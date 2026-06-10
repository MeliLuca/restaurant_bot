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

// Math is done in integer cents to avoid floating-point drift.
export function calcTotals(lines: PricedLine[]): TicketTotals {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity,
    0,
  );
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  return {
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    total: (subtotalCents + taxCents) / 100,
  };
}
