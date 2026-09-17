import {
  Beef,
  Beer,
  CakeSlice,
  Carrot,
  Coffee,
  ConciergeBell,
  CupSoda,
  Fish,
  Hamburger,
  HandPlatter,
  IceCreamCone,
  Martini,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  UtensilsCrossed,
  Wheat,
  Wine,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { ReactNode } from "react";

/** A lucide icon, or one of the two below drawn to match them */
export type CategoryIcon = LucideIcon | ((props: LucideProps) => ReactNode);

/**
 * Two foods the icon set doesn't cover, drawn to lucide's own spec — 24x24
 * box, no fill, 2px round-capped strokes — so they sit in a row of lucide
 * icons without looking imported from somewhere else.
 */
function FoodIcon({
  children,
  ...props
}: LucideProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Folded shell with the filling standing proud of the rim */
function Taco(props: LucideProps) {
  return (
    <FoodIcon {...props}>
      <path d="M2.5 11.5h19" />
      <path d="M2.5 11.5a9.5 9.5 0 0 0 19 0" />
      <path d="M6.5 11.5c1.2-2.6 2.6-2.6 3.8 0" />
      <path d="M10.3 11.5c1.2-2.6 2.6-2.6 3.8 0" />
      <path d="M14.1 11.5c1.2-2.6 2.6-2.6 3.8 0" />
    </FoodIcon>
  );
}

/** Carton with three chips poking out of the top */
function Fries(props: LucideProps) {
  return (
    <FoodIcon {...props}>
      <path d="M5 10h14l-1.5 10h-11z" />
      <path d="M5.6 13.5h12.8" />
      <path d="M8.5 10 7 5" />
      <path d="M12 10V4" />
      <path d="M15.5 10 17 5" />
    </FoodIcon>
  );
}

/**
 * A picture per category, so the category list reads at a glance instead of
 * word by word — the list is scanned mid-service, often one-handed.
 *
 * Matched on keywords rather than on category id: the listino gets categories
 * added and renamed from Settings, and a new "Birre in bottiglia" should show
 * a beer without anyone editing code. Anything unmatched falls back to the
 * cutlery icon, which is never wrong, only unspecific.
 */
const RULES: Array<[RegExp, CategoryIcon]> = [
  // Longest / most specific wins, so keep the narrow patterns above the broad
  // ones: "pizza longa" must not be caught by a generic bread rule.
  [/\bpizz/, Pizza],
  [/bruschett/, Wheat],
  [/birr|spina|giraff/, Beer],
  [/toast/, Sandwich],
  [/piadin|piada/, Taco],
  [/hamburger|burger/, Hamburger],
  [/panin|sandwich|tramezzin/, Sandwich],
  [/fritt|patatin/, Fries],
  [/tagliata|carne|grigliat|secondi/, Beef],
  [/pesc|frutti di mare/, Fish],
  [/insalat|piatti freddi|freddi/, Salad],
  [/zupp|minestr|primi/, Soup],
  [/contorn|verdur/, Carrot],
  [/dolc|dessert|torte/, CakeSlice],
  [/gelat/, IceCreamCone],
  [/caff|cappuccin|colazion/, Coffee],
  [/vin|prosecc|bollicin/, Wine],
  [/cocktail|amar|liquor|digestiv|aperitiv/, Martini],
  [/bibit|bevand|analcolic|soft|succh/, CupSoda],
  [/servizio|copert/, ConciergeBell],
  [/richiesta|extra|aggiunt/, HandPlatter],
  [/piatti unici|unici/, UtensilsCrossed],
];

/** The icon for a category name; cutlery when nothing matches. */
export function categoryIcon(name: string | null | undefined): CategoryIcon {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return Utensils;
  for (const [pattern, icon] of RULES) {
    if (pattern.test(key)) return icon;
  }
  return Utensils;
}
