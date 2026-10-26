// Open orders as the kitchen display sees them: production items only, with
// display-ready names and variation rows. Shared by the /kitchen hook and
// server code (the AI prototype's late-order watch), so it has no React.

import { getSupabase } from "@/lib/supabase/client";
import { parseModifiers } from "@/lib/printing/route-order";
import type { OrderType, PrinterType } from "@/lib/database.types";

/** Which display column an item belongs to. Mirrors route-order: a CASSA
 * target still produces a production slip rendered in the CUCINA style, so it
 * shows under the kitchen station; items with no target print nowhere and are
 * receipt-only, so the display hides them. */
export type Station = "CUCINA" | "BAR";

export interface KitchenItem {
  id: string;
  quantity: number;
  /** Dish name (or a "Fuori menù" line's own name) with the "(1/3)" fraction suffix for split items */
  name: string;
  /** Display-ready variation rows: "+ Bufala", "- Acciughe", free-text notes */
  modifiers: string[];
  station: Station;
  readyAt: string | null;
  createdAt: string;
}

export interface KitchenOrder {
  id: string;
  ticketNumber: number;
  orderType: OrderType;
  tableName: string | null;
  subtable: string | null;
  customerName: string | null;
  deliveryNumber: number | null;
  openedAt: string;
  items: KitchenItem[];
}

type OrderRow = {
  id: string;
  ticket_number: number;
  order_type: OrderType;
  subtable: string | null;
  customer_name: string | null;
  delivery_number: number | null;
  opened_at: string;
  tables: { name: string } | null;
  order_items: {
    id: string;
    quantity: number;
    notes: string | null;
    fraction_of: number | null;
    ready_at: string | null;
    created_at: string;
    custom_name: string | null;
    menu_items: { name: string; target_printer_id: string | null } | null;
    order_item_modifiers: {
      name: string;
      price_adjustment: number;
      is_removal: boolean;
    }[];
  }[];
};

/** Same signing convention as the production slips (route-order.ts): the
 * direction comes from is_removal, never from the amount. */
function modifierLabel(m: { name: string; is_removal: boolean }): string {
  return `${m.is_removal ? "-" : "+"} ${m.name}`;
}

/** Every open order with its production items, oldest first */
export async function fetchKitchenOrders(): Promise<KitchenOrder[]> {
  const sb = getSupabase();
  const [ordersResult, printersResult] = await Promise.all([
    sb
      .from("orders")
      .select(
        "id, ticket_number, order_type, subtable, customer_name, delivery_number, opened_at, tables(name), order_items(id, quantity, notes, fraction_of, ready_at, created_at, custom_name, menu_items(name, target_printer_id), order_item_modifiers(name, price_adjustment, is_removal))",
      )
      .eq("status", "open")
      .order("opened_at")
      .returns<OrderRow[]>(),
    sb.from("printers").select("id, printer_type"),
  ]);
  if (ordersResult.error) throw new Error(ordersResult.error.message);
  if (printersResult.error) throw new Error(printersResult.error.message);

  const stationByPrinter = new Map<string, PrinterType>(
    printersResult.data.map((p) => [p.id, p.printer_type]),
  );

  return ordersResult.data.map((o) => ({
    id: o.id,
    ticketNumber: o.ticket_number,
    orderType: o.order_type,
    tableName: o.tables?.name ?? null,
    subtable: o.subtable,
    customerName: o.customer_name,
    deliveryNumber: o.delivery_number,
    openedAt: o.opened_at,
    items: o.order_items
      .filter((i) => {
        // receipt-only items (no production target) never reach a station
        const target = i.menu_items?.target_printer_id;
        return !!target && stationByPrinter.has(target);
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((i) => ({
        id: i.id,
        quantity: i.quantity,
        name:
          (i.custom_name ?? i.menu_items?.name ?? "Item") +
          (i.fraction_of ? ` (1/${i.fraction_of})` : ""),
        modifiers: [
          ...i.order_item_modifiers.map(modifierLabel),
          ...parseModifiers(i.notes),
        ],
        station:
          stationByPrinter.get(i.menu_items!.target_printer_id!) === "BAR"
            ? "BAR"
            : "CUCINA",
        readyAt: i.ready_at,
        createdAt: i.created_at,
      })),
  }));
}
