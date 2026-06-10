"use client";

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/database.types";
import { STATUS_CONFIG } from "./status";

interface TableCardProps {
  table: RestaurantTable;
  onSelect: (table: RestaurantTable) => void;
}

export function TableCard({ table, onSelect }: TableCardProps) {
  const status = STATUS_CONFIG[table.status];

  return (
    <button
      type="button"
      onClick={() => onSelect(table)}
      className={cn(
        "flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-4 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        status.card,
      )}
    >
      <span className="text-2xl font-bold">{table.name}</span>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        {table.capacity}
      </span>
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-semibold",
          status.badge,
        )}
      >
        {status.label}
      </span>
    </button>
  );
}
