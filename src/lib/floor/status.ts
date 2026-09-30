import type { TableStatus } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/** Visual states shown on the floor. "ordered" is derived (an occupied table
 * that already has an open order), so it has no matching DB status. */
export type TableDisplayStatus = TableStatus | "ordered";

export const STATUS_CONFIG: Record<
  TableDisplayStatus,
  {
    labelKey: TranslationKey;
    card: string;
    badge: string;
    dot: string;
    /** fill/stroke for the table's shape on the drawn floor map */
    shape: string;
  }
> = {
  // Free table — blue.
  available: {
    labelKey: "floor.status.available",
    card: "border-blue-600/50 bg-blue-500/10 hover:bg-blue-500/20",
    badge: "bg-blue-600 text-white",
    dot: "bg-blue-600",
    shape: "fill-blue-500/15 stroke-blue-600 group-hover:fill-blue-500/30",
  },
  // Seated but nothing ordered yet — yellow.
  occupied: {
    labelKey: "floor.status.occupied",
    card: "border-yellow-500/60 bg-yellow-400/15 hover:bg-yellow-400/25",
    badge: "bg-yellow-400 text-black",
    dot: "bg-yellow-400",
    shape: "fill-yellow-400/40 stroke-yellow-500 group-hover:fill-yellow-400/60",
  },
  // Has at least one open order — red.
  ordered: {
    labelKey: "floor.status.ordered",
    card: "border-red-600/50 bg-red-500/10 hover:bg-red-500/20",
    badge: "bg-red-600 text-white",
    dot: "bg-red-600",
    shape: "fill-red-500/25 stroke-red-600 group-hover:fill-red-500/40",
  },
  // Needs clearing — muddy brown to read as "dirty".
  dirty: {
    labelKey: "floor.status.dirty",
    card: "border-amber-800/50 bg-amber-800/15 hover:bg-amber-800/25",
    badge: "bg-amber-800 text-white",
    dot: "bg-amber-800",
    shape: "fill-amber-800/30 stroke-amber-800 group-hover:fill-amber-800/45",
  },
};

/** Map the stored status + live order presence onto a visual state. */
export function displayStatus(
  status: TableStatus,
  hasOrder: boolean,
): TableDisplayStatus {
  return status === "occupied" && hasOrder ? "ordered" : status;
}

/** The four states in the order the Sala shows them (legend and filter) */
export const DISPLAY_STATUSES: TableDisplayStatus[] = [
  "available",
  "occupied",
  "ordered",
  "dirty",
];

/** How many tables are in each visual state: the Sala at a glance */
export function countByStatus(
  tables: { id: string; status: TableStatus }[],
  hasOrder: (tableId: string) => boolean,
): Record<TableDisplayStatus, number> {
  const counts: Record<TableDisplayStatus, number> = {
    available: 0,
    occupied: 0,
    ordered: 0,
    dirty: 0,
  };
  for (const tb of tables) counts[displayStatus(tb.status, hasOrder(tb.id))] += 1;
  return counts;
}
