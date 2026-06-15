"use client";

import { useMemo, useState } from "react";
import { ShoppingBag, Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/constants";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

interface TakeawayPickerProps {
  openOrders: Order[];
  /** Reusable customer-name labels offered as quick-picks */
  savedLabels?: string[];
  onPickExisting: (order: Order) => void;
  onStartNew: (name: string) => void;
}

export function TakeawayPicker({
  openOrders,
  savedLabels = [],
  onPickExisting,
  onStartNew,
}: TakeawayPickerProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return openOrders;
    return openOrders.filter((o) =>
      (o.customer_name ?? "").toLowerCase().includes(q),
    );
  }, [openOrders, query]);

  // Saved labels matching the query (or all when empty), capped for the list.
  const labelMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? savedLabels.filter((l) => l.toLowerCase().includes(q))
      : savedLabels;
    return list.slice(0, 8);
  }, [savedLabels, query]);

  function pick(order: Order) {
    onPickExisting(order);
    setQuery("");
    setOpen(false);
  }

  function pickLabel(name: string) {
    onStartNew(name);
    setQuery("");
    setOpen(false);
  }

  function startNew() {
    const name = query.trim();
    if (!name) return;
    onStartNew(name);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-6 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startNew();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={t("pos.customerNamePlaceholder")}
        className="h-12 pl-10 text-base"
        aria-label={t("pos.searchTakeawayAria")}
      />

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md">
          {matches.length > 0 && (
            <ul role="listbox" aria-label={t("pos.openTakeawayOrdersAria")}>
              {matches.map((o) => (
                <li key={o.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o);
                    }}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {o.customer_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("pos.openedAt", {
                            time: TIME_FORMATTER.format(new Date(o.opened_at)),
                          })}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {formatMoney(o.total)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {labelMatches.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t p-3">
              {labelMatches.map((l) => (
                <button
                  key={l}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickLabel(l);
                  }}
                  className="flex h-9 items-center rounded-full border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          {query.trim() ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                startNew();
              }}
              className="flex min-h-12 w-full items-center gap-2 border-t px-4 py-2 text-left font-medium text-primary transition-colors hover:bg-accent"
            >
              <Plus className="h-4 w-4" />{" "}
              {t("pos.newTakeawayFor", { query: query.trim() })}
            </button>
          ) : (
            matches.length === 0 &&
            labelMatches.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {t("pos.noTakeawayType")}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
