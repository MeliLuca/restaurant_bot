// Server-side assembly of everything the routing/rendering pipeline needs
// for one order. Used by the /api/print/* route handlers.

import { getSupabase } from "@/lib/supabase/client";
import type { Order, Printer, RestaurantSettings } from "@/lib/database.types";
import type { TicketMeta } from "./types";
import type { RoutableItem } from "./route-order";

export interface OrderPrintContext {
  order: Order;
  items: RoutableItem[];
  printers: Printer[];
  settings: RestaurantSettings;
  meta: TicketMeta;
}

type OrderRow = Order & {
  tables: { name: string } | null;
  app_users: { name: string } | null;
};

type ItemRow = {
  quantity: number;
  unit_price: number;
  notes: string | null;
  fraction_of: number | null;
  menu_items: { name: string; target_printer_id: string | null } | null;
};

/**
 * Load the print context for an order. When orderItemIds is given, only those
 * lines are included (production slips for the round just fired); omitted,
 * the whole order is included (receipts, reprints).
 */
export async function loadOrderPrintContext(
  orderId: string,
  orderItemIds?: string[],
): Promise<OrderPrintContext | null> {
  const sb = getSupabase();

  const { data: order, error: orderError } = await sb
    .from("orders")
    .select("*, tables(name), app_users(name)")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  if (orderError) throw new Error(orderError.message);
  if (!order) return null;

  let itemQuery = sb
    .from("order_items")
    .select(
      "quantity, unit_price, notes, fraction_of, menu_items(name, target_printer_id)",
    )
    .eq("order_id", orderId)
    .order("created_at");
  if (orderItemIds && orderItemIds.length > 0) {
    itemQuery = itemQuery.in("id", orderItemIds);
  }
  const { data: itemRows, error: itemsError } =
    await itemQuery.returns<ItemRow[]>();
  if (itemsError) throw new Error(itemsError.message);

  const [{ data: printers, error: printersError }, settingsResult] =
    await Promise.all([
      sb.from("printers").select("*"),
      sb.from("restaurant_settings").select("*").single(),
    ]);
  if (printersError) throw new Error(printersError.message);
  if (settingsResult.error) throw new Error(settingsResult.error.message);

  const { tables, app_users, ...orderFields } = order;
  return {
    order: orderFields,
    items: itemRows.map((i) => ({
      quantity: i.quantity,
      unit_price: i.unit_price,
      notes: i.notes,
      // fractional shares of a split item print as "Tiramisù (1/3)"
      name:
        (i.menu_items?.name ?? "Item") +
        (i.fraction_of ? ` (1/${i.fraction_of})` : ""),
      target_printer_id: i.menu_items?.target_printer_id ?? null,
    })),
    printers,
    settings: settingsResult.data,
    meta: {
      ticketNumber: order.ticket_number,
      tableName: tables?.name ?? null,
      subtable: order.subtable,
      customerName: order.customer_name,
      serverName: app_users?.name ?? null,
      openedAt: new Date().toISOString(), // slips/receipts show firing time
    },
  };
}
