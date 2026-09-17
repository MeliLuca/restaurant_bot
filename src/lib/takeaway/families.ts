/**
 * Follow-ups sit directly under the order they add to.
 *
 * A customer with two orders is still one customer waiting at the counter, and
 * two unrelated-looking rows sharing a name is exactly the confusion the name
 * rule exists to prevent. A follow-up re-timed away from its parent lands in
 * its own slot instead, where it keeps a caption naming the order it belongs
 * to — being in the right slot matters more than being under the right row.
 *
 * Shared by the till's board and the phone list so the two never disagree
 * about which order is whose.
 */

import type { Order } from "@/lib/database.types";

/** An order as a list shows it: on its own, or tucked under the one it adds to */
export interface FamilyRow {
  order: Order;
  isFollowUp: boolean;
  /** The parent's nightly number, for the caption on a stray follow-up */
  parentNumber: number | null;
}

export function arrangeFamilies(
  items: Order[],
  /** Every order in view, so a parent outside this group can still be named */
  numberById: Map<string, number | null>,
): FamilyRow[] {
  const present = new Set(items.map((o) => o.id));
  const childrenOf = new Map<string, Order[]>();
  for (const o of items) {
    const parentId = o.parent_order_id;
    if (parentId === null || !present.has(parentId)) continue;
    const list = childrenOf.get(parentId);
    if (list) list.push(o);
    else childrenOf.set(parentId, [o]);
  }

  const rows: FamilyRow[] = [];
  for (const o of items) {
    if (o.parent_order_id !== null && present.has(o.parent_order_id)) continue;
    rows.push({
      order: o,
      isFollowUp: o.parent_order_id !== null,
      parentNumber:
        o.parent_order_id === null
          ? null
          : (numberById.get(o.parent_order_id) ?? null),
    });
    for (const child of childrenOf.get(o.id) ?? []) {
      rows.push({
        order: child,
        isFollowUp: true,
        parentNumber: o.delivery_number,
      });
    }
  }
  return rows;
}
