"use client";

import { useMemo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import { useTimeFormat } from "@/components/reservations/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Reservation, TableLink } from "@/lib/database.types";
import type { Geom } from "@/lib/floor/geometry";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { toFloorTable } from "@/lib/smart-floor/context";
import { hullPath } from "@/lib/smart-floor/hull";
import {
  floorOverlay,
  type FloorGroup,
  type FloorSpot,
} from "@/lib/smart-floor/overlay";
import { rulesFrom } from "@/lib/smart-floor/types";
import { cn } from "@/lib/utils";
import { useSmartFloor } from "@/stores/smart-floor-store";

const MINUTE = 60_000;
const STEP = 15 * MINUTE;
/** Map units between a party's tables and the outline drawn around them */
const HULL_PAD = 9;
const NAME_MAX = 14;

const HULL_STYLE: Record<FloorGroup["kind"], string> = {
  soon: "fill-violet-500/10 stroke-violet-500",
  seated: "fill-violet-500/10 stroke-violet-500",
  late: "fill-fuchsia-500/10 stroke-fuchsia-500",
  overdue: "fill-fuchsia-500/15 stroke-fuchsia-600",
  linked: "fill-zinc-500/10 stroke-zinc-500",
};

function shortName(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

/** "20:30 Rossi (4)", "+12'" when late, "⚠" when its table is still taken */
export function spotLabel(spot: FloorSpot, time: (d: string) => string): string {
  const r = spot.reservation;
  const late =
    spot.kind === "late" || spot.kind === "overdue" ? ` +${spot.lateMinutes}'` : "";
  return `${spot.blocked ? "⚠ " : ""}${time(r.reserved_at)} ${shortName(r.customer_name)} (${r.party_size})${late}`;
}

interface LayerInput {
  tables: TableWithTags[];
  reservations: Reservation[];
  links: TableLink[];
  /** Tables of the map on screen (outlines are drawn for those only) */
  mapTableIds: Set<string>;
  now: number;
  at: number | null;
}

/**
 * Gestione Sala Smart over the Sala map: booked parties on their tables
 * (violet border = due within two hours, fuchsia = late), outlines around
 * pushed-together tables, and the floor as expected at a time picked ahead.
 * Inactive (all undefined) while the module is off.
 */
export function useSmartFloorLayer({
  tables,
  reservations,
  links,
  mapTableIds,
  now,
  at,
}: LayerInput): {
  active: boolean;
  spots: Map<string, FloorSpot>;
  marks?: Map<string, TableMark>;
  underlay?: ReactNode;
} {
  const { settings, enabled } = useSmartFloor();
  const time = useTimeFormat();
  const floorTables = useMemo(() => tables.map(toFloorTable), [tables]);

  const overlay = useMemo(
    () =>
      enabled && settings
        ? floorOverlay({
            tables: floorTables,
            reservations,
            links,
            rules: rulesFrom(settings),
            lateAfterMinutes: settings.late_after_minutes,
            occupiedWarnMinutes: settings.occupied_warn_minutes,
            now,
            at,
          })
        : null,
    [enabled, settings, floorTables, reservations, links, now, at],
  );

  if (!overlay) return { active: false, spots: new Map() };

  const marks = new Map<string, TableMark>();
  overlay.busy.forEach((id) => marks.set(id, { tone: "held" }));
  overlay.spots.forEach((spot, id) => {
    const label = spot.labelled ? spotLabel(spot, time) : undefined;
    switch (spot.kind) {
      case "late":
      case "overdue":
        marks.set(id, { tone: spot.kind, label });
        break;
      case "seated":
        marks.set(id, { tone: "picked", label });
        break;
      case "soon":
        marks.set(id, { ...marks.get(id), ring: true, label });
        break;
    }
  });

  const geomById = new Map(floorTables.map((ft) => [ft.id, ft.geom]));
  const underlay = (
    <g aria-hidden className="pointer-events-none">
      {overlay.groups
        .filter((g) => g.tableIds.every((id) => mapTableIds.has(id)))
        .map((g) => {
          const geoms = g.tableIds
            .map((id) => geomById.get(id))
            .filter((x): x is Geom => !!x);
          return (
            <path
              key={g.key}
              d={hullPath(geoms, HULL_PAD)}
              strokeWidth={2}
              strokeDasharray="7 4"
              strokeLinejoin="round"
              className={HULL_STYLE[g.kind]}
            />
          );
        })}
    </g>
  );

  return { active: true, spots: overlay.spots, marks, underlay };
}

/** Midnight after `now`, minus one step: the last time worth looking at */
function lastSlot(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime() - STEP;
}

/**
 * "Adesso" or a time later today, in 15-minute steps: the Sala map shows the
 * floor as expected then.
 */
export function TimeControl({
  at,
  now,
  onChange,
}: {
  at: number | null;
  now: number;
  onChange: (at: number | null) => void;
}) {
  const t = useT();
  const time = useTimeFormat();
  const nextSlot = Math.ceil((now + 1) / STEP) * STEP;
  const shown = at ?? now;

  function set(next: number) {
    onChange(next <= now ? null : Math.min(next, lastSlot(now)));
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t("smartFloor.viewAt")}>
      <button
        type="button"
        aria-pressed={at === null}
        onClick={() => onChange(null)}
        className={cn(
          "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
          at === null
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent",
        )}
      >
        {t("smartFloor.now")}
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={t("smartFloor.earlier")}
        disabled={at === null}
        onClick={() => at !== null && set(at - STEP)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="time"
        step={900}
        className={cn("h-9 w-[6.5rem]", at === null && "text-muted-foreground")}
        aria-label={t("smartFloor.viewAt")}
        value={time(shown)}
        onChange={(e) => {
          const [h, m] = e.target.value.split(":").map(Number);
          if (Number.isNaN(h) || Number.isNaN(m)) return;
          const d = new Date(now);
          d.setHours(h, m, 0, 0);
          set(d.getTime());
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={t("smartFloor.later")}
        disabled={at !== null && at >= lastSlot(now)}
        onClick={() => set(at === null ? nextSlot : at + STEP)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
