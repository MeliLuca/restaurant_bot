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

/** Items orderable right now: available AND no out-of-stock ingredient (86'd) */
export async function fetchMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .select("*, ingredients(is_available)")
    .eq("is_available", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data as unknown as (MenuItem & { ingredients: { is_available: boolean }[] })[])
    .filter((item) => item.ingredients.every((i) => i.is_available))
    .map(({ id, category_id, name, price, is_available, sort_order }) => ({
      id,
      category_id,
      name,
      price,
      is_available,
      sort_order,
    }));
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

/**
 * The single open order for a (table, split) pair — enforced by a DB unique
 * index. `subtable: null` is the whole-table tab.
 */
export async function fetchOpenOrder(
  tableId: string,
  subtable: string | null,
): Promise<OpenOrder | null> {
  let query = getSupabase()
    .from("orders")
    .select("*")
    .eq("table_id", tableId)
    .eq("status", "open");
  query = subtable === null
    ? query.is("subtable", null)
    : query.eq("subtable", subtable);
  const { data: order, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;
  return { order, items: await fetchOrderItems(order.id) };
}

/** All open orders on a table (one per split), oldest first */
export async function fetchOpenOrdersForTable(tableId: string): Promise<Order[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("table_id", tableId)
    .eq("status", "open")
    .order("opened_at");
  if (error) throw new Error(error.message);
  return data;
}

/** Every open dine-in order across the floor (for split badges on table cards) */
export async function fetchOpenDineInOrders(): Promise<Order[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("status", "open")
    .eq("order_type", "dine_in")
    .order("opened_at");
  if (error) throw new Error(error.message);
  return data;
}

export type OrderWithItems = Order & { order_items: OrderItemWithName[] };

/** Open orders on a table including their items (table dialog detail view) */
export async function fetchOpenOrdersWithItems(
  tableId: string,
): Promise<OrderWithItems[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*, order_items(*, menu_items(name))")
    .eq("table_id", tableId)
    .eq("status", "open")
    .order("opened_at");
  if (error) throw new Error(error.message);
  return data as unknown as OrderWithItems[];
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
 * Persist pending ticket lines: appends to the (table, split)'s open order
 * (creating one if needed), recomputes stored totals, and marks the table
 * occupied. Returns the order id.
 */
export async function sendToKitchen(
  tableId: string,
  lines: TicketLineInput[],
  subtable: string | null,
): Promise<string> {
  if (lines.length === 0) throw new Error("Ticket is empty");
  const sb = getSupabase();

  const existing = await fetchOpenOrder(tableId, subtable);
  let orderId = existing?.order.id;
  if (!orderId) {
    const { data, error } = await sb
      .from("orders")
      .insert({ table_id: tableId, subtable, tax_rate: TAX_RATE })
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

/**
 * Close the order as paid. A dine-in table is flagged for cleaning only when
 * this was its last open split — other splits keep the table occupied.
 * Returns true if the table was flagged dirty.
 */
export async function checkoutOrder(
  orderId: string,
  tableId: string | null,
): Promise<boolean> {
  const { error } = await getSupabase()
    .from("orders")
    .update({ status: "paid", closed_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
  if (!tableId) return false;

  const remaining = await fetchOpenOrdersForTable(tableId);
  if (remaining.length > 0) return false;
  await updateTableStatus(tableId, "dirty");
  return true;
}

/**
 * Amend an item already sent to the kitchen: change its quantity (or remove
 * it with quantity <= 0) and recompute the order totals. An order left with
 * no items is cancelled.
 */
export async function setSentItemQuantity(
  orderId: string,
  orderItemId: string,
  quantity: number,
): Promise<void> {
  const sb = getSupabase();
  if (quantity <= 0) {
    const { error } = await sb
      .from("order_items")
      .delete()
      .eq("id", orderItemId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("order_items")
      .update({ quantity })
      .eq("id", orderItemId);
    if (error) throw new Error(error.message);
  }

  const { count, error: countError } = await sb
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  if (countError) throw new Error(countError.message);

  if (count === 0) {
    const { error } = await sb
      .from("orders")
      .update({ status: "cancelled", closed_at: new Date().toISOString() })
      .eq("id", orderId);
    if (error) throw new Error(error.message);
    return;
  }
  await recomputeOrderTotals(orderId);
}
