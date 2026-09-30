"use client";

// The floor itself: the drawn map of one room (with the room switcher) or the
// grid of cards, plus the tables no map places.

import type { ReactNode } from "react";
import { CalendarOff } from "lucide-react";
import { FloorMapView, type TableMark } from "@/components/floor-map/floor-map-view";
import { TableCard, type TableCardBooking } from "@/components/floor-plan/table-card";
import type { FloorMap, RestaurantTable } from "@/lib/database.types";
import type { FloorView } from "@/lib/floor/view-pref";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { cn } from "@/lib/utils";

export function FloorCanvas({
  view,
  loading,
  maps,
  activeMap,
  onActiveMap,
  mapTables,
  visibleTables,
  dimmed,
  splitsByTable,
  linkedByTable,
  onSelect,
  neutral,
  marks,
  underlay,
  timeControl,
  banner,
  bookingChip,
}: {
  view: FloorView;
  loading: boolean;
  maps: FloorMap[];
  activeMap: FloorMap | null;
  onActiveMap: (id: string) => void;
  /** Every table drawn on the active map */
  mapTables: TableWithTags[];
  /** The tables the filters let through */
  visibleTables: TableWithTags[];
  /** On the map: tables the filters leave out (drawn faded, not hidden) */
  dimmed: Set<string>;
  splitsByTable: Map<string, (string | null)[]>;
  linkedByTable: Map<string, string[]>;
  onSelect: (table: RestaurantTable) => void;
  /** Map only: grey every table (looking at a later time) */
  neutral?: boolean;
  marks?: Map<string, TableMark>;
  underlay?: ReactNode;
  /** Beside the room switcher (Gestione Sala Smart: "Adesso / 20:30") */
  timeControl?: ReactNode;
  /** Above the map ("you are looking at 20:30") */
  banner?: ReactNode;
  /** Grid only: the party booked on a table */
  bookingChip?: (tableId: string) => TableCardBooking | undefined;
}) {
  const t = useT();
  // Tables no map places (new ones, or a map was deleted) stay reachable.
  const offMapTables = visibleTables.filter(
    (tb) => tb.map_id === null || !maps.some((m) => m.id === tb.map_id),
  );

  if (view === "map" && activeMap) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {banner}
        <div className="min-h-[320px] flex-1">
          <FloorMapView
            map={activeMap}
            tables={mapTables}
            splitsByTable={splitsByTable}
            linkedByTable={linkedByTable}
            dimmed={dimmed}
            onSelect={onSelect}
            neutral={neutral}
            marks={marks}
            underlay={underlay}
            toolbar={
              (maps.length > 1 || timeControl) && (
                <div className="flex flex-wrap items-center gap-2">
                  {timeControl}
                  {maps.length > 1 &&
                    maps.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={m.id === activeMap.id}
                        onClick={() => onActiveMap(m.id)}
                        title={m.bookable ? undefined : t("floor.roomNotBookable")}
                        className={cn(
                          "flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                          m.id === activeMap.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {m.name}
                        {!m.bookable && (
                          <>
                            <CalendarOff className="h-3.5 w-3.5" aria-hidden />
                            <span className="sr-only">{t("floor.roomNotBookable")}</span>
                          </>
                        )}
                      </button>
                    ))}
                </div>
              )
            }
          />
        </div>
        {offMapTables.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t("floor.offMap")}</h2>
            <div className="flex gap-4 overflow-x-auto pb-1">
              {offMapTables.map((tb) => (
                <TableCard
                  key={tb.id}
                  table={tb}
                  splits={splitsByTable.get(tb.id) ?? []}
                  linkedTo={linkedByTable.get(tb.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {loading ? (
        <div className="flex flex-wrap content-start gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-36 w-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visibleTables.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t("floor.noTablesMatch")}</p>
      ) : (
        <div className="flex flex-wrap content-start gap-4">
          {visibleTables.map((tb) => (
            <TableCard
              key={tb.id}
              table={tb}
              splits={splitsByTable.get(tb.id) ?? []}
              linkedTo={linkedByTable.get(tb.id)}
              onSelect={onSelect}
              booking={bookingChip?.(tb.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
