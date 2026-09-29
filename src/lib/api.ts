import { TAX_RATE } from "@/lib/constants";
import {
  calcTotals,
  remainingBalanceCents,
  splitCents,
  toCents,
  unitPriceWithModifiers,
} from "@/lib/money";
// re-exported so existing callers keep importing it from the data layer
export { remainingBalanceCents } from "@/lib/money";
import {
  previewEvenShareCents,
  previewItemsPaymentCents,
} from "@/lib/pos/bill-preview";
import type { VariationOption } from "@/lib/pos/variation-selection";
import { compareTableNames } from "@/lib/floor/maps";
import { getSupabase } from "@/lib/supabase/client";
import type {
  Category,
  MenuItem,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderPayment,
  PaymentKind,
  Reservation,
  ReservationRow,
  ReservationStatus,
  RestaurantTable,
  TableStatus,
} from "@/lib/database.types";
import type { MenuItemView } from "@/lib/menu-display";
import type { HoldReason } from "@/lib/printing/dispatch";
import type { PrinterQueue, ReprintResult } from "@/lib/printing/queue";

export async function fetchTables(): Promise<RestaurantTable[]> {
  const { data, error } = await getSupabase()
    .from("tables")
    .select("*");
  if (error) throw new Error(error.message);
  return data.sort((a, b) => compareTableNames(a.name, b.name));
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

/** Reservation rows with the tables they hold */
const RESERVATION_SELECT = "*, reservation_tables(table_id)";

type ReservationJoinRow = ReservationRow & {
  reservation_tables: { table_id: string }[];
};

function toReservation({
  reservation_tables,
  ...row
}: ReservationJoinRow): Reservation {
  return { ...row, table_ids: reservation_tables.map((rt) => rt.table_id) };
}

/** Reservations with reserved_at in [start, end), earliest first */
export async function fetchReservationsBetween(
  start: Date,
  end: Date,
): Promise<Reservation[]> {
  const { data, error } = await getSupabase()
    .from("reservations")
    .select(RESERVATION_SELECT)
    .gte("reserved_at", start.toISOString())
    .lt("reserved_at", end.toISOString())
    .order("reserved_at");
  if (error) throw new Error(error.message);
  return (data as unknown as ReservationJoinRow[]).map(toReservation);
}

export async function fetchTodayReservations(): Promise<Reservation[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return fetchReservationsBetween(start, end);
}

export interface NewReservation {
  /** Tables it holds; [] = not assigned yet (Gestione Sala Smart) */
  tableIds: string[];
  customerName: string;
  partySize: number;
  reservedAt: Date;
  notes?: string;
  phone?: string;
  /** Requested table features (table_tags ids) */
  tagIds?: string[];
  /** Preferred room (floor map) */
  mapId?: string | null;
  /** Keep bulk assignment from moving it */
  locked?: boolean;
}

/** Create a reservation and its tables in one transaction; returns its id */
export async function createReservation(r: NewReservation): Promise<string> {
  const { data, error } = await getSupabase().rpc("save_reservation", {
    p: {
      customer_name: r.customerName,
      party_size: r.partySize,
      reserved_at: r.reservedAt.toISOString(),
      notes: r.notes || null,
      phone: r.phone || null,
      tag_ids: r.tagIds ?? [],
      map_id: r.mapId ?? null,
      locked: r.locked ?? false,
    },
    p_table_ids: r.tableIds,
  });
  if (error) throw new Error(error.message);
  return data;
}

export type ReservationPatch = Partial<Omit<NewReservation, "tableIds">>;

/**
 * Change a reservation's details; `tableIds` replaces its tables (omit to
 * leave them alone, [] to unassign).
 */
export async function updateReservation(
  id: string,
  patch: ReservationPatch,
  tableIds?: string[],
): Promise<void> {
  const p: Record<string, unknown> = { id };
  if (patch.customerName !== undefined) p.customer_name = patch.customerName;
  if (patch.partySize !== undefined) p.party_size = patch.partySize;
  if (patch.reservedAt !== undefined) p.reserved_at = patch.reservedAt.toISOString();
  if (patch.notes !== undefined) p.notes = patch.notes || null;
  if (patch.phone !== undefined) p.phone = patch.phone || null;
  if (patch.tagIds !== undefined) p.tag_ids = patch.tagIds;
  if (patch.mapId !== undefined) p.map_id = patch.mapId;
  if (patch.locked !== undefined) p.locked = patch.locked;
  const { error } = await getSupabase().rpc("save_reservation", {
    p,
    p_table_ids: tableIds ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Replace the tables of many reservations in one transaction */
export async function assignReservations(
  assignments: { id: string; table_ids: string[] }[],
): Promise<void> {
  if (assignments.length === 0) return;
  const { error } = await getSupabase().rpc("assign_reservations", {
    p: assignments,
  });
  if (error) throw new Error(error.message);
}

/** The party arrived: the booking is seated and all its tables occupied */
export async function seatReservation(r: Reservation): Promise<void> {
  await setReservationStatus(r.id, "seated");
  await Promise.all(r.table_ids.map((id) => updateTableStatus(id, "occupied")));
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

/**
 * Items orderable right now: available AND no out-of-stock ingredient (86'd).
 *
 * The cover charge is not among them. It is generated per check from the guest
 * count, so a waiter who could find it in the menu could also add it twice, or
 * to the wrong table, or not at all — the failure this whole feature exists to
 * remove. Excluding it here leaves it with no tap target anywhere.
 *
 * Nothing downstream loses sight of it: analytics reads sold lines through its
 * own join (stats-api), so coperto revenue still ranks and reports normally.
 * The only other consumer of this list is the dead-stock report, where a cover
 * charge would be noise — it is not an item anyone is deciding whether to cull.
 */
export async function fetchMenuItems(): Promise<MenuItemView[]> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .select("*, ingredients(name, is_available)")
    .eq("is_available", true)
    .eq("is_coperto", false)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data as unknown as (MenuItem & {
    ingredients: { name: string; is_available: boolean }[];
  })[])
    .filter((item) => item.ingredients.every((i) => i.is_available))
    .map(({ id, category_id, name, price, is_available, sort_order, target_printer_id, codice, is_coperto, allows_variations, ingredients }) => ({
      id,
      category_id,
      name,
      price,
      is_available,
      sort_order,
      target_printer_id,
      codice,
      is_coperto,
      allows_variations,
      // the listino's ingredienti column, for the caption under the dish name
      ingredients: ingredients.map((i) => i.name),
    }));
}

export interface VariationData {
  /** Every ingredient in stock, priced as an addition — the "add" side */
  pantry: VariationOption[];
  /** A dish's own ingredients, the "remove" side, keyed by menu_item_id.
   *
   * KEY PRESENCE is what says a dish allows variations — NOT a non-empty
   * array. A dish can be modifiable and still have no ingredients of its own
   * (chips, a dessert, anything the kitchen never itemized): it offers nothing
   * to remove but the whole pantry to add. Gating on `.length > 0` would strip
   * those dishes of the affordance permanently. */
  byItem: Record<string, VariationOption[]>;
}

/**
 * Everything the POS variation picker needs, in two round trips.
 *
 * Replaces the old modifier-group fetch: there is nothing to configure per
 * dish beyond the `allows_variations` switch, so this is just the pantry plus
 * each modifiable dish's own ingredient list.
 */
export async function fetchVariationData(): Promise<VariationData> {
  const sb = getSupabase();
  const [pantryRes, dishRes] = await Promise.all([
    sb
      .from("ingredients")
      .select("id, name, price")
      .eq("is_available", true)
      .order("name"),
    sb
      .from("menu_items")
      .select("id, ingredients(id, name, price)")
      .eq("allows_variations", true),
  ]);
  if (pantryRes.error) throw new Error(pantryRes.error.message);
  if (dishRes.error) throw new Error(dishRes.error.message);

  const byItem: Record<string, VariationOption[]> = {};
  for (const row of dishRes.data as unknown as Array<{
    id: string;
    ingredients: VariationOption[];
  }>) {
    // the join has no ordering column, so sort here or the list comes back shuffled
    byItem[row.id] = [...row.ingredients].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  return { pantry: pantryRes.data as VariationOption[], byItem };
}

export type OrderItemWithName = OrderItem & {
  /** `is_coperto` rides along so the bill can render the cover charge as the
   * derived line it is, rather than one more thing to delete by accident.
   * `codice` and the category name let a bill line label itself the same way
   * the menu did — a pizza reads as its number here too, not as its toppings. */
  menu_items:
    | {
        name: string;
        is_coperto: boolean;
        codice: string | null;
        categories: { name: string; sort_order: number } | null;
      }
    | null;
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
    .select("*, menu_items(name, is_coperto, codice, categories(name, sort_order)), order_item_modifiers(*)")
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
    .select("*, order_items(*, menu_items(name, is_coperto, codice, categories(name, sort_order)), order_item_modifiers(*))")
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

// ---------------------------------------------------------------------------
// Cover charge ("coperto")
// ---------------------------------------------------------------------------

/**
 * The single menu row that IS the cover charge, or null when this house
 * charges none. `maybeSingle` is safe: a partial unique index allows at most
 * one such row.
 */
async function fetchCopertoItem(): Promise<{ id: string; price: number } | null> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .select("id, price")
    .eq("is_coperto", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The house cover charge per guest, or null when there is none. Lets the
 * covers prompt show what the number it is about to accept will cost — a
 * waiter who can see "4 x EUR 1.50" will notice they typed 40.
 */
export async function fetchCoverCharge(): Promise<number | null> {
  return (await fetchCopertoItem())?.price ?? null;
}

/**
 * Make the order's coperto line match its guest count.
 *
 * The waiter never touches this line: they state how many people are at the
 * table and the charge follows, here, every time the count changes. That is
 * the whole design — a per-person line punched in by hand is a line that gets
 * forgotten on a busy Saturday, and a forgotten coperto leaves nothing on the
 * bill to notice it by.
 *
 * Covers already paid for are honoured: on a split bill the coperto may have
 * been settled before the count changed, so only the still-unpaid remainder is
 * adjusted, and a paid line is never rewritten (same invariant as
 * setSentItemPrice). Raising the count after a partial payment therefore adds
 * the difference rather than re-charging everyone.
 *
 * Callers recompute totals afterwards; this function only moves the line.
 */
async function syncCoperto(orderId: string, covers: number): Promise<void> {
  const sb = getSupabase();
  const item = await fetchCopertoItem();
  if (!item) return; // this house charges no coperto

  const { data: existing, error } = await sb
    .from("order_items")
    .select("id, quantity, paid_by_payment_id")
    .eq("order_id", orderId)
    .eq("menu_item_id", item.id)
    .order("created_at");
  if (error) throw new Error(error.message);

  const paid = existing.filter((r) => r.paid_by_payment_id !== null);
  const unpaid = existing.filter((r) => r.paid_by_payment_id === null);
  const alreadyCharged = paid.reduce((n, r) => n + r.quantity, 0);
  const outstanding = covers - alreadyCharged;

  // Collapse to at most one unpaid line, so repeated edits can never leave a
  // trail of coperto rows on the bill.
  const [keep, ...extra] = unpaid;
  if (extra.length > 0) {
    const { error: delError } = await sb
      .from("order_items")
      .delete()
      .in("id", extra.map((r) => r.id));
    if (delError) throw new Error(delError.message);
  }

  if (outstanding <= 0) {
    if (keep) {
      const { error: delError } = await sb
        .from("order_items")
        .delete()
        .eq("id", keep.id);
      if (delError) throw new Error(delError.message);
    }
    return;
  }

  if (keep) {
    const { error: upError } = await sb
      .from("order_items")
      .update({ quantity: outstanding })
      .eq("id", keep.id);
    if (upError) throw new Error(upError.message);
    return;
  }

  const { error: insError } = await sb.from("order_items").insert({
    order_id: orderId,
    menu_item_id: item.id,
    quantity: outstanding,
    // price snapshot at the moment the charge lands, like every other line
    unit_price: item.price,
  });
  if (insError) throw new Error(insError.message);
}

/**
 * Change how many guests a check is for, at any point while it is open.
 *
 * Deliberately not a write-once field: a table gains a latecomer, loses
 * someone before the food arrives, or the waiter simply mistyped. Being able
 * to correct the number is what makes it safe to demand one up front.
 * Zero is a legitimate answer — this check carries no cover charge — and
 * removes the line rather than being rejected.
 */
export async function updateOrderCovers(
  orderId: string,
  covers: number,
): Promise<void> {
  if (!Number.isInteger(covers) || covers < 0) {
    throw new Error("Covers must be a whole number, zero or more");
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ covers })
    .eq("id", orderId)
    .eq("status", "open");
  if (error) throw new Error(error.message);
  await syncCoperto(orderId, covers);
  await recomputeOrderTotals(orderId);
}

export interface TicketLineInput {
  menuItemId: string;
  /** BASE menu price; modifier adjustments are added on insert */
  unitPrice: number;
  quantity: number;
  notes?: string | null;
  /** Ingredients added to / removed from this line */
  modifiers?: Array<{
    ingredientId: string;
    name: string;
    priceAdjustment: number;
    isRemoval: boolean;
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

  // Per-line variation detail (name + adjustment frozen at order time) for the
  // ticket UI and the print engine; rows return in insert order, so ids align.
  const modifierRows = lines.flatMap((l, idx) =>
    (l.modifiers ?? []).map((m) => ({
      order_item_id: itemIds[idx],
      ingredient_id: m.ingredientId,
      name: m.name,
      price_adjustment: m.priceAdjustment,
      is_removal: m.isRemoval,
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
 *
 * `covers` is the guest count collected when the check was opened. It is
 * applied on creation, and adopted by an order that has none yet — which is
 * how the checks already sitting open when this shipped pick up their cover
 * charge instead of going without one forever. It never overwrites a count
 * that is already set: changing it is updateOrderCovers' job, so sending a
 * round can't silently rewrite a number the waiter corrected by hand.
 *
 * The returned newItemIds hold only the lines from this round, so the coperto
 * never reaches a production slip.
 */
export async function sendToKitchen(
  tableId: string,
  lines: TicketLineInput[],
  subtable: string | null,
  openedBy: string | null,
  covers?: number | null,
): Promise<SentRound> {
  if (lines.length === 0) throw new Error("Ticket is empty");
  const sb = getSupabase();

  const existing = await fetchOpenOrder(tableId, subtable);
  let orderId = existing?.order.id;
  const adoptCovers =
    covers != null && (!existing || existing.order.covers == null);

  if (!orderId) {
    const { data, error } = await sb
      .from("orders")
      .insert({
        table_id: tableId,
        subtable,
        tax_rate: TAX_RATE,
        opened_by: openedBy,
        covers: covers ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    orderId = data.id;
  } else if (adoptCovers) {
    const { error } = await sb
      .from("orders")
      .update({ covers })
      .eq("id", orderId);
    if (error) throw new Error(error.message);
  }

  const newItemIds = await insertOrderItems(orderId, lines);
  if (adoptCovers) await syncCoperto(orderId, covers as number);
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
// Delivery counter & saved labels
// ---------------------------------------------------------------------------

/** Start of the current "night" = the later of today's local midnight and the
 * last manual reset. The delivery number counts orders opened since then. */
async function deliveryNightStart(): Promise<Date> {
  const { data, error } = await getSupabase()
    .from("delivery_counter")
    .select("last_reset_at")
    .eq("singleton", true)
    .single();
  if (error) throw new Error(error.message);

  const localMidnight = new Date();
  localMidnight.setHours(0, 0, 0, 0);
  const lastReset = new Date(data.last_reset_at);
  // The most recent boundary wins, so a manual reset mid-night takes effect
  // immediately while the calendar rollover handles the unattended case.
  return lastReset > localMidnight ? lastReset : localMidnight;
}

/** Next sequential delivery number for tonight (1-based). */
export async function nextDeliveryNumber(): Promise<number> {
  const since = await deliveryNightStart();
  const { data, error } = await getSupabase()
    .from("orders")
    .select("delivery_number")
    .eq("order_type", "takeaway")
    .gte("opened_at", since.toISOString())
    .not("delivery_number", "is", null)
    .order("delivery_number", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const highest = data[0]?.delivery_number ?? 0;
  return highest + 1;
}

/** Force the counter back to 1 from now on (end-of-night close). */
export async function resetDeliveryCounter(): Promise<void> {
  const { error } = await getSupabase()
    .from("delivery_counter")
    .update({ last_reset_at: new Date().toISOString() })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

/** Names previously used on delivery orders, offered as quick-picks. */
export async function fetchDeliveryLabels(): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("delivery_labels")
    .select("name")
    .order("name");
  if (error) throw new Error(error.message);
  return data.map((l) => l.name);
}

/**
 * Open a new delivery (take-away) order eagerly so its nightly counter number
 * is assigned and visible right away. The name is saved as a reusable label.
 * Returns the order id and its delivery number; the POS then loads it.
 */
export async function createDeliveryOrder(
  name: string,
  openedBy: string | null,
): Promise<{ orderId: string; deliveryNumber: number }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A name is required");
  const sb = getSupabase();
  const deliveryNumber = await nextDeliveryNumber();

  const { data, error } = await sb
    .from("orders")
    .insert({
      order_type: "takeaway",
      customer_name: trimmed,
      delivery_number: deliveryNumber,
      tax_rate: TAX_RATE,
      opened_by: openedBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Remember the name for next time (ignore the conflict if it already exists).
  await sb.from("delivery_labels").upsert({ name: trimmed }, { onConflict: "name" });

  return { orderId: data.id, deliveryNumber };
}

// ---------------------------------------------------------------------------
// Printing (LAN thermal printers, dispatched server-side via /api/print/*)
// ---------------------------------------------------------------------------

export interface PrintJobResult {
  printerName: string;
  ok: boolean;
  error?: string;
  /** Set when a comanda couldn't print and was parked in the printer's queue */
  held?: HoldReason;
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

/** Fire the kitchen's "CAMBIO TAVOLO" notice: production slips for the moved
 * lines only, under the target's table, with `from` (e.g. "TAVOLO 3") in the
 * banner so the runner knows where the dishes used to go. */
export function printTransferSlips(
  orderId: string,
  orderItemIds: string[],
  from: string,
): Promise<PrintJobResult[]> {
  return postPrint("/api/print/transfer", { orderId, orderItemIds, from });
}

/** Fire a sample ticket at one printer (admin panel "Test print"). With
 * `draft`, the template editor's unsaved template is printed instead of the
 * printer's own one. */
export function printTest(
  printerId: string,
  draft?: {
    template: unknown;
    variant?: "CONTO" | "PRECONTO" | "PARZIALE";
    service?: "table" | "takeaway";
  },
): Promise<PrintJobResult[]> {
  return postPrint("/api/print/test", { printerId, ...draft });
}

/** Held comande per printer; `probe` also asks each printer if it's back. */
export async function fetchPrintQueues(probe: boolean): Promise<PrinterQueue[]> {
  const res = await fetch(`/api/print/queue${probe ? "?probe=1" : ""}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Print service unavailable");
  return data.queues;
}

/** Reprint the given held comande of one printer, oldest first. */
export async function reprintHeldJobs(
  printerId: string,
  jobIds: string[],
): Promise<ReprintResult> {
  const res = await fetch("/api/print/queue/reprint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printerId, jobIds }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Print service unavailable");
  return data;
}

/** Drop held comande without printing them. */
export async function discardHeldJobs(jobIds: string[]): Promise<void> {
  const res = await fetch("/api/print/queue/discard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Print service unavailable");
  }
}

/**
 * Close the order as paid. A dine-in table is flagged for cleaning only when
 * this was its last open split — other splits keep the table occupied.
 * Returns true if the table was flagged dirty.
 */
/**
 * Close one order as paid. Returns true when this was the table's last open
 * order (the whole table is now free). The table status is intentionally left
 * untouched: the caller asks the user whether to flag the table dirty or
 * available and applies that choice via updateTableStatus.
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
  return remaining.length === 0;
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

  // A check whose last real line just came off is cancelled — and the coperto
  // does not count as a real line. It is derived from the guest count, so an
  // order holding nothing but a cover charge is an order with nothing on it,
  // and leaving it open would strand the table as occupied.
  const { count, error: countError } = await sb
    .from("order_items")
    .select("id, menu_items!inner(is_coperto)", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("menu_items.is_coperto", false);
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
  /** True when this was the table's last open split — the table is now free
   * and the UI should ask whether to flag it dirty or available */
  tableClosed: boolean;
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
  let tableClosed = false;
  if (remainingCents <= 0) {
    orderClosed = true;
    tableClosed = await checkoutOrder(order.id, order.table_id);
  }
  return { paidAmount: amountCents / 100, remainingCents, orderClosed, tableClosed };
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

  const shareCents = previewEvenShareCents(open.order, open.payments, sharesLeft);
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

  const amountCents = previewItemsPaymentCents(
    open.order,
    open.items,
    open.payments,
    orderItemIds,
  );

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

/**
 * Break the cover charge into one payable line per guest.
 *
 * The coperto lives on the bill as a single line of `covers` units, which is
 * how it should read while the table is eating. The moment the bill is split
 * by item, though, that single line is unpayable by anyone but the person who
 * agrees to buy everybody's coperto: it is all-or-nothing, and the waiter has
 * to reach for the divide button and retype the guest count to make it
 * splittable. So the split-by-item flow calls this on entry and the work is
 * already done — each guest picks up their own cover charge alongside their
 * own dishes.
 *
 * Unlike splitItemIntoFractions this leaves `fraction_of` null: one guest's
 * coperto is a whole cover charge, not 1/N of one, and the line total is
 * already an exact multiple so nothing has to be distributed in cents. Each
 * source row's own price snapshot is carried onto its expanded rows, so a
 * mid-service price change on the coperto item cannot move the total.
 *
 * Paid rows are never touched (same invariant as syncCoperto). Idempotent:
 * returns false — with nothing written — when the unpaid coperto is already
 * one line per guest, when the check carries a single cover, or when this
 * house charges no coperto at all.
 */
export async function splitCopertoPerGuest(orderId: string): Promise<boolean> {
  const sb = getSupabase();
  const item = await fetchCopertoItem();
  if (!item) return false;

  const { data: rows, error } = await sb
    .from("order_items")
    .select("id, quantity, unit_price, notes")
    .eq("order_id", orderId)
    .eq("menu_item_id", item.id)
    .is("paid_by_payment_id", null)
    .order("created_at");
  if (error) throw new Error(error.message);

  const covers = rows.reduce((n, r) => n + r.quantity, 0);
  // already one line per guest (the common case on re-entry), or nothing to split
  if (covers < 2 || rows.length === covers) return false;

  const { error: insertError } = await sb.from("order_items").insert(
    rows.flatMap((r) =>
      Array.from({ length: r.quantity }, () => ({
        order_id: orderId,
        menu_item_id: item.id,
        quantity: 1,
        unit_price: r.unit_price,
        notes: r.notes,
      })),
    ),
  );
  if (insertError) throw new Error(insertError.message);

  const { error: deleteError } = await sb
    .from("order_items")
    .delete()
    .in("id", rows.map((r) => r.id));
  if (deleteError) throw new Error(deleteError.message);

  // No-op by construction, but keeps stored totals authoritative.
  await recomputeOrderTotals(orderId);
  return true;
}

// ---------------------------------------------------------------------------
// Cambio tavolo (move a bill, or part of it, to another table / split)
// ---------------------------------------------------------------------------

export interface MoveResult {
  /** The bill the lines now live on */
  orderId: string;
  /** Moved lines as they sit on the target (for the kitchen notice) */
  movedItemIds: string[];
  /** The source bill left its table (moved whole, or merged and cancelled) */
  sourceClosed: boolean;
  /** The source table has no open bill left: ask dirty vs available */
  tableFreed: boolean;
}

/**
 * Move `items` (line id → quantity) off an open dine-in bill onto the
 * (table, split) target, creating its bill if needed. The move itself is one
 * DB transaction (move_order_items, which holds the rules); what follows here
 * is the same bookkeeping every other write does — coperto re-sync on a merge
 * (covers were added up) and stored totals on both bills.
 */
export async function moveOrderItems(
  fromOrderId: string,
  items: Array<{ id: string; quantity: number }>,
  toTableId: string,
  toSubtable: string | null,
  userId: string | null,
): Promise<MoveResult> {
  const sb = getSupabase();
  const { data: source, error: srcError } = await sb
    .from("orders")
    .select("table_id")
    .eq("id", fromOrderId)
    .single();
  if (srcError) throw new Error(srcError.message);

  const { data, error } = await sb.rpc("move_order_items", {
    p_from_order: fromOrderId,
    p_items: items,
    p_to_table: toTableId,
    p_to_sub: toSubtable,
    p_user: userId,
  });
  if (error) throw new Error(error.message);

  if (data.covers != null) await syncCoperto(data.order_id, data.covers);
  await recomputeOrderTotals(data.order_id);
  if (!data.source_closed) await recomputeOrderTotals(fromOrderId);

  const fromTable = source.table_id;
  const tableFreed =
    data.source_closed &&
    fromTable !== null &&
    fromTable !== toTableId &&
    (await fetchOpenOrdersForTable(fromTable)).length === 0;

  return {
    orderId: data.order_id,
    movedItemIds: data.moved_item_ids,
    sourceClosed: data.source_closed,
    tableFreed,
  };
}
