// Assistente AI — order task: free text → ExtractedItem[]. SERVER ONLY.
//
// The model reads the text (corrections, dialect, English, intent) and
// returns words only — no ids, no prices. When it is unavailable, a plain
// rule-based reader does the simple cases ("2 margherite senza basilico,
// 1202 ben cotta") so the waiter is never left with nothing.
// Either way, the safety rules are applied here, not trusted to the model:
// allergies always go to staff, a manipulation attempt is refused whole
// (looksLikeManipulation), a refusal never carries dishes, and a reply that
// talks money is dropped.

import { normalize } from "@/lib/menu-search";
import type { AiMeta } from "../contracts/common";
import type { ExtractedItem, OrderParseStatus } from "../contracts/order";
import { chatJson, tryAi } from "../ollama";
import { EXTRACT_SCHEMA, extractMessages } from "./prompts";
import { sigWords } from "./text";

export interface Extraction {
  status: OrderParseStatus;
  items: ExtractedItem[];
  reply: string | null;
  by: "ai" | "rules";
  ai: AiMeta | null;
}

interface ModelReply {
  status?: string;
  items?: unknown;
  risposta?: string;
}

const STATUSES: OrderParseStatus[] = ["ok", "clarify", "staff", "refuse"];

/** Allergies & co. — a person must confirm, whatever the model said */
const ALLERGY = /\b(allerg\w*|celiac\w*|glutin\w*|gluten\w*|intolleran\w*|lattosio|lactose|coeliac\w*|anafilass\w*|nichel)\b/;
/**
 * Manipulation — ONE general criterion, not a list of known attacks: a
 * waiter's order talks about dishes. A message that talks to or about the
 * assistant itself (its rules, instructions, prompt, system, identity, role,
 * mode, how it should answer), about money (free, discounts, prices), or
 * that carries fake chat-role / section markers is refused WHOLE, whatever
 * the model answered. Only the subject counts, never order verbs: "ignora la
 * birra di prima", "togli", "anzi", "offre lui" stay orders.
 */
const OFF_ORDER = new RegExp(
  "\\b(" +
    // the assistant itself
    "prompt\\w*|istruzion\\w*|instruction\\w*|regol[ae]|rules?|system\\w*|assistant\\w*|assistente|" +
    "modalita|mode|ruolo|role\\w*|fingi|pretend\\w*|rispond\\w*|respond\\w*|reply|" +
    "you are now|sei ora|ora sei|da ora|from now on|" +
    // money
    "gratis|gratuit\\w*|free|omagg\\w*|regal\\w*|scont\\w*|discount\\w*|prezz\\w*|pric\\w*|costs?|cost[ao]|costano|euro?s?" +
    ")\\b",
);
/** A line opened by a chat role, or prompt-format tokens: "SYSTEM:", "###", "[INST]", "<|im_start|>" */
const ROLE_MARKER = /^\s*(system|assistant|developer)\s*:|#{2,}|\[\/?inst\]|<\|[^|>]*\|>/im;

export function looksLikeManipulation(text: string): boolean {
  // "gluten-free", "alcohol-free" mean "without", not money
  return ROLE_MARKER.test(text) || OFF_ORDER.test(normalize(text.replace(/-\s*free\b/gi, " senza")));
}

/** A reply mentioning money is never shown: prices come from the app */
const MONEY = /(€|\$|\beur\w*|\bprezz\w*|\bpric\w*|\bcost\w*|\btotal\w*|\bgratis\b|\bfree\b|\bscont\w*|\bdiscount\w*|\bomagg\w*|\d+[.,]\d{2})/i;

function asStrings(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out = x.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return out.length > 0 ? out.map((s) => s.trim()) : undefined;
}

/** The model's items, shape-checked (the schema constrains it, but trust nothing) */
function cleanItems(raw: unknown): ExtractedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): ExtractedItem[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const piatto = typeof o.piatto === "string" ? o.piatto.trim() : "";
    if (!piatto) return [];
    const q = typeof o.quantita === "number" ? Math.round(o.quantita) : 1;
    return [
      {
        quantita: Math.max(1, Math.min(20, q)),
        piatto,
        categoria: typeof o.categoria === "string" ? o.categoria.trim() : undefined,
        senza: asStrings(o.senza),
        extra: asStrings(o.extra),
        note: asStrings(o.note),
      },
    ];
  });
}

// --- rule-based fallback -----------------------------------------------------

const QTY_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, "un'": 1, a: 1, an: 1, one: 1,
  due: 2, do: 2, two: 2, tre: 3, three: 3, quattro: 4, four: 4,
  cinque: 5, five: 5, sei: 6, six: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
};

/** A chunk that starts a new dish: a quantity, or a codice */
function startsDish(chunk: string): boolean {
  const first = chunk.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^\d+$/.test(first) || first in QTY_WORDS;
}

/** One dish's words → quantity, name, senza / con / notes */
function readChunk(chunk: string, quickNotes: string[]): ExtractedItem | null {
  let text = ` ${chunk.trim()} `;
  const note: string[] = [];
  // note rapide by name, longest first ("poco cotta" before "cotta")
  [...quickNotes]
    .sort((a, b) => b.length - a.length)
    .forEach((n) => {
      const re = new RegExp(`\\s${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`, "i");
      if (re.test(text)) {
        note.push(n);
        text = text.replace(re, " ");
      }
    });
  const words = text.trim().split(/\s+/);
  let quantita = 1;
  const first = words[0]?.toLowerCase() ?? "";
  if (/^\d{1,2}$/.test(first) && Number(first) <= 20 && words.length > 1) {
    quantita = Number(first);
    words.shift();
  } else if (first in QTY_WORDS) {
    quantita = QTY_WORDS[first];
    words.shift();
  }
  // split the rest at "senza" / "con": name first, then the variations
  const senza: string[] = [];
  const extra: string[] = [];
  const name: string[] = [];
  let mode: "name" | "senza" | "extra" = "name";
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const phrase = current.join(" ");
    if (mode === "senza") senza.push(...phrase.split(/\s*,\s*|\s+e\s+/));
    else if (mode === "extra") extra.push(...phrase.split(/\s*,\s*|\s+e\s+/));
    current = [];
  };
  words.forEach((w) => {
    const lw = w.toLowerCase().replace(/,$/, "");
    if (lw === "senza" || lw === "without" || lw === "no") {
      flush();
      mode = "senza";
    } else if (["con", "col", "with", "extra", "aggiungi", "più", "piu"].includes(lw)) {
      flush();
      mode = "extra";
    } else if (mode === "name") {
      name.push(w);
    } else {
      current.push(w);
    }
  });
  flush();
  const piatto = name.join(" ").replace(/[,.]+$/, "").trim();
  if (!piatto) return null;
  return {
    quantita,
    piatto,
    senza: senza.filter(Boolean),
    extra: extra.filter(Boolean),
    note,
  };
}

export function ruleExtract(text: string, quickNotes: string[]): Extraction {
  const n = normalize(text);
  if (!ALLERGY.test(n) && looksLikeManipulation(text)) {
    return { status: "refuse", items: [], reply: null, by: "rules", ai: null };
  }
  // split into dishes: lines, then commas / " e " / " poi " — a chunk that
  // does not start with a quantity or codice belongs to the previous dish
  // ("pizza con burrata, crudo e pistacchio" stays one)
  const chunks: string[] = [];
  text.split(/\n+/).forEach((line) => {
    let first = true;
    line.split(/\s*[,;]\s*|\s+(?:e|ed|poi|and|plus)\s+/i).forEach((c) => {
      const t = c.trim();
      if (!t) return;
      if (!first && !startsDish(t)) chunks[chunks.length - 1] += `, ${t}`;
      else chunks.push(t);
      first = false;
    });
  });
  const items = chunks.flatMap((c) => {
    const item = readChunk(c, quickNotes);
    return item ? [item] : [];
  });
  return {
    status: ALLERGY.test(n) ? "staff" : "ok",
    items,
    reply: null,
    by: "rules",
    ai: null,
  };
}

/** Corrections the rules cannot follow: when present, the model's word stands */
const CORRECTION = /\b(anzi|aspetta|togli\w*|meglio|invece|cambia\w*|actually|instead|remove)\b/;

/**
 * The small model sometimes drops a "senza X" it thinks the dish lacks
 * ("margherita senza basilico"), or hangs the next dish's "ben cotta" on this
 * one. The rule reader does neither on a plain text: when there are no
 * corrections, a dish the rules read the same way (same written name) gets
 * the removals the rules found if the model has none, and keeps only the
 * note rapide the rules saw in its own words. Anything the rules could not
 * pair (English, dialect, odd phrasing) is left to the model.
 */
function reconcileWithRules(items: ExtractedItem[], text: string, quickNotes: string[]): ExtractedItem[] {
  if (CORRECTION.test(normalize(text))) return items;
  const rules = ruleExtract(text, quickNotes).items;
  const key = (p: string) => sigWords(p).join(" ");
  return items.map((item) => {
    const twins = rules.filter((r) => key(r.piatto) === key(item.piatto));
    if (twins.length !== 1) return item;
    const twin = twins[0];
    const note = item.note?.filter((n) => !quickNotes.includes(n) || twin.note?.includes(n));
    return {
      ...item,
      senza: item.senza?.length ? item.senza : twin.senza,
      note: note?.length ? note : undefined,
    };
  });
}

// --- model -------------------------------------------------------------------

export async function extractOrder(
  text: string,
  categories: string[],
  quickNotes: string[],
): Promise<Extraction> {
  const result = await tryAi(() =>
    chatJson<ModelReply>(extractMessages(text, categories, quickNotes), EXTRACT_SCHEMA, {
      numPredict: 200,
      temperature: 0.1,
    }),
  );
  if (!result) return ruleExtract(text, quickNotes);

  const { data, meta } = result;
  const n = normalize(text);
  let status: OrderParseStatus = STATUSES.includes(data.status as OrderParseStatus)
    ? (data.status as OrderParseStatus)
    : "ok";
  let items = reconcileWithRules(cleanItems(data.items), text, quickNotes);
  let reply = typeof data.risposta === "string" ? data.risposta.trim().slice(0, 240) : "";
  if (ALLERGY.test(n)) status = "staff";
  else if (looksLikeManipulation(text) && status !== "refuse") {
    // the model went along with it: its reply ("OK", "aggiunte 20 birre") goes too
    status = "refuse";
    reply = "";
  }
  // consistency: a refusal never carries dishes, whoever decided it
  if (status === "refuse") items = [];
  if (reply && MONEY.test(reply) && status !== "refuse") reply = "";
  // a refusal may say "nothing for free", but never a figure
  if (reply && status === "refuse" && /(€|\d+[.,]\d{2})/.test(reply)) reply = "";
  return { status, items, reply: reply || null, by: "ai", ai: meta };
}
