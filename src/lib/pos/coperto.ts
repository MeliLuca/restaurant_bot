/**
 * Display-side collapse of the cover charge.
 *
 * splitCopertoPerGuest turns the coperto into one payable line per guest so
 * the split-by-item picker can hand each customer their own. That is right for
 * the picker and wrong everywhere else: a bill that reads "1× Coperto" four
 * times over looks like a punching mistake, not a guest count. So the two
 * places that render a bill run the lines through here first and get the one
 * line back, without the split being undone underneath the payment flow.
 *
 * Only *unpaid* covers merge, and only those sharing a price snapshot: a paid
 * line belongs to the guest who settled it and stays on its own, and prices
 * from either side of a mid-service change never fold into one quantity.
 */

interface CopertoLine {
  quantity: number;
  unit_price: number;
  paid_by_payment_id: string | null;
  menu_items: { is_coperto: boolean } | null;
}

export function collapseCoperto<T extends CopertoLine>(items: T[]): T[] {
  const isMergeable = (i: T) =>
    (i.menu_items?.is_coperto ?? false) && i.paid_by_payment_id === null;
  if (items.filter(isMergeable).length < 2) return items;

  // first row of each price group keeps its place (and its id, so React keys
  // and the covers-edit target stay stable); the rest fold into its quantity
  const firstAt = new Map<number, number>();
  const out: T[] = [];
  for (const item of items) {
    if (!isMergeable(item)) {
      out.push(item);
      continue;
    }
    const at = firstAt.get(item.unit_price);
    if (at === undefined) {
      firstAt.set(item.unit_price, out.length);
      out.push(item);
    } else {
      out[at] = { ...out[at], quantity: out[at].quantity + item.quantity };
    }
  }
  return out;
}
