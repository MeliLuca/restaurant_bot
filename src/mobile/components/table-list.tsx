"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users, X } from "lucide-react";
import { useFloorData } from "@/hooks/use-floor-data";
import { useT } from "@/lib/i18n/use-translation";
import { STATUS_CONFIG, displayStatus } from "@/lib/floor/status";
import { cn } from "@/lib/utils";
import { mRoutes } from "@/mobile/lib/routes";
import { MHeader, DesktopSwitch } from "./m-header";

/**
 * The floor, phone-shaped.
 *
 * IMPORTANT: useFloorData() is mounted here and nowhere else in the mobile
 * tree. It hard-codes the realtime channel name "floor-data", and
 * RealtimeClient.channel() returns the *existing* channel for a repeated
 * topic — so a second concurrent mount would share one object, and whichever
 * unmounted first would tear down realtime for the other, silently degrading
 * it to the 15s poll. Never mount this in src/app/m/layout.tsx.
 */
export function TableList() {
  const t = useT();
  const { tables, openOrders, loading, error } = useFloorData();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  // split labels + running total per table, from the open orders
  const byTable = useMemo(() => {
    const m = new Map<string, { splits: number; total: number }>();
    for (const o of openOrders) {
      if (!o.table_id) continue;
      const prev = m.get(o.table_id) ?? { splits: 0, total: 0 };
      m.set(o.table_id, {
        splits: prev.splits + 1,
        total: prev.total + o.total,
      });
    }
    return m;
  }, [openOrders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((tb) => tb.name.toLowerCase().includes(q));
  }, [tables, query]);

  return (
    <>
      <MHeader
        title={t("m.tabTables")}
        action={
          <div className="flex items-center">
            <button
              type="button"
              aria-label={t("floor.searchTables")}
              onClick={() => {
                setSearching((s) => !s);
                setQuery("");
              }}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              {searching ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </button>
            <DesktopSwitch />
          </div>
        }
      />

      {searching && (
        <div className="shrink-0 border-b bg-card px-3 pb-3">
          {/* text-base, not text-sm: iOS zooms the page on focus for anything
              under 16px, and userScalable:false makes that awkward to undo */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("floor.searchTables")}
            className="h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>
        )}
        {loading && (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        )}

        {/* four across once the phone is turned: two very wide, very short
            cards is the one layout that wastes a landscape screen */}
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        {visible.map((table) => {
          const open = byTable.get(table.id);
          const status =
            STATUS_CONFIG[displayStatus(table.status, (open?.splits ?? 0) > 0)];
          return (
            <Link
              key={table.id}
              href={mRoutes.table(table.id)}
              className={cn(
                "flex min-h-[104px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 transition-colors",
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
                {t(status.labelKey)}
              </span>
              {open && (
                <span className="text-sm font-semibold tabular-nums">
                  {open.total.toFixed(2)}
                  {open.splits > 1 && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      ×{open.splits}
                    </span>
                  )}
                </span>
              )}
            </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
