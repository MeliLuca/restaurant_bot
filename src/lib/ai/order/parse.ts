// Assistente AI — order task: the whole "Scrivi l'ordine" pipeline. SERVER ONLY.
//   text → extract (model, or rules when it is down) → match each dish
//   against the live menu → priced lines / off-menu proposals / leftovers.

import type { AiSettings } from "@/lib/database.types";
import type {
  CustomDishProposal,
  OrderParseResponse,
  OrderPriceResponse,
  ParsedLine,
} from "../contracts/order";
import { proposeCustomDish } from "./custom-dish";
import { loadOrderData, type OrderData } from "./data";
import { extractOrder, ruleExtract } from "./extract";
import { matchItem } from "./match";
import { normalize } from "@/lib/menu-search";
import {
  mentionedCategories,
  sigWords,
  splitPhrases,
  validateCategoryHint,
  wordMatches,
} from "./text";

export async function parseOrder(text: string, settings: AiSettings): Promise<OrderParseResponse> {
  const data = await loadOrderData();
  const extraction = await extractOrder(
    text,
    data.categories.map((c) => c.name),
    data.variations.quickNotes,
  );
  const ctx = { data, minOverlap: settings.custom_dish_min_overlap, fullText: text };
  const items = extraction.items.map((i) => ({ ...i, note: groundedNotes(i.note, text, data) }));

  const lines: ParsedLine[] = [];
  const customDishes: CustomDishProposal[] = [];
  const unresolved: OrderParseResponse["unresolved"] = [];
  items.forEach((item) => {
    const r = matchItem(item, ctx);
    if (r.kind === "menu") lines.push(r.line);
    else if (r.kind === "custom") customDishes.push(r.proposal);
    else unresolved.push({ text: r.text, reason: r.reason, categoryName: r.categoryName });
  });

  return {
    status: extraction.status,
    lines,
    customDishes,
    unresolved,
    clarification: extraction.status === "clarify" ? extraction.reply : null,
    reply: extraction.reply,
    extractedBy: extraction.by,
    ai: extraction.ai,
  };
}

/** A note that names an ingredient the text never mentions ("Poca
 * mozzarella" out of nowhere) is the model's invention: dropped */
function groundedNotes(notes: string[] | undefined, text: string, data: OrderData) {
  if (!notes) return notes;
  const written = sigWords(text);
  // one-word pantry names only: "cotta" is a cooking, not "prosciutto cotto"
  const ingredientWords = new Set(
    data.variations.pantry.flatMap((p) => {
      const w = sigWords(p.name);
      return w.length === 1 ? w : [];
    }),
  );
  return notes.filter((n) =>
    sigWords(n).every(
      (w) => !ingredientWords.has(w) || written.some((x) => wordMatches(w, x) || wordMatches(x, w)),
    ),
  );
}

/** "pizza con burrata, crudo e pistacchio" → the category it names and the
 * ingredient phrases after it */
function readDishText(text: string, data: OrderData, hint?: string) {
  const mention = mentionedCategories(text, data.categories);
  const hinted = mention.categories.length === 0 ? validateCategoryHint(hint, data.categories) : null;
  const categories = hinted ? [hinted] : mention.categories;
  if (categories.length === 0) return null;
  const rest = text
    .split(/\s+/)
    .filter((w) => !mention.words.includes(normalize(w)))
    .join(" ");
  return { categories, phrases: splitPhrases(rest) };
}

/** The question around the dish, which is not part of it: "quanto faccio
 * pagare una pizza con …?", "… e quanto far pagare", "che prezzo do a …" */
const PRICE_QUESTION =
  /\b(?:(?:e\s+)?(?:quanto|a quanto|che prezzo|a che prezzo|how much)(?:\s+[a-zàèéìòù']+){0,3}?\s+(?:pagare|costa|costerebbe|vendere|vendo|metto|metterei|do|dare|charge|for)\b|(?:il\s+)?prezzo\s+(?:di|per|del|della)\b)/gi;

export function stripPriceQuestion(text: string): string {
  return text
    .replace(PRICE_QUESTION, " ")
    .replace(/[?!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:per|a|e)\s+/i, "")
    .replace(/\s+(?:e|ed)$/i, "");
}

/** POST /price: a dish written by ingredients → proposed price */
export async function priceDish(
  input: { text?: string; categoryId?: string; ingredients?: string[]; name?: string },
  settings: AiSettings,
): Promise<OrderPriceResponse | null> {
  const data = await loadOrderData();
  const min = settings.custom_dish_min_overlap;
  if (input.categoryId) {
    const p = proposeCustomDish(
      { categoryId: input.categoryId, phrases: input.ingredients ?? [], name: input.name },
      data,
      min,
    );
    return p ? { ...p, ai: null } : null;
  }
  const text = stripPriceQuestion(input.text ?? "");
  // the plain form needs no model; anything else is read like an order
  const direct = readDishText(text, data);
  const pick = (cats: { id: string }[], phrases: string[], extra = {}) => {
    let best: CustomDishProposal | null = null;
    cats.forEach((c) => {
      const p = proposeCustomDish(
        { categoryId: c.id, phrases, sourceText: text, name: input.name, ...extra },
        data,
        min,
      );
      if (p && (!best || p.overlap > best.overlap)) best = p;
    });
    return best as CustomDishProposal | null;
  };
  if (direct && direct.phrases.length > 0) {
    const p = pick(direct.categories, direct.phrases);
    if (p) return { ...p, ai: null };
  }
  const extraction = await extractOrder(
    text,
    data.categories.map((c) => c.name),
    data.variations.quickNotes,
  );
  const first = extraction.items[0] ?? ruleExtract(text, data.variations.quickNotes).items[0];
  if (!first) return null;
  const read = readDishText(first.piatto, data, first.categoria);
  if (!read) return null;
  const p = pick(read.categories, [...read.phrases, ...(first.extra ?? [])], {
    removed: first.senza,
    quantity: first.quantita,
  });
  return p ? { ...p, ai: extraction.ai } : null;
}
