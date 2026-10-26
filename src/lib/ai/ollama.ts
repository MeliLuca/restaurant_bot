// Assistente AI (PROTOTYPE) — Ollama client. SERVER ONLY (called from the
// /api/ai route handlers; the browser never talks to the model).
//
// * chatJson: structured output — Ollama constrains the reply to a JSON
//   schema (`format`), so a small model can't answer in prose or break JSON.
// * chatText: a short free-text reply (explanations, summaries).
// * A process-wide semaphore keeps at most AI_MAX_CONCURRENCY generations
//   running, so a busy service can't saturate the Mac mini; the others wait
//   in line up to AI_QUEUE_TIMEOUT_MS.
// * Every failure (server down, model missing, timeout, invalid JSON) is an
//   AiUnavailableError, so callers can degrade: the computed data still goes
//   out, only the explanation is missing (see tryAi).

import { aiConfig } from "./config";
import type { AiMeta } from "./contracts/common";

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "offline" | "timeout" | "busy" | "model" | "invalid",
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  /** Cap on generated tokens — also the guard against a looping model */
  numPredict?: number;
  timeoutMs?: number;
}

export interface ChatResult<T> {
  data: T;
  meta: AiMeta;
}

// --- semaphore (on globalThis: in dev every route is its own module graph) --

type Waiter = { resolve: () => void; timer: ReturnType<typeof setTimeout> };
interface Gate {
  running: number;
  queue: Waiter[];
}
const g = globalThis as unknown as { __aiGate?: Gate };
const gate: Gate = (g.__aiGate ??= { running: 0, queue: [] });

async function acquire(max: number, waitMs: number): Promise<void> {
  if (gate.running < max) {
    gate.running += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      timer: setTimeout(() => {
        gate.queue = gate.queue.filter((w) => w !== waiter);
        reject(new AiUnavailableError("The model is busy, try again", "busy"));
      }, waitMs),
    };
    gate.queue.push(waiter);
  });
  // the releasing request handed its slot over: running is unchanged
}

function release(): void {
  const next = gate.queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  } else {
    gate.running = Math.max(0, gate.running - 1);
  }
}

/** Requests currently generating / waiting (for /api/ai/health) */
export function gateStatus(): { running: number; waiting: number } {
  return { running: gate.running, waiting: gate.queue.length };
}

// --- chat ------------------------------------------------------------------

interface OllamaChatResponse {
  message?: { content?: string };
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  error?: string;
}

async function chat(
  messages: ChatMessage[],
  format: unknown,
  opts: ChatOptions,
): Promise<{ content: string; meta: AiMeta }> {
  const cfg = aiConfig();
  await acquire(cfg.maxConcurrency, cfg.queueTimeoutMs);
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${cfg.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream: false,
          ...(format ? { format } : {}),
          // thinking only slowed gemma4 down without improving it (llm_tests/)
          think: false,
          keep_alive: cfg.keepAlive,
          options: {
            temperature: opts.temperature ?? 0.2,
            num_ctx: cfg.numCtx,
            num_predict: opts.numPredict ?? 400,
          },
        }),
      });
    } catch (e) {
      if (controller.signal.aborted) {
        throw new AiUnavailableError(`No answer within ${timeoutMs} ms`, "timeout");
      }
      throw new AiUnavailableError(
        `Ollama unreachable at ${cfg.host}: ${e instanceof Error ? e.message : e}`,
        "offline",
      );
    }
    const body = (await res.json().catch(() => ({}))) as OllamaChatResponse;
    if (!res.ok) {
      throw new AiUnavailableError(
        body.error ?? `Ollama answered ${res.status}`,
        res.status === 404 ? "model" : "offline",
      );
    }
    const content = body.message?.content ?? "";
    const evalSeconds = (body.eval_duration ?? 0) / 1e9;
    return {
      content,
      meta: {
        model: cfg.model,
        ms: Date.now() - started,
        promptTokens: body.prompt_eval_count ?? null,
        outputTokens: body.eval_count ?? null,
        tokensPerSecond:
          evalSeconds > 0 && body.eval_count
            ? Math.round((body.eval_count / evalSeconds) * 10) / 10
            : null,
      },
    };
  } catch (e) {
    if (e instanceof AiUnavailableError) throw e;
    if (controller.signal.aborted) {
      throw new AiUnavailableError(`No answer within ${timeoutMs} ms`, "timeout");
    }
    throw new AiUnavailableError(e instanceof Error ? e.message : String(e), "offline");
  } finally {
    clearTimeout(timer);
    release();
  }
}

/** A reply constrained to `schema` (JSON Schema), parsed. */
export async function chatJson<T>(
  messages: ChatMessage[],
  schema: object,
  opts: ChatOptions = {},
): Promise<ChatResult<T>> {
  const { content, meta } = await chat(messages, schema, opts);
  try {
    return { data: JSON.parse(content) as T, meta };
  } catch {
    throw new AiUnavailableError("The model returned invalid JSON", "invalid");
  }
}

/** A short free-text reply, trimmed. */
export async function chatText(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResult<string>> {
  const { content, meta } = await chat(messages, null, opts);
  return { data: content.trim(), meta };
}

/**
 * Graceful degradation: the model's part, or null when the model is
 * unavailable. Programming errors still throw.
 */
export async function tryAi<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      console.warn(`[ai] ${e.reason}: ${e.message}`);
      return null;
    }
    throw e;
  }
}

// --- health ----------------------------------------------------------------

export interface OllamaHealth {
  reachable: boolean;
  host: string;
  model: string;
  version: string | null;
  /** the configured model is pulled on this server */
  installed: boolean;
  /** …and currently loaded in memory (first answer is fast) */
  loaded: boolean;
  /** size in memory when loaded, bytes */
  sizeBytes: number | null;
  error: string | null;
}

async function getJson<T>(url: string, ms: number): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

const sameModel = (a: string, b: string) =>
  a === b || a === `${b}:latest` || b === `${a}:latest`;

export async function ollamaHealth(): Promise<OllamaHealth> {
  const cfg = aiConfig();
  const out: OllamaHealth = {
    reachable: false,
    host: cfg.host,
    model: cfg.model,
    version: null,
    installed: false,
    loaded: false,
    sizeBytes: null,
    error: null,
  };
  try {
    const [version, tags, ps] = await Promise.all([
      getJson<{ version: string }>(`${cfg.host}/api/version`, 3000),
      getJson<{ models: { name: string }[] }>(`${cfg.host}/api/tags`, 3000),
      getJson<{ models: { name: string; size: number }[] }>(`${cfg.host}/api/ps`, 3000),
    ]);
    out.reachable = true;
    out.version = version.version;
    out.installed = tags.models.some((m) => sameModel(m.name, cfg.model));
    const running = ps.models.find((m) => sameModel(m.name, cfg.model));
    out.loaded = !!running;
    out.sizeBytes = running?.size ?? null;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
