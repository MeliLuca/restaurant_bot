import { getSupabase } from "@/lib/supabase/client";
import type { Order, OrderItem } from "@/lib/database.types";

export type StatsOrderItem = OrderItem & {
  menu_items: { name: string; category_id: string } | null;
};

export type StatsOrder = Order & {
  order_items: StatsOrderItem[];
  tables: { name: string } | null;
};

// A service "night" runs 6 AM → 6 AM so bills rung up after midnight still
// count toward the same night.
export const SERVICE_DAY_START_HOUR = 6;

/** Start of the service day containing `now` */
export function currentServiceDayStart(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(SERVICE_DAY_START_HOUR, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  return start;
}

export function serviceDayEnd(dayStart: Date): Date {
  const end = new Date(dayStart);
  end.setDate(end.getDate() + 1);
  return end;
}

/** Every order opened during the service day, items included, newest first */
export async function fetchOrdersForServiceDay(
  dayStart: Date,
): Promise<StatsOrder[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*, order_items(*, menu_items(name, category_id)), tables(name)")
    .gte("opened_at", dayStart.toISOString())
    .lt("opened_at", serviceDayEnd(dayStart).toISOString())
    .order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as unknown as StatsOrder[];
}

// ---------------------------------------------------------------------------
// Aggregation (pure — math in integer cents, like lib/money.ts)
// ---------------------------------------------------------------------------

export interface NightSummary {
  paidTotal: number;
  paidSubtotal: number;
  paidTax: number;
  paidCount: number;
  avgBill: number;
  dineInPaidTotal: number;
  takeawayPaidTotal: number;
  openTotal: number;
  openCount: number;
  cancelledCount: number;
  itemsOrdered: number; // total quantity across paid + open orders
}

export function summarizeNight(orders: StatsOrder[]): NightSummary {
  let paidCents = 0;
  let paidSubtotalCents = 0;
  let paidTaxCents = 0;
  let paidCount = 0;
  let dineInPaidCents = 0;
  let takeawayPaidCents = 0;
  let openCents = 0;
  let openCount = 0;
  let cancelledCount = 0;
  let itemsOrdered = 0;

  for (const o of orders) {
    const totalCents = Math.round(o.total * 100);
    if (o.status === "paid") {
      paidCount += 1;
      paidCents += totalCents;
      paidSubtotalCents += Math.round(o.subtotal * 100);
      paidTaxCents += Math.round(o.tax * 100);
      if (o.order_type === "takeaway") takeawayPaidCents += totalCents;
      else dineInPaidCents += totalCents;
    } else if (o.status === "open") {
      openCount += 1;
      openCents += totalCents;
    } else {
      cancelledCount += 1;
    }
    if (o.status !== "cancelled") {
      itemsOrdered += o.order_items.reduce((sum, i) => sum + i.quantity, 0);
    }
  }

  return {
    paidTotal: paidCents / 100,
    paidSubtotal: paidSubtotalCents / 100,
    paidTax: paidTaxCents / 100,
    paidCount,
    avgBill: paidCount > 0 ? Math.round(paidCents / paidCount) / 100 : 0,
    dineInPaidTotal: dineInPaidCents / 100,
    takeawayPaidTotal: takeawayPaidCents / 100,
    openTotal: openCents / 100,
    openCount,
    cancelledCount,
    itemsOrdered,
  };
}

export interface ItemStat {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  quantity: number;
  revenue: number;
}

/** Items across paid + open orders, ranked by quantity then revenue */
export function rankItems(orders: StatsOrder[]): ItemStat[] {
  const byItem = new Map<
    string,
    { name: string; categoryId: string | null; quantity: number; cents: number }
  >();

  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const line of o.order_items) {
      const entry = byItem.get(line.menu_item_id) ?? {
        name: line.menu_items?.name ?? "Deleted item",
        categoryId: line.menu_items?.category_id ?? null,
        quantity: 0,
        cents: 0,
      };
      entry.quantity += line.quantity;
      entry.cents += Math.round(line.unit_price * 100) * line.quantity;
      byItem.set(line.menu_item_id, entry);
    }
  }

  return Array.from(byItem, ([menuItemId, e]) => ({
    menuItemId,
    name: e.name,
    categoryId: e.categoryId,
    quantity: e.quantity,
    revenue: e.cents / 100,
  })).sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);
}

export interface CategoryStat {
  categoryId: string | null;
  quantity: number;
  revenue: number;
}

/** Sales grouped by menu category, biggest revenue first */
export function rankCategories(items: ItemStat[]): CategoryStat[] {
  const byCategory = new Map<string | null, { quantity: number; cents: number }>();
  for (const item of items) {
    const entry = byCategory.get(item.categoryId) ?? { quantity: 0, cents: 0 };
    entry.quantity += item.quantity;
    entry.cents += Math.round(item.revenue * 100);
    byCategory.set(item.categoryId, entry);
  }
  return Array.from(byCategory, ([categoryId, e]) => ({
    categoryId,
    quantity: e.quantity,
    revenue: e.cents / 100,
  })).sort((a, b) => b.revenue - a.revenue);
}
