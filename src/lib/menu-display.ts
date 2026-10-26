import type { Category, MenuItem } from "@/lib/database.types";

/** A menu item plus the ingredient names the listino lists underneath it. */
export type MenuItemView = MenuItem & { ingredients: string[] };

/**
 * Categories the listino identifies by number rather than by name. A pizza has
 * no name in the price list — the "name" column IS its topping list, and the
 * codice is what everyone, staff and regulars alike, actually says out loud.
 * So on screen the codice becomes the headline and the toppings drop to the
 * caption, which is the same information the paper listino shows.
 *
 * Matched on the category name because nothing in the schema marks these; a
 * renamed or newly added pizza category needs its name adding here.
 */
const CODE_NAMED_CATEGORIES = new Set(["pizze", "bruschette"]);

export function isCodeNamedCategory(name: string | null | undefined): boolean {
  return name != null && CODE_NAMED_CATEGORIES.has(name.trim().toLowerCase());
}

export interface MenuLabel {
  /** Headline: the codice for pizze/bruschette, the dish name everywhere else */
  title: string;
  /** Caption under the title; null when the item has nothing to add */
  ingredients: string | null;
}

export function menuLabel(
  item: { name: string; codice?: string | null; ingredients?: string[] },
  categoryName: string | null | undefined,
): MenuLabel {
  // The name already reads as the topping list, in the listino's own wording
  // and order — better than the ingredient join, which has no ordering column
  // and comes back shuffled ("carciofi, pomodoro, crudo, funghi, mozzarella").
  // A code-named item with no codice keeps its name; there is nothing to
  // promote, and a bare caption would leave the row unidentifiable.
  if (isCodeNamedCategory(categoryName) && item.codice) {
    return { title: item.codice, ingredients: item.name };
  }
  const ingredients = (item.ingredients ?? []).join(", ");
  return { title: item.name, ingredients: ingredients || null };
}

/**
 * Label resolver bound to a category list — the form every item-picking screen
 * wants, since they all hold `categories` already and render many items.
 */
export function makeMenuLabeller(
  categories: Category[],
): (item: MenuItem | MenuItemView) => MenuLabel {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  return (item) =>
    menuLabel(item as MenuItemView, nameById.get(item.category_id));
}

/** The menu_items columns a bill line needs to label itself */
export type OrderItemMenuRef = {
  name: string;
  codice: string | null;
  categories: { name: string } | null;
} | null;

/**
 * Label for a line already on the bill. Ingredients are only ever filled in
 * for code-named items, where the title is a bare number and the toppings are
 * what make the line readable — a conto that spelled out the filling of every
 * panino would be unreadable.
 */
export function orderItemLabel(
  menuItem: OrderItemMenuRef,
  fallbackName: string,
  /** order_items.custom_name — a "Fuori menù" line reads as its own name */
  customName?: string | null,
): MenuLabel {
  if (customName) return { title: customName, ingredients: null };
  if (!menuItem) return { title: fallbackName, ingredients: null };
  return menuLabel(
    { name: menuItem.name, codice: menuItem.codice },
    menuItem.categories?.name,
  );
}

/** One-line form, for aria labels and pickers that can't render two rows */
export function menuLabelText(label: MenuLabel): string {
  return label.ingredients
    ? `${label.title} — ${label.ingredients}`
    : label.title;
}
