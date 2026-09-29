"use client";

// Pieces shared by "Trova posto" and the waitlist ("coda"): the floor as the
// walk-in engine sees it, the party inputs, and how a table option reads.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, Check, Minus, Plus, TriangleAlert, Users } from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import { optionNotes, tableNamesOf, useTimeFormat } from "@/components/reservations/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchTableStatuses } from "@/lib/api";
import type {
  FloorMap,
  Order,
  Reservation,
  TableJoinRule,
  TableLink,
  TableTag,
} from "@/lib/database.types";
import type { Geom } from "@/lib/floor/geometry";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { buildFloorContext, toFloorTable } from "@/lib/smart-floor/context";
import { fetchJoinRules, fetchOpenBills } from "@/lib/smart-floor/data";
import { hullPath } from "@/lib/smart-floor/hull";
import type { Booking, FloorContext } from "@/lib/smart-floor/types";
import {
  finishingSignals,
  type FinishKind,
  type FinishSignal,
  type OpenBill,
  type WalkInOption,
} from "@/lib/smart-floor/walk-in";
import { cn } from "@/lib/utils";
import { useSmartFloor } from "@/stores/smart-floor-store";

export const MAX_PARTY = 99;

export const FINISH_KEY: Record<FinishKind, TranslationKey> = {
  preconto: "walkIn.preconto",
  dessert: "walkIn.dessert",
  overtime: "walkIn.overtime",
};

export const optionKey = (o: WalkInOption) => o.tableIds.join(",");

export const chipClass = (active: boolean) =>
  cn(
    "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "text-muted-foreground hover:bg-accent",
  );

/** A party size typed in, or null when it isn't a usable number */
export function parsePartySize(value: string): number | null {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PARTY ? n : null;
}

export interface WalkInFloor {
  ctx: FloorContext | null;
  finishing: Map<string, FinishSignal>;
  /** Table features in use, by name */
  tags: TableTag[];
}

/**
 * The floor as the walk-in engine sees it: the page's live tables and
 * bookings, plus the joinable-pair exceptions and the open bills (for
 * pre-conto and desserts), read again whenever a bill changes.
 */
export function useWalkInFloor({
  tables,
  reservations,
  links,
  openOrders,
  now,
}: {
  tables: TableWithTags[];
  reservations: Reservation[];
  links: TableLink[];
  openOrders: Order[];
  now: number;
}): WalkInFloor {
  const { settings } = useSmartFloor();
  const [joinRules, setJoinRules] = useState<TableJoinRule[] | null>(null);
  const [bills, setBills] = useState<OpenBill[] | null>(null);

  useEffect(() => {
    fetchJoinRules()
      .then(setJoinRules)
      .catch(() => setJoinRules([]));
  }, []);

  const finishingIds = settings?.finishing_category_ids.join(",") ?? "";
  useEffect(() => {
    let live = true;
    fetchOpenBills(finishingIds ? finishingIds.split(",") : [])
      .then((b) => live && setBills(b))
      .catch(() => live && setBills([]));
    return () => {
      live = false;
    };
  }, [openOrders, finishingIds]);

  const tags = useMemo(
    () =>
      Array.from(
        new Map(tables.flatMap((tb) => tb.table_tags).map((tg) => [tg.id, tg])).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [tables],
  );
  const ctx = useMemo(
    () =>
      settings && joinRules && bills
        ? buildFloorContext({ settings, tables, tags, reservations, joinRules }, now)
        : null,
    [settings, tables, tags, reservations, joinRules, bills, now],
  );
  const finishing = useMemo(
    () =>
      ctx && bills
        ? finishingSignals(Array.from(ctx.tables.values()), bills, links, ctx.rules, ctx.now)
        : new Map<string, FinishSignal>(),
    [ctx, bills, links],
  );
  return { ctx, finishing, tags };
}

/** Of these tables, the ones someone sat at a second ago (on another device) */
export async function takenMeanwhile(tableIds: string[]): Promise<string[]> {
  const fresh = await fetchTableStatuses(tableIds);
  return tableIds.filter((id) => fresh.get(id) === "occupied");
}

/** "12 min", "1 h 05" */
export function waitedText(t: TFn, since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 60) return t("walkIn.minutes", { minutes });
  return t("walkIn.hours", {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, "0"),
  });
}

/** How many, what they need, which room */
export function PartyInputs({
  idPrefix,
  party,
  onParty,
  tags,
  tagIds,
  onTags,
  maps,
  mapId,
  onMap,
}: {
  idPrefix: string;
  party: string;
  onParty: (value: string) => void;
  tags: TableTag[];
  tagIds: string[];
  onTags: (ids: string[]) => void;
  maps: FloorMap[];
  mapId: string | null;
  onMap: (id: string | null) => void;
}) {
  const t = useT();
  const size = parsePartySize(party);
  const step = (delta: number) =>
    onParty(String(Math.min(MAX_PARTY, Math.max(1, (size ?? 1) + delta))));

  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-party`} className="text-sm font-medium">
          {t("walkIn.people")}
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11"
            aria-label={t("walkIn.fewer")}
            disabled={size !== null && size <= 1}
            onClick={() => step(-1)}
          >
            <Minus className="h-5 w-5" />
          </Button>
          <Input
            id={`${idPrefix}-party`}
            type="number"
            min={1}
            max={MAX_PARTY}
            inputMode="numeric"
            className="h-11 w-20 text-center text-lg font-semibold"
            value={party}
            onChange={(e) => onParty(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11"
            aria-label={t("walkIn.more")}
            onClick={() => step(1)}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("walkIn.needs")}</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((tg) => {
              const on = tagIds.includes(tg.id);
              return (
                <button
                  key={tg.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onTags(on ? tagIds.filter((x) => x !== tg.id) : [...tagIds, tg.id])}
                  className={chipClass(on)}
                >
                  {tg.name}
                  {tg.is_mandatory && " *"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {maps.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("walkIn.room")}</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={mapId === null}
              onClick={() => onMap(null)}
              className={chipClass(mapId === null)}
            >
              {t("reservations.anyRoom")}
            </button>
            {maps.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mapId === m.id}
                onClick={() => onMap(m.id)}
                className={chipClass(mapId === m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * What a table option means for the party: seats, what's not perfect, what
 * must happen first (clear it, wait for the pre-conto) and how long it's
 * theirs.
 */
export function OptionDetails({
  ctx,
  option,
  booking,
  tags,
  maps,
  heading = true,
  trailing,
}: {
  ctx: FloorContext;
  option: WalkInOption;
  booking: Booking;
  tags: TableTag[];
  maps: FloorMap[];
  /** The table names and seats as a first line (off: the caller names the
   * tables and what to do first itself) */
  heading?: boolean;
  /** Shown at the end of the first line ("Consigliato") */
  trailing?: ReactNode;
}) {
  const t = useT();
  const time = useTimeFormat();
  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const mapName = (id: string | null) =>
    id === null ? t("reservations.anyRoom") : maps.find((m) => m.id === id)?.name ?? "?";
  const notes = optionNotes(t, ctx, booking, option, tagName, mapName);

  return (
    <>
      {heading && (
        <span className="flex items-center gap-2">
          <span className="text-base font-semibold">{tableNamesOf(ctx, option.tableIds)}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {t("reservations.seatsCount", { count: option.seats })}
          </span>
          {maps.length > 1 && (
            <span className="text-muted-foreground">
              · {mapName(ctx.tables.get(option.tableIds[0])?.mapId ?? null)}
            </span>
          )}
          {trailing && <span className="ml-auto">{trailing}</span>}
        </span>
      )}
      {notes.length > 0 && (
        <span className="text-xs text-muted-foreground">{notes.join(" · ")}</span>
      )}
      {option.finishing.map((f) => (
        <span key={f.tableId} className="text-muted-foreground">
          {t(FINISH_KEY[f.signal.kind], {
            table: ctx.tables.get(f.tableId)?.name ?? "?",
            time: time(f.signal.at),
          })}
        </span>
      ))}
      {heading && option.dirtyIds.length > 0 && (
        <span className="text-muted-foreground">
          {t("walkIn.toClear", { tables: tableNamesOf(ctx, option.dirtyIds) })}
        </span>
      )}
      {option.leaveBy === null ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          {t("walkIn.allEvening")}
        </span>
      ) : option.shortStay ? (
        <span className="flex gap-1.5 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("walkIn.shortStay", {
            until: time(option.leaveBy),
            time: time(option.freeUntil!),
            name: option.nextBooking?.name ?? "?",
          })}
        </span>
      ) : (
        <span className="flex gap-1.5 text-muted-foreground">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
          {t("walkIn.bookedLater", {
            time: time(option.freeUntil!),
            name: option.nextBooking?.name ?? "?",
            until: time(option.leaveBy),
          })}
        </span>
      )}
    </>
  );
}

/** The picked option on the Sala map: green tables, an outline when joined */
export function walkInMarks(
  pick: WalkInOption | null,
  tables: TableWithTags[],
  base: Map<string, TableMark> | undefined,
  label: string,
): { marks: Map<string, TableMark> | undefined; underlay: ReactNode } {
  if (!pick) return { marks: base, underlay: null };
  const marks = new Map(base);
  pick.tableIds.forEach((id, i) => {
    marks.set(id, { ...marks.get(id), tone: "proposed", label: i === 0 ? label : undefined });
  });
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
}
