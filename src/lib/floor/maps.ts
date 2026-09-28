import type { FloorMap } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";

/** Table names are mostly numbers ("2", "10", "102/1"): sort them the way a
 * waiter reads them, not as plain strings (where "10" < "2"). */
export function compareTableNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export async function fetchFloorMaps(): Promise<FloorMap[]> {
  const { data, error } = await getSupabase()
    .from("floor_maps")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}
