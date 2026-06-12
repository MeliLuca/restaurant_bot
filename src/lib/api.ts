import { TAX_RATE } from "@/lib/constants";
import {
  calcTotals,
  splitCents,
  toCents,
  unitPriceWithModifiers,
} from "@/lib/money";
import { getSupabase } from "@/lib/supabase/client";
import type {
  Category,
  MenuItem,
  Modifier,
  ModifierGroup,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderPayment,
  PaymentKind,
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
    .map(({ id, category_id, name, price, is_available, sort_order, target_printer_id }) => ({
      id,
      category_id,
      name,
      price,
      is_available,
      sort_order,
      target_printer_id,
    }));
}

export type ModifierGroupWithModifiers = ModifierGroup & {
  modifiers: Modifier[];
};

/**
 * Modifier groups (with their modifiers) offered by each menu item, keyed by
 * menu_item_id. Items absent from the map add to the ticket directly; items
 * present open the modifier picker first.
 */
export async function fetchMenuModifierGroups(): Promise<
  Record<string, ModifierGroupWithModifiers[]>
> {
  const { data, error } = await getSupabase()
    .from("menu_item_modifier_groups")
    .select("menu_item_id, modifier_groups(*, modifiers(*))");
  if (error) throw new Error(error.message);

  const rows = data as unknown as Array<{
    menu_item_id: string;
    modifier_groups: ModifierGroupWithModifiers | null;
  }>;
  const byItem: Record<string, ModifierGroupWithModifiers[]> = {};
  for (const row of rows) {
    if (!row.modifier_groups) continue;
    const group = {
      ...row.modifier_groups,
      modifiers: [...row.modifier_groups.modifiers].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
      ),
    };
    (byItem[row.menu_item_id] ??= []).push(group);
  }
  for (const groups of Object.values(byItem)) {
    groups.sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
  }
  return byItem;
}

export type OrderItemWithName = OrderItem & {
  menu_items: { name: string } | null;
  order_item_modifiers: OrderItemModifier[];
};

export interface OpenOrder {
  order: Order;
  items: OrderItemWithName[];
  /** Partial payments already taken on this order (split bill) */
  payments: OrderPayment[];
}

async function fetchOrderItems(orderId: string): Promise<OrderItemWithName[]> {
  const { data, error } = await getSupabase()
    .from("order_items")
    .select("*, menu_items(name), order_item_modifiers(*)")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data as OrderItemWithName[];
}

export async function fetchOrderPayments(
  orderId: string,
): Promise<OrderPayment[]> {
  const { data, error } = await getSupabase()
    .from("order_payments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

/** Cents still owed on an order after its partial payments */
export function remainingBalanceCents(
  order: Order,
  payments: OrderPayment[],
): number {
  return (
    toCents(order.total) -
    payments.reduce((sum, p) => sum + toCents(p.amount), 0)
  );
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
  return {
    order,
    items: await fetchOrderItems(order.id),
    payments: await fetchOrderPayments(order.id),
  };
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
    .select("*, order_items(*, menu_items(name), order_item_modifiers(*))")
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
  return {
    order,
    items: await fetchOrderItems(order.id),
    payments: await fetchOrderPayments(order.id),
  };
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
  /** BASE menu price; modifier adjustments are added on insert */
  unitPrice: number;
  quantity: number;
  notes?: string | null;
  /** Modifiers picked for this line (pizzeria variations) */
  modifiers?: Array<{
    modifierId: string;
    name: string;
    priceAdjustment: number;
  }>;
}

/** A persisted round: the order plus the ids of the lines just inserted
 * (the print API receives exactly these so reorders don't reprint). */
export interface SentRound {
  orderId: string;
  newItemIds: string[];
}

async function insertOrderItems(
  orderId: string,
  lines: TicketLineInput[],
): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("order_items")
    .insert(
      lines.map((l) => ({
        order_id: orderId,
        menu_item_id: l.menuItemId,
        quantity: l.quantity,
        // snapshot the price actually charged per unit, modifiers included
        unit_price: unitPriceWithModifiers(l.unitPrice, l.modifiers ?? []),
        notes: l.notes ?? null,
      })),
    )
    .select("id");
  if (error) throw new Error(error.message);
  const itemIds = data.map((d) => d.id);

  // Per-line modifier detail (name + adjustment frozen at order time) for the
  // ticket UI and the print engine; rows return in insert order, so ids align.
  const modifierRows = lines.flatMap((l, idx) =>
    (l.modifiers ?? []).map((m) => ({
      order_item_id: itemIds[idx],
      modifier_id: m.modifierId,
      name: m.name,
      price_adjustment: m.priceAdjustment,
    })),
  );
  if (modifierRows.length > 0) {
    const { error: modError } = await sb
      .from("order_item_modifiers")
      .insert(modifierRows);
    if (modError) throw new Error(modError.message);
  }
  return itemIds;
}

/**
 * Persist pending ticket lines: appends to the (table, split)'s open order
 * (creating one if needed, stamped with the ordering user), recomputes stored
 * totals, and marks the table occupied.
 */
export async function sendToKitchen(
  tableId: string,
  lines: TicketLineInput[],
  subtable: string | null,
  openedBy: string | null,
): Promise<SentRound> {
  if (lines.length === 0) throw new Error("Ticket is empty");
  const sb = getSupabase();

  const existing = await fetchOpenOrder(tableId, subtable);
  let orderId = existing?.order.id;
  if (!orderId) {
    const { data, error } = await sb
      .from("orders")
      .insert({ table_id: tableId, subtable, tax_rate: TAX_RATE, opened_by: openedBy })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    orderId = data.id;
  }

  const newItemIds = await insertOrderItems(orderId, lines);
  await recomputeOrderTotals(orderId);
  await updateTableStatus(tableId, "occupied");
  return { orderId, newItemIds };
}

/**
 * Persist pending lines on a take-away order: appends to the given open order,
 * or creates one for the customer.
 */
export async function sendTakeawayToKitchen(
  orderId: string | null,
  customerName: string,
  lines: TicketLineInput[],
  openedBy: string | null,
): Promise<SentRound> {
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
        opened_by: openedBy,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
  }

  const newItemIds = await insertOrderItems(id, lines);
  await recomputeOrderTotals(id);
  return { orderId: id, newItemIds };
}

// ---------------------------------------------------------------------------
// Printing (LAN thermal printers, dispatched server-side via /api/print/*)
// ---------------------------------------------------------------------------

export interface PrintJobResult {
  printerName: string;
  ok: boolean;
  error?: string;
}

async function postPrint(
  path: string,
  body: Record<string, unknown>,
): Promise<PrintJobResult[]> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? "Print service unavailable");
  }
  return data.jobs;
}

/** Fire CUCINA/BAR slips for the given lines (a just-sent round). */
export function printProductionSlips(
  orderId: string,
  orderItemIds: string[],
): Promise<PrintJobResult[]> {
  return postPrint("/api/print/order", { orderId, orderItemIds });
}

/** Fire the full CASSA receipt for an order (checkout or reprint). */
export function printReceipt(orderId: string): Promise<PrintJobResult[]> {
  return postPrint("/api/print/receipt", { orderId });
}

/** Fire the courtesy bill: same itemized receipt under a PRE-CONTO / NON
 * FISCALE banner. Pure print — no payment, no order/table state change. */
export function printPreReceipt(orderId: string): Promise<PrintJobResult[]> {
  return postPrint("/api/print/receipt", { orderId, preconto: true });
}

/** Fire a partial receipt holding ONLY the given (just paid) lines; `total`
 * is the amount actually charged for them. */
export function printPartialReceipt(
  orderId: string,
  orderItemIds: string[],
  total: number,
): Promise<PrintJobResult[]> {
  return postPrint("/api/print/partial", { orderId, orderItemIds, total });
}

/** Fire a sample ticket at one printer (admin panel "Test print"). */
export function printTest(printerId: string): Promise<PrintJobResult[]> {
  return postPrint("/api/print/test", { printerId });
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

/**
 * Override the price of an item already on the bill. Touches only this
 * order's order_items.unit_price snapshot — the global menu price is never
 * affected. Paid lines are immutable.
 */
export async function setSentItemPrice(
  orderId: string,
  orderItemId: string,
  unitPrice: number,
): Promise<void> {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error("Price must be zero or more");
  }
  const { error } = await getSupabase()
    .from("order_items")
    .update({ unit_price: unitPrice })
    .eq("id", orderItemId)
    .eq("order_id", orderId)
    .is("paid_by_payment_id", null);
  if (error) throw new Error(error.message);
  await recomputeOrderTotals(orderId);
}

// ---------------------------------------------------------------------------
// Split bill (partial payments)
// ---------------------------------------------------------------------------

export interface PaymentResult {
  /** Euro amount just charged */
  paidAmount: number;
  /** Cents still owed after this payment */
  remainingCents: number;
  /** True when this payment settled the order (now closed as paid) */
  orderClosed: boolean;
  /** True when closing also flagged the table for cleaning (last open split) */
  tableFlagged: boolean;
}

/**
 * Record one partial payment, optionally marking the lines it covers as
 * paid, and close the order automatically once the balance reaches zero.
 */
async function recordPayment(
  order: Order,
  kind: PaymentKind,
  amountCents: number,
  paidItemIds: string[],
  userId: string | null,
): Promise<PaymentResult> {
  const sb = getSupabase();
  const { data: payment, error } = await sb
    .from("order_payments")
    .insert({
      order_id: order.id,
      kind,
      amount: amountCents / 100,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (paidItemIds.length > 0) {
    const { error: markError } = await sb
      .from("order_items")
      .update({ paid_by_payment_id: payment.id })
      .in("id", paidItemIds)
      .eq("order_id", order.id)
      .is("paid_by_payment_id", null);
    if (markError) throw new Error(markError.message);
  }

  // Re-read payments so concurrent splits from another till still converge
  const payments = await fetchOrderPayments(order.id);
  const remainingCents = remainingBalanceCents(order, payments);

  let orderClosed = false;
  let tableFlagged = false;
  if (remainingCents <= 0) {
    orderClosed = true;
    tableFlagged = await checkoutOrder(order.id, order.table_id);
  }
  return { paidAmount: amountCents / 100, remainingCents, orderClosed, tableFlagged };
}

async function requireOpenOrder(orderId: string): Promise<OpenOrder> {
  const open = await fetchOpenOrderById(orderId);
  if (!open) throw new Error("Order is already closed");
  return open;
}

/**
 * "Alla romana" even split: charge one share of the remaining balance
 * divided by the people still to pay. Each share is the cent-rounded
 * remaining/sharesLeft, and the last share is exactly the remainder, so the
 * sequence always lands on zero with no rounding drift.
 */
export async function payEvenShare(
  orderId: string,
  sharesLeft: number,
  userId: string | null,
): Promise<PaymentResult> {
  const open = await requireOpenOrder(orderId);
  const remainingCents = remainingBalanceCents(open.order, open.payments);
  if (remainingCents <= 0) throw new Error("Nothing left to pay");

  const n = Math.max(1, Math.floor(sharesLeft));
  const shareCents =
    n === 1 ? remainingCents : Math.min(splitCents(remainingCents, n)[0], remainingCents);
  return recordPayment(open.order, "even", shareCents, [], userId);
}

export type ItemsPaymentResult = PaymentResult & { paidItemIds: string[] };

/**
 * Split by item: charge the selected unpaid lines (subtotal + their share of
 * tax at the order's snapshotted rate) and mark them paid. When the selection
 * clears the last unpaid lines, the charge is exactly the remaining balance,
 * absorbing any per-payment tax-rounding drift.
 */
export async function payForItems(
  orderId: string,
  orderItemIds: string[],
  userId: string | null,
): Promise<ItemsPaymentResult> {
  const open = await requireOpenOrder(orderId);
  const unpaid = open.items.filter((i) => i.paid_by_payment_id === null);
  const selected = unpaid.filter((i) => orderItemIds.includes(i.id));
  if (selected.length === 0) throw new Error("No unpaid items selected");

  const remainingCents = remainingBalanceCents(open.order, open.payments);
  if (remainingCents <= 0) throw new Error("Nothing left to pay");

  let amountCents = toCents(
    calcTotals(
      selected.map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity })),
      open.order.tax_rate,
    ).total,
  );
  if (selected.length === unpaid.length) amountCents = remainingCents;
  amountCents = Math.min(amountCents, remainingCents);

  const paidItemIds = selected.map((i) => i.id);
  const result = await recordPayment(
    open.order,
    "items",
    amountCents,
    paidItemIds,
    userId,
  );
  return { ...result, paidItemIds };
}

/**
 * Split one shared line into `parts` standalone 1/parts fractions (quantity 1
 * each) that the split-by-item flow can pay individually. The line total is
 * distributed in integer cents (splitCents), so the fractions sum back to the
 * original amount exactly.
 */
export async function splitItemIntoFractions(
  orderId: string,
  orderItemId: string,
  parts: number,
): Promise<void> {
  if (!Number.isInteger(parts) || parts < 2) {
    throw new Error("Split into at least 2 parts");
  }
  const sb = getSupabase();
  const { data: item, error } = await sb
    .from("order_items")
    .select("*")
    .eq("id", orderItemId)
    .eq("order_id", orderId)
    .single();
  if (error) throw new Error(error.message);
  if (item.paid_by_payment_id) throw new Error("Item is already paid");

  const lineTotalCents = toCents(item.unit_price) * item.quantity;
  const shares = splitCents(lineTotalCents, parts);

  const { error: insertError } = await sb.from("order_items").insert(
    shares.map((cents) => ({
      order_id: orderId,
      menu_item_id: item.menu_item_id,
      quantity: 1,
      unit_price: cents / 100,
      notes: item.notes,
      fraction_of: parts,
    })),
  );
  if (insertError) throw new Error(insertError.message);

  const { error: deleteError } = await sb
    .from("order_items")
    .delete()
    .eq("id", orderItemId);
  if (deleteError) throw new Error(deleteError.message);

  // No-op by construction, but keeps stored totals authoritative.
  await recomputeOrderTotals(orderId);
}
