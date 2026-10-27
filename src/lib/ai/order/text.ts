// Assistente AI — order task: words → menu vocabulary. Pure, no I/O.
//
// What gets written is not what the listino says: "crudo" is "prosciutto
// crudo" in the pantry, "bufala" is "mozzarella di bufala", "margherite" is
// pizza 1201 "Pomodoro, mozzarella". The same normalize/stem the POS search
// uses (lib/menu-search.ts) folds accents and plurals; this file adds the few
// folds the menu itself makes (short names on the pizza list, English words).

import { normalize, stem } from "@/lib/menu-search";
import type { Category } from "@/lib/database.types";
import type { VariationOption } from "@/lib/pos/variation-selection";

/** Function words dropped before matching (it + en). Not "senza": it is
 * handled before words get here. */
const STOP = new Set([
  "a", "al", "alla", "alle", "allo", "ai", "agli", "col", "con", "d", "da",
  "del", "della", "delle", "dei", "degli", "di", "e", "ed", "il", "i", "in",
  "la", "le", "lo", "gli", "l", "un", "una", "uno", "per", "piu", "anche",
  "and", "with", "the", "of", "some", "plus",
  "base", "cl", "lt", "g", "cm",
]);

const NUMBER_WORDS: Record<string, string> = {
  quattro: "4",
  four: "4",
};

/** Significant, stemmed words of `s` — the unit every comparison here uses */
export function sigWords(s: string): string[] {
  const n = normalize(s);
  if (!n) return [];
  return n
    .split(" ")
    .filter((w) => !STOP.has(w))
    .map((w) => NUMBER_WORDS[w] ?? stem(w));
}

/** Word `w` (stemmed) stands for `target` (stemmed): equal, the start of it
 * ("fung" ~ "fungh"), or one letter longer ("fungh" ~ "fung") — not more,
 * or "patatine" would read as "patate" */
export function wordMatches(w: string, target: string): boolean {
  if (w === target) return true;
  if (w.length < 3 || target.length < 3) return false;
  return (
    target.startsWith(w) ||
    (w.startsWith(target) && target.length >= 4 && w.length - target.length <= 1)
  );
}

/**
 * One slip of the finger between two (stemmed) words: a letter swapped with
 * its neighbour ("prochett" ~ "porchett"), missing, extra or wrong. Only for
 * words of 5+ letters, where one edit cannot turn one food into another.
 */
export function oneTypo(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    // one wrong letter, or two neighbours swapped
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

// --- sizes -------------------------------------------------------------------

const UNIT = "(?:cl|ml|lt|l(?!['’])|litr[oi])"; // not the l' of "l'insalata"
const NUM = "(\\d+(?:[.,]\\d+)?)";
/** Tried in this order: a unit says it best, then "da 33", then a bare "0,33" */
const SIZE_PATTERNS: Array<{ re: RegExp; num: number; unit?: number; bare?: boolean }> = [
  { re: new RegExp(`(?<![\\d.,])${NUM}\\s*(${UNIT})\\b`, "gi"), num: 1, unit: 2 }, // "0,33cl", "1,5 litri"
  { re: new RegExp(`\\b(${UNIT})\\s*${NUM}(?![\\d.,]*\\d)`, "gi"), num: 2, unit: 1 }, // "cl 0,33", "lt 1"
  { re: new RegExp(`\\bda\\s+${NUM}(?![\\d.,]*\\d)`, "gi"), num: 1, bare: true }, // "da 33"
  { re: /(?<![\d.,])(\d+[.,]\d+)(?![\d.,]*\d)/g, num: 1, bare: true }, // "0,33"
];

/**
 * The drink size written in `s`, in cl, and the words that said it. The
 * listino writes "cl 0,33" for a third of a litre, waiters write "0,33cl",
 * "33 cl" or "da 33": a number under 10 is litres whatever the unit says.
 * A bare whole number is not a size (it is a quantity or a codice), except
 * after "da" when it reads like centilitres ("da 33", not "da 2").
 */
export function writtenSize(s: string): { cl: number; text: string } | null {
  for (const p of SIZE_PATTERNS) {
    for (const m of Array.from(s.matchAll(p.re))) {
      const raw = m[p.num];
      const v = Number(raw.replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) continue;
      const decimal = /[.,]/.test(raw);
      if (p.bare && !decimal && (v < 10 || v > 100)) continue;
      const unit = p.unit ? m[p.unit].toLowerCase() : "";
      let cl: number;
      if (unit === "ml") cl = v / 10;
      else if (unit && unit !== "cl") cl = v * 100;
      else cl = v < 10 ? v * 100 : v;
      return { cl: Math.round(cl), text: m[0] };
    }
  }
  return null;
}

// --- ingredients -----------------------------------------------------------

/** Short or foreign names → the pantry's long form (normalized). Used only
 * when the target exists in the pool being searched. */
const INGREDIENT_SYNONYMS: Record<string, string> = {
  bufala: "mozzarella di bufala",
  "mozzarella bufala": "mozzarella di bufala",
  crudo: "prosciutto crudo",
  "crudo di parma": "prosciutto crudo",
  parma: "prosciutto crudo",
  cotto: "prosciutto cotto",
  speck: "speck di sauris",
  "speck saurius": "speck di sauris",
  porcini: "funghi porcini",
  chiodini: "funghi chiodini",
  pistacchio: "granella di pistacchio",
  pistacchi: "granella di pistacchio",
  parmigiano: "grana",
  "grana padano": "grana",
  "salame piccante": "salamino piccante",
  "salamino piccante": "salamino piccante",
  olive: "olive nere",
  uovo: "uova",
  // English, in case the model leaves them untranslated
  basil: "basilico",
  mushrooms: "funghi",
  mushroom: "funghi",
  ham: "prosciutto cotto",
  "parma ham": "prosciutto crudo",
  tomato: "pomodoro",
  onion: "cipolla",
  onions: "cipolla",
  olives: "olive nere",
  tuna: "tonno",
  rocket: "rucola",
  arugula: "rucola",
  sausage: "salsiccia",
  peppers: "peperoni",
  artichokes: "carciofi",
  anchovies: "acciughe",
  capers: "capperi",
  "spicy salami": "salamino piccante",
  egg: "uova",
  eggs: "uova",
  cream: "panna",
  corn: "mais",
  spinach: "spinaci",
  eggplant: "melanzane",
  aubergine: "melanzane",
  zucchini: "zucchine",
  salmon: "salmone",
  shrimp: "gamberetti",
  prawns: "gamberetti",
  walnuts: "noci",
  potatoes: "patate",
  bacon: "pancetta",
  cheese: "formaggio",
  pistachio: "granella di pistacchio",
};

/** Lead-in words of an ingredient phrase that are not part of the name */
const PHRASE_LEAD = /^(?:(?:extra|aggiunta|aggiungi|aggiungere|doppio|doppia|doppi|con|col|e|ed|anche|piu|tanto|tanta|add|with|double|di|del|della|dei|delle|il|la|lo|le|i|gli|l|un|una|uno|some|the)\s+)+/;

/** Accent-free, lower-case, lead-ins dropped: "Extra Bufala" → "bufala" */
export function cleanPhrase(s: string): string {
  return normalize(s).replace(PHRASE_LEAD, "").trim();
}

/**
 * The ingredient of `pool` a written phrase names, or null. Exact name first,
 * then the menu's short forms, then a word match: every written word must
 * stand for a word of the name. Among several, priced rows win (those are the
 * house's add-on list — the free ones are mostly dish descriptions the
 * listino import split into the pantry), then the name with fewest extra
 * words, then the shortest: "olive" → "olive nere", "bufala" → "mozzarella di
 * bufala", not "involtino di speck … mozzarella di bufala".
 */
export function resolveIngredient(
  phrase: string,
  pool: VariationOption[],
  typoFixed = false,
): VariationOption | null {
  const n = cleanPhrase(phrase);
  if (!n) return null;
  const byName = new Map(pool.map((i) => [normalize(i.name), i]));
  const exact = byName.get(n);
  if (exact) return exact;
  const syn = INGREDIENT_SYNONYMS[n];
  if (syn && byName.has(syn)) return byName.get(syn)!;
  const words = sigWords(n);
  if (words.length === 0) return null;
  const ranked = pool
    .map((i) => ({ i, w: sigWords(i.name) }))
    .filter(
      ({ w }) =>
        w.length > 0 &&
        w.length <= 4 &&
        words.every((q) => w.some((t) => wordMatches(q, t))),
    )
    .sort(
      (a, b) =>
        (b.i.price > 0 ? 1 : 0) - (a.i.price > 0 ? 1 : 0) ||
        a.w.length - words.length - (b.w.length - words.length) ||
        a.i.name.length - b.i.name.length,
    );
  if (ranked.length > 0) return ranked[0].i;
  if (typoFixed) return null;
  // last: a typo ("prochetta" → porchetta), each word fixed only when the
  // pantry offers one way to fix it
  const vocab = Array.from(new Set(pool.flatMap((i) => sigWords(i.name))));
  let changed = false;
  const fixed = words.map((q) => {
    if (vocab.some((t) => wordMatches(q, t))) return q;
    const near = vocab.filter((t) => oneTypo(q, t));
    if (near.length !== 1) return q;
    changed = true;
    return near[0];
  });
  return changed ? resolveIngredient(fixed.join(" "), pool, true) : null;
}

/** "burrata, crudo e pistacchio" → ["burrata", "crudo", "pistacchio"] */
export function splitPhrases(s: string): string[] {
  return s
    .replace(/[+&;/]/g, ",")
    .split(/,|\s+(?:e|ed|con|col|and|with)\s+/i)
    .map((p) => p.trim())
    .filter((p) => sigWords(p).length > 0);
}

/**
 * Phrases → pool ingredients. A phrase that names nothing as a whole is tried
 * word span by word span, longest first, so "pomodoro mozzarella" (no comma)
 * still reads as two ingredients. What stays unmatched comes back as written.
 */
export function resolvePhrases(
  phrases: string[],
  pool: VariationOption[],
): { found: { written: string; ingredient: VariationOption }[]; unknown: string[] } {
  const found: { written: string; ingredient: VariationOption }[] = [];
  const unknown: string[] = [];
  for (const phrase of phrases) {
    const whole = resolveIngredient(phrase, pool);
    if (whole) {
      found.push({ written: cleanPhrase(phrase), ingredient: whole });
      continue;
    }
    const words = cleanPhrase(phrase).split(" ").filter(Boolean);
    let i = 0;
    const leftovers: string[] = [];
    while (i < words.length) {
      let hit: { j: number; ing: VariationOption } | null = null;
      for (let j = words.length; j > i; j--) {
        const span = words.slice(i, j).join(" ");
        if (sigWords(span).length === 0) continue;
        const ing = resolveIngredient(span, pool);
        if (ing) {
          hit = { j, ing };
          break;
        }
      }
      if (hit) {
        found.push({ written: words.slice(i, hit.j).join(" "), ingredient: hit.ing });
        i = hit.j;
      } else {
        if (sigWords(words[i]).length > 0) leftovers.push(words[i]);
        i += 1;
      }
    }
    if (leftovers.length > 0) unknown.push(leftovers.join(" "));
  }
  return { found, unknown };
}

// --- categories ------------------------------------------------------------

/** Words that name a category without being in its name */
const CATEGORY_WORDS: Record<string, string> = {
  beer: "birre alla spina",
  beers: "birre alla spina",
  dessert: "dolci",
  desserts: "dolci",
  dolcetto: "dolci",
  burger: "hamburger",
  fries: "fritti",
};

export interface CategoryMention {
  categories: Category[];
  /** the written words that named them ("pizza") */
  words: string[];
}

/**
 * Categories named in `text`: a category counts when its first significant
 * word is written ("birra" → "Birre alla spina"); when several share that
 * word, the ones with more of their words written win ("pizza longa" →
 * Pizza Longa, "pizza" → Pizze). Panini caldi and Panini al tegamino both
 * stay for "panino".
 */
export function mentionedCategories(text: string, categories: Category[]): CategoryMention {
  const written = normalize(text).split(" ").filter(Boolean);
  const mapped = written.map((w) => {
    const alias = CATEGORY_WORDS[w];
    return alias ? sigWords(alias)[0] : NUMBER_WORDS[w] ?? stem(w);
  });
  let best = 0;
  let hits: Array<{ c: Category; score: number; words: string[] }> = [];
  for (const c of categories) {
    const cw = sigWords(c.name);
    if (cw.length === 0) continue;
    const idx = mapped.findIndex((w) => wordMatches(w, cw[0]) && w.length >= 4);
    if (idx < 0) continue;
    const used = new Set<number>([idx]);
    cw.slice(1).forEach((t) => {
      const k = mapped.findIndex((w, i) => !used.has(i) && wordMatches(w, t));
      if (k >= 0) used.add(k);
    });
    const score = used.size / cw.length;
    hits.push({ c, score, words: Array.from(used).map((i) => written[i]) });
    best = Math.max(best, score);
  }
  hits = hits.filter((h) => h.score === best);
  const words: string[] = [];
  hits.forEach((h) => h.words.forEach((w) => words.includes(w) || words.push(w)));
  return { categories: hits.map((h) => h.c), words };
}

/** The model's category hint, if it names a real category */
export function validateCategoryHint(
  hint: string | undefined,
  categories: Category[],
): Category | null {
  const n = normalize(hint ?? "");
  if (!n) return null;
  return (
    categories.find((c) => normalize(c.name) === n) ??
    mentionedCategories(n, categories).categories[0] ??
    null
  );
}

/** "Pizze" → "Pizza": the singular for a proposed dish name */
export function singularCategory(name: string): string {
  const first = name.split(" ")[0];
  const singular = /e$/.test(first) && first.length > 4 ? `${first.slice(0, -1)}a` : first;
  return [singular, ...name.split(" ").slice(1)].join(" ");
}

/** Notes are stored comma-joined (order_items.notes): never let one carry a comma */
export function cleanNote(s: string): string {
  return s.replace(/[,;\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** "a, b e c" */
export function joinList(items: string[], and = "e"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}
