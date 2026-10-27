// Assistente AI — tables: one request, start to end. SERVER ONLY.
// 1. what is asked: explicit fields, else the text (model, checked; regex
//    reader without it);
// 2. when: now (± 15 min) → walk-in finder, later → booking suggestions;
// 3. the engine picks (suggest.ts);
// 4. the model explains the best option in a sentence or two, from the
//    computed options only — and the sentence is dropped if it brings a
//    number of its own.

import type { AiMeta } from "@/lib/ai/contracts/common";
import {
  TABLES_MAX_PARTY,
  TABLES_NOW_MINUTES,
  type TablePreviousRequest,
  type TableSuggestion,
  type TableSuggestRequest,
  type TableSuggestResponse,
} from "@/lib/ai/contracts/tables";
import { chatText, tryAi, type ChatResult } from "@/lib/ai/ollama";
import {
  extractWithModel,
  mergeReadings,
  parseTextFallback,
  type Understood,
} from "./extract";
import {
  loadBookingFloor,
  loadNowFloor,
  loadVocabulary,
  suggestBookingFrom,
  suggestNowFrom,
  timeText,
} from "./suggest";

const MINUTE = 60_000;

/** A request that can't be answered as asked: 400 with this message */
export class TablesRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TablesRequestError";
  }
}

export type Start = { mode: "now" } | { mode: "booking"; start: number };

/**
 * When the party sits. "HH:MM" is today, or tomorrow once today's is past
 * (asking "alle 21" at 23:00); an ISO datetime must not be past. Within
 * TABLES_NOW_MINUTES of now either way it is now: a walk-in.
 */
export function resolveStart(time: string | null, now: number): Start {
  if (time === null) return { mode: "now" };
  const near = TABLES_NOW_MINUTES * MINUTE;
  const hm = time.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  let start: number;
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) throw new TablesRequestError(`Orario non valido: ${time}`);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() < now - near) d.setDate(d.getDate() + 1);
    start = d.getTime();
  } else {
    start = Date.parse(time);
    if (Number.isNaN(start)) throw new TablesRequestError(`Orario non valido: ${time}`);
    if (start < now - near) throw new TablesRequestError("Quell'orario è già passato.");
  }
  return Math.abs(start - now) <= near ? { mode: "now" } : { mode: "booking", start };
}

/** Sum of the model calls of one answer */
function mergeMeta(metas: (AiMeta | null)[]): AiMeta | null {
  const ok = metas.filter((m): m is AiMeta => m !== null);
  if (ok.length === 0) return null;
  const sum = (k: "promptTokens" | "outputTokens") =>
    ok.every((m) => m[k] === null) ? null : ok.reduce((s, m) => s + (m[k] ?? 0), 0);
  return {
    model: ok[ok.length - 1].model,
    ms: ok.reduce((s, m) => s + m.ms, 0),
    promptTokens: sum("promptTokens"),
    outputTokens: sum("outputTokens"),
    tokensPerSecond: ok[ok.length - 1].tokensPerSecond,
  };
}

const KIND_WORD: Record<TableSuggestion["kind"], string> = {
  free: "libero",
  dirty: "da pulire",
  finishing: "sta per liberarsi",
  booking: "prenotabile",
};

/** What the model is told: the computed options, nothing else */
export function explanationPrompt(
  partySize: number,
  start: number | null,
  options: TableSuggestion[],
  tagNames: string[] = [],
): string {
  const lines = options.slice(0, 4).map((o, i) => {
    const room = o.mapName ? ` (${o.mapName})` : "";
    // which of the asked features it has — what the guest asked for comes
    // before seats in the explanation
    const fit =
      tagNames.length === 0
        ? ""
        : / senza /.test(` ${o.reason} `)
          ? ""
          : ` [ha tutto ciò che è chiesto: ${tagNames.join(", ")}]`;
    return `${i + 1}. Tavolo ${o.tableNames.join(" + ")}${room}, ${o.seats} posti, ${KIND_WORD[o.kind]}: ${o.reason}${fit}`;
  });
  const asked = tagNames.length ? `, con ${tagNames.join(", ")}` : "";
  return (
    `Richiesta: ${partySize} persone, ${start === null ? "adesso" : `alle ${timeText(start)}`}${asked}.\n` +
    `Opzioni calcolate (la 1 è la migliore):\n${lines.join("\n")}`
  );
}

/** The sentence, or null when it says a number the facts don't */
export function checkExplanation(text: string, facts: string): string | null {
  const clean = text.replace(/\*\*?|__|`/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const known = new Set(facts.match(/\d+/g) ?? []);
  const said = clean.match(/\d+/g) ?? [];
  return said.every((n) => known.has(n)) ? clean : null;
}

async function explain(
  partySize: number,
  start: number | null,
  options: TableSuggestion[],
  tagNames: string[],
): Promise<ChatResult<string | null>> {
  const facts = explanationPrompt(partySize, start, options, tagNames);
  const { data, meta } = await chatText(
    [
      {
        role: "system",
        content:
          "Sei l'assistente di sala di un ristorante. In una o due frasi brevi, in italiano, " +
          "di' al cameriere perché l'opzione 1 è la migliore (e, se utile, l'alternativa): " +
          "prima le esigenze richieste che rispetta, poi il resto. " +
          "Usa solo i fatti dati: non inventare tavoli, numeri o orari.",
      },
      { role: "user", content: facts },
    ],
    { numPredict: 90, temperature: 0.3 },
  );
  return { data: checkExplanation(data, facts), meta };
}

/** Hand-checked request → what to look for */
export interface ParsedRequest {
  text: string | null;
  partySize: number | null;
  time: string | null;
  tagIds: string[] | null;
  /** undefined = not given; null = anywhere */
  mapId: string | null | undefined;
  /** the conversation's request so far (lowest priority) */
  previous: TablePreviousRequest | null;
}

function parsePrevious(raw: unknown): TablePreviousRequest | null {
  if (raw === undefined || raw === null) return null;
  const p = raw as Partial<TablePreviousRequest>;
  const ok =
    typeof p === "object" &&
    typeof p.partySize === "number" &&
    Number.isInteger(p.partySize) &&
    p.partySize >= 1 &&
    p.partySize <= TABLES_MAX_PARTY &&
    (p.time === null || (typeof p.time === "string" && !Number.isNaN(Date.parse(p.time)))) &&
    Array.isArray(p.tagIds) &&
    p.tagIds.every((id) => typeof id === "string") &&
    (p.mapId === null || typeof p.mapId === "string");
  if (!ok) throw new TablesRequestError("previous must be a previous answer's request");
  return {
    partySize: p.partySize!,
    time: p.time ?? null,
    tagIds: p.tagIds!,
    mapId: p.mapId ?? null,
  };
}

export function parseRequest(body: Record<string, unknown>): ParsedRequest {
  const { text, partySize, time, tagIds, mapId, previous } = body as TableSuggestRequest &
    Record<string, unknown>;
  if (text !== undefined && typeof text !== "string") throw new TablesRequestError("text must be a string");
  if (typeof text === "string" && text.length > 500) throw new TablesRequestError("text is too long");
  if (
    partySize !== undefined &&
    !(typeof partySize === "number" && Number.isInteger(partySize) && partySize >= 1 && partySize <= TABLES_MAX_PARTY)
  ) {
    throw new TablesRequestError(`partySize must be a whole number from 1 to ${TABLES_MAX_PARTY}`);
  }
  if (time !== undefined && typeof time !== "string") throw new TablesRequestError("time must be a string");
  if (
    tagIds !== undefined &&
    !(Array.isArray(tagIds) && tagIds.every((id) => typeof id === "string"))
  ) {
    throw new TablesRequestError("tagIds must be a list of ids");
  }
  if (mapId !== undefined && mapId !== null && typeof mapId !== "string") {
    throw new TablesRequestError("mapId must be an id or null");
  }
  const trimmed = typeof text === "string" ? text.trim() : "";
  return {
    text: trimmed || null,
    partySize: partySize ?? null,
    time: typeof time === "string" && time.trim() ? time.trim() : null,
    tagIds: tagIds ?? null,
    mapId,
    previous: parsePrevious(previous),
  };
}

export async function suggestForRequest(
  req: ParsedRequest,
  now: number = Date.now(),
): Promise<TableSuggestResponse> {
  const vocab = await loadVocabulary();
  const prev = req.previous;
  const unknownTag = [...(req.tagIds ?? []), ...(prev?.tagIds ?? [])].find(
    (id) => !vocab.tags.some((t) => t.id === id),
  );
  if (unknownTag) throw new TablesRequestError(`Unknown table feature: ${unknownTag}`);
  if (req.mapId && !vocab.allMapIds.has(req.mapId)) {
    throw new TablesRequestError(`Unknown room: ${req.mapId}`);
  }

  // 1. what is asked — the model only when the fields don't say it all
  let read: Understood | null = null;
  let readMeta: AiMeta | null = null;
  /** the model just failed: don't make the waiter wait for it twice */
  let modelDown = false;
  const needsText =
    req.text !== null &&
    (req.partySize === null || req.time === null || req.tagIds === null || req.mapId === undefined);
  if (needsText) {
    const model = await tryAi(() => extractWithModel(req.text!, vocab));
    readMeta = model?.meta ?? null;
    modelDown = model === null;
    read = mergeReadings(model?.data ?? null, parseTextFallback(req.text!, vocab));
  }
  const partySize = req.partySize ?? read?.partySize ?? prev?.partySize ?? null;
  if (partySize === null) {
    throw new TablesRequestError(
      req.text
        ? "Non ho capito per quante persone: scrivilo (es. \"4 persone alle 21\") o usa il campo Persone."
        : "Quante persone? Scrivi la richiesta o indica il numero di persone.",
    );
  }
  // a follow-up keeps what was asked before: features add up, minus the
  // ones the text takes back
  const removed = read?.removedTagIds ?? [];
  const asked = req.tagIds ?? [
    ...(prev?.tagIds ?? []),
    ...(read?.tagIds ?? []).filter((id) => !(prev?.tagIds ?? []).includes(id)),
  ];
  const walkIn = {
    partySize,
    tagIds: req.tagIds ? asked : asked.filter((id) => !removed.includes(id)),
    mapId: req.mapId !== undefined ? req.mapId : read?.mapId ?? prev?.mapId ?? null,
  };

  // 2. when, 3. the engine — a previous time holds unless the text says
  // another one, or now; once it has passed it is now
  const prevTime =
    prev?.time && !read?.saysNow && Date.parse(prev.time) > now - TABLES_NOW_MINUTES * MINUTE
      ? prev.time
      : null;
  const when = resolveStart(req.time ?? read?.hhmm ?? prevTime, now);
  const start = when.mode === "booking" ? when.start : null;
  const computed =
    when.mode === "now"
      ? suggestNowFrom(await loadNowFloor(now), walkIn)
      : suggestBookingFrom(await loadBookingFloor(when.start, now), walkIn, when.start);

  // 4. the explanation — never when there's nothing to explain
  const explained =
    computed.options.length > 0 && !modelDown
      ? await tryAi(() =>
          explain(
            partySize,
            start,
            computed.options,
            walkIn.tagIds.map((id) => vocab.tags.find((t) => t.id === id)?.name ?? id),
          ),
        )
      : null;

  return {
    request: {
      partySize,
      time: start === null ? null : new Date(start).toISOString(),
      tagIds: walkIn.tagIds,
      tagNames: walkIn.tagIds.map((id) => vocab.tags.find((t) => t.id === id)?.name ?? id),
      mapId: walkIn.mapId,
      mode: when.mode,
    },
    options: computed.options,
    reason: computed.reason,
    notes: computed.notes,
    explanation: explained?.data ?? null,
    ai: mergeMeta([readMeta, explained?.meta ?? null]),
  };
}
