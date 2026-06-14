"use client";

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/database.types";
import { STATUS_CONFIG, displayStatus } from "./status";

interface TableCardProps {
  table: RestaurantTable;
  /** Labels of this table's open orders: split names, null = whole table */
  splits: (string | null)[];
  onSelect: (table: RestaurantTable) => void;
}

/** Max split chips shown before collapsing the rest into an "…" chip */
const MAX_SPLIT_CHIPS = 2;

export function TableCard({ table, splits, onSelect }: TableCardProps) {
  // An occupied table with an open order reads as "ordered" (red).
  const status = STATUS_CONFIG[displayStatus(table.status, splits.length > 0)];
  const visibleSplits = splits.slice(0, MAX_SPLIT_CHIPS);
  const hiddenCount = splits.length - visibleSplits.length;

  return (
    <button
      type="button"
      onClick={() => onSelect(table)}
      className={cn(
        "flex h-36 w-36 shrink-0 grow-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 p-3 transition-colors",
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
      {splits.length > 0 && (
        <span className="flex max-w-full items-center justify-center gap-1 overflow-hidden whitespace-nowrap">
          {visibleSplits.map((s, i) => (
            <span
              key={`${s ?? "whole"}-${i}`}
              className="max-w-[3.25rem] truncate rounded-full border border-foreground/20 bg-background/60 px-1.5 py-px text-[10px] font-medium text-foreground/80"
            >
              {s === null ? table.name : `${table.name}/${s}`}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="shrink-0 rounded-full border border-foreground/20 bg-background/60 px-1.5 py-px text-[10px] font-medium text-foreground/80">
              …
            </span>
          )}
        </span>
      )}
    </button>
  );
}
