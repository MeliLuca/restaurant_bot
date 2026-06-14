import { TAX_RATE } from "@/lib/constants";

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface TicketTotals {
  subtotal: number;
  tax: number;
  total: number;
}

// Math is done in integer cents to avoid floating-point drift. Historical
// orders pass their snapshotted orders.tax_rate; new tickets use the default.
export function calcTotals(
  lines: PricedLine[],
  taxRate: number = TAX_RATE,
): TicketTotals {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity,
    0,
  );
  const taxCents = Math.round(subtotalCents * taxRate);
  return {
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    total: (subtotalCents + taxCents) / 100,
  };
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Extra charge for the ingredients ADDED to a dish, on a diminishing
 * logarithmic scale. Add-ons range ≈€1–€3 and customers heavily modify
 * standard pizzas, so the linear sum is tapered as the order grows:
 *
 *     P_total = S · log2(n + 1) / n
 *
 * where S is the linear sum of the added ingredients and n is how many were
 * added. n=1 charges the full price, n=2 ≈0.79×, n=3 ≈0.67×, … — the per-item
 * cost keeps falling. Only true additions (positive adjustment) feed S and n;
 * removing a standard ingredient is never a deduction, so non-positive
 * modifiers contribute exactly 0 (the POS "−" action). Order-independent: it
 * reads only the current set of modifiers. Euros, rounded to the cent.
 */
export function addedIngredientsSurcharge(
  modifiers: Array<{ priceAdjustment: number }>,
): number {
  const added = modifiers.filter((m) => m.priceAdjustment > 0);
  const n = added.length;
  if (n === 0) return 0;
  const sumCents = added.reduce((sum, m) => sum + toCents(m.priceAdjustment), 0);
  const factor = Math.log2(n + 1) / n;
  return Math.round(sumCents * factor) / 100;
}

/**
 * Plain linear sum S of the added ingredients, before the diminishing taper —
 * lets the POS show the "before → after" of the scale. Euros, cent-exact.
 */
export function addedIngredientsLinearSum(
  modifiers: Array<{ priceAdjustment: number }>,
): number {
  return (
    modifiers
      .filter((m) => m.priceAdjustment > 0)
      .reduce((sum, m) => sum + toCents(m.priceAdjustment), 0) / 100
  );
}

/**
 * Price actually charged per unit: base price plus the diminishing surcharge
 * for added ingredients (removals add nothing). This is what
 * order_items.unit_price snapshots, so downstream money flows (totals, splits,
 * stats, receipt) never re-derive modifiers.
 */
export function unitPriceWithModifiers(
  basePrice: number,
  modifiers: Array<{ priceAdjustment: number }>,
): number {
  return (
    (toCents(basePrice) + toCents(addedIngredientsSurcharge(modifiers))) / 100
  );
}

/**
 * Split an integer cent amount into `parts` near-equal shares that sum back
 * to the amount exactly — the first `remainder` shares carry the extra cent
 * (e.g. 1000/3 → [334, 333, 333]), so no rounding error can accumulate.
 */
export function splitCents(totalCents: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}
