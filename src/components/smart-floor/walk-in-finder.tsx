"use client";

// "Trova posto": a party walks in without a booking. Say how many they are
// (and what they need): the panel lists the tables free now, the ones to
// clear, and the ones about to free up, best first; the Sala map shows the
// one picked.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Armchair,
  CalendarClock,
  Check,
  Minus,
  Plus,
  Sparkles,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import {
  optionNotes,
  reasonText,
  tableNamesOf,
  useTimeFormat,
} from "@/components/reservations/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchTableStatuses, occupyTables } from "@/lib/api";
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
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { buildFloorContext, toFloorTable } from "@/lib/smart-floor/context";
import { fetchJoinRules, fetchOpenBills } from "@/lib/smart-floor/data";
import { hullPath } from "@/lib/smart-floor/hull";
import { UPCOMING_MINUTES } from "@/lib/smart-floor/overlay";
import type { Booking } from "@/lib/smart-floor/types";
import {
  findWalkInSeats,
  finishingSignals,
  type FinishKind,
  type OpenBill,
  type WalkInOption,
  type WalkInState,
} from "@/lib/smart-floor/walk-in";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor } from "@/stores/smart-floor-store";

const MINUTE = 60_000;
const MAX_PARTY = 99;

const SECTIONS: { state: WalkInState; titleKey: TranslationKey; dot: string }[] = [
  { state: "free", titleKey: "walkIn.free", dot: "bg-blue-600" },
  { state: "dirty", titleKey: "walkIn.dirty", dot: "bg-amber-800" },
  { state: "finishing", titleKey: "walkIn.finishing", dot: "bg-red-600" },
];

const FINISH_KEY: Record<FinishKind, TranslationKey> = {
  preconto: "walkIn.preconto",
  dessert: "walkIn.dessert",
  overtime: "walkIn.overtime",
};

const optionKey = (o: WalkInOption) => o.tableIds.join(",");

interface WalkInFinderProps {
  tables: TableWithTags[];
  /** Today's reservations */
  reservations: Reservation[];
  links: TableLink[];
  maps: FloorMap[];
  /** Open dine-in bills: when they change, pre-conto and desserts are read again */
  openOrders: Order[];
  now: number;
  /** The option to show on the map (null = none), for a party of `partySize` */
  onPick: (option: WalkInOption | null, partySize: number) => void;
  /** After seating: the floor changed */
  onSeated: () => Promise<void>;
  onClose: () => void;
}

export function WalkInFinder({
  tables,
  reservations,
  links,
  maps,
  openOrders,
  now,
  onPick,
  onSeated,
  onClose,
}: WalkInFinderProps) {
  const t = useT();
  const time = useTimeFormat();
  const { settings } = useSmartFloor();
  const canSeat = usePermission("manage_tables");
  const [party, setParty] = useState("2");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [joinRules, setJoinRules] = useState<TableJoinRule[] | null>(null);
  const [bills, setBills] = useState<OpenBill[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchJoinRules()
      .then(setJoinRules)
      .catch(() => setJoinRules([]));
  }, []);

  // pre-conto and desserts live on the bills: read them again as they change
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
      settings && joinRules
        ? buildFloorContext({ settings, tables, tags, reservations, joinRules }, now)
        : null,
    [settings, tables, tags, reservations, joinRules, now],
  );

  const size = parseInt(party, 10);
  const validSize = Number.isInteger(size) && size >= 1 && size <= MAX_PARTY;
  const result = useMemo(() => {
    if (!ctx || !bills || !validSize) return null;
    const finishing = finishingSignals(
      Array.from(ctx.tables.values()),
      bills,
      links,
      ctx.rules,
      ctx.now,
    );
    return findWalkInSeats(ctx, { partySize: size, tagIds, mapId }, finishing);
  }, [ctx, bills, links, validSize, size, tagIds, mapId]);

  const all = result ? [...result.free, ...result.dirty, ...result.finishing] : [];
  const picked = all.find((o) => optionKey(o) === pickedKey) ?? all[0] ?? null;
  const pickedId = picked ? optionKey(picked) : null;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const latest = useRef(picked);
  latest.current = picked;
  // the option object changes on every refresh; its tables are what matters
  useEffect(() => {
    pickRef.current(latest.current, validSize ? size : 0);
  }, [pickedId, validSize, size]);
  useEffect(() => () => pickRef.current(null, 0), []);

  // bookings due soon with no table yet: seating walk-ins takes their room
  const unassigned = reservations.filter((r) => {
    if (r.status !== "booked" || r.table_ids.length > 0) return false;
    const start = Date.parse(r.reserved_at);
    return start >= now - 30 * MINUTE && start - now <= UPCOMING_MINUTES * MINUTE;
  }).length;

  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const mapName = (id: string | null) =>
    id === null ? t("reservations.anyRoom") : maps.find((m) => m.id === id)?.name ?? "?";
  const booking: Booking = {
    id: "__walk_in__",
    name: "",
    partySize: validSize ? size : 1,
    start: now,
    tagIds,
    mapId,
    tableIds: [],
    locked: false,
  };

  function toggleTag(id: string) {
    setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function step(delta: number) {
    const next = Math.min(MAX_PARTY, Math.max(1, (validSize ? size : 1) + delta));
    setParty(String(next));
  }

  async function seat(o: WalkInOption) {
    if (!ctx) return;
    const names = tableNamesOf(ctx, o.tableIds);
    setBusy(true);
    try {
      // someone else may have seated a party there a second ago
      const fresh = await fetchTableStatuses(o.tableIds);
      const taken = o.tableIds.filter((id) => fresh.get(id) === "occupied");
      if (taken.length > 0) {
        toast.error(t("walkIn.justTaken", { tables: tableNamesOf(ctx, taken) }));
        await onSeated();
        return;
      }
      await occupyTables(o.tableIds);
      await onSeated();
      toast.success(
        o.shortStay && o.leaveBy !== null
          ? t("walkIn.seatedUntil", { tables: names, until: time(o.leaveBy) })
          : t("walkIn.seated", { tables: names }),
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSeat"));
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) =>
    cn(
      "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent",
    );

  return (
    <section
      aria-label={t("walkIn.title")}
      className="flex h-full min-h-0 flex-col rounded-xl border bg-card"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="flex-1 text-lg font-semibold">{t("walkIn.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          aria-label={t("walkIn.close")}
          title={t("walkIn.close")}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="walk-in-party" className="text-sm font-medium">
            {t("walkIn.people")}
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11"
              aria-label={t("walkIn.fewer")}
              disabled={validSize && size <= 1}
              onClick={() => step(-1)}
            >
              <Minus className="h-5 w-5" />
            </Button>
            <Input
              id="walk-in-party"
              type="number"
              min={1}
              max={MAX_PARTY}
              inputMode="numeric"
              className="h-11 w-20 text-center text-lg font-semibold"
              value={party}
              onChange={(e) => setParty(e.target.value)}
            />
            <Button
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
              {tags.map((tg: TableTag) => (
                <button
                  key={tg.id}
                  type="button"
                  aria-pressed={tagIds.includes(tg.id)}
                  onClick={() => toggleTag(tg.id)}
                  className={chip(tagIds.includes(tg.id))}
                >
                  {tg.name}
                  {tg.is_mandatory && " *"}
                </button>
              ))}
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
                onClick={() => setMapId(null)}
                className={chip(mapId === null)}
              >
                {t("reservations.anyRoom")}
              </button>
              {maps.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mapId === m.id}
                  onClick={() => setMapId(m.id)}
                  className={chip(mapId === m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {unassigned > 0 && (
          <p className="flex gap-2 text-sm text-muted-foreground">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
            {t("walkIn.unassigned", { count: unassigned })}
          </p>
        )}

        {!validSize ? (
          <p className="text-sm text-muted-foreground">{t("floor.partySizeMin")}</p>
        ) : !ctx || !result ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : result.reason ? (
          <p className="flex gap-2 text-sm">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
            {result.reason !== "all_taken"
              ? reasonText(t, ctx, booking, result.reason, tagName)
              : mapId
                ? t("walkIn.allTakenRoom", { room: mapName(mapId) })
                : t("walkIn.allTaken")}
          </p>
        ) : (
          SECTIONS.map(({ state, titleKey, dot }) => {
            const list = result[state];
            return (
              <div key={state} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                  {t(titleKey)}
                  <span className="font-normal text-muted-foreground">({list.length})</span>
                </h3>
                {state === "finishing" && list.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t("walkIn.finishingHint")}</p>
                )}
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("walkIn.none")}</p>
                ) : (
                  <ul role="radiogroup" aria-label={t(titleKey)} className="flex flex-col gap-2">
                    {list.map((o) => {
                      const active = picked !== null && optionKey(o) === pickedId;
                      const lines: ReactNode[] = [];
                      for (const f of o.finishing) {
                        lines.push(
                          t(FINISH_KEY[f.signal.kind], {
                            table: ctx.tables.get(f.tableId)?.name ?? "?",
                            time: time(f.signal.at),
                          }),
                        );
                      }
                      if (o.dirtyIds.length > 0) {
                        lines.push(t("walkIn.toClear", { tables: tableNamesOf(ctx, o.dirtyIds) }));
                      }
                      const notes = optionNotes(t, ctx, booking, o, tagName, mapName);
                      return (
                        <li key={optionKey(o)}>
                          <div
                            role="radio"
                            aria-checked={active}
                            aria-label={t("walkIn.optionAria", {
                              tables: tableNamesOf(ctx, o.tableIds),
                              seats: o.seats,
                            })}
                            tabIndex={0}
                            onClick={() => setPickedKey(optionKey(o))}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setPickedKey(optionKey(o));
                              }
                            }}
                            className={cn(
                              "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                              active ? "border-emerald-600 bg-emerald-500/10" : "hover:bg-accent",
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span className="text-base font-semibold">
                                {tableNamesOf(ctx, o.tableIds)}
                              </span>
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Users className="h-3.5 w-3.5" />
                                {t("reservations.seatsCount", { count: o.seats })}
                              </span>
                              {maps.length > 1 && (
                                <span className="text-muted-foreground">
                                  · {mapName(ctx.tables.get(o.tableIds[0])?.mapId ?? null)}
                                </span>
                              )}
                              {o === all[0] && (
                                <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-400">
                                  {t("walkIn.best")}
                                </span>
                              )}
                            </span>
                            {notes.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {notes.join(" · ")}
                              </span>
                            )}
                            {lines.map((line, i) => (
                              <span key={i} className="text-muted-foreground">
                                {line}
                              </span>
                            ))}
                            {o.leaveBy === null ? (
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                {t("walkIn.allEvening")}
                              </span>
                            ) : o.shortStay ? (
                              <span className="flex gap-1.5 text-amber-700 dark:text-amber-400">
                                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {t("walkIn.shortStay", {
                                  until: time(o.leaveBy),
                                  time: time(o.freeUntil!),
                                  name: o.nextBooking?.name ?? "?",
                                })}
                              </span>
                            ) : (
                              <span className="flex gap-1.5 text-muted-foreground">
                                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
                                {t("walkIn.bookedLater", {
                                  time: time(o.freeUntil!),
                                  name: o.nextBooking?.name ?? "?",
                                  until: time(o.leaveBy),
                                })}
                              </span>
                            )}
                            {canSeat && state !== "finishing" && (
                              <Button
                                className="mt-1 h-11"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void seat(o);
                                }}
                              >
                                {state === "dirty" ? (
                                  <Sparkles className="mr-2 h-4 w-4" />
                                ) : (
                                  <Armchair className="mr-2 h-4 w-4" />
                                )}
                                {t(state === "dirty" ? "walkIn.seatClean" : "walkIn.seat")}
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
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
