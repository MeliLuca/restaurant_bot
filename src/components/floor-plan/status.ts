import type { TableStatus } from "@/lib/database.types";

/** Visual states shown on the floor. "ordered" is derived (an occupied table
 * that already has an open order), so it has no matching DB status. */
export type TableDisplayStatus = TableStatus | "ordered";

export const STATUS_CONFIG: Record<
  TableDisplayStatus,
  { label: string; card: string; badge: string; dot: string }
> = {
  // Free table — blue.
  available: {
    label: "Available",
    card: "border-blue-600/50 bg-blue-500/10 hover:bg-blue-500/20",
    badge: "bg-blue-600 text-white",
    dot: "bg-blue-600",
  },
  // Seated but nothing ordered yet — yellow.
  occupied: {
    label: "Occupied",
    card: "border-yellow-500/60 bg-yellow-400/15 hover:bg-yellow-400/25",
    badge: "bg-yellow-400 text-black",
    dot: "bg-yellow-400",
  },
  // Has at least one open order — red.
  ordered: {
    label: "Order placed",
    card: "border-red-600/50 bg-red-500/10 hover:bg-red-500/20",
    badge: "bg-red-600 text-white",
    dot: "bg-red-600",
  },
  // Needs clearing — muddy brown to read as "dirty".
  dirty: {
    label: "Dirty",
    card: "border-amber-800/50 bg-amber-800/15 hover:bg-amber-800/25",
    badge: "bg-amber-800 text-white",
    dot: "bg-amber-800",
  },
};

/** Map the stored status + live order presence onto a visual state. */
export function displayStatus(
  status: TableStatus,
  hasOrder: boolean,
): TableDisplayStatus {
  return status === "occupied" && hasOrder ? "ordered" : status;
}
