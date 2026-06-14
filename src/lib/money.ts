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
 * standard pizzas, so each successive ingredient is charged less than the
 * last. The ingredients are ranked most-expensive-first and the i-th one
 * (1-based) is charged at weight:
 *
 *     w(i) = log2(1 + 1/i)            // w(1)=1, w(2)≈0.585, w(3)≈0.415, …
 *
 * so P_total = Σ price(i) · w(i). The weights telescope — Σ_{i=1..n} w(i) =
 * log2(n+1) — so when every add-on costs the same this is exactly the old
 * aggregate form S·log2(n+1)/n (n=1 full price, n=2 ≈0.79×, n=3 ≈0.67×, …).
 * Charging per rank rather than tapering the whole sum keeps it MONOTONE:
 * because every weight is ≥ 0 and ranks only shift down (to weaker weights)
 * when a pricier item is inserted, adding an ingredient can never lower the
 * surcharge — the old closed form could (a cheap add-on shrank the factor
 * faster than it grew the sum, dropping the charge). Only true additions
 * (positive adjustment) are charged; removing a standard ingredient is never a
 * deduction, so non-positive modifiers contribute exactly 0 (the POS "−"
 * action). Order-independent: it reads only the current set of modifiers.
 * Euros, rounded to the cent.
 */
export function addedIngredientsSurcharge(
  modifiers: Array<{ priceAdjustment: number }>,
): number {
  const ranked = modifiers
    .filter((m) => m.priceAdjustment > 0)
    .map((m) => toCents(m.priceAdjustment))
    .sort((a, b) => b - a);
  if (ranked.length === 0) return 0;
  const totalCents = ranked.reduce(
    (sum, cents, i) => sum + cents * Math.log2(1 + 1 / (i + 1)),
    0,
  );
  return Math.round(totalCents) / 100;
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
