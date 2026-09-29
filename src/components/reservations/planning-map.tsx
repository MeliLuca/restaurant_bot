"use client";

import { useEffect, type ReactNode } from "react";
import {
  FloorMapView,
  type TableMark,
} from "@/components/floor-map/floor-map-view";
import type { FloorMap, RestaurantTable } from "@/lib/database.types";
import { bookableMaps } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const NO_SPLITS = new Map<string, (string | null)[]>();
const NO_LINKS = new Map<string, string[]>();
const NOTHING_DIMMED = new Set<string>();

interface PlanningMapProps {
  maps: FloorMap[];
  tables: RestaurantTable[];
  activeMapId: string | null;
  onActiveMapChange: (id: string) => void;
  marks: Map<string, TableMark>;
  /** Bring the room holding these tables into view when they change */
  focusTableIds?: string[];
  onTableClick?: (table: RestaurantTable) => void;
  /** Shown above the map, left of the room picker */
  header?: ReactNode;
}

/**
 * The floor map as Gestione Sala Smart draws it while planning: no live
 * status colours (the time planned for is not now), only the marks. Rooms
 * closed to bookings aren't offered; one shows only while a booking there
 * is in focus.
 */
export function PlanningMap({
  maps,
  tables,
  activeMapId,
  onActiveMapChange,
  marks,
  focusTableIds,
  onTableClick,
  header,
}: PlanningMapProps) {
  const t = useT();
  const active =
    maps.find((m) => m.id === activeMapId) ?? bookableMaps(maps)[0] ?? maps[0] ?? null;
  const rooms = bookableMaps(maps, active?.id ?? null);

  const focusKey = (focusTableIds ?? []).join(",");
  useEffect(() => {
    if (!focusKey) return;
    const first = tables.find((tb) => tb.id === focusKey.split(",")[0]);
    if (first?.map_id && first.map_id !== active?.id) onActiveMapChange(first.map_id);
    // only when the focus changes, not when the user picks another room
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border text-sm text-muted-foreground">
        {t("reservations.noMaps")}
      </div>
    );
  }

  return (
    <FloorMapView
      map={active}
      tables={tables.filter((tb) => tb.map_id === active.id)}
      splitsByTable={NO_SPLITS}
      linkedByTable={NO_LINKS}
      dimmed={NOTHING_DIMMED}
      neutral
      marks={marks}
      onSelect={(tb) => onTableClick?.(tb)}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {header}
          {rooms.length > 1 &&
            rooms.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === active.id}
                onClick={() => onActiveMapChange(m.id)}
                className={cn(
                  "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
                  m.id === active.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {m.bookable ? m.name : t("reservations.roomClosed", { room: m.name })}
              </button>
            ))}
        </div>
      }
    />
  );
}
