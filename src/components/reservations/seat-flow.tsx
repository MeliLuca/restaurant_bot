"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Armchair, ArrowRight, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchTableStatuses,
  seatReservation,
  updateReservation,
} from "@/lib/api";
import type { FloorMap, Reservation } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { suggestTables, timelineFor } from "@/lib/smart-floor/assign";
import { buildFloorContext, reservationToBooking } from "@/lib/smart-floor/context";
import { fetchFloorSnapshot } from "@/lib/smart-floor/data";
import type {
  Booking,
  FloorContext,
  NoTableReason,
  TableOption,
} from "@/lib/smart-floor/types";
import { optionNotes, reasonText, tableNamesOf, useTimeFormat } from "./format";

/** Stand-in holder for tables kept out of the suggestions */
const BLOCKED = "__blocked__";

interface Request {
  reservation: Reservation;
  /** seat: the party is here now · move: find it a table for its time */
  mode: "seat" | "move";
  /** Its tables occupied by someone else right now */
  blocked: string[];
}

interface Found {
  ctx: FloorContext;
  booking: Booking;
  options: TableOption[];
  reason: NoTableReason | null;
  tagNames: Map<string, string>;
}

/**
 * Seating a booked party, and what to do when its table is still taken:
 * other tables that fit now (or at its time), or seat it there anyway.
 * Render `element` once; call `seat` / `move` from anywhere below it.
 */
export function useSeatFlow({
  maps,
  canPlan,
  canPickTables = false,
  tableNames,
  onDone,
}: {
  maps: FloorMap[];
  /** May give the party other tables (plan_floor, on a computer) */
  canPlan: boolean;
  /** Without the engine, may still move it by hand ("Cambia tavolo", module off) */
  canPickTables?: boolean;
  /** "201 + 202" */
  tableNames: (ids: string[]) => string;
  onDone?: () => void | Promise<void>;
}): {
  seat: (r: Reservation) => Promise<void>;
  move: (r: Reservation, blocked: string[]) => void;
  element: ReactNode;
} {
  const t = useT();
  const [request, setRequest] = useState<Request | null>(null);

  async function seat(r: Reservation) {
    try {
      const status = await fetchTableStatuses(r.table_ids);
      const blocked = r.table_ids.filter((id) => status.get(id) === "occupied");
      if (blocked.length > 0 || r.table_ids.length === 0) {
        setRequest({ reservation: r, mode: "seat", blocked });
        return;
      }
      await seatReservation(r);
      toast.success(
        t("floor.seatedAt", { name: r.customer_name, table: tableNames(r.table_ids) }),
      );
      await onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSeat"));
    }
  }

  const element = (
    <AlternativeTablesDialog
      request={request}
      maps={maps}
      canPlan={canPlan}
      canPickTables={canPickTables}
      tableNames={tableNames}
      onClose={() => setRequest(null)}
      onDone={async () => {
        setRequest(null);
        await onDone?.();
      }}
    />
  );

  return {
    seat,
    move: (r, blocked) => setRequest({ reservation: r, mode: "move", blocked }),
    element,
  };
}

function AlternativeTablesDialog({
  request,
  maps,
  canPlan,
  canPickTables,
  tableNames,
  onClose,
  onDone,
}: {
  request: Request | null;
  maps: FloorMap[];
  canPlan: boolean;
  canPickTables: boolean;
  tableNames: (ids: string[]) => string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const time = useTimeFormat();
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFound(null);
    setError(null);
    if (!request || !canPlan) return;
    let live = true;
    const { reservation: r, mode, blocked } = request;
    fetchFloorSnapshot(new Date(r.reserved_at))
      .then((snap) => {
        if (!live) return;
        const ctx = buildFloorContext(snap);
        const booked = ctx.bookings.get(r.id) ?? reservationToBooking(r);
        const booking = {
          ...booked,
          start: mode === "seat" ? ctx.now : booked.start,
          tableIds: [],
        };
        const timeline = timelineFor(ctx, new Set([r.id]));
        timeline.hold(BLOCKED, blocked, booking.start);
        const res = suggestTables(ctx, booking, { timeline, limit: 3 });
        setFound({
          ctx,
          booking,
          options: res.options,
          reason: res.reason,
          tagNames: new Map(snap.tags.map((tg) => [tg.id, tg.name])),
        });
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [request, canPlan]);

  if (!request) return null;
  const { reservation: r, mode, blocked } = request;
  const own = tableNames(r.table_ids);

  async function act(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  const choose = (o: TableOption) => {
    const tables = tableNames(o.tableIds);
    if (mode === "seat") {
      void act(async () => {
        await updateReservation(r.id, {}, o.tableIds);
        await seatReservation({ ...r, table_ids: o.tableIds });
      }, t("floor.seatedAt", { name: r.customer_name, table: tables }));
    } else {
      void act(
        () => updateReservation(r.id, {}, o.tableIds),
        t("smartFloor.movedTo", { name: r.customer_name, tables }),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(mode === "seat" ? "smartFloor.seatTitle" : "smartFloor.moveTitle", {
              name: r.customer_name,
            })}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2">
            <span className="tabular-nums">{time(r.reserved_at)}</span>
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {r.party_size}
            </span>
          </DialogDescription>
        </DialogHeader>

        {r.table_ids.length === 0 ? (
          <p className="text-sm">{t("smartFloor.noTableYet")}</p>
        ) : (
          blocked.length > 0 && (
            <p className="flex gap-2 text-sm">
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
              {t("smartFloor.stillOccupied", { tables: tableNames(blocked) })}
            </p>
          )
        )}

        {!canPlan ? (
          <p className="text-sm text-muted-foreground">
            {t(canPickTables ? "reservations.pickOtherHint" : "smartFloor.askPlanner")}
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !found ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : found.options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {found.reason
              ? reasonText(t, found.ctx, found.booking, found.reason, (id) =>
                  found.tagNames.get(id) ?? "?",
                )
              : t("reservations.reasonAllTaken")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {t(mode === "seat" ? "smartFloor.freeNow" : "smartFloor.freeAt", {
                time: time(found.booking.start),
              })}
            </p>
            {found.options.map((o) => {
              const notes = optionNotes(
                t,
                found.ctx,
                found.booking,
                o,
                (id) => found.tagNames.get(id) ?? "?",
                (id) => maps.find((m) => m.id === id)?.name ?? t("reservations.anyRoom"),
              );
              return (
                <div
                  key={o.tableIds.join(",")}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {tableNamesOf(found.ctx, o.tableIds)}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {t("reservations.seatsCount", { count: o.seats })}
                      </span>
                    </p>
                    {(notes.length > 0 || o.freeUntil !== null) && (
                      <p className="text-xs text-muted-foreground">
                        {[
                          ...notes,
                          ...(o.freeUntil !== null
                            ? [t("smartFloor.freeUntil", { time: time(o.freeUntil) })]
                            : []),
                        ].join(" · ")}
                      </p>
                    )}
                  </div>
                  <Button className="h-10 shrink-0" disabled={busy} onClick={() => choose(o)}>
                    {mode === "seat" ? (
                      <Armchair className="mr-1.5 h-4 w-4" />
                    ) : (
                      <ArrowRight className="mr-1.5 h-4 w-4" />
                    )}
                    {t(mode === "seat" ? "smartFloor.seatHere" : "smartFloor.moveHere")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" disabled={busy} onClick={onClose}>
            {t(mode === "seat" ? "common.cancel" : "smartFloor.keepTables")}
          </Button>
          {mode === "seat" && r.table_ids.length > 0 && (
            <Button
              variant="secondary"
              className="h-11"
              disabled={busy}
              onClick={() =>
                void act(
                  () => seatReservation(r),
                  t("floor.seatedAt", { name: r.customer_name, table: own }),
                )
              }
            >
              {t("smartFloor.seatAnyway", { tables: own })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
