"use client";

// Choosing a reservation's tables, shared by the booking form and "Cambia
// tavolo": the engine's best picks (the current tables among them), a hand
// pick on the map with what's wrong with it, or no table at all.

import { useEffect, useMemo, useState } from "react";
import { Hand, Lock, Sparkles, TriangleAlert, Users } from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import { Button } from "@/components/ui/button";
import type { FloorMap, Reservation, RestaurantTable, TableTag } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { seatsOf, suggestTables, tablesTakenAt } from "@/lib/smart-floor/assign";
import type { Booking, FloorContext, NoTableReason, TableOption } from "@/lib/smart-floor/types";
import { cn } from "@/lib/utils";
import { optionNotes, reasonText, tableNamesOf } from "./format";

export type TableMode = "auto" | "manual" | "none";

/** How many of the engine's picks are listed (the current tables may be one) */
const OPTIONS_SHOWN = 5;
const NO_TABLES: string[] = [];

const sameTables = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Are these tables one connected group of joinable tables? */
function connected(ctx: FloorContext, ids: string[]): boolean {
  if (ids.length < 2) return true;
  const seen = new Set([ids[0]]);
  const queue = [ids[0]];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ctx.adjacency.get(id)?.forEach((n) => {
      if (ids.includes(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    });
  }
  return seen.size === ids.length;
}

export interface TablePicker {
  mode: TableMode;
  setMode: (mode: TableMode) => void;
  picked: string[];
  options: TableOption[];
  option: TableOption | null;
  choose: (index: number) => void;
  reason: NoTableReason | null;
  /** The tables that would be saved ([] = none) */
  chosenTables: string[];
  /** The reservation's tables before this edit */
  currentTableIds: string[];
  /** The choice is the tables it already has */
  unchanged: boolean;
  /** Hand pick: what's wrong with it (it can still be saved) */
  warnings: string[];
  marks: Map<string, TableMark>;
  clickTable: (table: RestaurantTable) => void;
}

export function useTablePicker({
  ctx,
  booking,
  reservations,
  tags,
  initialMode,
  label,
}: {
  ctx: FloorContext | null;
  /** null while the details don't make a booking yet (no time, no guests) */
  booking: Booking | null;
  reservations: Reservation[];
  tags: TableTag[];
  initialMode: TableMode;
  /** The party's name, drawn on the chosen tables */
  label?: string;
}): TablePicker {
  const t = useT();
  const currentTableIds = booking?.tableIds ?? NO_TABLES;
  const [mode, setModeState] = useState<TableMode>(initialMode);
  const [picked, setPicked] = useState<string[]>(currentTableIds);
  const [chosen, setChosen] = useState(0);
  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";

  // booking is rebuilt by its owner each render: these are the real inputs
  const key = booking
    ? `${booking.id}|${booking.partySize}|${booking.start}|${booking.tagIds.join()}|${booking.mapId}`
    : "";
  const suggestion = useMemo(
    () => (ctx && booking ? suggestTables(ctx, booking, { limit: OPTIONS_SHOWN }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, key],
  );
  // new details, new list: start again from the best one
  useEffect(() => setChosen(0), [suggestion]);
  const options = suggestion?.options ?? [];
  const option = options[Math.min(chosen, options.length - 1)] ?? null;

  const taken = useMemo(
    () =>
      ctx && booking
        ? tablesTakenAt(ctx, booking.start, booking.id)
        : new Map<string, string | null>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, key],
  );

  const chosenTables =
    mode === "auto" ? (option?.tableIds ?? []) : mode === "manual" ? picked : [];

  const bookingName = (id: string | null) =>
    id ? reservations.find((r) => r.id === id)?.customer_name ?? "?" : null;
  const marks = new Map<string, TableMark>();
  taken.forEach((holder, id) => {
    marks.set(id, { tone: "held", label: bookingName(holder) ?? t("reservations.takenNow") });
  });
  // where the party is now, if the choice moves it
  if (!sameTables(chosenTables, currentTableIds)) {
    currentTableIds.forEach((id, i) => {
      marks.set(id, {
        tone: "moved",
        label: i === 0 ? t("reservations.currentMark") : undefined,
      });
    });
  }
  for (const id of chosenTables) {
    marks.set(id, { tone: mode === "auto" ? "proposed" : "picked", label: label || undefined });
  }

  const warnings: string[] = [];
  if (ctx && booking && mode === "manual" && picked.length > 0) {
    const seats = seatsOf(ctx, picked);
    if (booking.partySize > seats + ctx.rules.overfillSeats) {
      warnings.push(t("reservations.warnSeats", { seats, count: booking.partySize }));
    }
    const has = new Set(picked.flatMap((id) => ctx.tables.get(id)?.tagIds ?? []));
    const missing = booking.tagIds.filter((id) => ctx.mandatoryTagIds.has(id) && !has.has(id));
    if (missing.length > 0) {
      warnings.push(t("reservations.warnMandatory", { tags: missing.map(tagName).join(", ") }));
    }
    for (const id of picked) {
      if (!taken.has(id)) continue;
      const holder = bookingName(taken.get(id) ?? null);
      warnings.push(
        holder
          ? t("reservations.warnTakenBy", { table: tableNamesOf(ctx, [id]), name: holder })
          : t("reservations.warnTakenNow", { table: tableNamesOf(ctx, [id]) }),
      );
    }
    if (!connected(ctx, picked)) warnings.push(t("reservations.warnNotJoinable"));
    const closed = picked.filter((id) => ctx.tables.get(id)?.closed);
    if (closed.length > 0) {
      warnings.push(t("reservations.warnClosedRoom", { tables: tableNamesOf(ctx, closed) }));
    }
  }

  function setMode(next: TableMode) {
    // from the engine's pick to the map: start from what it proposed
    if (next === "manual" && mode === "auto") setPicked(option?.tableIds ?? []);
    setModeState(next);
  }

  function clickTable(tb: RestaurantTable) {
    // clicking the map always means "I'll choose": start from the current pick
    if (mode !== "manual") {
      setModeState("manual");
      setPicked(chosenTables.includes(tb.id) ? chosenTables : [tb.id]);
      return;
    }
    setPicked((ids) => (ids.includes(tb.id) ? ids.filter((x) => x !== tb.id) : [...ids, tb.id]));
  }

  return {
    mode,
    setMode,
    picked,
    options,
    option,
    choose: setChosen,
    reason: suggestion?.reason ?? null,
    chosenTables,
    currentTableIds,
    unchanged: sameTables(chosenTables, currentTableIds),
    warnings,
    marks,
    clickTable,
  };
}

/** The table part of a reservation: engine's picks / by hand / none, and the lock */
export function TablePickerSection({
  picker,
  ctx,
  booking,
  tags,
  maps,
  locked,
  onLockedChange,
}: {
  picker: TablePicker;
  ctx: FloorContext | null;
  booking: Booking | null;
  tags: TableTag[];
  maps: FloorMap[];
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
}) {
  const t = useT();
  const { mode, options, option, currentTableIds, warnings } = picker;
  const hasCurrent = currentTableIds.length > 0;
  const closedRoom = ctx
    ? currentTableIds.map((id) => ctx.tables.get(id)).find((tb) => tb?.closed)?.mapId ?? null
    : null;
  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const mapName = (id: string | null) =>
    maps.find((m) => m.id === id)?.name ?? t("reservations.anyRoom");

  const modes: { value: TableMode; label: string }[] = [
    // a party that has tables: the engine "re-assigns"
    { value: "auto", label: t(hasCurrent ? "reservations.modeReassign" : "reservations.modeAuto") },
    { value: "manual", label: t("reservations.modeManual") },
    { value: "none", label: t("reservations.modeNone") },
  ];

  return (
    <>
      {hasCurrent && ctx && (
        <p className="text-sm">
          {t("reservations.currentTables", { tables: tableNamesOf(ctx, currentTableIds) })}
        </p>
      )}
      {closedRoom && (
        <p className="flex gap-2 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
          {t("reservations.currentInClosedRoom", { room: mapName(closedRoom) })}
        </p>
      )}
      <div role="group" className="flex rounded-lg border p-1">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => picker.setMode(m.value)}
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
              mode === m.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {m.value === "auto" && <Sparkles className="h-4 w-4" />}
            {m.value === "manual" && <Hand className="h-4 w-4" />}
            {m.label}
          </button>
        ))}
      </div>

      {mode === "auto" &&
        (!ctx ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !booking ? (
          <p className="text-sm text-muted-foreground">{t("reservations.fillDetails")}</p>
        ) : picker.reason ? (
          <p className="flex gap-2 text-sm">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
            {reasonText(t, ctx, booking, picker.reason, tagName)}
          </p>
        ) : (
          <>
            {hasCurrent && sameTables(options[0]?.tableIds ?? [], currentTableIds) && (
              <p className="text-sm text-muted-foreground">{t("reservations.currentIsBest")}</p>
            )}
            <div role="radiogroup" className="flex flex-col gap-2">
              {options.map((o, i) => {
                const notesList = optionNotes(t, ctx, booking, o, tagName, mapName);
                const active = option === o;
                const current = sameTables(o.tableIds, currentTableIds);
                return (
                  <button
                    key={o.tableIds.join()}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => picker.choose(i)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      active ? "border-emerald-600 bg-emerald-500/10" : "hover:bg-accent",
                    )}
                  >
                    <span className="flex w-full items-center gap-2 font-medium">
                      {tableNamesOf(ctx, o.tableIds)}
                      <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        {t("reservations.seatsCount", { count: o.seats })}
                      </span>
                      <span className="ml-auto flex gap-2 text-xs font-normal">
                        {current && (
                          <span className="text-amber-700 dark:text-amber-400">
                            {t("reservations.currentBadge")}
                          </span>
                        )}
                        {i === 0 && (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {t("reservations.best")}
                          </span>
                        )}
                      </span>
                    </span>
                    {notesList.length > 0 && (
                      <span className="text-xs text-muted-foreground">{notesList.join(" · ")}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ))}

      {mode === "manual" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t("reservations.pickHint")}</p>
          {ctx && picker.picked.length > 0 && (
            <p className="text-sm">
              <span className="font-medium">{tableNamesOf(ctx, picker.picked)}</span>
              {" · "}
              {t("reservations.seatsCount", { count: seatsOf(ctx, picker.picked) })}
              {sameTables(picker.picked, currentTableIds) && (
                <span className="text-muted-foreground"> · {t("reservations.currentBadge")}</span>
              )}
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className="flex gap-2 text-sm">
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" /> {w}
            </p>
          ))}
          {warnings.length > 0 && booking && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-fit"
              onClick={() => picker.setMode("auto")}
            >
              <Sparkles className="mr-1.5 h-4 w-4" /> {t("reservations.findFitting")}
            </Button>
          )}
        </div>
      )}

      {mode === "none" && (
        <p className="text-sm text-muted-foreground">{t("reservations.noneHint")}</p>
      )}

      {picker.chosenTables.length > 0 && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary"
            checked={locked}
            onChange={(e) => onLockedChange(e.target.checked)}
          />
          <Lock className="h-4 w-4 text-muted-foreground" />
          {t("reservations.lockLabel")}
        </label>
      )}
    </>
  );
}
