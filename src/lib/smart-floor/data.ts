import { fetchReservationsBetween } from "@/lib/api";
import { fetchFloorMaps } from "@/lib/floor/maps";
import { fetchTablesWithTags, fetchTableTags } from "@/lib/settings-api";
import { getSupabase } from "@/lib/supabase/client";
import type {
  FloorMap,
  FloorMapElement,
  FloorZone,
  TableJoinRule,
} from "@/lib/database.types";
import type { FloorSnapshot } from "./context";
import { fetchSmartFloorSettings } from "./settings";
import type { OpenBill } from "./walk-in";

export async function fetchJoinRules(): Promise<TableJoinRule[]> {
  const { data, error } = await getSupabase().from("table_join_rules").select("*");
  if (error) throw new Error(error.message);
  return data;
}

/** Everything the engine needs to plan the service of `day` (local date) */
export async function fetchFloorSnapshot(day: Date = new Date()): Promise<FloorSnapshot> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [settings, tables, tags, reservations, joinRules, maps] = await Promise.all([
    fetchSmartFloorSettings(),
    fetchTablesWithTags(),
    fetchTableTags(),
    fetchReservationsBetween(start, end),
    fetchJoinRules(),
    fetchFloorMaps(),
  ]);
  return { settings, tables, tags, reservations, joinRules, maps };
}

/**
 * Set whether two tables can be pushed together, against what the map says:
 * true / false store an exception, null drops it (the map decides again).
 */
export async function setJoinRule(
  a: string,
  b: string,
  joinable: boolean | null,
): Promise<void> {
  // stored once per pair, smaller id first (uuid text sorts like the bytes)
  const [table_a, table_b] = a < b ? [a, b] : [b, a];
  const sb = getSupabase();
  const { error } =
    joinable === null
      ? await sb.from("table_join_rules").delete().match({ table_a, table_b })
      : await sb.from("table_join_rules").upsert({ table_a, table_b, joinable });
  if (error) throw new Error(error.message);
}

/** Drop every exception between tables of these (one map's) tables */
export async function clearJoinRules(tableIds: string[]): Promise<void> {
  if (tableIds.length === 0) return;
  const { error } = await getSupabase()
    .from("table_join_rules")
    .delete()
    .in("table_a", tableIds)
    .in("table_b", tableIds);
  if (error) throw new Error(error.message);
}

// ZONES (tables of different zones are never pushed together) ---------------------

export async function fetchZones(): Promise<FloorZone[]> {
  const { data, error } = await getSupabase()
    .from("floor_zones")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function createZone(mapId: string, name: string, sortOrder: number): Promise<FloorZone> {
  const { data, error } = await getSupabase()
    .from("floor_zones")
    .insert({ map_id: mapId, name: name.trim(), sort_order: sortOrder })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function renameZone(id: string, name: string): Promise<void> {
  const { error } = await getSupabase()
    .from("floor_zones")
    .update({ name: name.trim() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Its tables are left with no zone */
export async function deleteZone(id: string): Promise<void> {
  const { error } = await getSupabase().from("floor_zones").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Put tables in a zone of their room (null = no zone) */
export async function setTablesZone(tableIds: string[], zoneId: string | null): Promise<void> {
  if (tableIds.length === 0) return;
  const { error } = await getSupabase()
    .from("tables")
    .update({ zone_id: zoneId })
    .in("id", tableIds);
  if (error) throw new Error(error.message);
}

/**
 * Take a divider away for now (off) or put it back, by its place in the
 * map's scenery. The rest of the drawing is written back as it was read.
 */
export async function setDividerOff(
  map: FloorMap,
  index: number,
  off: boolean,
): Promise<FloorMapElement[]> {
  const elements = map.elements.map((el, i) =>
    i === index && el.kind !== "text" ? { ...el, off: off || undefined } : el,
  );
  const { error } = await getSupabase()
    .from("floor_maps")
    .update({ elements })
    .eq("id", map.id);
  if (error) throw new Error(error.message);
  return elements;
}

/**
 * Every open dine-in bill, for "Trova posto": when its pre-conto was printed
 * and when it first got an item from a "finishing" category (Dolci…).
 */
export async function fetchOpenBills(finishingCategoryIds: string[]): Promise<OpenBill[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("table_id, preconto_at, order_items(created_at, menu_items(category_id))")
    .eq("status", "open")
    .eq("order_type", "dine_in");
  if (error) throw new Error(error.message);
  const finishing = new Set(finishingCategoryIds);
  const rows = data as unknown as {
    table_id: string | null;
    preconto_at: string | null;
    order_items: { created_at: string; menu_items: { category_id: string } | null }[];
  }[];
  return rows
    .filter((o) => o.table_id !== null)
    .map((o) => {
      const times = o.order_items
        .filter((i) => i.menu_items && finishing.has(i.menu_items.category_id))
        .map((i) => Date.parse(i.created_at));
      return {
        tableId: o.table_id!,
        precontoAt: o.preconto_at ? Date.parse(o.preconto_at) : null,
        finishingAt: times.length > 0 ? Math.min(...times) : null,
      };
    });
}
