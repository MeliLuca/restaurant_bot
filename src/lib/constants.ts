// Fixed tax rate applied to all orders (spec: 8%). Snapshotted onto each
// order row at write time so historical orders survive future rate changes.
export const TAX_RATE = 0.08;

export const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(amount: number): string {
  return CURRENCY_FORMATTER.format(amount);
}
