// Assistente AI — contract of the ORDER task (owned by the order task).
//   POST /api/ai/order/parse        free text → menu lines + off-menu dishes
//   POST /api/ai/order/price        a written dish → proposed price
//   POST /api/ai/order/custom-item  the "Fuori menù" placeholder of a category
// Every price here is computed by the app's own rules (lib/money.ts,
// lib/pos/variation-selection.ts); the model never writes a number. The model
// only extracts the structure of the text (ExtractedItem); matching it to the
// menu and pricing it is deterministic code (lib/ai/order/*).
import type { SelectedModifier } from "@/stores/ticket-store";
import type { AiMeta } from "./common";

export interface OrderParseRequest {
  text: string;
}

/** One dish as the model (or the rule-based fallback) read it — words only */
export interface ExtractedItem {
  quantita: number;
  /** the dish as written ("margherita", "1202", "bruschetta pomodoro", "pizza") */
  piatto: string;
  /** category hint; validated against the real categories, may be empty */
  categoria?: string;
  /** ingredients to take off, as written */
  senza?: string[];
  /** ingredients to add, as written (also the ingredients of a dish written
   * by its toppings: "pizza con burrata e crudo") */
  extra?: string[];
  /** cooking, timing, "con ghiaccio"… */
  note?: string[];
}

/** One way of putting a recognised dish on the ticket. The line's own pick and
 * each alternative have this shape, so switching is a plain swap. */
export interface LineChoice {
  menuItemId: string;
  /** display label, as the POS menu shows it (codice for pizze/bruschette) */
  name: string;
  /** caption under a codice name (the toppings), else null */
  ingredients: string | null;
  categoryName: string;
  /** BASE menu price (TicketLine.unitPrice) */
  basePrice: number;
  /** only on dishes that allow variations (key present in byItem) */
  modifiers: SelectedModifier[];
  /** charged per unit, modifiers included (unitPriceWithModifiers) */
  unitPrice: number;
  /** note rapide (canonical names) first, then free notes; never a comma */
  notes: string[];
  /** variations that could not be charged and went into `notes` instead
   * ("senza basilico" on a dish without basil, anything on a dish that does
   * not allow variations) — the UI flags them */
  noteOnly: string[];
  /** asked-for additions/removals that match no pantry ingredient */
  unknownIngredients: string[];
}

/** A menu dish recognised in the text, ready to become a TicketLine */
export interface ParsedLine extends LineChoice {
  kind: "menu";
  /** the words of the request this line came from */
  sourceText: string;
  quantity: number;
  /** low = picked among several close candidates, or something asked could
   * not be applied; the UI asks to check */
  confidence: "high" | "low";
  /** close candidates, each priced with the same variations */
  alternatives: LineChoice[];
}

export interface PriceBreakdownRow {
  kind: "base" | "addition" | "removal" | "unknown" | "total";
  /** dish label (base), ingredient name (addition/removal/unknown), "" (total) */
  label: string;
  /** what this row adds to the price; removals and unknown are always 0 */
  amount: number;
  /** removals only: listino price credited against an addition (swap) */
  credit?: number;
}

/** A dish written by ingredients, priced from the most similar menu dish */
export interface CustomDishProposal {
  kind: "custom";
  sourceText: string;
  quantity: number;
  /** proposed free name, e.g. "Pizza con burrata, prosciutto crudo e granella di pistacchio" */
  name: string;
  categoryId: string;
  categoryName: string;
  /** what was asked for; ingredientId null = not in the pantry (priced 0,
   * flagged). `implied` = the pizza base (pomodoro + mozzarella), not written */
  ingredients: {
    name: string;
    written: string;
    ingredientId: string | null;
    implied: boolean;
  }[];
  /** variation = add it as the base dish with variations; custom = "Fuori
   * menù" line. Always custom when the base does not allow variations. */
  mode: "variation" | "custom";
  base: {
    menuItemId: string;
    name: string;
    /** caption under a codice name */
    caption: string | null;
    price: number;
    allowsVariations: boolean;
  };
  /** Jaccard similarity of ingredients with the base dish, 0..1 */
  overlap: number;
  /** variations relative to the base dish (removals carry creditPrice) */
  modifiers: SelectedModifier[];
  /** proposed price per unit = unitPriceWithModifiers(base.price, modifiers) */
  price: number;
  breakdown: PriceBreakdownRow[];
  /** the 3 most similar dishes of the category, each priced as the variation
   * it would take to become this dish */
  similar: {
    menuItemId: string;
    name: string;
    basePrice: number;
    price: number;
    overlap: number;
  }[];
  range: { min: number; max: number };
}

export type OrderParseStatus = "ok" | "clarify" | "staff" | "refuse";

export type UnresolvedReason =
  /** nothing on the menu looks like it */
  | "not_found"
  /** only a category was named ("una pizza") */
  | "too_vague";

export interface OrderParseResponse {
  status: OrderParseStatus;
  lines: ParsedLine[];
  customDishes: CustomDishProposal[];
  /** parts of the text that matched nothing */
  unresolved: { text: string; reason: UnresolvedReason; categoryName: string | null }[];
  /** a short question back when status = clarify */
  clarification: string | null;
  /** one-sentence reply from the model (null when unavailable, or scrubbed
   * because it mentioned money) */
  reply: string | null;
  /** who read the text: the model, or the rule-based fallback when the
   * model is unavailable (simpler: no corrections, no dialect) */
  extractedBy: "ai" | "rules";
  ai: AiMeta | null;
}

export interface OrderPriceRequest {
  /** free text ("pizza con burrata, crudo e pistacchio")… */
  text?: string;
  /** …or the pieces directly */
  categoryId?: string;
  ingredients?: string[];
  name?: string;
}

export type OrderPriceResponse = CustomDishProposal & { ai: AiMeta | null };

export interface CustomItemRequest {
  categoryId: string;
}

export interface CustomItemResponse {
  menuItemId: string;
  name: string;
  categoryId: string;
  targetPrinterId: string | null;
  /** false = it already existed */
  created: boolean;
}
