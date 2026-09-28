import type { FloorMap, RestaurantTable } from "@/lib/database.types";
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

// ---------------------------------------------------------------------------
// Managing maps (Settings → Mappe sala)
// ---------------------------------------------------------------------------

/** Canvas bounds a manager can pick; beyond these the map gets unusable. */
export const MAP_MIN_SIZE = 200;
export const MAP_MAX_SIZE = 5000;
/** Size given to a table when it is first put on a map (moved in the editor) */
export const DEFAULT_TABLE_SIZE = {
  rect: { w: 60, h: 40 },
  circle: { w: 44, h: 44 },
} as const;

export type MapTableGeometry = Pick<
  RestaurantTable,
  "shape" | "x" | "y" | "w" | "h" | "rotation" | "path"
>;

export async function createFloorMap(
  name: string,
  width: number,
  height: number,
  sortOrder: number,
): Promise<FloorMap> {
  const { data, error } = await getSupabase()
    .from("floor_maps")
    .insert({ name: name.trim(), width, height, sort_order: sortOrder })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateFloorMap(
  id: string,
  fields: { name?: string; width?: number; height?: number },
): Promise<void> {
  const { error } = await getSupabase()
    .from("floor_maps")
    .update(fields)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tables on the map are not deleted: the FK un-places them (map_id → null). */
export async function deleteFloorMap(id: string): Promise<void> {
  const { error } = await getSupabase().from("floor_maps").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Persist a new display order (index = sort_order). */
export async function reorderFloorMaps(ids: string[]): Promise<void> {
  const sb = getSupabase();
  const results = await Promise.all(
    ids.map((id, i) =>
      sb.from("floor_maps").update({ sort_order: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/**
 * First free default spot for a new table: the map centre, stepping
 * diagonally past tables already parked there, so several quick additions
 * don't stack exactly on top of each other before they are arranged.
 */
export function defaultPlacement(
  map: Pick<FloorMap, "width" | "height">,
  onMap: Pick<RestaurantTable, "x" | "y">[],
  shape: "rect" | "circle",
): MapTableGeometry {
  const { w, h } = DEFAULT_TABLE_SIZE[shape];
  const taken = new Set(onMap.map((tb) => `${Number(tb.x)},${Number(tb.y)}`));
  let x = Math.round((map.width - w) / 2);
  let y = Math.round((map.height - h) / 2);
  for (let i = 0; i < 50 && taken.has(`${x},${y}`); i++) {
    x = Math.min(map.width - w, x + 20);
    y = Math.min(map.height - h, y + 20);
  }
  return { shape, x, y, w, h, rotation: 0, path: null };
}

export async function placeTable(
  tableId: string,
  mapId: string,
  geometry: MapTableGeometry,
): Promise<void> {
  const { error } = await getSupabase()
    .from("tables")
    .update({ map_id: mapId, ...geometry })
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

/** Take a table off its map; it stays usable from the grid / "Fuori mappa". */
export async function unplaceTable(tableId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("tables")
    .update({ map_id: null })
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

/** Switch rect ⇄ circle, keeping the table's centre. Circles are square. */
export async function setTableShape(
  table: RestaurantTable,
  shape: "rect" | "circle",
): Promise<void> {
  const cx = Number(table.x) + Number(table.w) / 2;
  const cy = Number(table.y) + Number(table.h) / 2;
  const { w, h } =
    shape === "circle"
      ? (() => {
          const d = Math.min(Number(table.w), Number(table.h));
          return { w: d, h: d };
        })()
      : table.shape === "circle"
        ? DEFAULT_TABLE_SIZE.rect
        : { w: Number(table.w), h: Number(table.h) };
  const { error } = await getSupabase()
    .from("tables")
    .update({ shape, w, h, x: cx - w / 2, y: cy - h / 2, path: null })
    .eq("id", table.id);
  if (error) throw new Error(error.message);
}
