import type {
  FloorMap,
  FloorMapElement,
  RestaurantTable,
} from "@/lib/database.types";
import { toShape, type Geom } from "@/lib/floor/geometry";
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
  const g = toShape(geomOf(table), shape);
  const { error } = await getSupabase()
    .from("tables")
    .update({ shape: g.shape, x: g.x, y: g.y, w: g.w, h: g.h, path: g.path })
    .eq("id", table.id);
  if (error) throw new Error(error.message);
}

/** A placed table's geometry as plain numbers (PostgREST numerics). */
export function geomOf(table: RestaurantTable): Geom {
  return {
    shape: table.shape,
    x: Number(table.x),
    y: Number(table.y),
    w: Number(table.w),
    h: Number(table.h),
    rotation: Number(table.rotation) || 0,
    path: table.path,
  };
}

/** A table drawn in the editor that doesn't exist yet (created on save) */
export interface NewMapTable {
  /** Draft key, not a real id */
  key: string;
  name: string;
  capacity: number;
  tagIds: string[];
  geom: Geom;
}

/**
 * Write an editor draft in one transaction (see save_floor_map_layout).
 * Returns draft key → real id for the tables it created.
 */
export async function saveFloorMapLayout(
  mapId: string,
  changes: { id: string; geom: Geom | null }[],
  /** The map's whole new scenery; omit to leave it untouched */
  elements?: FloorMapElement[],
  /** New sheet size; omit to keep it */
  size?: { width: number; height: number },
  /** Tables drawn in this draft */
  created: NewMapTable[] = [],
): Promise<Record<string, string>> {
  const { data, error } = await getSupabase().rpc("save_floor_map_layout", {
    p_map_id: mapId,
    p_tables: [
      ...changes.map(({ id, geom }) =>
        geom ? { id, placed: true, ...geom } : { id, placed: false },
      ),
      ...created.map((c) => ({
        new: true as const,
        key: c.key,
        name: c.name,
        capacity: c.capacity,
        tag_ids: c.tagIds,
        ...c.geom,
      })),
    ],
    p_elements: elements ?? null,
    p_width: size?.width ?? null,
    p_height: size?.height ?? null,
  });
  if (error) throw new Error(error.message);
  return data ?? {};
}

/**
 * Name for a freshly drawn table: one past the highest plain-number name
 * ("71" after "70"; "102/4" and "Patio 3" don't count), or "1".
 */
export function nextTableName(taken: string[]): string {
  return nextTableNameLike("", taken);
}

/**
 * Next name in the same series as `like`: "G1" → one past the highest
 * "G<n>" ("G6" if G1–G5 exist), "310" → one past the highest plain number.
 * A name without a trailing number starts a plain-number series.
 */
export function nextTableNameLike(like: string, taken: string[]): string {
  const prefix = like.trim().replace(/\d+$/, "");
  const series = /\d$/.test(like.trim()) ? prefix : "";
  const escaped = series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(\\d+)$`, "i");
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  let max = 0;
  for (const name of taken) {
    const m = re.exec(name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (used.has(`${series}${n}`.toLowerCase())) n++;
  return `${series}${n}`;
}
