import { fetchReservationsBetween } from "@/lib/api";
import { fetchTablesWithTags, fetchTableTags } from "@/lib/settings-api";
import { getSupabase } from "@/lib/supabase/client";
import type { TableJoinRule } from "@/lib/database.types";
import type { FloorSnapshot } from "./context";
import { fetchSmartFloorSettings } from "./settings";

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
  const [settings, tables, tags, reservations, joinRules] = await Promise.all([
    fetchSmartFloorSettings(),
    fetchTablesWithTags(),
    fetchTableTags(),
    fetchReservationsBetween(start, end),
    fetchJoinRules(),
  ]);
  return { settings, tables, tags, reservations, joinRules };
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
