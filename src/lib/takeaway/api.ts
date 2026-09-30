/**
 * Take-away writes that the shared `lib/api.ts` does not cover.
 *
 * Kept out of that file on purpose: it is the busiest module in the codebase
 * and the one most likely to be mid-edit elsewhere. Everything here is additive
 * and take-away specific, so it has no reason to live in the common surface.
 */

import { TAX_RATE } from "@/lib/constants";
import { createDeliveryOrder, nextDeliveryNumber } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import {
  fetchRestaurantSettings,
  updateRestaurantSettings,
} from "@/lib/settings-api";
import type { LoadRow } from "@/lib/takeaway/load";
import type { SlotConfig } from "@/lib/takeaway/slots";
import type { Order, TakeawayCategoryLimit } from "@/lib/database.types";

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
  let created;
  try {
    created = await createDeliveryOrder(name, openedBy);
  } catch (e) {
    // The unique index is the last line of the name rule; the screens check
    // first and offer the follow-up. Reaching it means two tills raced, so the
    // message has to say what happened rather than leak an index name.
    const message = e instanceof Error ? e.message : String(e);
    throw message.includes("uniq_open_root_takeaway_name")
      ? new Error(DUPLICATE_NAME)
      : (e as Error);
  }
  if (pickupAt) await setPickupTime(created.orderId, pickupAt);
  return created;
}

/** Recognisable by the screens so they can show their own wording */
export const DUPLICATE_NAME = "takeaway/duplicate-name";

/** What the take-away board is filtered to */
export type TakeawayStatusFilter = "open" | "closed" | "all";

/**
 * Take-away orders for the board.
 *
 * Open orders are returned however old they are — an order nobody closed is
 * exactly the one the counter needs to see. Closed ones are bounded to today,
 * because the board answers "what is happening tonight"; the full history
 * already has a home in Statistiche.
 */
export async function fetchTakeawayOrders(
  status: TakeawayStatusFilter = "open",
): Promise<Order[]> {
  const sb = getSupabase();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  let query = sb.from("orders").select("*").eq("order_type", "takeaway");
  if (status === "open") {
    query = query.eq("status", "open");
  } else if (status === "closed") {
    query = query.neq("status", "open").gte("opened_at", dayStart.toISOString());
  } else {
    query = query.or(
      `status.eq.open,opened_at.gte.${dayStart.toISOString()}`,
    );
  }

  const { data, error } = await query
    .order("pickup_at", { ascending: true, nullsFirst: false })
    .order("delivery_number", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

/** Just enough of the open take-aways for the nav badge: how many, how late */
export async function fetchOpenTakeawayDue(): Promise<
  Pick<Order, "id" | "status" | "pickup_at">[]
> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("id, status, pickup_at")
    .eq("order_type", "takeaway")
    .eq("status", "open");
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// Capacity settings
// ---------------------------------------------------------------------------

/** The slot grid as the restaurant configured it, falling back to the default */
export async function fetchSlotConfig(): Promise<SlotConfig> {
  const settings = await fetchRestaurantSettings();
  return {
    slotMinutes: settings.takeaway_slot_minutes,
    serviceStart: settings.takeaway_service_start,
    serviceEnd: settings.takeaway_service_end,
  };
}

export async function updateSlotConfig(config: SlotConfig): Promise<void> {
  await updateRestaurantSettings({
    takeaway_slot_minutes: config.slotMinutes,
    takeaway_service_start: config.serviceStart,
    takeaway_service_end: config.serviceEnd,
  });
}

export async function fetchCategoryLimits(): Promise<TakeawayCategoryLimit[]> {
  const { data, error } = await getSupabase()
    .from("takeaway_category_limits")
    .select("*");
  if (error) throw new Error(error.message);
  return data;
}

/** Create or replace a category's rule — the category is the primary key */
export async function saveCategoryLimit(
  limit: Omit<TakeawayCategoryLimit, "updated_at">,
): Promise<void> {
  const { error } = await getSupabase()
    .from("takeaway_category_limits")
    .upsert(
      { ...limit, updated_at: new Date().toISOString() },
      { onConflict: "category_id" },
    );
  if (error) throw new Error(error.message);
}

/** Drop the rule entirely — "no limit", as distinct from a rule switched off */
export async function deleteCategoryLimit(categoryId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("takeaway_category_limits")
    .delete()
    .eq("category_id", categoryId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * menu item → category, for costing an unsent ticket against the limits.
 *
 * Memoised for the session: the till already refetches the load on every send,
 * and re-reading a few thousand menu rows each time would be the most
 * expensive part of a warning nobody is waiting for. A dish moved between
 * categories mid-service is picked up on the next reload — the cost of being
 * wrong for an hour is one warning counted against the old category.
 */
let menuItemCategories: Promise<Map<string, string>> | null = null;

export function forgetMenuItemCategories(): void {
  menuItemCategories = null;
}

export function fetchMenuItemCategories(): Promise<Map<string, string>> {
  if (menuItemCategories === null) {
    menuItemCategories = (async () => {
      const { data, error } = await getSupabase()
        .from("menu_items")
        .select("id, category_id");
      if (error) throw new Error(error.message);
      return new Map(data.map((r) => [r.id, r.category_id]));
    })().catch((e) => {
      // A failed fetch must not be cached as the answer forever.
      menuItemCategories = null;
      throw e;
    });
  }
  return menuItemCategories;
}

/**
 * Every piece already promised for a time, flattened for the load calculator.
 *
 * Only open orders carrying a pickup time count: a closed order has left the
 * kitchen, and an order with no promised time was never a claim on a slot.
 */
export async function fetchLoadRows(): Promise<LoadRow[]> {
  const sb = getSupabase();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const { data: orders, error: ordersError } = await sb
    .from("orders")
    .select("id, pickup_at")
    .eq("order_type", "takeaway")
    .eq("status", "open")
    .not("pickup_at", "is", null)
    .gte("pickup_at", dayStart.toISOString());
  if (ordersError) throw new Error(ordersError.message);
  if (orders.length === 0) return [];

  const pickupById = new Map(
    orders.map((o) => [o.id, new Date(o.pickup_at as string).getTime()]),
  );

  const { data: items, error: itemsError } = await sb
    .from("order_items")
    .select("order_id, quantity, menu_items!inner(category_id)")
    .in(
      "order_id",
      orders.map((o) => o.id),
    );
  if (itemsError) throw new Error(itemsError.message);

  return items.flatMap((row) => {
    const pickupAtMs = pickupById.get(row.order_id);
    const categoryId = (row.menu_items as { category_id: string } | null)
      ?.category_id;
    if (pickupAtMs === undefined || !categoryId) return [];
    return [
      {
        orderId: row.order_id,
        pickupAtMs,
        categoryId,
        quantity: row.quantity,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Names and follow-up orders
// ---------------------------------------------------------------------------

/** Compare names the way the counter does: trimmed, case- and space-insensitive */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The open take-away already using this name, if any.
 *
 * Only root orders can collide — a follow-up shares its parent's name by
 * design, and the answer a caller wants is "whose order is this", which is
 * always the root.
 */
export function findOpenTakeawayByName(
  name: string,
  openOrders: Order[],
): Order | null {
  const target = normaliseName(name);
  if (target === "") return null;
  return (
    openOrders.find(
      (o) =>
        o.parent_order_id === null &&
        o.status === "open" &&
        normaliseName(o.customer_name ?? "") === target,
    ) ?? null
  );
}

/**
 * "Rossi" → "Rossi 2" — the way out for two genuinely different customers.
 *
 * Counts up rather than reusing a freed number so the suggestion can never
 * land on a name still open at the counter.
 */
export function suggestDistinctName(name: string, openOrders: Order[]): string {
  const base = name.trim();
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} ${n}`;
    if (findOpenTakeawayByName(candidate, openOrders) === null) return candidate;
  }
  return base;
}

/**
 * A second order for a customer who already has one open.
 *
 * Its own order, its own nightly number, its own ticket to the kitchen — what
 * it shares with the parent is the name it will be called out by and the time
 * it has to be ready. Inheriting the pickup time is the point: the two bags
 * leave together, and a follow-up silently defaulting to "no time" would put
 * half the order outside every capacity count.
 */
export async function createFollowUpOrder(
  parent: Order,
  openedBy: string | null,
): Promise<{ orderId: string; deliveryNumber: number }> {
  const sb = getSupabase();
  const deliveryNumber = await nextDeliveryNumber();
  const { data, error } = await sb
    .from("orders")
    .insert({
      order_type: "takeaway",
      customer_name: parent.customer_name,
      // Chains stay one level deep: a follow-up's follow-up belongs to the
      // same customer, not to a sub-order nobody would think to look under.
      parent_order_id: parent.parent_order_id ?? parent.id,
      pickup_at: parent.pickup_at,
      delivery_number: deliveryNumber,
      tax_rate: TAX_RATE,
      opened_by: openedBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { orderId: data.id, deliveryNumber };
}

/** The order a follow-up belongs to, for captions that name it */
export async function fetchParentOrder(
  parentOrderId: string,
): Promise<Order | null> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("id", parentOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
