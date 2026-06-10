import type { TableStatus } from "@/lib/database.types";

export const STATUS_CONFIG: Record<
  TableStatus,
  { label: string; card: string; badge: string; dot: string }
> = {
  available: {
    label: "Available",
    card: "border-green-600/50 bg-green-500/10 hover:bg-green-500/20",
    badge: "bg-green-600 text-white",
    dot: "bg-green-600",
  },
  occupied: {
    label: "Occupied",
    card: "border-red-600/50 bg-red-500/10 hover:bg-red-500/20",
    badge: "bg-red-600 text-white",
    dot: "bg-red-600",
  },
  dirty: {
    label: "Dirty",
    card: "border-amber-500/60 bg-amber-400/15 hover:bg-amber-400/25",
    badge: "bg-amber-500 text-black",
    dot: "bg-amber-500",
  },
};
