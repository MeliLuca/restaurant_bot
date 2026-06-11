"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Order } from "@/lib/database.types";
import { cn } from "@/lib/utils";

interface SplitPickerProps {
  tableName: string;
  /** Open orders on the selected table — one per split */
  openSplits: Order[];
  /** Currently selected split (null = whole table) */
  subtable: string | null;
  onSelect: (subtable: string | null) => void;
}

export function SplitPicker({
  tableName,
  openSplits,
  subtable,
  onSelect,
}: SplitPickerProps) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  const existing = openSplits
    .map((o) => o.subtable)
    .filter((s): s is string => s !== null);
  // include the selected split even before its first send creates the order
  const labels =
    subtable && !existing.includes(subtable)
      ? [...existing, subtable]
      : existing;

  function addSplit() {
    const name = label.trim();
    if (!name) return;
    onSelect(name);
    setLabel("");
    setAdding(false);
  }

  const chipClass = (active: boolean) =>
    cn(
      "flex min-h-10 items-center rounded-full border px-3 text-sm font-medium transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent",
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={chipClass(subtable === null)}
        onClick={() => onSelect(null)}
      >
        Whole table
      </button>
      {labels.map((s) => (
        <button
          key={s}
          type="button"
          className={chipClass(subtable === s)}
          onClick={() => onSelect(s)}
        >
          {tableName}/{s}
        </button>
      ))}
      {adding ? (
        <div className="flex items-center gap-1">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSplit();
              }
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="1, 2, Gino…"
            className="h-10 w-28"
            autoFocus
            aria-label="New split name"
          />
          <Button type="button" size="sm" className="h-10" onClick={addSplit}>
            Add
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className={chipClass(false)}
          aria-label="Add split"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-4 w-4" /> Split
        </button>
      )}
    </div>
  );
}
