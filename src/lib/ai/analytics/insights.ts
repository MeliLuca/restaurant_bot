// Assistente AI — analytics: the model's few observations. SERVER ONLY.
//
// The model never sees an order: it gets a compact, rounded digest (totals +
// top/bottom 5) and writes 3–5 short remarks. Every number it writes must be
// one of the digest's — a remark quoting anything else is dropped, so a small
// model can't slip an invented figure onto the owner's screen.

import { chatJson, tryAi } from "@/lib/ai/ollama";
import type { AiMeta } from "@/lib/ai/contracts/common";

const SCHEMA = {
  type: "object",
  properties: {
    osservazioni: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 5,
    },
  },
  required: ["osservazioni"],
};

const SYSTEM = [
  "Sei il consulente di un ristorante italiano. Ricevi SOLO dati già calcolati, in JSON.",
  "Scrivi da 3 a 5 osservazioni in italiano, una frase ciascuna (massimo 25 parole).",
  "Usa solo i numeri presenti nei dati, scritti come sono: non calcolarne di nuovi e non inventarne.",
  "Ogni osservazione deve suggerire un'azione concreta: {focus}.",
  "Niente saluti, niente premesse.",
].join(" ");

const FOCUS = {
  tavoli:
    "quali tavoli far sedere per primi, quali tavoli o sale rendono poco, come aumentare le rotazioni",
  prodotti:
    "quali piatti spingere, quali riprezzare o togliere, dove il food cost è alto, quali costi mancano",
};

export const WEEKDAY_IT = [
  "domenica",
  "lunedì",
  "martedì",
  "mercoledì",
  "giovedì",
  "venerdì",
  "sabato",
];

/** Rounding for the digest: whole euros, 1-decimal ratios, whole percents */
export const r0 = (n: number) => Math.round(n);
export const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
/** "30%" — as text, so the model quotes "30%" rather than "food cost pct di 30" */
export const pct = (n: number | null) => (n === null ? null : `${Math.round(n * 100)}%`);

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

/** Every number the digest contains (values and digits inside names/dates) */
function allowedNumbers(digest: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v, Math.abs(v));
    // names too: "Leffe — cl 0,25", "102/1", dates
    else if (typeof v === "string") (v.match(NUMBER_RE) ?? []).forEach((m) => out.push(...readings(m)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(digest);
  return out;
}

/** The ways an Italian/English number token can be read ("1.234", "12,5") */
function readings(token: string): number[] {
  const values = [Number(token.replace(",", "."))];
  if (/^\d{1,3}([.,]\d{3})+$/.test(token)) values.push(Number(token.replace(/[.,]/g, "")));
  if (/^\d+,\d+$/.test(token)) values.push(Number(token.replace(",", ".")));
  return values.filter((n) => Number.isFinite(n));
}

function quotesOnlyGiven(text: string, allowed: number[]): boolean {
  const tokens = text.match(NUMBER_RE) ?? [];
  return tokens.every((tok) =>
    readings(tok).some(
      // small counts ("i 3 tavoli", "5 piatti") are always fine
      (n) => (Number.isInteger(n) && n <= 10) || allowed.some((a) => Math.abs(a - n) < 0.051),
    ),
  );
}

const TABLE_RE = /\btavol[oi]\s+(?:n\.?\s*)?([A-Za-zÀ-ÿ0-9/]+)/gi;

/** "tavolo 12" must name a real table (a count read as a name is dropped) */
function namesRealTables(text: string, known: Set<string>): boolean {
  const re = new RegExp(TABLE_RE.source, "gi");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (/\d/.test(m[1]) && !known.has(m[1].toLowerCase())) return false;
  }
  return true;
}

/**
 * 3–5 observations on `digest`, or null when the model is unavailable or
 * every remark had to be dropped. `tableNames`: the venue's tables, to check
 * the "tavolo N" a remark mentions.
 */
export async function writeObservations(
  kind: keyof typeof FOCUS,
  digest: object,
  tableNames: string[] = [],
): Promise<{ insights: string[]; ai: AiMeta } | null> {
  const res = await tryAi(() =>
    chatJson<{ osservazioni?: unknown }>(
      [
        { role: "system", content: SYSTEM.replace("{focus}", FOCUS[kind]) },
        { role: "user", content: JSON.stringify(digest) },
      ],
      SCHEMA,
      { numPredict: 220, temperature: 0.3 },
    ),
  );
  if (!res) return null;
  const allowed = allowedNumbers(digest);
  const known = new Set(tableNames.map((n) => n.toLowerCase()));
  const raw = Array.isArray(res.data.osservazioni) ? res.data.osservazioni : [];
  const insights = raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0 && s.length <= 400)
    .filter((s) => {
      const ok = quotesOnlyGiven(s, allowed) && namesRealTables(s, known);
      if (!ok) console.warn(`[ai] analytics: dropped a remark with an unknown figure: ${s}`);
      return ok;
    })
    .slice(0, 5);
  return insights.length > 0 ? { insights, ai: res.meta } : null;
}
