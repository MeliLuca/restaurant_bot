/**
 * An emoji per category, so the category list reads at a glance instead of
 * word by word — the list is scanned mid-service, often one-handed.
 *
 * Matched on keywords rather than on category id: the listino gets categories
 * added and renamed from Settings, and a new "Birre in bottiglia" should show
 * a beer without anyone editing code. Anything unmatched falls back to the
 * place setting, which is never wrong, only unspecific.
 */
const RULES: Array<[RegExp, string]> = [
  // Longest / most specific wins, so keep the narrow patterns above the broad
  // ones: "pizza longa" must not be caught by a generic bread rule.
  [/\bpizz/, "🍕"],
  [/bruschett/, "🥖"],
  [/birr|spina|giraff/, "🍺"],
  [/toast/, "🥪"],
  [/piadin|piada/, "🌮"],
  [/hamburger|burger/, "🍔"],
  [/panin|sandwich|tramezzin/, "🥪"],
  [/fritt|patatin/, "🍟"],
  [/tagliata|carne|grigliat|secondi/, "🥩"],
  [/pesc|frutti di mare/, "🐟"],
  [/insalat|piatti freddi|freddi/, "🥗"],
  [/zupp|minestr|primi/, "🍲"],
  [/contorn|verdur/, "🥕"],
  [/dolc|dessert|torte/, "🍰"],
  [/gelat/, "🍦"],
  [/caff|cappuccin|colazion/, "☕"],
  [/vin|prosecc|bollicin/, "🍷"],
  [/cocktail|amar|liquor|digestiv|aperitiv/, "🍸"],
  [/bibit|bevand|analcolic|soft|succh/, "🥤"],
  [/servizio|copert/, "🔔"],
  [/richiesta|extra|aggiunt/, "🙋"],
  [/piatti unici|unici/, "🍛"],
];

/** The emoji for a category name; a place setting when nothing matches. */
export function categoryEmoji(name: string | null | undefined): string {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return "🍽️";
  for (const [pattern, emoji] of RULES) {
    if (pattern.test(key)) return emoji;
  }
  return "🍽️";
}
