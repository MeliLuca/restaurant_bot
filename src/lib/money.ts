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
 * Price actually charged per unit: base price plus every modifier adjustment,
 * summed in integer cents. This is what order_items.unit_price snapshots, so
 * downstream money flows (totals, splits, stats) never re-derive modifiers.
 */
export function unitPriceWithModifiers(
  basePrice: number,
  modifiers: Array<{ priceAdjustment: number }>,
): number {
  return (
    modifiers.reduce((sum, m) => sum + toCents(m.priceAdjustment), toCents(basePrice)) / 100
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
