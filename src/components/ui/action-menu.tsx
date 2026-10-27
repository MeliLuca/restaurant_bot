"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Red text, for actions that remove something */
  destructive?: boolean;
}

interface ActionMenuProps {
  /** The button content (usually an icon such as MoreHorizontal) */
  trigger: ReactNode;
  /** Accessible name of the trigger button */
  label: string;
  items: ActionMenuItem[];
  /** Open above the trigger (footer) or below it (header) */
  side?: "top" | "bottom";
  align?: "start" | "end";
  disabled?: boolean;
  triggerClassName?: string;
}

/** A small "⋯" menu for actions that are used rarely: tap to open, tap an
 * entry or anywhere else to close. Entries are 44px tall for touch. */
export function ActionMenu({
  trigger,
  label,
  items,
  side = "bottom",
  align = "end",
  disabled,
  triggerClassName,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = items.filter(Boolean);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || visible.length === 0}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50",
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 min-w-52 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {visible.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "flex h-11 w-full items-center gap-2 rounded-sm px-3 text-left text-sm hover:bg-accent disabled:opacity-50",
                item.destructive && "text-destructive",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
