// Assistente AI — order task: an extracted dish → a menu line, an off-menu
// proposal, or "not found". Pure (the data comes in), no model.
//
// The model only copies what was written; this decides what it is, with the
// rules the POS search already follows (lib/menu-search.ts) plus the
// listino's own quirks (lib/menu-display.ts):
//   * pizze/bruschette are named by codice; their `name` IS the topping list,
//     so they are recognised by number ("1202") or by ingredients
//     (Jaccard on ingredient ids, base pomodoro + mozzarella implied);
//   * Pizze and Bruschette share names → a pizza unless "bruschetta" is said;
//   * everything else by its words (coverage of what was written, precision
//     on the dish's own name).
// A written dish that is a category plus ingredients ("pizza con burrata,
// crudo e pistacchio") and matches no dish exactly becomes a custom proposal.

import type { Category } from "@/lib/database.types";
import { isCodeNamedCategory, menuLabel, type MenuItemView } from "@/lib/menu-display";
import { buildHaystack, normalize, stem } from "@/lib/menu-search";
import { unitPriceWithModifiers } from "@/lib/money";
import { variationsToModifiers, type VariationOption } from "@/lib/pos/variation-selection";
import type {
  CustomDishProposal,
  ExtractedItem,
  LineChoice,
  ParsedLine,
  UnresolvedReason,
} from "../contracts/order";
import { askedIngredients, overlapWith, proposeCustomDish } from "./custom-dish";
import type { OrderData } from "./data";
import {
  cleanNote,
  mentionedCategories,
  resolveIngredient,
  resolvePhrases,
  sigWords,
  splitPhrases,
  validateCategoryHint,
  wordMatches,
} from "./text";

export type MatchResult =
  | { kind: "menu"; line: ParsedLine }
  | { kind: "custom"; proposal: CustomDishProposal }
  | { kind: "unresolved"; text: string; reason: UnresolvedReason; categoryName: string | null };

export interface MatchContext {
  data: OrderData;
  /** ai_settings.custom_dish_min_overlap */
  minOverlap: number;
  /** the whole request, for rules that look past one dish ("bruschetta") */
  fullText: string;
}

/** Dish nicknames that are a topping list on this menu */
const DISH_ALIASES: Record<string, string> = {
  margherit: "pomodoro, mozzarella",
};

/** Size words → the numbers the beer names carry ("cl 0,40") */
const SIZE_WORDS: Record<string, string[]> = {
  piccol: ["20", "25"],
  small: ["20", "25"],
  medi: ["40", "50"],
  medium: ["40", "50"],
};

/** Above this a word-matched dish is taken as is */
const SURE = 0.75;
/** Below this nothing is proposed */
const FLOOR = 0.4;
/** A runner-up closer than this to the best makes the pick uncertain */
const CLOSE = 0.06;
const MAX_ALTERNATIVES = 4;

interface Candidate {
  item: MenuItemView;
  category: Category;
  score: number;
}

type Resolution =
  | { kind: "items"; candidates: Candidate[]; sure: boolean; score: number }
  | {
      kind: "description";
      categories: Category[];
      phrases: string[];
      bianca: boolean;
    }
  | { kind: "vague"; category: Category | null }
  | { kind: "none" };

function clampQty(q: unknown): number {
  const n = typeof q === "number" && Number.isFinite(q) ? Math.round(q) : 1;
  return Math.max(1, Math.min(20, n));
}

const nonEmpty = (xs: unknown): string[] =>
  Array.isArray(xs)
    ? xs.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];

/** How the request reads back, for the preview ("2× margherita senza basilico") */
function describe(ex: ExtractedItem, quantity: number): string {
  const parts = [`${quantity}× ${ex.piatto}`];
  nonEmpty(ex.senza).forEach((s) => parts.push(`senza ${s}`));
  nonEmpty(ex.extra).forEach((s) => parts.push(`+ ${s}`));
  nonEmpty(ex.note).forEach((s) => parts.push(s));
  return parts.join(", ");
}

// --- word scoring ------------------------------------------------------------

/** Name words that must be matched for a dish to count as named */
function nameWords(item: MenuItemView): string[] {
  return sigWords(item.name);
}

/**
 * 0..1: how much of what was written the dish carries (codice, name,
 * ingredients, category — the POS search haystack), and how much of the
 * dish's own name was written. Size words stand for any of their numbers.
 */
function wordScore(words: string[], item: MenuItemView, categoryName: string): { score: number; precision: number } {
  if (words.length === 0) return { score: 0, precision: 0 };
  const hay = buildHaystack([item.codice, item.name, ...(item.ingredients ?? []), categoryName]);
  const hayWords = hay.split(" ");
  const covers = (w: string) => {
    const sizes = SIZE_WORDS[w];
    if (sizes) return sizes.some((n) => hayWords.includes(n));
    return hayWords.some((h) => wordMatches(w, h));
  };
  const coverage = words.filter(covers).length / words.length;
  const own = nameWords(item);
  const precision =
    own.length === 0
      ? 0
      : own.filter((o) =>
          words.some((w) => (SIZE_WORDS[w] ? SIZE_WORDS[w].includes(o) : wordMatches(w, o))),
        ).length / own.length;
  return { score: 0.6 * coverage + 0.4 * precision, precision };
}

function sortCandidates(cands: Candidate[]): Candidate[] {
  return cands.sort(
    (a, b) =>
      b.score - a.score ||
      a.category.sort_order - b.category.sort_order ||
      a.item.sort_order - b.item.sort_order,
  );
}

function itemsResult(cands: Candidate[], sure?: boolean): Resolution {
  const sorted = sortCandidates(cands);
  const top = sorted[0];
  const second = sorted[1];
  return {
    kind: "items",
    candidates: sorted,
    score: top.score,
    sure: sure ?? (top.score >= SURE && (!second || top.score - second.score >= CLOSE)),
  };
}

// --- dish resolution -------------------------------------------------------

function resolveDish(piatto: string, extras: string[], hint: string | undefined, ctx: MatchContext): Resolution {
  const { categories, items } = ctx.data;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const norm = normalize(piatto);
  const isBruschette = (c: Category | undefined) => !!c && normalize(c.name) === "bruschette";

  const mention = mentionedCategories(piatto, categories);
  const hintCat = mention.categories.length === 0 ? validateCategoryHint(hint, categories) : null;
  // the hint may say Bruschette only when the request does
  const allowBruschette =
    /\bbruschett/.test(norm) ||
    (isBruschette(hintCat ?? undefined) && /\bbruschett/.test(normalize(ctx.fullText)));
  const usable = items.filter((i) => {
    const c = catById.get(i.category_id);
    return !!c && (!isBruschette(c) || allowBruschette);
  });
  const withCat = (i: MenuItemView): Candidate => ({ item: i, category: catById.get(i.category_id)!, score: 1 });

  // 1. codice ("1202", "01")
  const numbers = norm.split(" ").filter((w) => /^\d+$/.test(w));
  for (const n of numbers) {
    const hits = items.filter(
      (i) => i.codice && (i.codice === n || (n.length >= 3 && Number(i.codice) === Number(n))),
    );
    if (hits.length > 0) {
      const inMention = hits.filter((i) => mention.categories.some((c) => c.id === i.category_id));
      const pick = inMention.length > 0 ? inMention : hits;
      return itemsResult(pick.map(withCat), pick.length === 1);
    }
  }

  // 2. the dish's name, exactly (any category: "pollo fritto" is not a Fritti)
  const allWords = sigWords(piatto);
  const target = allWords.join(" ");
  if (target) {
    const exact = usable.filter((i) => {
      const nw = nameWords(i).join(" ");
      return nw === target || normalize(i.name) === norm;
    });
    if (exact.length > 0) return itemsResult(exact.map(withCat), exact.length === 1);
  }

  // what is left once the category words are taken out
  const catStems = mention.words.map((w) => sigWords(w)[0]).filter(Boolean);
  let qWords = allWords.filter((w) => !catStems.includes(w));
  let qText = norm
    .split(" ")
    .filter((w) => !mention.words.includes(w))
    .join(" ");
  const bianca = qWords.includes("bianc");
  if (bianca) {
    qWords = qWords.filter((w) => w !== "bianc");
    qText = qText.replace(/\bbianc[ah]e?\b/g, " ");
  }
  let aliased = false;
  qWords.forEach((w) => {
    const alias = DISH_ALIASES[w];
    if (!alias) return;
    aliased = true;
    qText = qText
      .split(" ")
      .map((x) => (stem(x) === w ? `, ${alias},` : x))
      .join(" ");
  });

  const mentioned = mention.categories.filter((c) => !isBruschette(c) || allowBruschette);
  const scope = mentioned.length > 0 ? mentioned : null;
  const inScope = (i: MenuItemView) => !scope || scope.some((c) => c.id === i.category_id);
  const codeNamedAllowed = (c: Category) =>
    isCodeNamedCategory(c.name) &&
    (!scope || scope.some((s) => s.id === c.id)) &&
    (!aliased || scope !== null || normalize(c.name) === "pizze" || isBruschette(c));

  // 3. pizze/bruschette by ingredients
  const phrases = [...splitPhrases(qText), ...(qWords.length === 0 ? extras : [])];
  const codeCats = categories.filter(
    (c) => codeNamedAllowed(c) && (!isBruschette(c) || allowBruschette),
  );
  const byIngredients: Candidate[] = [];
  const knownIngredient =
    phrases.length > 0 && resolvePhrases(phrases, ctx.data.variations.pantry).found.length > 0;
  if (phrases.length > 0) {
    codeCats.forEach((c) => {
      const asked = askedIngredients(phrases, [], c, ctx.data, { bianca });
      usable
        .filter((i) => i.category_id === c.id)
        .forEach((i) => {
          const ids = (ctx.data.itemIngredients[i.id] ?? []).map((x) => x.id);
          byIngredients.push({ item: i, category: c, score: overlapWith(asked, ids) });
        });
    });
  }
  const exactSet = byIngredients.filter((c) => c.score >= 0.999);
  if (exactSet.length > 0) return itemsResult(exactSet, exactSet.length === 1);

  // 4. everything else by its words
  const byWords: Candidate[] = [];
  if (!aliased) {
    usable
      .filter((i) => inScope(i) && !isCodeNamedCategory(catById.get(i.category_id)!.name))
      .forEach((i) => {
        const c = catById.get(i.category_id)!;
        const { score, precision } = wordScore(allWords, i, c.name);
        // a category word alone ("piadina") names no particular dish
        if (precision > 0) byWords.push({ item: i, category: c, score });
      });
  }
  const bestWords = sortCandidates(byWords)[0];
  if (bestWords && bestWords.score >= SURE) return itemsResult(byWords);

  // 5. a pizza named by a topping only it has ("4 stagioni", "salmone")
  if (qWords.length > 0 && !aliased) {
    const covered = usable.filter((i) => {
      const c = catById.get(i.category_id)!;
      if (!codeCats.some((x) => x.id === c.id)) return false;
      const hay = buildHaystack([i.name, ...(i.ingredients ?? [])]).split(" ");
      return qWords.every((w) => hay.some((h) => wordMatches(w, h)));
    });
    if (covered.length === 1) return itemsResult([withCat(covered[0])], true);
  }

  // 6. a category plus ingredients: a dish to price
  const descriptive = scope ?? (hintCat ? [hintCat] : null);
  if (descriptive && (knownIngredient || qWords.length === 0)) {
    const descPhrases = qWords.length === 0 ? extras : phrases;
    if (descPhrases.length > 0) {
      return { kind: "description", categories: descriptive, phrases: descPhrases, bianca };
    }
  }
  if (aliased && byIngredients.length > 0) {
    // "margherita" plus something unknown: the closest pizza, to be checked
    return itemsResult(byIngredients.filter((c) => c.score > 0), false);
  }

  // 7. the best word match, flagged for checking
  if (bestWords && bestWords.score >= FLOOR) return itemsResult(byWords, false);

  if (qWords.length === 0 && (scope || hintCat)) {
    const cat = scope?.[0] ?? hintCat;
    const only = usable.filter((i) => i.category_id === cat!.id);
    if (only.length === 1) return itemsResult([withCat(only[0])], true);
    return { kind: "vague", category: cat };
  }
  return { kind: "none" };
}

// --- the line --------------------------------------------------------------

/**
 * A menu dish with the asked variations, priced by the POS rules. Removals
 * resolve against the dish's own ingredients, additions against the pantry;
 * only a dish that allows variations (key present in byItem) gets modifiers,
 * anything else becomes a note so the kitchen still reads it.
 */
export function buildChoice(
  item: MenuItemView,
  category: Category,
  ex: Pick<ExtractedItem, "senza" | "extra" | "note">,
  data: OrderData,
): LineChoice & { flagged: boolean } {
  const { pantry, byItem, quickNotes } = data.variations;
  const allows = item.id in byItem;
  const own: VariationOption[] = byItem[item.id] ?? data.itemIngredients[item.id] ?? [];
  const ownIds = new Set(own.map((i) => i.id));
  const removedIds: string[] = [];
  const addedIds: string[] = [];
  const noteOnly: string[] = [];
  const unknownIngredients: string[] = [];
  let flagged = false;

  nonEmpty(ex.senza).forEach((s) => {
    const mine = resolveIngredient(s, own);
    if (mine && allows) {
      if (!removedIds.includes(mine.id)) removedIds.push(mine.id);
      return;
    }
    const known = mine ?? resolveIngredient(s, pantry);
    if (!known) unknownIngredients.push(s);
    noteOnly.push(cleanNote(`senza ${known?.name ?? s}`));
    // not on this dish anyway ("senza basilico" on a margherita without it)
    // is just a note; one we could not apply needs a look
    if (!allows || !known) flagged = true;
  });

  nonEmpty(ex.extra).forEach((s) => {
    let ing = resolveIngredient(s, pantry);
    if (ing && ownIds.has(ing.id)) {
      // already on the dish: "extra mozzarella" is the pantry's "abbondante mozzarella"
      const more = pantry.find((p) => normalize(p.name) === `abbondante ${normalize(ing!.name)}`);
      if (more) ing = more;
      else {
        noteOnly.push(cleanNote(`+ ${ing.name}`));
        flagged = true;
        return;
      }
    }
    if (ing && allows) {
      if (!addedIds.includes(ing.id)) addedIds.push(ing.id);
      return;
    }
    if (!ing) unknownIngredients.push(s);
    noteOnly.push(cleanNote(`+ ${ing?.name ?? s}`));
    flagged = true;
  });

  const modifiers = allows ? variationsToModifiers(own, pantry, { removedIds, addedIds }) : [];

  // note rapide by their configured name and order, then free notes
  const quick: string[] = [];
  const free: string[] = [];
  nonEmpty(ex.note).forEach((n) => {
    const q = quickNotes.find((x) => normalize(x) === normalize(n));
    if (q) {
      if (!quick.includes(q)) quick.push(q);
    } else {
      const c = cleanNote(n);
      if (c && !free.includes(c)) free.push(c);
    }
  });
  quick.sort((a, b) => quickNotes.indexOf(a) - quickNotes.indexOf(b));
  const notes = [...quick, ...free, ...noteOnly.filter((n) => !free.includes(n))];

  const label = menuLabel(item, category.name);
  const basePrice = Number(item.price);
  return {
    menuItemId: item.id,
    name: label.title,
    ingredients: label.ingredients,
    categoryName: category.name,
    basePrice,
    modifiers,
    unitPrice: unitPriceWithModifiers(basePrice, modifiers),
    notes,
    noteOnly,
    unknownIngredients,
    flagged,
  };
}

function strip<T extends { flagged: boolean }>(c: T): Omit<T, "flagged"> {
  const { flagged, ...rest } = c;
  void flagged;
  return rest;
}

// --- entry point -------------------------------------------------------------

export function matchItem(ex: ExtractedItem, ctx: MatchContext): MatchResult {
  const quantity = clampQty(ex.quantita);
  const piatto = (ex.piatto ?? "").trim();
  const sourceText = describe({ ...ex, piatto }, quantity);
  const extras = nonEmpty(ex.extra);
  const senza = nonEmpty(ex.senza);

  // "patatine fritte con salsa" is a dish; "pizza con burrata" is a category
  // plus ingredients: try the words as written first, then split at "con"
  let res = resolveDish(piatto, extras, ex.categoria, ctx);
  let usedExtras = extras;
  const con = piatto.match(/^(.*?)\s+(?:con|col|with)\s+(.+)$/i);
  if (con && !(res.kind === "items" && res.sure)) {
    const tail = splitPhrases(con[2]);
    const retry = resolveDish(con[1], [...tail, ...extras], ex.categoria, ctx);
    const better =
      (retry.kind === "items" && (res.kind !== "items" || retry.score > res.score)) ||
      (retry.kind === "description" && res.kind !== "items");
    if (better) {
      res = retry;
      usedExtras = [...tail, ...extras];
    }
  }

  if (res.kind === "description") {
    let best: CustomDishProposal | null = null;
    res.categories.forEach((c) => {
      const p = proposeCustomDish(
        {
          categoryId: c.id,
          phrases: res.kind === "description" ? res.phrases : [],
          removed: senza,
          quantity,
          sourceText,
          bianca: res.kind === "description" && res.bianca,
        },
        ctx.data,
        ctx.minOverlap,
      );
      if (p && (!best || p.overlap > best.overlap)) best = p;
    });
    if (best) {
      const p: CustomDishProposal = best;
      // the very dish after all ("pizza con tonno e cipolla" = 1208)
      if (p.overlap >= 0.999 && !p.ingredients.some((i) => !i.ingredientId)) {
        const item = ctx.data.items.find((i) => i.id === p.base.menuItemId)!;
        const category = ctx.data.categories.find((c) => c.id === p.categoryId)!;
        const choice = buildChoice(item, category, { note: ex.note }, ctx.data);
        return {
          kind: "menu",
          line: { kind: "menu", sourceText, quantity, confidence: choice.flagged ? "low" : "high", alternatives: [], ...strip(choice) },
        };
      }
      return { kind: "custom", proposal: p };
    }
    return { kind: "unresolved", text: sourceText, reason: "not_found", categoryName: res.categories[0]?.name ?? null };
  }

  if (res.kind === "vague") {
    return { kind: "unresolved", text: sourceText, reason: "too_vague", categoryName: res.category?.name ?? null };
  }
  if (res.kind === "none") {
    return { kind: "unresolved", text: sourceText, reason: "not_found", categoryName: null };
  }

  // extras that described the dish ("1202 con bufala" keeps them as additions)
  const variation = { senza, extra: usedExtras, note: ex.note };
  const [top, ...rest] = res.candidates;
  const choice = buildChoice(top.item, top.category, variation, ctx.data);
  const alternatives = rest
    .filter((c) => c.score >= top.score - 0.3)
    .slice(0, MAX_ALTERNATIVES)
    .map((c) => strip(buildChoice(c.item, c.category, variation, ctx.data)));
  const confidence = res.sure && !choice.flagged ? "high" : "low";
  return {
    kind: "menu",
    line: {
      kind: "menu",
      sourceText,
      quantity,
      confidence,
      alternatives: confidence === "low" ? alternatives : [],
      ...strip(choice),
    },
  };
}
