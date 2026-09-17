/**
 * Take-away writes that the shared `lib/api.ts` does not cover.
 *
 * Kept out of that file on purpose: it is the busiest module in the codebase
 * and the one most likely to be mid-edit elsewhere. Everything here is additive
 * and take-away specific, so it has no reason to live in the common surface.
 */

import { createDeliveryOrder } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";

/** Set (or clear) the time the customer said they would arrive */
export async function setPickupTime(
  orderId: string,
  pickupAt: string | null,
): Promise<void> {
  const { error } = await getSupabase()
    .from("orders")
    .update({ pickup_at: pickupAt })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
}

/**
 * Start a take-away with its pickup time already on it.
 *
 * Two round trips rather than one: the nightly number, the name label and the
 * order row are all assigned by `createDeliveryOrder`, and reimplementing that
 * here to save a request would mean two places that decide what tonight's
 * number is. The time is written straight after, and a failure to write it
 * leaves a perfectly usable order with a blank time rather than no order.
 */
export async function createTakeawayOrder(
  name: string,
  pickupAt: string | null,
  openedBy: string | null,
): Promise<{ orderId: string; deliveryNumber: number }> {
  const created = await createDeliveryOrder(name, openedBy);
  if (pickupAt) await setPickupTime(created.orderId, pickupAt);
  return created;
}
