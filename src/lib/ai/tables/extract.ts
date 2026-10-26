// Assistente AI — tables: what a request for a table asks for. SERVER ONLY
// (the model call); the parsing and validation are pure and tested alone.
//
// The model reads the text into {persone, orario, esigenze, sala}; nothing it
// returns is trusted as is:
// * persone must be a whole 1..60 that the text says (a number, a number
//   word, or two of them added up: "4 adulti e 2 bambini");
// * orario must be HH:MM whose hour the text says;
// * esigenze / sala must name a real table feature / bookable room.
// Features also come from a fixed synonym table run on the text itself
// ("carrozzina" → Accessible), so the model is only a hint there. Without
// the model, a small regex reader takes its place.

import type { FloorMap, TableTag } from "@/lib/database.types";
import { chatJson, type ChatResult } from "@/lib/ai/ollama";
import { TABLES_MAX_PARTY } from "@/lib/ai/contracts/tables";

export interface TablesVocabulary {
  tags: TableTag[];
  /** Rooms a party can ask for (bookable ones) */
  maps: FloorMap[];
}

/** The model's reply, as constrained by extractionSchema */
export interface RawExtraction {
  persone: number | null;
  orario: string | null;
  esigenze: string[];
  sala: string | null;
}

/** A request read from text, every field checked against the text and the data */
export interface Understood {
  partySize: number | null;
  /** "HH:MM", 24 h */
  hhmm: string | null;
  tagIds: string[];
  mapId: string | null;
}

/** Lower case, no accents: "Disabilità" → "disabilita" */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7,
  otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13,
  quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18,
  diciannove: 19, venti: 20, ventuno: 21, ventidue: 22, ventitre: 23,
  trenta: 30, quaranta: 40, cinquanta: 50, sessanta: 60,
};
const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;

function numberOf(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

/** Every number the (normalized) text says, digits or words; "coppia" = 2 */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of Array.from(text.matchAll(/\d+/g))) out.push(Number(m[0]));
  for (const w of text.split(/[^a-z]+/)) {
    if (w in NUMBER_WORDS) out.push(NUMBER_WORDS[w]);
  }
  if (/\bcoppia\b/.test(text)) out.push(2);
  return out;
}

/** The party size can be a number of the text, or two of them added up */
function textSaysParty(text: string, n: number): boolean {
  const nums = numbersIn(text);
  if (nums.includes(n)) return true;
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] === n) return true;
  }
  return false;
}

const validParty = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= TABLES_MAX_PARTY;

/**
 * "HH:MM" from an hour and minutes said in a request. A restaurant serves
 * lunch and dinner: "alle 9" is 21:00 (unless it says "mattina").
 */
function hhmmOf(h: number, m: number, text: string): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  const hour = h >= 1 && h <= 10 && !/\bmattin/.test(text) ? h + 12 : h;
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// --- features -----------------------------------------------------------------

/**
 * Italian (and English) ways of asking for a feature, and how such a feature
 * is called in Settings. Tags are matched by name, so this works whatever
 * language the tags were named in.
 */
const FEATURE_SYNONYMS: { asked: RegExp; tag: RegExp }[] = [
  {
    asked: /\b(disabil\w*|carrozzin\w*|sedia a rotelle|rotelle|accessibil\w*|handicap\w*|deambul\w*|wheelchair|accessible)\b/,
    tag: /accessib|disabil|carrozzin|wheelchair/,
  },
  {
    asked: /\b(bambin\w*|bimb\w*|seggiolon\w*|passeggin\w*|neonat\w*|piccoli|kids?|child\w*)\b/,
    tag: /child|bambin|kid|famigl|seggiolon/,
  },
  {
    asked: /\b(finestr\w*|vetrat\w*|vista|window)\b/,
    tag: /window|finestr|vetrat/,
  },
  {
    asked: /\b(tv|tivu|televisor\w*|televisione|partita|maxischermo|schermo|calcio|screen)\b/,
    tag: /\btv\b|screen|schermo|televis/,
  },
];

const wordIn = (text: string, phrase: string) =>
  phrase.length > 0 &&
  new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(
    text,
  );

/** Features a piece of text asks for: a tag's own name, or a synonym */
export function tagsFromText(text: string, tags: TableTag[]): string[] {
  const t = normalize(text);
  const out = new Set<string>();
  for (const tag of tags) {
    if (wordIn(t, normalize(tag.name))) out.add(tag.id);
  }
  for (const syn of FEATURE_SYNONYMS) {
    if (!syn.asked.test(t)) continue;
    for (const tag of tags) if (syn.tag.test(normalize(tag.name))) out.add(tag.id);
  }
  return tags.filter((tg) => out.has(tg.id)).map((tg) => tg.id);
}

/** A bookable room by name ("sala", "Giardino") */
export function matchMap(name: string, maps: FloorMap[]): string | null {
  const n = normalize(name);
  return maps.find((m) => normalize(m.name) === n)?.id ?? null;
}

/** A bookable room the text names, if exactly one */
export function mapFromText(text: string, maps: FloorMap[]): string | null {
  const t = normalize(text);
  const named = maps.filter((m) => wordIn(t, normalize(m.name)));
  return named.length === 1 ? named[0].id : null;
}

// --- reading without the model -------------------------------------------------

/** The regex reader: the fallback when the model is unavailable */
export function parseTextFallback(text: string, vocab: TablesVocabulary): Understood {
  const t = normalize(text);
  let partySize: number | null = null;
  const party = [
    new RegExp(`\\b${NUM}\\s*(?:persone|persona|pers\\b|pax|coperti|ospiti|adulti|posti)`),
    new RegExp(`\\bsiamo\\s+(?:in\\s+)?${NUM}\\b`),
    new RegExp(`\\b(?:tavolo|posto|prenotazione)\\s+(?:per|da)\\s+${NUM}\\b`),
    new RegExp(`\\bper\\s+${NUM}\\b(?!\\s*[:.]\\d)`),
  ];
  for (const re of party) {
    const m = t.match(re);
    const n = m ? numberOf(m[1]) : null;
    if (validParty(n)) {
      partySize = n;
      break;
    }
  }
  if (partySize === null && /\b(coppia|in due)\b/.test(t)) partySize = 2;

  let hhmm: string | null = null;
  const clock = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  const said = t.match(
    new RegExp(`\\b(?:alle|ore|per le|verso le|dalle)\\s+${NUM}(?:\\s+e\\s+(mezza|mezzo|un quarto|tre quarti))?\\b`),
  );
  if (clock) {
    hhmm = hhmmOf(Number(clock[1]), Number(clock[2]), t);
  } else if (said) {
    const h = numberOf(said[1]);
    const m = said[2] === "un quarto" ? 15 : said[2] === "tre quarti" ? 45 : said[2] ? 30 : 0;
    if (h !== null) hhmm = hhmmOf(h, m, t);
  }

  return {
    partySize,
    hhmm,
    tagIds: tagsFromText(text, vocab.tags),
    mapId: mapFromText(text, vocab.maps),
  };
}

// --- the model -----------------------------------------------------------------

/** Every field required, features and rooms limited to the real names */
export function extractionSchema(vocab: TablesVocabulary): object {
  return {
    type: "object",
    properties: {
      persone: { type: ["integer", "null"] },
      orario: { type: ["string", "null"] },
      esigenze: {
        type: "array",
        items:
          vocab.tags.length > 0
            ? { type: "string", enum: vocab.tags.map((t) => t.name) }
            : { type: "string" },
        maxItems: 4,
      },
      sala:
        vocab.maps.length > 0
          ? { type: ["string", "null"], enum: [...vocab.maps.map((m) => m.name), null] }
          : { type: "null" },
    },
    required: ["persone", "orario", "esigenze", "sala"],
  };
}

export function extractionMessages(text: string, vocab: TablesVocabulary) {
  const tags = vocab.tags.map((t) => t.name).join(", ") || "nessuna";
  const maps = vocab.maps.map((m) => m.name).join(", ") || "nessuna";
  return [
    {
      role: "system" as const,
      content:
        "Leggi la richiesta di un tavolo al ristorante e rispondi in JSON. " +
        "persone: quante persone in tutto (intero), null se non detto. " +
        "orario: l'ora chiesta come HH:MM (24 ore), null se non detta o se è adesso. " +
        `esigenze: solo tra ${tags}; [] se nessuna. ` +
        `sala: solo tra ${maps}; null se non detta.`,
    },
    { role: "user" as const, content: text.slice(0, 300) },
  ];
}

/** Check the model's reply against the text and the real tags and rooms */
export function validateExtraction(
  raw: unknown,
  text: string,
  vocab: TablesVocabulary,
): Understood {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RawExtraction>;
  const t = normalize(text);

  const partySize = validParty(r.persone) && textSaysParty(t, r.persone) ? r.persone : null;

  let hhmm: string | null = null;
  const clock = typeof r.orario === "string" ? r.orario.trim().match(/^(\d{1,2})[:.](\d{2})$/) : null;
  if (clock) {
    const h = Number(clock[1]);
    const nums = numbersIn(t);
    // the hour must be in the text ("alle 21", "alle 9" → 21:00, "alle nove")
    if (nums.includes(h) || nums.includes(h - 12) || nums.includes(h + 12)) {
      hhmm = hhmmOf(h, Number(clock[2]), t);
    }
  }

  const tagIds = new Set(tagsFromText(text, vocab.tags));
  for (const e of Array.isArray(r.esigenze) ? r.esigenze : []) {
    if (typeof e !== "string") continue;
    tagsFromText(e, vocab.tags).forEach((id) => tagIds.add(id));
  }

  const mapId =
    (typeof r.sala === "string" ? matchMap(r.sala, vocab.maps) : null) ??
    mapFromText(text, vocab.maps);

  return {
    partySize,
    hhmm,
    tagIds: vocab.tags.filter((tg) => tagIds.has(tg.id)).map((tg) => tg.id),
    mapId,
  };
}

/** The model reads the text (throws AiUnavailableError: wrap in tryAi) */
export async function extractWithModel(
  text: string,
  vocab: TablesVocabulary,
): Promise<ChatResult<Understood>> {
  const { data, meta } = await chatJson<RawExtraction>(
    extractionMessages(text, vocab),
    extractionSchema(vocab),
    { numPredict: 80, temperature: 0 },
  );
  return { data: validateExtraction(data, text, vocab), meta };
}

/**
 * The model's reading, each field it couldn't give (or got wrong) filled by
 * the regex reader; the regex reader alone when `model` is null.
 */
export function mergeReadings(model: Understood | null, regex: Understood): Understood {
  if (!model) return regex;
  const tagIds = model.tagIds.slice();
  regex.tagIds.forEach((id) => {
    if (!tagIds.includes(id)) tagIds.push(id);
  });
  return {
    partySize: model.partySize ?? regex.partySize,
    hhmm: model.hhmm ?? regex.hhmm,
    tagIds,
    mapId: model.mapId ?? regex.mapId,
  };
}
