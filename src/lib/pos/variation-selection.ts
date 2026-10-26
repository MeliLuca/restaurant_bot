import {
  addedIngredientsLinearSum,
  addedIngredientsNetSum,
  addedIngredientsSurcharge,
  toCents,
} from "@/lib/money";
import type { SelectedModifier } from "@/stores/ticket-store";

/**
 * Variation picking rules, extracted from the desktop dialog so the phone can
 * reuse them instead of re-deriving the pricing — that class of bug is silent
 * (a wrong charge on a valid-looking ticket) and therefore expensive.
 *
 * Replaces the old modifier-group machinery: there are no groups, no min/max
 * rules and nothing to configure per dish. A dish offers its own ingredients
 * to REMOVE and the whole pantry to ADD.
 *
 * Pure and React-free.
 */

/** An ingredient as the picker sees it: the dish's own, or one from the pantry. */
export interface VariationOption {
  id: string;
  name: string;
  /** Price as an addition. Ignored when the option is being removed. */
  price: number;
}

/** What the picker is holding, as two disjoint sets of ingredient ids. */
export interface VariationState {
  removedIds: string[];
  addedIds: string[];
}

export const EMPTY_VARIATIONS: VariationState = { removedIds: [], addedIds: [] };

/** Map a line's existing modifiers back into the two sets. */
export function seedVariations(initial: SelectedModifier[]): VariationState {
  const removedIds: string[] = [];
  const addedIds: string[] = [];
  for (const m of initial) {
    if (!m.ingredientId) continue;
    (m.isRemoval ? removedIds : addedIds).push(m.ingredientId);
  }
  return { removedIds, addedIds };
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function toggleRemoval(
  state: VariationState,
  ingredientId: string,
): VariationState {
  return { ...state, removedIds: toggle(state.removedIds, ingredientId) };
}

export function toggleAddition(
  state: VariationState,
  ingredientId: string,
): VariationState {
  return { ...state, addedIds: toggle(state.addedIds, ingredientId) };
}

/**
 * Flatten the two sets into the SelectedModifier[] a ticket line holds.
 *
 * Removals are emitted first (they read as corrections to the dish) and always
 * at price 0 — a removal is never a discount, which the DB also enforces. They
 * carry their listino price as `creditPrice`, so swapping one ingredient for
 * another of the same price costs nothing (lib/money.ts).
 * Anything no longer present in the dish or the pantry is dropped: an
 * ingredient deleted from the menu should not keep charging.
 */
export function variationsToModifiers(
  dishIngredients: VariationOption[],
  pantry: VariationOption[],
  state: VariationState,
): SelectedModifier[] {
  const dishById = new Map(dishIngredients.map((i) => [i.id, i]));
  const pantryById = new Map(pantry.map((i) => [i.id, i]));

  const removals = state.removedIds.flatMap((id) => {
    const opt = dishById.get(id);
    return opt
      ? [
          {
            ingredientId: id,
            name: opt.name,
            priceAdjustment: 0,
            isRemoval: true,
            // its listino price offsets an addition (swap), never deducts
            creditPrice: opt.price,
          },
        ]
      : [];
  });
  const additions = state.addedIds.flatMap((id) => {
    const opt = pantryById.get(id);
    return opt
      ? [
          {
            ingredientId: id,
            name: opt.name,
            priceAdjustment: opt.price,
            isRemoval: false,
          },
        ]
      : [];
  });
  return [...removals, ...additions];
}

/**
 * The pantry as the "add" section should render it: the picked additions, plus
 * search suggestions for the query. Nothing is suggested until something is
 * typed — the pantry runs to a couple of hundred rows and browsing it was
 * slower than typing three letters.
 *
 * The dish's own ingredients are excluded — they belong to the "remove"
 * section, and letting them appear in both would allow one line to carry the
 * same ingredient added AND removed. Picked additions are returned apart from
 * the suggestions and never filtered, so a search never hides something the
 * waiter has selected (and the total always matches what is on screen).
 */
export function addablePantry(
  pantry: VariationOption[],
  dishIngredients: VariationOption[],
  state: VariationState,
  query: string,
  limit: number,
): { picked: VariationOption[]; matches: VariationOption[]; hiddenCount: number } {
  const ownIds = new Set(dishIngredients.map((i) => i.id));
  const addable = pantry.filter((i) => !ownIds.has(i.id));
  const pickedIds = new Set(state.addedIds);

  const picked = addable.filter((i) => pickedIds.has(i.id));
  const q = query.trim().toLowerCase();
  if (!q) return { picked, matches: [], hiddenCount: 0 };

  // Names starting with the query first, then a later word starting with it,
  // then anywhere: "sal" offers salame before "2 salsicce" before insalata.
  // Within a tier, priced rows first: those are the house's add-on list, the
  // free ones are mostly dish descriptions the listino import split into the
  // pantry ("involtino di speck … di bufala" must not beat "mozzarella di
  // bufala" to the Enter key). The sort is stable, so the rest stays A–Z.
  const tier = (i: VariationOption) => {
    const name = i.name.toLowerCase();
    const t = name.startsWith(q) ? 0 : name.includes(` ${q}`) ? 1 : 2;
    return t * 2 + (i.price > 0 ? 0 : 1);
  };
  const rest = addable
    .filter((i) => !pickedIds.has(i.id) && i.name.toLowerCase().includes(q))
    .sort((a, b) => tier(a) - tier(b));
  return {
    picked,
    matches: rest.slice(0, limit),
    hiddenCount: Math.max(0, rest.length - limit),
  };
}

/** Toggle a note rapida on a line. The result follows the configured list's
 * order, not tap order, so the kitchen always reads them the same way round;
 * a note deleted from the list since goes last rather than vanishing. */
export function toggleNote(
  notes: string[],
  note: string,
  order: string[],
): string[] {
  const next = notes.includes(note)
    ? notes.filter((n) => n !== note)
    : [...notes, note];
  const rank = (n: string) => {
    const i = order.indexOf(n);
    return i < 0 ? order.length : i;
  };
  return next.sort((a, b) => rank(a) - rank(b));
}

export interface VariationPricePreview {
  /** How many priced additions are selected (removals excluded) */
  addedCount: number;
  /** Straight sum of the additions — shown struck through when tapered */
  linearExtras: number;
  /** What is actually charged, on the diminishing scale */
  surcharge: number;
  /** True once the diminishing scale (or rounding down) has actually bitten */
  tapered: boolean;
  /** True when a removed ingredient offsets an addition (swap) */
  swapped: boolean;
  total: number;
}

/** Live price breakdown for the picker footer. Removals never deduct on
 * their own; they only offset a swapped-in addition. */
export function variationPricePreview(
  basePrice: number,
  selected: SelectedModifier[],
): VariationPricePreview {
  const linearExtras = addedIngredientsLinearSum(selected);
  const netExtras = addedIngredientsNetSum(selected);
  const surcharge = addedIngredientsSurcharge(selected);
  return {
    addedCount: selected.filter((m) => !m.isRemoval && m.priceAdjustment > 0)
      .length,
    linearExtras,
    surcharge,
    tapered: surcharge < netExtras,
    swapped: netExtras < linearExtras,
    total: (toCents(basePrice) + toCents(surcharge)) / 100,
  };
}
