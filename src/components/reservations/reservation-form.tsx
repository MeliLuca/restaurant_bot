"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
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
import { useT } from "@/lib/i18n/use-translation";
import type { Booking, FloorContext } from "@/lib/smart-floor/types";
import { cn } from "@/lib/utils";
import { tableNamesOf, useTimeFormat } from "./format";
import { PlanningMap } from "./planning-map";
import { TablePickerSection, useTablePicker } from "./table-picker";

/** Stand-in id for a reservation not saved yet */
const NEW_ID = "__new__";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const [busy, setBusy] = useState(false);

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

  // an edited party keeps its tables unless told otherwise ("Riassegna")
  const picker = useTablePicker({
    ctx,
    booking,
    reservations,
    tags,
    initialMode: editing && editing.table_ids.length > 0 ? "manual" : "auto",
    label: name.trim(),
  });
  const chosenTables = canPlan ? picker.chosenTables : [];

  function toggleTag(id: string) {
    setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
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
            <TablePickerSection
              picker={picker}
              ctx={ctx}
              booking={booking}
              tags={tags}
              maps={maps}
              locked={locked}
              onLockedChange={setLocked}
            />
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
          marks={canPlan ? picker.marks : new Map()}
          focusTableIds={chosenTables}
          onTableClick={canPlan ? picker.clickTable : undefined}
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

