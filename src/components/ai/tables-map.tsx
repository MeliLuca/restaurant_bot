"use client";

// Assistente AI — tables: the picked option on the floor map, read only.
// Same look as the Sala's "Trova posto": green tables with a label, a dashed
// outline when they are pushed together. For a later time the live status
// colours are dropped (like the planning map): only the mark matters.

import { useEffect, useMemo, useState } from "react";
import { FloorMapView, type TableMark } from "@/components/floor-map/floor-map-view";
import type { TableSuggestion } from "@/lib/ai/contracts/tables";
import type { FloorMap } from "@/lib/database.types";
import type { Geom } from "@/lib/floor/geometry";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { toFloorTable } from "@/lib/smart-floor/context";
import { hullPath } from "@/lib/smart-floor/hull";
import { cn } from "@/lib/utils";

const NO_SPLITS = new Map<string, (string | null)[]>();
const NO_LINKS = new Map<string, string[]>();
const NOTHING_DIMMED = new Set<string>();

export function TablesMap({
  maps,
  tables,
  pick,
  label,
  neutral,
}: {
  maps: FloorMap[];
  tables: TableWithTags[];
  pick: TableSuggestion | null;
  label: string;
  /** a later time: no live status colours */
  neutral: boolean;
}) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);

  // bring the picked option's room on screen
  const pickMap = pick?.mapId ?? null;
  useEffect(() => {
    if (pickMap) setActiveId(pickMap);
  }, [pickMap]);

  const active =
    maps.find((m) => m.id === activeId) ?? maps.find((m) => m.bookable) ?? maps[0] ?? null;

  const { marks, underlay } = useMemo(() => {
    const marks = new Map<string, TableMark>();
    if (!pick) return { marks, underlay: null };
    pick.tableIds.forEach((id, i) =>
      marks.set(id, { tone: "proposed", label: i === 0 ? label : undefined }),
    );
    const geoms = pick.tableIds
      .map((id) => tables.find((tb) => tb.id === id))
      .filter((tb): tb is TableWithTags => !!tb)
      .map((tb) => toFloorTable(tb).geom)
      .filter((g): g is Geom => !!g);
    const underlay =
      geoms.length > 1 ? (
        <path
          aria-hidden
          d={hullPath(geoms, 9)}
          strokeWidth={2}
          strokeDasharray="7 4"
          strokeLinejoin="round"
          className="pointer-events-none fill-emerald-500/10 stroke-emerald-600"
        />
      ) : null;
    return { marks, underlay };
  }, [pick, tables, label]);

  if (!active) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center rounded-xl border text-sm text-muted-foreground">
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
      neutral={neutral}
      marks={marks}
      underlay={underlay}
      onSelect={() => {}}
      toolbar={
        maps.length > 1 && (
          <div role="group" aria-label={t("ai.tables.rooms")} className="flex flex-wrap gap-2">
            {maps.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === active.id}
                onClick={() => setActiveId(m.id)}
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
        )
      }
    />
  );
}
