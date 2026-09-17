import type { Category } from "@/lib/database.types";
import type { MenuItemView } from "@/lib/menu-display";

/**
 * One search engine for every screen that looks things up in the listino: the
 * till, the phone, and the settings menu manager.
 *
 * What a waiter types is not what the listino says. They type without accents,
 * in whatever word order comes out, they name an ingredient rather than a dish,
 * and they say "piadina" when the category is called "Piadine". Each of those
 * is handled below; between them they are most of what "search doesn't work"
 * meant before this existed.
 */

/**
 * Accent-insensitive lowercase, with punctuation flattened to spaces so
 * "Hoegaarden Blanche — cl 0,25" tokenises the same way it is spoken.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Below this length a word is left alone — short queries stay literal. */
const STEM_MIN_LENGTH = 4;

/**
 * Crude Italian plural fold, NOT a general stemmer: drop a trailing a/e/i/o.
 *
 * Menu vocabulary pluralises by swapping that final vowel — piadina/piadine,
 * bruschetta/bruschette, pizza/pizze, panino/panini, birra/birre — so plain
 * substring matching misses the singular a waiter actually types
 * ("piadine".includes("piadina") is false). Folding both the query and the
 * indexed text through the same rule makes the two meet in the middle at
 * "piadin". Words ending in a consonant are untouched, so "hamburger" and
 * "toast" match themselves and nothing else.
 *
 * The 4-character floor guarantees at least 3 characters survive, which is what
 * keeps the fold from collapsing distinct short words together.
 */
export function stem(word: string): string {
  if (word.length < STEM_MIN_LENGTH) return word;
  return /[aeio]$/.test(word) ? word.slice(0, -1) : word;
}

/** Normalised, stemmed words — the unit both sides of a match are built from. */
export function tokenize(s: string): string[] {
  const normalized = normalize(s);
  return normalized ? normalized.split(" ").map(stem) : [];
}

/**
 * The searchable text of an item, as one string. Callers pass whatever fields
 * identify their rows; matching is substring-based, so a single joined haystack
 * beats a per-field scan.
 */
export function buildHaystack(parts: (string | null | undefined)[]): string {
  return tokenize(parts.filter(Boolean).join(" ")).join(" ");
}

export interface MenuSearchEntry {
  item: MenuItemView;
  haystack: string;
}

export type MenuSearchIndex = MenuSearchEntry[];

/**
 * Pre-normalised text per item, so a keystroke only scans strings.
 *
 * The haystack spans codice, name, ingredients AND the category name, which is
 * what lets one box answer all the ways a dish gets asked for: "1202", "toast
 * prosciutto", "prosciutto" (every category, not just the pizzas whose name
 * column happens to be a topping list), and "piadina" (the whole section).
 */
export function buildMenuIndex(
  items: MenuItemView[],
  categories: Category[],
): MenuSearchIndex {
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  return items.map((item) => ({
    item,
    haystack: buildHaystack([
      item.codice,
      item.name,
      ...(item.ingredients ?? []),
      categoryName.get(item.category_id),
    ]),
  }));
}

/**
 * Every item matching all the typed words, in any order. An empty query means
 * "the whole menu" — browsing and searching are the same list, only narrower.
 *
 * Input order is preserved (the API sorts by sort_order), so the caller can
 * group without re-sorting.
 */
export function searchMenu(
  index: MenuSearchIndex,
  query: string,
): MenuItemView[] {
  const words = tokenize(query);
  if (words.length === 0) return index.map((e) => e.item);
  return index
    .filter((e) => words.every((w) => e.haystack.includes(w)))
    .map((e) => e.item);
}

export interface MenuSection {
  category: Category;
  items: MenuItemView[];
}

/**
 * Items bucketed into categories in menu order, empty categories dropped. The
 * shape the list renders: one sticky-headed section per category, whether it is
 * showing the whole menu or three search hits.
 */
export function groupByCategory(
  items: MenuItemView[],
  categories: Category[],
): MenuSection[] {
  const byCategory = new Map<string, MenuItemView[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.category_id);
    if (bucket) bucket.push(item);
    else byCategory.set(item.category_id, [item]);
  }
  return categories
    .map((category) => ({
      category,
      items: byCategory.get(category.id) ?? [],
    }))
    .filter((section) => section.items.length > 0);
}
