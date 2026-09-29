"use client";

// "Cambia tavolo" on a booked party that has tables: the tables it has, the
// engine's other picks for it, or a hand pick on the map; saved on "Conferma".

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateReservation } from "@/lib/api";
import type { FloorMap, Reservation, RestaurantTable, TableTag } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { reservationToBooking } from "@/lib/smart-floor/context";
import type { FloorContext } from "@/lib/smart-floor/types";
import { tableNamesOf, useTimeFormat } from "./format";
import { PlanningMap } from "./planning-map";
import { TablePickerSection, useTablePicker } from "./table-picker";

export function TableChange({
  ctx,
  reservation,
  reservations,
  tags,
  maps,
  tables,
  activeMapId,
  onActiveMapChange,
  onDone,
}: {
  ctx: FloorContext;
  reservation: Reservation;
  reservations: Reservation[];
  tags: TableTag[];
  maps: FloorMap[];
  tables: RestaurantTable[];
  activeMapId: string | null;
  onActiveMapChange: (id: string) => void;
  /** saved = the tables (or the lock) changed */
  onDone: (saved: boolean) => void;
}) {
  const t = useT();
  const time = useTimeFormat();
  const booking = reservationToBooking(reservation);
  const picker = useTablePicker({
    ctx,
    booking,
    reservations,
    tags,
    // the point of coming here: see where else it could go
    initialMode: "auto",
    label: reservation.customer_name,
  });
  const [locked, setLocked] = useState(reservation.locked);
  const [busy, setBusy] = useState(false);
  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const lockChanged = picker.chosenTables.length > 0 && locked !== reservation.locked;

  async function confirm() {
    setBusy(true);
    try {
      await updateReservation(
        reservation.id,
        { locked: picker.chosenTables.length > 0 ? locked : false },
        picker.chosenTables,
      );
      toast.success(
        picker.chosenTables.length > 0
          ? t("reservations.tablesChanged", {
              name: reservation.customer_name,
              tables: tableNamesOf(ctx, picker.chosenTables),
            })
          : t("reservations.tablesCleared", { name: reservation.customer_name }),
      );
      onDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 lg:w-[380px] xl:w-[460px] lg:shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-9" onClick={() => onDone(false)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("reservations.backToList")}
          </Button>
          <h2 className="text-lg font-semibold">{t("reservations.changeTables")}</h2>
        </div>

        <div className="rounded-lg border p-3">
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-semibold tabular-nums">{time(reservation.reserved_at)}</span>
            <span className="font-medium">{reservation.customer_name}</span>
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {reservation.party_size}
            </span>
          </p>
          {(reservation.tag_ids.length > 0 || reservation.map_id) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                ...reservation.tag_ids.map(tagName),
                ...(reservation.map_id
                  ? [maps.find((m) => m.id === reservation.map_id)?.name ?? "?"]
                  : []),
              ].join(" · ")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <TablePickerSection
            picker={picker}
            ctx={ctx}
            booking={booking}
            tags={tags}
            maps={maps}
            locked={locked}
            onLockedChange={setLocked}
          />
        </div>

        <div className="flex gap-2 pb-2">
          <Button variant="outline" className="h-11 flex-1" onClick={() => onDone(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            className="h-11 flex-1"
            disabled={busy || (picker.unchanged && !lockChanged)}
            onClick={() => void confirm()}
          >
            <Check className="mr-1.5 h-4 w-4" />
            {t("reservations.confirmPlan")}
          </Button>
        </div>
      </aside>

      <div className="min-h-[360px] flex-1">
        <PlanningMap
          maps={maps}
          tables={tables}
          activeMapId={activeMapId}
          onActiveMapChange={onActiveMapChange}
          marks={picker.marks}
          focusTableIds={picker.chosenTables}
          onTableClick={picker.clickTable}
          header={
            <span className="text-sm text-muted-foreground">
              {t("reservations.mapAt", { time: time(reservation.reserved_at) })}
            </span>
          }
        />
      </div>
    </div>
  );
}
