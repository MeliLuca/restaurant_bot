"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchOpenDineInOrders } from "@/lib/api";
import type { Order, RestaurantTable } from "@/lib/database.types";
import { STATUS_CONFIG, displayStatus } from "@/lib/floor/status";
import { useT } from "@/lib/i18n/use-translation";
import type { TicketMode } from "@/stores/ticket-store";
import { cn } from "@/lib/utils";
import { TakeawayPicker } from "./takeaway-picker";

interface TablePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab shown on open: the mode the ticket is in */
  initialTab: TicketMode;
  tables: RestaurantTable[];
  currentTableId: string | null;
  onPickTable: (table: RestaurantTable) => void;
  openTakeaways: Order[];
  savedLabels: string[];
  onPickTakeaway: (order: Order) => void;
  onStartNewTakeaway: (name: string) => void;
  onAddToExistingTakeaway: (parent: Order) => void;
}

const byName = (a: RestaurantTable, b: RestaurantTable) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** Who the ticket is for, as a full-screen-ish choice: a grid of table cards
 * (open ones first, coloured like the Sala) or the take-away picker. Each
 * pick closes the dialog; the caller sets the target. */
export function TablePicker({
  open,
  onOpenChange,
  initialTab,
  tables,
  currentTableId,
  onPickTable,
  openTakeaways,
  savedLabels,
  onPickTakeaway,
  onStartNewTakeaway,
  onAddToExistingTakeaway,
}: TablePickerProps) {
  const t = useT();
  const [tab, setTab] = useState<TicketMode>(initialTab);
  const [query, setQuery] = useState("");
  // Open dine-in splits per table, read when the picker opens: it turns an
  // occupied table red ("ordered") like the Sala, and lists its sub-bills.
  const [splitsByTable, setSplitsByTable] = useState<
    Map<string, (string | null)[]>
  >(new Map());

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setQuery("");
    let alive = true;
    // Best effort: without it the cards fall back to the stored status.
    void fetchOpenDineInOrders()
      .then((orders) => {
        if (!alive) return;
        const map = new Map<string, (string | null)[]>();
        for (const o of orders) {
          if (!o.table_id) continue;
          map.set(o.table_id, [...(map.get(o.table_id) ?? []), o.subtable]);
        }
        setSplitsByTable(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, initialTab]);

  const { openList, otherList, matches } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? tables.filter((tb) => tb.name.toLowerCase().includes(q))
      : tables;
    const isOpen = (tb: RestaurantTable) =>
      tb.status === "occupied" || splitsByTable.has(tb.id);
    // Tables with an order, then seated ones, then the rest by name.
    const rank = (tb: RestaurantTable) => (splitsByTable.has(tb.id) ? 0 : 1);
    const openList = matches
      .filter(isOpen)
      .sort((a, b) => rank(a) - rank(b) || byName(a, b));
    const otherList = matches.filter((tb) => !isOpen(tb)).sort(byName);
    return { openList, otherList, matches };
  }, [tables, query, splitsByTable]);

  function pickTable(tb: RestaurantTable) {
    onPickTable(tb);
    onOpenChange(false);
  }

  // Enter picks the exact name ("12"), or the only table left.
  function pickFromQuery() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = matches.find((tb) => tb.name.toLowerCase() === q);
    if (exact) pickTable(exact);
    else if (matches.length === 1) pickTable(matches[0]);
  }

  function renderCard(tb: RestaurantTable) {
    const splits = splitsByTable.get(tb.id) ?? [];
    const status = STATUS_CONFIG[displayStatus(tb.status, splits.length > 0)];
    const current = tb.id === currentTableId;
    return (
      <button
        key={tb.id}
        type="button"
        onClick={() => pickTable(tb)}
        aria-current={current || undefined}
        className={cn(
          "flex h-24 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          status.card,
          current && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <span className="max-w-full truncate text-xl font-bold leading-tight">
          {tb.name}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="flex items-center gap-0.5"
            aria-label={t("cassa.header.seatsAria", { count: tb.capacity })}
          >
            <Users className="h-3.5 w-3.5" />
            {tb.capacity}
          </span>
          <span className={cn("h-2 w-2 rounded-full", status.dot)} />
          <span className="truncate">
            {current ? t("cassa.header.current") : t(status.labelKey)}
          </span>
        </span>
        {splits.some((s) => s !== null) && (
          <span className="max-w-full truncate text-[10px] text-foreground/70">
            {splits.map((s) => (s === null ? tb.name : `${tb.name}/${s}`)).join(" · ")}
          </span>
        )}
      </button>
    );
  }

  const grid = "grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{t("cassa.header.pickerTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("cassa.header.pickerDescription")}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TicketMode)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="grid h-12 w-full grid-cols-2">
            <TabsTrigger value="table" className="h-10 text-base">
              {t("cassa.header.tabTables")}
            </TabsTrigger>
            <TabsTrigger value="takeaway" className="h-10 text-base">
              {t("cassa.header.tabTakeaway")}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="table"
            className="mt-0 flex min-h-0 flex-1 flex-col gap-3 data-[state=inactive]:hidden"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    pickFromQuery();
                  }
                }}
                placeholder={t("cassa.header.searchTables")}
                aria-label={t("cassa.header.searchTablesAria")}
                className="h-11 pl-10 text-base"
                inputMode="search"
              />
            </div>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
              {matches.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("cassa.header.noTablesMatch")}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {openList.length > 0 && (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("cassa.header.openTables")}
                      </h3>
                      <div className={grid}>{openList.map(renderCard)}</div>
                    </section>
                  )}
                  {otherList.length > 0 && (
                    <section className="flex flex-col gap-2">
                      {openList.length > 0 && (
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("cassa.header.otherTables")}
                        </h3>
                      )}
                      <div className={grid}>{otherList.map(renderCard)}</div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          {/* min height leaves room for the picker's dropdown list */}
          <TabsContent
            value="takeaway"
            className="mt-0 min-h-[50dvh] data-[state=inactive]:hidden"
          >
            <TakeawayPicker
              openOrders={openTakeaways}
              savedLabels={savedLabels}
              onPickExisting={(o) => {
                onPickTakeaway(o);
                onOpenChange(false);
              }}
              onStartNew={(name) => {
                onStartNewTakeaway(name);
                onOpenChange(false);
              }}
              onAddToExisting={(o) => {
                onAddToExistingTakeaway(o);
                onOpenChange(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
