import {
  addedIngredientsLinearSum,
  addedIngredientsSurcharge,
} from "@/lib/money";
import type { ModifierGroupWithModifiers } from "@/lib/api";
import type { SelectedModifier } from "@/stores/ticket-store";
import type { TFn } from "@/lib/i18n/use-translation";

/**
 * Modifier picking rules, extracted from the desktop dialog so the phone can
 * reuse them instead of re-deriving min/max enforcement — that class of bug is
 * silent (a wrong charge on a valid-looking ticket) and therefore expensive.
 *
 * Pure and React-free: TFn is imported as a type only, so nothing here pulls
 * in the i18n hook at runtime.
 */

/** Human-readable "choose 1" / "up to 3" / "choose 2–4" label for a group. */
export function selectionRule(group: ModifierGroupWithModifiers, t: TFn): string {
  const { min_selections: min, max_selections: max } = group;
  if (min === max)
    return min === 1 ? t("pos.ruleChoose1") : t("pos.ruleChooseN", { count: min });
  if (min === 0)
    return max === 1 ? t("pos.ruleOptional") : t("pos.ruleUpToN", { count: max });
  return t("pos.ruleChooseRange", { min, max });
}

/** Map a line's existing modifiers back to picked ids, per group. */
export function seedPicked(
  groups: ModifierGroupWithModifiers[],
  initial: SelectedModifier[],
): Record<string, string[]> {
  const chosen = new Set(initial.map((m) => m.modifierId));
  const picked: Record<string, string[]> = {};
  for (const g of groups) {
    const ids = g.modifiers.filter((m) => chosen.has(m.id)).map((m) => m.id);
    if (ids.length) picked[g.id] = ids;
  }
  return picked;
}

/**
 * Next picked-id list for one group after tapping `modifierId`.
 *
 * Deselect always works. Single-choice groups swap the selection; multi-choice
 * groups respect max_selections and return `currentPicked` unchanged when the
 * cap is already reached, so the caller can treat identity as "no-op".
 */
export function togglePick(
  group: ModifierGroupWithModifiers,
  currentPicked: string[],
  modifierId: string,
): string[] {
  if (currentPicked.includes(modifierId))
    return currentPicked.filter((id) => id !== modifierId);
  if (group.max_selections === 1) return [modifierId];
  if (currentPicked.length >= group.max_selections) return currentPicked;
  return [...currentPicked, modifierId];
}

/** True when this modifier can't be picked because the group is already full. */
export function isCapped(
  group: ModifierGroupWithModifiers,
  pickedCount: number,
  active: boolean,
): boolean {
  return !active && group.max_selections > 1 && pickedCount >= group.max_selections;
}

/** Flatten the per-group picks into the SelectedModifier[] a ticket line holds. */
export function pickedToModifiers(
  groups: ModifierGroupWithModifiers[],
  picked: Record<string, string[]>,
): SelectedModifier[] {
  return groups.flatMap((g) =>
    g.modifiers
      .filter((m) => (picked[g.id] ?? []).includes(m.id))
      .map((m) => ({
        modifierId: m.id,
        name: m.name,
        priceAdjustment: m.price_adjustment,
      })),
  );
}

/**
 * Filter groups by ingredient name. Only affects what is *shown* — picks and
 * the running total always read the full selection, so a filtered-out
 * ingredient stays selected.
 */
export function filterGroups(
  groups: ModifierGroupWithModifiers[],
  query: string,
): ModifierGroupWithModifiers[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      modifiers: g.modifiers.filter((m) => m.name.toLowerCase().includes(q)),
    }))
    .filter((g) => g.modifiers.length > 0);
}

export interface ModifierPricePreview {
  /** How many priced additions are selected (removals excluded) */
  addedCount: number;
  /** Straight sum of the additions — shown struck through when tapered */
  linearExtras: number;
  /** What is actually charged, on the diminishing scale */
  surcharge: number;
  /** True once n >= 2, i.e. the diminishing scale has kicked in */
  tapered: boolean;
  total: number;
}

/** Live price breakdown for the picker footer. Removals never deduct. */
export function modifierPricePreview(
  basePrice: number,
  selected: SelectedModifier[],
): ModifierPricePreview {
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
