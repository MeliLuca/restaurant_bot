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
