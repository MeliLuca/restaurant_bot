import { TAX_RATE } from "@/lib/constants";
import { calcTotals } from "@/lib/money";
import { getSupabase } from "@/lib/supabase/client";
import type {
  Category,
  MenuItem,
  Order,
  OrderItem,
  Reservation,
  ReservationStatus,
  RestaurantTable,
  TableStatus,
} from "@/lib/database.types";

export async function fetchTables(): Promise<RestaurantTable[]> {
  const { data, error } = await getSupabase()
    .from("tables")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function updateTableStatus(
  tableId: string,
  status: TableStatus,
): Promise<void> {
  const { error } = await getSupabase()
    .from("tables")
    .update({ status })
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

export async function fetchTodayReservations(): Promise<Reservation[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await getSupabase()
    .from("reservations")
    .select("*")
    .gte("reserved_at", start.toISOString())
    .lt("reserved_at", end.toISOString())
    .order("reserved_at");
  if (error) throw new Error(error.message);
  return data;
}

export interface NewReservation {
  tableId: string;
  customerName: string;
  partySize: number;
  reservedAt: Date;
  notes?: string;
}

export async function createReservation(r: NewReservation): Promise<void> {
  const { error } = await getSupabase().from("reservations").insert({
    table_id: r.tableId,
    customer_name: r.customerName,
    party_size: r.partySize,
    reserved_at: r.reservedAt.toISOString(),
    notes: r.notes || null,
  });
  if (error) throw new Error(error.message);
}

export async function setReservationStatus(
  reservationId: string,
  status: ReservationStatus,
): Promise<void> {
  const { error } = await getSupabase()
    .from("reservations")
    .update({ status })
    .eq("id", reservationId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// POS / menu
// ---------------------------------------------------------------------------

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await getSupabase()
    .from("categories")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .select("*")
    .eq("is_available", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data;
}

export type OrderItemWithName = OrderItem & {
  menu_items: { name: string } | null;
};

export interface OpenOrder {
  order: Order;
  items: OrderItemWithName[];
}

async function fetchOrderItems(orderId: string): Promise<OrderItemWithName[]> {
  const { data, error } = await getSupabase()
    .from("order_items")
    .select("*, menu_items(name)")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data as OrderItemWithName[];
}

/** The single open order for a table (enforced by a DB unique index), if any */
export async function fetchOpenOrder(tableId: string): Promise<OpenOrder | null> {
  const { data: order, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("table_id", tableId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;
  return { order, items: await fetchOrderItems(order.id) };
}

/** An order by id, but only while it's still open (closed orders return null
 * so a stale refetch after checkout can't resurrect them in the ticket) */
export async function fetchOpenOrderById(orderId: string): Promise<OpenOrder | null> {
  const { data: order, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;
  return { order, items: await fetchOrderItems(order.id) };
}

/** All open take-away orders, newest first (searched client-side by name) */
export async function fetchOpenTakeaways(): Promise<Order[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("status", "open")
    .eq("order_type", "takeaway")
    .order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function recomputeOrderTotals(orderId: string): Promise<void> {
  const sb = getSupabase();
  const { data: items, error } = await sb
    .from("order_items")
    .select("quantity, unit_price")
    .eq("order_id", orderId);
  if (error) throw new Error(error.message);

  const { subtotal, tax, total } = calcTotals(
    items.map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity })),
  );
  const { error: updateError } = await sb
    .from("orders")
    .update({ subtotal, tax, total })
    .eq("id", orderId);
  if (updateError) throw new Error(updateError.message);
}

export interface TicketLineInput {
  menuItemId: string;
  unitPrice: number;
  quantity: number;
}

/**
 * Persist pending ticket lines: appends to the table's open order (creating
 * one if needed), recomputes stored totals, and marks the table occupied.
 * Returns the order id.
 */
export async function sendToKitchen(
  tableId: string,
  lines: TicketLineInput[],
): Promise<string> {
  if (lines.length === 0) throw new Error("Ticket is empty");
  const sb = getSupabase();

  const existing = await fetchOpenOrder(tableId);
  let orderId = existing?.order.id;
  if (!orderId) {
    const { data, error } = await sb
      .from("orders")
      .insert({ table_id: tableId, tax_rate: TAX_RATE })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    orderId = data.id;
  }

  const { error: itemsError } = await sb.from("order_items").insert(
    lines.map((l) => ({
      order_id: orderId!,
      menu_item_id: l.menuItemId,
      quantity: l.quantity,
      unit_price: l.unitPrice,
    })),
  );
  if (itemsError) throw new Error(itemsError.message);

  await recomputeOrderTotals(orderId);
  await updateTableStatus(tableId, "occupied");
  return orderId;
}

/**
 * Persist pending lines on a take-away order: appends to the given open order,
 * or creates one for the customer. Returns the order id.
 */
export async function sendTakeawayToKitchen(
  orderId: string | null,
  customerName: string,
  lines: TicketLineInput[],
): Promise<string> {
  if (lines.length === 0) throw new Error("Ticket is empty");
  const sb = getSupabase();

  let id = orderId;
  if (!id) {
    const { data, error } = await sb
      .from("orders")
      .insert({
        order_type: "takeaway",
        customer_name: customerName.trim(),
        tax_rate: TAX_RATE,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
  }

  const { error: itemsError } = await sb.from("order_items").insert(
    lines.map((l) => ({
      order_id: id!,
      menu_item_id: l.menuItemId,
      quantity: l.quantity,
      unit_price: l.unitPrice,
    })),
  );
  if (itemsError) throw new Error(itemsError.message);

  await recomputeOrderTotals(id);
  return id;
}

/** Close the order as paid; dine-in additionally flags the table for cleaning */
export async function checkoutOrder(
  orderId: string,
  tableId: string | null,
): Promise<void> {
  const { error } = await getSupabase()
    .from("orders")
    .update({ status: "paid", closed_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
  if (tableId) await updateTableStatus(tableId, "dirty");
}
