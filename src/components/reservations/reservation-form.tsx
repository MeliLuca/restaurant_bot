"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Hand, Lock, Sparkles, TriangleAlert, Users } from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createReservation, updateReservation } from "@/lib/api";
import type {
  FloorMap,
  Reservation,
  RestaurantTable,
  TableTag,
} from "@/lib/database.types";
import { dayStart } from "@/hooks/use-reservations-day";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import {
  seatsOf,
  suggestTables,
  tablesTakenAt,
} from "@/lib/smart-floor/assign";
import type { Booking, FloorContext } from "@/lib/smart-floor/types";
import { cn } from "@/lib/utils";
import { optionNotes, reasonText, tableNamesOf, useTimeFormat } from "./format";
import { PlanningMap } from "./planning-map";

type TableMode = "auto" | "manual" | "none";

const MODES: { value: TableMode; labelKey: TranslationKey }[] = [
  { value: "auto", labelKey: "reservations.modeAuto" },
  { value: "manual", labelKey: "reservations.modeManual" },
  { value: "none", labelKey: "reservations.modeNone" },
];

/** Stand-in id for a reservation not saved yet */
const NEW_ID = "__new__";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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

interface ReservationFormProps {
  /** null while the day is loading */
  ctx: FloorContext | null;
  reservations: Reservation[];
  tags: TableTag[];
  maps: FloorMap[];
  tables: RestaurantTable[];
  phoneRequired: boolean;
  day: string;
  onDayChange: (day: string) => void;
  editing: Reservation | null;
  canPlan: boolean;
  activeMapId: string | null;
  onActiveMapChange: (id: string) => void;
  onDone: (savedId: string | null) => void;
}

export function ReservationForm({
  ctx,
  reservations,
  tags,
  maps,
  tables,
  phoneRequired,
  day,
  onDayChange,
  editing,
  canPlan,
  activeMapId,
  onActiveMapChange,
  onDone,
}: ReservationFormProps) {
  const t = useT();
  const time = useTimeFormat();
  const [name, setName] = useState(editing?.customer_name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [hhmm, setHhmm] = useState(editing ? timeOf(editing.reserved_at) : "20:00");
  const [party, setParty] = useState(String(editing?.party_size ?? 2));
  const [tagIds, setTagIds] = useState<string[]>(editing?.tag_ids ?? []);
  const [mapId, setMapId] = useState<string | null>(editing?.map_id ?? null);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [locked, setLocked] = useState(editing?.locked ?? false);
  const [mode, setMode] = useState<TableMode>(
    editing && editing.table_ids.length > 0 ? "manual" : "auto",
  );
  const [picked, setPicked] = useState<string[]>(editing?.table_ids ?? []);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);

  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const mapName = (id: string | null) =>
    maps.find((m) => m.id === id)?.name ?? t("reservations.anyRoom");
  const bookingName = (id: string | null) =>
    id ? reservations.find((r) => r.id === id)?.customer_name ?? "?" : null;

  const size = parseInt(party, 10);
  const validSize = Number.isFinite(size) && size >= 1;
  const start = useMemo(() => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = dayStart(day);
    d.setHours(h, m, 0, 0);
    return d;
  }, [day, hhmm]);
  const validStart = !Number.isNaN(start.getTime()) && /^\d{2}:\d{2}$/.test(hhmm);

  const booking: Booking | null =
    validSize && validStart
      ? {
          id: editing?.id ?? NEW_ID,
          name: name.trim() || t("reservations.thisParty"),
          partySize: size,
          start: start.getTime(),
          tagIds,
          mapId,
          tableIds: editing?.table_ids ?? [],
          locked,
        }
      : null;

  // the engine's picks for these details, live
  const suggestion = useMemo(
    () => (ctx && booking ? suggestTables(ctx, booking, { limit: 4 }) : null),
    // booking is rebuilt each render; its inputs are the real deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, size, start.getTime(), tagIds.join(), mapId, editing?.id],
  );
  // new details, new list: start again from the best one
  useEffect(() => setChosen(0), [suggestion]);
  const options = suggestion?.options ?? [];
  const option = options[Math.min(chosen, options.length - 1)] ?? null;

  const taken = useMemo(
    () =>
      ctx && validStart
        ? tablesTakenAt(ctx, start.getTime(), editing?.id ?? null)
        : new Map<string, string | null>(),
    [ctx, start, validStart, editing?.id],
  );

  const chosenTables =
    !canPlan ? [] : mode === "auto" ? (option?.tableIds ?? []) : mode === "manual" ? picked : [];

  // what the map shows: taken tables greyed with who holds them, ours on top
  const marks = new Map<string, TableMark>();
  taken.forEach((holder, id) => {
    marks.set(id, {
      tone: "held",
      label: bookingName(holder) ?? t("reservations.takenNow"),
    });
  });
  for (const id of chosenTables) {
    marks.set(id, {
      tone: mode === "auto" ? "proposed" : "picked",
      label: name.trim() || undefined,
    });
  }

  // manual choice: what's wrong with it (it can still be saved)
  const warnings: string[] = [];
  if (ctx && mode === "manual" && picked.length > 0 && booking) {
    const seats = seatsOf(ctx, picked);
    if (size > seats + ctx.rules.overfillSeats) {
      warnings.push(t("reservations.warnSeats", { seats, count: size }));
    }
    const has = new Set(picked.flatMap((id) => ctx.tables.get(id)?.tagIds ?? []));
    const missing = tagIds.filter((id) => ctx.mandatoryTagIds.has(id) && !has.has(id));
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
  }

  function toggleTag(id: string) {
    setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function clickTable(tb: RestaurantTable) {
    if (!canPlan) return;
    // clicking the map always means "I'll choose": start from the current pick
    if (mode !== "manual") {
      setMode("manual");
      setPicked(chosenTables.includes(tb.id) ? chosenTables : [tb.id]);
      return;
    }
    setPicked((ids) => (ids.includes(tb.id) ? ids.filter((x) => x !== tb.id) : [...ids, tb.id]));
  }

  async function save() {
    if (!name.trim()) return toast.error(t("floor.customerNameRequired"));
    if (phoneRequired && !phone.trim()) return toast.error(t("reservations.phoneRequired"));
    if (!validSize) return toast.error(t("floor.partySizeMin"));
    if (!validStart) return toast.error(t("floor.invalidDateTime"));

    const details = {
      customerName: name.trim(),
      partySize: size,
      reservedAt: start,
      notes: notes.trim(),
      phone: phone.trim(),
      tagIds,
      mapId,
      locked: canPlan && chosenTables.length > 0 ? locked : editing?.locked ?? false,
    };
    setBusy(true);
    try {
      let id: string;
      if (editing) {
        await updateReservation(editing.id, details, canPlan ? chosenTables : undefined);
        id = editing.id;
      } else {
        id = await createReservation({ ...details, tableIds: chosenTables });
      }
      toast.success(
        t(editing ? "reservations.saved" : "floor.reservationCreated", { name: details.customerName }),
      );
      onDone(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSave"));
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 lg:w-[380px] xl:w-[460px] lg:shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => onDone(null)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("reservations.backToList")}
          </Button>
          <h2 className="text-lg font-semibold">
            {t(editing ? "reservations.editTitle" : "floor.newReservation")}
          </h2>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="rf-name">{t("floor.customerName")}</Label>
          <Input
            id="rf-name"
            className="h-11"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("floor.customerNamePlaceholder")}
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rf-phone">
            {t(phoneRequired ? "reservations.phone" : "reservations.phoneOptional")}
          </Label>
          <Input
            id="rf-phone"
            className="h-11"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="333 123 4567"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="rf-date">{t("floor.date")}</Label>
            <Input
              id="rf-date"
              className="h-11"
              type="date"
              value={day}
              onChange={(e) => e.target.value && onDayChange(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rf-time">{t("floor.time")}</Label>
            <Input
              id="rf-time"
              className="h-11"
              type="time"
              step={900}
              value={hhmm}
              onChange={(e) => setHhmm(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rf-party">{t("reservations.people")}</Label>
            <Input
              id="rf-party"
              className="h-11"
              type="number"
              min={1}
              inputMode="numeric"
              value={party}
              onChange={(e) => setParty(e.target.value)}
            />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="grid gap-2">
            <Label>{t("reservations.needs")}</Label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tg) => (
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
            <p className="text-xs text-muted-foreground">{t("reservations.needsHint")}</p>
          </div>
        )}

        {maps.length > 1 && (
          <div className="grid gap-2">
            <Label>{t("reservations.room")}</Label>
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

        <div className="grid gap-2">
          <Label htmlFor="rf-notes">{t("floor.notesOptional")}</Label>
          <Input
            id="rf-notes"
            className="h-11"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("floor.notesPlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <h3 className="font-medium">{t("reservations.tableSection")}</h3>
          {!canPlan ? (
            <p className="text-sm text-muted-foreground">
              {editing && editing.table_ids.length > 0 && ctx
                ? t("reservations.keepsTables", { tables: tableNamesOf(ctx, editing.table_ids) })
                : t("reservations.plannerAssigns")}
            </p>
          ) : (
            <>
              <div role="group" className="flex rounded-lg border p-1">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={mode === m.value}
                    onClick={() => {
                      if (m.value === "manual" && mode === "auto") setPicked(option?.tableIds ?? []);
                      setMode(m.value);
                    }}
                    className={cn(
                      "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
                      mode === m.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {m.value === "auto" && <Sparkles className="h-4 w-4" />}
                    {m.value === "manual" && <Hand className="h-4 w-4" />}
                    {t(m.labelKey)}
                  </button>
                ))}
              </div>

              {mode === "auto" &&
                (!ctx ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : !booking ? (
                  <p className="text-sm text-muted-foreground">{t("reservations.fillDetails")}</p>
                ) : suggestion?.reason ? (
                  <p className="flex gap-2 text-sm">
                    <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                    {reasonText(t, ctx, booking, suggestion.reason, tagName)}
                  </p>
                ) : (
                  <div role="radiogroup" className="flex flex-col gap-2">
                    {options.map((o, i) => {
                      const notesList = optionNotes(t, ctx, booking, o, tagName, mapName);
                      const active = option === o;
                      return (
                        <button
                          key={o.tableIds.join()}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setChosen(i)}
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
                            {i === 0 && (
                              <span className="ml-auto text-xs font-normal text-emerald-700">
                                {t("reservations.best")}
                              </span>
                            )}
                          </span>
                          {notesList.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {notesList.join(" · ")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}

              {mode === "manual" && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">{t("reservations.pickHint")}</p>
                  {ctx && picked.length > 0 && (
                    <p className="text-sm">
                      <span className="font-medium">{tableNamesOf(ctx, picked)}</span>
                      {" · "}
                      {t("reservations.seatsCount", { count: seatsOf(ctx, picked) })}
                    </p>
                  )}
                  {warnings.map((w) => (
                    <p key={w} className="flex gap-2 text-sm">
                      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" /> {w}
                    </p>
                  ))}
                </div>
              )}

              {mode === "none" && (
                <p className="text-sm text-muted-foreground">{t("reservations.noneHint")}</p>
              )}

              {chosenTables.length > 0 && (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={locked}
                    onChange={(e) => setLocked(e.target.checked)}
                  />
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  {t("reservations.lockLabel")}
                </label>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 pb-2">
          <Button variant="outline" className="h-11 flex-1" onClick={() => onDone(null)}>
            {t("common.cancel")}
          </Button>
          <Button className="h-11 flex-1" disabled={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </aside>

      <div className="min-h-[360px] flex-1">
        <PlanningMap
          maps={maps}
          tables={tables}
          activeMapId={activeMapId}
          onActiveMapChange={onActiveMapChange}
          marks={marks}
          focusTableIds={chosenTables}
          onTableClick={clickTable}
          header={
            validStart && (
              <span className="text-sm text-muted-foreground">
                {t("reservations.mapAt", { time: time(start) })}
              </span>
            )
          }
        />
      </div>
    </div>
  );
}

