// Assistente AI — order task: the price of a dish that is not on the menu.
// Pure (the data comes in), no model.
//
// "Pizza con burrata, crudo e pistacchio" is priced the way the till would
// price it if the waiter built it by hand: take the most similar dish of the
// category (Jaccard on ingredient ids), take off what was not asked (each
// removal carries its listino price as swap credit), add what is missing, and
// let unitPriceWithModifiers apply the house rules (swap credit, log2 taper,
// 10c floor). Nothing here invents a number: every amount is a menu or
// pantry price, or the result of lib/money.ts.

import type { Category } from "@/lib/database.types";
import { isCodeNamedCategory, menuLabel, type MenuItemView } from "@/lib/menu-display";
import { addedIngredientsCharges, toCents, unitPriceWithModifiers } from "@/lib/money";
import { variationsToModifiers, type VariationOption } from "@/lib/pos/variation-selection";
import type { SelectedModifier } from "@/stores/ticket-store";
import type { CustomDishProposal, PriceBreakdownRow } from "../contracts/order";
import type { OrderData } from "./data";
import { normalize } from "@/lib/menu-search";
import { joinList, resolvePhrases, singularCategory } from "./text";

/** Pizze and bruschette list their base among the ingredients (checked in
 * the DB): "pizza con burrata" means pomodoro + mozzarella + burrata. */
const PIZZA_BASE = ["pomodoro", "mozzarella"];

export interface AskedIngredient {
  name: string;
  written: string;
  ingredientId: string | null;
  implied: boolean;
}

/** Every ingredient the house knows, pantry first (it is what can be added) */
function ingredientPool(data: OrderData): VariationOption[] {
  const seen = new Set<string>();
  const pool: VariationOption[] = [];
  const push = (i: VariationOption) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    pool.push(i);
  };
  data.variations.pantry.forEach(push);
  Object.keys(data.itemIngredients).forEach((id) => data.itemIngredients[id].forEach(push));
  return pool;
}

/**
 * Written phrases → the ingredients asked for, deduplicated. For a code-named
 * category the base is implied (minus whatever `removed` takes off, or the
 * pomodoro of a "bianca"); unknown words come back with ingredientId null.
 */
export function askedIngredients(
  phrases: string[],
  removed: string[],
  category: Category,
  data: OrderData,
  opts: { bianca?: boolean } = {},
): AskedIngredient[] {
  const pool = ingredientPool(data);
  const out: AskedIngredient[] = [];
  const has = (id: string) => out.some((a) => a.ingredientId === id);
  const removedIds = new Set(resolvePhrases(removed, pool).found.map((f) => f.ingredient.id));
  if (isCodeNamedCategory(category.name)) {
    PIZZA_BASE.forEach((n) => {
      if (opts.bianca && n === "pomodoro") return;
      const ing = pool.find((i) => normalize(i.name) === n);
      if (ing && !removedIds.has(ing.id)) {
        out.push({ name: ing.name, written: n, ingredientId: ing.id, implied: true });
      }
    });
  }
  const { found, unknown } = resolvePhrases(phrases, pool);
  found.forEach(({ written, ingredient }) => {
    if (removedIds.has(ingredient.id)) return;
    if (has(ingredient.id)) {
      // written although implied: it is part of the name after all
      const a = out.find((x) => x.ingredientId === ingredient.id)!;
      a.implied = false;
      a.written = written;
      return;
    }
    out.push({ name: ingredient.name, written, ingredientId: ingredient.id, implied: false });
  });
  unknown.forEach((w) => out.push({ name: w, written: w, ingredientId: null, implied: false }));
  return out;
}

/** Jaccard of the asked set with a dish; unknown asks only widen the union */
export function overlapWith(asked: AskedIngredient[], dishIds: string[]): number {
  const a = new Set(asked.flatMap((x) => (x.ingredientId ? [x.ingredientId] : [])));
  const unknown = asked.filter((x) => !x.ingredientId).length;
  const d = new Set(dishIds);
  let inter = 0;
  a.forEach((id) => {
    if (d.has(id)) inter += 1;
  });
  const union = a.size + d.size - inter + unknown;
  return union === 0 ? 0 : inter / union;
}

interface Scored {
  item: MenuItemView;
  overlap: number;
  sizeGap: number;
}

/** Dishes of the category by similarity: overlap, then closer ingredient
 * count, then the cheaper one (never round a guess up) */
export function rankSimilar(
  asked: AskedIngredient[],
  categoryId: string,
  data: OrderData,
): Scored[] {
  return data.items
    .filter((i) => i.category_id === categoryId)
    .map((item) => {
      const ids = (data.itemIngredients[item.id] ?? []).map((i) => i.id);
      return { item, overlap: overlapWith(asked, ids), sizeGap: Math.abs(ids.length - asked.length) };
    })
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        a.sizeGap - b.sizeGap ||
        Number(a.item.price) - Number(b.item.price),
    );
}

/** The variation that turns `item` into the asked dish, priced by the POS rules */
export function variationFor(
  item: MenuItemView,
  asked: AskedIngredient[],
  data: OrderData,
): { modifiers: SelectedModifier[]; price: number } {
  const own = data.itemIngredients[item.id] ?? [];
  const askedIds = new Set(asked.flatMap((a) => (a.ingredientId ? [a.ingredientId] : [])));
  const ownIds = new Set(own.map((i) => i.id));
  const removedIds = own.filter((i) => !askedIds.has(i.id)).map((i) => i.id);
  const addedIds = Array.from(askedIds).filter((id) => !ownIds.has(id));
  const modifiers = variationsToModifiers(own, data.variations.pantry, { removedIds, addedIds });
  return { modifiers, price: unitPriceWithModifiers(Number(item.price), modifiers) };
}

/** Rows that add up to the price: what each addition is charged after swaps
 * and the taper (addedIngredientsCharges), cent-rounded so they sum exactly */
function breakdownRows(
  baseLabel: string,
  basePrice: number,
  modifiers: SelectedModifier[],
  unknown: string[],
  total: number,
): PriceBreakdownRow[] {
  const rows: PriceBreakdownRow[] = [{ kind: "base", label: baseLabel, amount: basePrice }];
  const charges = addedIngredientsCharges(modifiers);
  const surchargeCents = toCents(total) - toCents(basePrice);
  const additions = modifiers
    .map((m, i) => ({ m, cents: Math.floor(charges[i] + 1e-9) }))
    .filter(({ m }) => !m.isRemoval);
  // the floored shares lose a few cents to rounding: give them back to the first
  const lost = surchargeCents - additions.reduce((s, a) => s + a.cents, 0);
  if (additions.length > 0 && lost > 0) {
    const i = additions.findIndex((a) => a.cents > 0);
    additions[i >= 0 ? i : 0].cents += lost;
  }
  modifiers
    .filter((m) => m.isRemoval)
    .forEach((m) =>
      rows.push({ kind: "removal", label: m.name, amount: 0, credit: m.creditPrice ?? 0 }),
    );
  additions.forEach(({ m, cents }) =>
    rows.push({ kind: "addition", label: m.name, amount: cents / 100 }),
  );
  unknown.forEach((u) => rows.push({ kind: "unknown", label: u, amount: 0 }));
  rows.push({ kind: "total", label: "", amount: total });
  return rows;
}

function labelOf(item: MenuItemView, category: Category) {
  return menuLabel(item, category.name);
}

/**
 * The proposal for a dish written by its ingredients, or null when the
 * category has no dish to compare with or nothing asked is a known
 * ingredient.
 */
export function proposeCustomDish(
  input: {
    categoryId: string;
    phrases: string[];
    removed?: string[];
    quantity?: number;
    sourceText?: string;
    name?: string;
    bianca?: boolean;
  },
  data: OrderData,
  minOverlap: number,
): CustomDishProposal | null {
  const category = data.categories.find((c) => c.id === input.categoryId);
  if (!category) return null;
  const asked = askedIngredients(input.phrases, input.removed ?? [], category, data, {
    bianca: input.bianca,
  });
  if (!asked.some((a) => a.ingredientId && !a.implied)) return null;
  const ranked = rankSimilar(asked, category.id, data);
  if (ranked.length === 0) return null;

  const best = ranked[0];
  const { modifiers, price } = variationFor(best.item, asked, data);
  const allowsVariations = best.item.id in data.variations.byItem;
  const label = labelOf(best.item, category);
  const unknown = asked.filter((a) => !a.ingredientId).map((a) => a.name);

  const similar = ranked.slice(0, 3).map((s) => ({
    menuItemId: s.item.id,
    name: labelOf(s.item, category).title,
    basePrice: Number(s.item.price),
    price: variationFor(s.item, asked, data).price,
    overlap: round2(s.overlap),
  }));
  const prices = similar.map((s) => s.price);

  const written = asked.filter((a) => !a.implied).map((a) => a.name);
  const name =
    input.name?.trim() ||
    `${singularCategory(category.name)} con ${joinList(written)}`;

  return {
    kind: "custom",
    sourceText: input.sourceText ?? input.phrases.join(", "),
    quantity: Math.max(1, Math.min(20, Math.round(input.quantity ?? 1))),
    name,
    categoryId: category.id,
    categoryName: category.name,
    ingredients: asked.map((a) => ({
      name: a.name,
      written: a.written,
      ingredientId: a.ingredientId,
      implied: a.implied,
    })),
    mode: allowsVariations && best.overlap >= minOverlap ? "variation" : "custom",
    base: {
      menuItemId: best.item.id,
      name: label.title,
      caption: label.ingredients,
      price: Number(best.item.price),
      allowsVariations,
    },
    overlap: round2(best.overlap),
    modifiers,
    price,
    breakdown: breakdownRows(label.title, Number(best.item.price), modifiers, unknown, price),
    similar,
    range: { min: Math.min(...prices), max: Math.max(...prices) },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
