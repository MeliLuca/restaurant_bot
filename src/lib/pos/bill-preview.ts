import { calcTotals, remainingBalanceCents, splitCents, toCents } from "@/lib/money";

/**
 * What a payment *will* charge, in cents.
 *
 * This exists because the split-bill UI used to re-derive these amounts to
 * label its buttons, independently reimplementing the writer's rules — in
 * particular "if the selection clears the last unpaid lines, charge exactly
 * the remaining balance". Two copies of that rule drift, and when they drift
 * the button lies about what the customer is charged. api.ts now calls these
 * too, so the label and the charge cannot disagree.
 *
 * Structural parameter types (rather than the api.ts row types) keep this
 * module free of any dependency on the data layer, which is what avoids an
 * import cycle now that api.ts depends on it.
 */

interface PayableItem {
  id: string;
  unit_price: number;
  quantity: number;
  paid_by_payment_id: string | null;
}

/**
 * Shares still to pay for a chosen head-count. Even shares already taken count
 * against it, so changing the head-count mid-way stays exact.
 */
export function evenSharesPaid(payments: { kind: string }[]): number {
  return payments.filter((p) => p.kind === "even").length;
}

export function evenSharesLeft(
  payments: { kind: string }[],
  people: number,
): number {
  return Math.max(1, people - evenSharesPaid(payments));
}

/**
 * Exactly what payEvenShare(orderId, sharesLeft) will charge.
 *
 * The last share is the whole remainder rather than a rounded quotient, so a
 * sequence of even shares always lands on zero with no rounding drift.
 */
export function previewEvenShareCents(
  order: { total: number },
  payments: { amount: number }[],
  sharesLeft: number,
): number {
  const remainingCents = Math.max(remainingBalanceCents(order, payments), 0);
  if (remainingCents <= 0) return 0;
  const n = Math.max(1, Math.floor(sharesLeft));
  if (n === 1) return remainingCents;
  return Math.min(splitCents(remainingCents, n)[0], remainingCents);
}

/**
 * Exactly what payForItems(orderId, selectedIds) will charge: the selected
 * unpaid lines plus their share of tax at the order's snapshotted rate —
 * except when the selection clears the last unpaid lines, where it is exactly
 * the remaining balance, absorbing per-payment tax-rounding drift.
 */
export function previewItemsPaymentCents(
  order: { total: number; tax_rate: number },
  items: PayableItem[],
  payments: { amount: number }[],
  selectedIds: string[],
): number {
  const unpaid = items.filter((i) => i.paid_by_payment_id === null);
  const selected = unpaid.filter((i) => selectedIds.includes(i.id));
  if (selected.length === 0) return 0;

  const remainingCents = Math.max(remainingBalanceCents(order, payments), 0);
  if (remainingCents <= 0) return 0;

  if (selected.length === unpaid.length) return remainingCents;

  const amountCents = toCents(
    calcTotals(
      selected.map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity })),
      order.tax_rate,
    ).total,
  );
  return Math.min(amountCents, remainingCents);
}
