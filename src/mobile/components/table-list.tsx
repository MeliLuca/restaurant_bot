"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Link2, Map as MapIcon, Search, Users, X } from "lucide-react";
import { FloorMapView } from "@/components/floor-map/floor-map-view";
import { useFloorData } from "@/hooks/use-floor-data";
import { useT } from "@/lib/i18n/use-translation";
import { STATUS_CONFIG, displayStatus } from "@/lib/floor/status";
import { linkedNamesByTable } from "@/lib/floor/links";
import {
  readStoredView,
  storeView,
  type FloorView,
} from "@/lib/floor/view-pref";
import type { FloorMap, RestaurantTable } from "@/lib/database.types";
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
  const router = useRouter();
  const { tables, openOrders, links, maps, loading, error } = useFloorData();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [storedView, setStoredView] = useState<FloorView | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  useEffect(() => setStoredView(readStoredView()), []);
  // Same per-device choice as the desktop Sala: map by default when one exists.
  const view: FloorView = maps.length === 0 ? "grid" : (storedView ?? "map");
  const activeMap = maps.find((m) => m.id === activeMapId) ?? maps[0] ?? null;

  function chooseView(v: FloorView) {
    setStoredView(v);
    storeView(v);
  }

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

  // the map's split badges want the split labels, not just a count
  const splitsByTable = useMemo(() => {
    const m = new Map<string, (string | null)[]>();
    for (const o of openOrders) {
      if (!o.table_id) continue;
      m.set(o.table_id, [...(m.get(o.table_id) ?? []), o.subtable]);
    }
    return m;
  }, [openOrders]);

  const linkedByTable = useMemo(
    () =>
      linkedNamesByTable(links, new Map(tables.map((tb) => [tb.id, tb.name]))),
    [links, tables],
  );

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
            {maps.length > 0 && (
              <button
                type="button"
                aria-label={t(view === "map" ? "m.showList" : "m.showMap")}
                onClick={() => chooseView(view === "map" ? "grid" : "map")}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              >
                {view === "map" ? (
                  <LayoutGrid className="h-5 w-5" />
                ) : (
                  <MapIcon className="h-5 w-5" />
                )}
              </button>
            )}
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

      {view === "map" && activeMap ? (
        <MapPane
          maps={maps}
          activeMapId={activeMap.id}
          onPickMap={setActiveMapId}
          tables={tables}
          visibleIds={new Set(visible.map((tb) => tb.id))}
          splitsByTable={splitsByTable}
          linkedByTable={linkedByTable}
          loading={loading}
          error={error}
          onOpen={(id) => router.push(mRoutes.table(id))}
        />
      ) : (
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
            const linked = linkedByTable.get(table.id);
            const status =
              STATUS_CONFIG[displayStatus(table.status, (open?.splits ?? 0) > 0)];
            return (
              <Link
                key={table.id}
                href={mRoutes.table(table.id)}
                className={cn(
                  "relative flex min-h-[104px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 transition-colors",
                  status.card,
                )}
              >
                {linked && (
                  <span
                    aria-label={`${t("links.badgeAria")}: ${linked.join(", ")}`}
                    className="absolute right-1.5 top-1.5 flex max-w-[60%] items-center gap-0.5 rounded-full bg-background/80 px-1.5 py-px text-[11px] font-semibold text-foreground/80"
                  >
                    <Link2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{linked.join(", ")}</span>
                  </span>
                )}
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
      )}
    </>
  );
}

/** Read-only drawn map for phones: tap a table to open it, pinch to zoom. */
function MapPane({
  maps,
  activeMapId,
  onPickMap,
  tables,
  visibleIds,
  splitsByTable,
  linkedByTable,
  loading,
  error,
  onOpen,
}: {
  maps: FloorMap[];
  activeMapId: string;
  onPickMap: (id: string) => void;
  tables: RestaurantTable[];
  visibleIds: Set<string>;
  splitsByTable: Map<string, (string | null)[]>;
  linkedByTable: Map<string, string[]>;
  loading: boolean;
  error: string | null;
  onOpen: (tableId: string) => void;
}) {
  const t = useT();
  const map = maps.find((m) => m.id === activeMapId)!;
  const onMap = tables.filter((tb) => tb.map_id === map.id);
  const offMap = tables.filter(
    (tb) =>
      visibleIds.has(tb.id) &&
      (tb.map_id === null || !maps.some((m) => m.id === tb.map_id)),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      {error && <p className="p-2 text-sm text-destructive">{t("m.loadFailed")}</p>}
      {loading && <p className="p-2 text-muted-foreground">{t("common.loading")}</p>}
      <FloorMapView
        map={map}
        tables={onMap}
        splitsByTable={splitsByTable}
        linkedByTable={linkedByTable}
        dimmed={new Set(onMap.filter((tb) => !visibleIds.has(tb.id)).map((tb) => tb.id))}
        onSelect={(tb) => onOpen(tb.id)}
        toolbar={
          maps.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto">
              {maps.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={m.id === map.id}
                  onClick={() => onPickMap(m.id)}
                  className={cn(
                    "flex h-10 shrink-0 items-center rounded-full border px-3 text-sm",
                    m.id === map.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )
        }
      />
      {offMap.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs text-muted-foreground">{t("floor.offMap")}</span>
          {offMap.map((tb) => (
            <Link
              key={tb.id}
              href={mRoutes.table(tb.id)}
              className="flex h-10 shrink-0 items-center rounded-full border px-3 text-sm font-semibold"
            >
              {tb.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
