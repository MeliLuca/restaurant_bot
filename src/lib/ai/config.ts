// Assistente AI (PROTOTYPE) — runtime configuration. SERVER ONLY.
//
// The module is sized for one machine: a Mac mini M4 with 32 GB of unified
// memory running everything at once (Supabase in Docker, Next, Ollama). A
// small, fast model is the point — the app's own code computes every number,
// the model only reads free text and writes short explanations.
//
// Everything can be overridden from the environment, so the same code runs
// (slowly) on a CPU-only dev laptop: raise AI_TIMEOUT_MS there.

export const AI_PROFILE = {
  id: "mac-mini-m4-32gb",
  label: "Mac mini M4 · 32 GB",
  ramGb: 32,
  /** ≈ 6.6 GB: the winner of llm_tests/ (quality 0.87, JSON always valid) */
  defaultModel: "gemma4:e4b",
  /** Optional, ≈ 18 GB MoE (~4B active): better Italian, tight next to Docker */
  qualityModel: "gemma4:26b",
  /** Prompts are kept short (no full menu), 8k leaves room for chat history */
  numCtx: 8192,
  /** Requests to the model at the same time; the rest wait in line */
  maxConcurrency: 2,
  keepAlive: "30m",
  timeoutMs: 30_000,
  /** How long a request may wait for a free slot before giving up */
  queueTimeoutMs: 20_000,
} as const;

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

export interface AiConfig {
  /** AI_PROTOTYPE=1 — without it every /api/ai route answers 404 */
  prototype: boolean;
  host: string;
  model: string;
  numCtx: number;
  maxConcurrency: number;
  keepAlive: string;
  timeoutMs: number;
  queueTimeoutMs: number;
}

/** Read on every call, so a changed .env.local needs only a server restart */
export function aiConfig(): AiConfig {
  return {
    prototype: process.env.AI_PROTOTYPE === "1",
    host: (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, ""),
    model: process.env.AI_MODEL || AI_PROFILE.defaultModel,
    numCtx: intEnv("AI_NUM_CTX", AI_PROFILE.numCtx),
    maxConcurrency: intEnv("AI_MAX_CONCURRENCY", AI_PROFILE.maxConcurrency),
    keepAlive: process.env.AI_KEEP_ALIVE || AI_PROFILE.keepAlive,
    timeoutMs: intEnv("AI_TIMEOUT_MS", AI_PROFILE.timeoutMs),
    queueTimeoutMs: intEnv("AI_QUEUE_TIMEOUT_MS", AI_PROFILE.queueTimeoutMs),
  };
}
