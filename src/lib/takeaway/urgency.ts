import type { Order } from "@/lib/database.types";

/** How close to the promised time an order starts asking for attention */
export const SOON_MINUTES = 15;

export type Urgency = "late" | "soon" | "none";

/**
 * Where an open take-away stands against the time the customer was promised.
 * One rule for the board's marks and the nav badge, so they never disagree.
 */
export function urgencyOf(
  order: Pick<Order, "status" | "pickup_at">,
  now: Date,
): Urgency {
  if (order.status !== "open" || order.pickup_at === null) return "none";
  const due = new Date(order.pickup_at).getTime();
  if (Number.isNaN(due)) return "none";
  if (due < now.getTime()) return "late";
  if (due - now.getTime() <= SOON_MINUTES * 60_000) return "soon";
  return "none";
}
