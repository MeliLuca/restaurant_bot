"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** closed, open on the list, or open straight on the new-split name field */
export type SplitMenuState = "closed" | "list" | "add";

interface SplitPickerProps {
  tableName: string;
  /** Open orders on the selected table — one per split */
  openSplits: Order[];
  /** Currently selected split (null = whole table) */
  subtable: string | null;
  onSelect: (subtable: string | null) => void;
  /** Optional control of the dropdown, so "Nuovo sottoconto" elsewhere (the
   * ⋯ menu) can open it on the name field; uncontrolled when omitted */
  menu?: SplitMenuState;
  onMenuChange?: (menu: SplitMenuState) => void;
}

/** Compact sub-bill switcher: a "Tutto il tavolo ▾" chip whose dropdown
 * lists the table's splits and creates a new one. A new split is only a
 * label until its first send creates the order. */
export function SplitPicker({
  tableName,
  openSplits,
  subtable,
  onSelect,
  menu: menuProp,
  onMenuChange,
}: SplitPickerProps) {
  const t = useT();
  const [ownMenu, setOwnMenu] = useState<SplitMenuState>("closed");
  const menu = menuProp ?? ownMenu;
  const setMenu = onMenuChange ?? setOwnMenu;
  const [label, setLabel] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const existing = openSplits
    .map((o) => o.subtable)
    .filter((s): s is string => s !== null);
  // include the selected split even before its first send creates the order
  const labels =
    subtable && !existing.includes(subtable)
      ? [...existing, subtable]
      : existing;

  // Close on a tap outside or Escape, like ActionMenu.
  useEffect(() => {
    if (menu === "closed") return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenu("closed");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu("closed");
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, setMenu]);

  function pick(s: string | null) {
    onSelect(s);
    setMenu("closed");
  }

  function addSplit() {
    const name = label.trim();
    if (!name) return;
    setLabel("");
    pick(name);
  }

  const current = subtable === null ? t("pos.wholeTable") : `${tableName}/${subtable}`;

  const rowClass =
    "flex h-11 w-full items-center gap-2 rounded-sm px-3 text-left text-sm hover:bg-accent";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu !== "closed"}
        aria-label={t("cassa.header.subBillsAria")}
        onClick={() => setMenu(menu === "closed" ? "list" : "closed")}
        className={cn(
          "flex h-11 max-w-[11rem] items-center gap-1 rounded-full border px-3 text-sm font-medium hover:bg-accent",
          subtable !== null && "border-primary bg-primary/10 text-primary",
        )}
      >
        <span className="truncate">{current}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {menu !== "closed" && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 min-w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {[null, ...labels].map((s) => (
            <button
              key={s ?? "__whole"}
              type="button"
              role="menuitemradio"
              aria-checked={subtable === s}
              onClick={() => pick(s)}
              className={cn(rowClass, subtable === s && "font-semibold")}
            >
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  subtable === s ? "opacity-100" : "opacity-0",
                )}
              />
              {s === null ? t("pos.wholeTable") : `${tableName}/${s}`}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          {menu === "add" ? (
            <div className="flex items-center gap-1 p-1">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSplit();
                  }
                }}
                placeholder={t("pos.newSplitPlaceholder")}
                className="h-11 w-32"
                autoFocus
                aria-label={t("pos.newSplitNameAria")}
              />
              <Button type="button" className="h-11" onClick={addSplit}>
                {t("common.add")}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setMenu("add")}
              className={cn(rowClass, "text-primary")}
            >
              <Plus className="h-4 w-4 shrink-0" />
              {t("cassa.header.newSplit")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
