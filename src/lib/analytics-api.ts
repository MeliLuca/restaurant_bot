import { getSupabase } from "@/lib/supabase/client";
import type { Order, OrderItem, ReservationRow } from "@/lib/database.types";
import type { ServiceDateRange } from "@/lib/analytics/date-range";

export type AnalyticsOrderItem = OrderItem & {
  menu_items: { name: string; category_id: string } | null;
  order_item_modifiers: {
    ingredient_id: string | null;
    name: string;
    price_adjustment: number;
    is_removal: boolean;
  }[];
};

// Structurally assignable to StatsOrder, so summarizeNight/rankItems from
// stats-api.ts work on these rows unchanged.
export type AnalyticsOrder = Order & {
  order_items: AnalyticsOrderItem[];
  tables: { name: string } | null;
};

// PostgREST caps a select at 1000 rows; long ranges can exceed that, so page
// through with .range() until a short page signals the end (settings-api.ts).
const FETCH_PAGE = 1000;

/** Every order opened in [start, end), items + modifiers included. */
export async function fetchOrdersForRange(
  range: ServiceDateRange,
): Promise<AnalyticsOrder[]> {
  const sb = getSupabase();
  const rows: AnalyticsOrder[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await sb
      .from("orders")
      .select(
        "*, order_items(*, menu_items(name, category_id), order_item_modifiers(ingredient_id, name, price_adjustment, is_removal)), tables(name)",
      )
      .gte("opened_at", range.start.toISOString())
      .lt("opened_at", range.end.toISOString())
      .order("opened_at", { ascending: true })
      .order("id")
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data as unknown as AnalyticsOrder[]));
    if (data.length < FETCH_PAGE) break;
  }
  return rows;
}

/** Reservations with reserved_at in [start, end). */
export async function fetchReservationsForRange(
  range: ServiceDateRange,
): Promise<ReservationRow[]> {
  const sb = getSupabase();
  const rows: ReservationRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await sb
      .from("reservations")
      .select("*")
      .gte("reserved_at", range.start.toISOString())
      .lt("reserved_at", range.end.toISOString())
      .order("reserved_at", { ascending: true })
      .order("id")
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < FETCH_PAGE) break;
  }
  return rows;
}
