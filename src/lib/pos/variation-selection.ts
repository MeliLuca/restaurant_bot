import {
  addedIngredientsLinearSum,
  addedIngredientsSurcharge,
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
 * at price 0 — a removal is never a discount, which the DB also enforces.
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
      ? [{ ingredientId: id, name: opt.name, priceAdjustment: 0, isRemoval: true }]
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
 * The pantry as the "add" section should render it.
 *
 * The dish's own ingredients are excluded — they belong to the "remove"
 * section, and letting them appear in both would allow one line to carry the
 * same ingredient added AND removed. Already-picked additions are always
 * returned even when the query filters them out, so a search never silently
 * hides something the waiter has selected (and the total always matches what
 * is on screen).
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
  const rest = addable.filter(
    (i) => !pickedIds.has(i.id) && (!q || i.name.toLowerCase().includes(q)),
  );
  return {
    picked,
    matches: rest.slice(0, limit),
    hiddenCount: Math.max(0, rest.length - limit),
  };
}

export interface VariationPricePreview {
  /** How many priced additions are selected (removals excluded) */
  addedCount: number;
  /** Straight sum of the additions — shown struck through when tapered */
  linearExtras: number;
  /** What is actually charged, on the diminishing scale */
  surcharge: number;
  /** True once the diminishing scale has actually bitten */
  tapered: boolean;
  total: number;
}

/** Live price breakdown for the picker footer. Removals never deduct. */
export function variationPricePreview(
  basePrice: number,
  selected: SelectedModifier[],
): VariationPricePreview {
  const linearExtras = addedIngredientsLinearSum(selected);
  const surcharge = addedIngredientsSurcharge(selected);
  return {
    addedCount: selected.filter((m) => m.priceAdjustment > 0).length,
    linearExtras,
    surcharge,
    tapered: surcharge < linearExtras,
    total: basePrice + surcharge,
  };
}
