"use client";

import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/constants";
import type { Category, MenuItem } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";

const MAX_RESULTS = 8;

interface ItemSearchProps {
  items: MenuItem[];
  categories: Category[];
  /** Returns true if the item was added (false e.g. when no table is selected) */
  onAdd: (item: MenuItem) => boolean;
}

export function ItemSearch({ items, categories, onAdd }: ItemSearchProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "";
  }, [categories]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [items, query]);

  function handlePick(item: MenuItem) {
    if (onAdd(item)) {
      setQuery("");
      setOpen(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
        placeholder={t("pos.searchMenuItems")}
        className="h-12 pl-10 pr-10 text-base"
        role="combobox"
        aria-expanded={open && query.trim().length > 0}
        aria-label={t("pos.searchMenuItemsAria")}
      />
      {query && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("pos.clearSearch")}
          className="absolute right-1 top-1/2 h-10 w-10 -translate-y-1/2 text-muted-foreground"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md">
          {matches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {t("pos.noItemsMatch", { query: query.trim() })}
            </p>
          ) : (
            <ul role="listbox" aria-label={t("pos.matchingMenuItems")}>
              {matches.map((i) => (
                <li key={i.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    // mousedown fires before the input's blur closes the list
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handlePick(i);
                    }}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {i.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {categoryName(i.category_id)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {formatMoney(i.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
