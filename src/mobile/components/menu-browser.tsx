"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import type { Category, MenuItem } from "@/lib/database.types";

/**
 * Menu browsing, phone-shaped.
 *
 * Two deliberate departures from the desktop panel, which are the whole point
 * of this screen: categories scroll horizontally in ONE row instead of
 * wrapping into a block (the real listino has 17 of them, which filled over
 * half a phone screen before a single dish was visible), and items are
 * full-width rows rather than a 2-column grid, so long names like
 * "Hoegaarden Blanche — cl 0,25" wrap instead of truncating mid-word.
 */
export function MenuBrowser({
  categories,
  items,
  onAdd,
}: {
  categories: Category[];
  items: MenuItem[];
  onAdd: (item: MenuItem) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const activeCategory = categoryId ?? categories[0]?.id ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // searching spans the whole menu, not just the open category — and matches
    // codice as well as name, same as the desktop ItemSearch
    if (q) {
      return items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.codice?.toLowerCase().includes(q) ?? false),
      );
    }
    return items.filter((i) => i.category_id === activeCategory);
  }, [items, query, activeCategory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 border-b bg-card px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          {/* text-base keeps iOS from zooming the page on focus */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("pos.searchMenuItems")}
            className="h-12 w-full rounded-lg border bg-background pl-10 pr-10 text-base outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button
              type="button"
              aria-label={t("pos.clearSearch")}
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {!query && (
        <div className="flex gap-2 overflow-x-auto border-b bg-card px-3 py-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
                c.id === activeCategory
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
        {visible.length === 0 && (
          <li className="p-4 text-muted-foreground">{t("m.noItemsFound")}</li>
        )}
        {visible.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onAdd(item)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-accent"
            >
              <span className="min-w-0 flex-1 text-base leading-snug">
                {item.name}
              </span>
              <span className="shrink-0 text-base font-semibold tabular-nums">
                {formatMoney(item.price)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
