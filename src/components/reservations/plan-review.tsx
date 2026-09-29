"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, TriangleAlert, Users } from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import { Button } from "@/components/ui/button";
import { assignReservations } from "@/lib/api";
import type { FloorMap, RestaurantTable, TableTag } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import type { Placement, Plan } from "@/lib/smart-floor/assign";
import type { FloorContext } from "@/lib/smart-floor/types";
import { cn } from "@/lib/utils";
import { optionNotes, reasonText, tableNamesOf, useTimeFormat } from "./format";
import { PlanningMap } from "./planning-map";

interface PlanReviewProps {
  ctx: FloorContext;
  plan: Plan;
  allowMoves: boolean;
  onAllowMovesChange: (on: boolean) => void;
  tags: TableTag[];
  maps: FloorMap[];
  tables: RestaurantTable[];
  activeMapId: string | null;
  onActiveMapChange: (id: string) => void;
  onDone: (applied: boolean) => void;
}

/** What "Assegna" would do, on the list and on the map, before anything is saved */
export function PlanReview({
  ctx,
  plan,
  allowMoves,
  onAllowMovesChange,
  tags,
  maps,
  tables,
  activeMapId,
  onActiveMapChange,
  onDone,
}: PlanReviewProps) {
  const t = useT();
  const time = useTimeFormat();
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const mapName = (id: string | null) =>
    maps.find((m) => m.id === id)?.name ?? t("reservations.anyRoom");
  const booking = (id: string) => ctx.bookings.get(id)!;
  const byTime = (a: { bookingId: string }, b: { bookingId: string }) =>
    booking(a.bookingId).start - booking(b.bookingId).start;

  const placed = [...plan.placed].sort(byTime);
  const moved = [...plan.moved].sort(byTime);
  const unplaced = [...plan.unplaced].sort(byTime);
  const lost = unplaced.filter((u) => !u.keepsPrevious && u.previousTableIds.length > 0);
  const changed = placed.filter(
    (p) =>
      p.option.tableIds.length !== p.previousTableIds.length ||
      p.option.tableIds.some((id) => !p.previousTableIds.includes(id)),
  );
  const writes = [
    ...changed.map((p) => ({ id: p.bookingId, table_ids: p.option.tableIds })),
    ...moved.map((p) => ({ id: p.bookingId, table_ids: p.option.tableIds })),
    ...lost.map((u) => ({ id: u.bookingId, table_ids: [] })),
  ];

  const marks = new Map<string, TableMark>();
  const shortName = (id: string) => booking(id).name;
  for (const p of placed) {
    for (const id of p.option.tableIds) {
      marks.set(id, { tone: "proposed", label: shortName(p.bookingId) });
    }
  }
  for (const p of moved) {
    for (const id of p.option.tableIds) {
      marks.set(id, { tone: "moved", label: shortName(p.bookingId) });
    }
  }
  const focused = [...placed, ...moved].find((p) => p.bookingId === focus);
  if (focused) {
    for (const id of focused.option.tableIds) {
      marks.set(id, { tone: "picked", label: shortName(focused.bookingId) });
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await assignReservations(writes);
      toast.success(t("reservations.planApplied", { count: changed.length + moved.length }));
      onDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  const row = (p: Placement, kind: "placed" | "moved") => {
    const b = booking(p.bookingId);
    const notes = optionNotes(t, ctx, b, p.option, tagName, mapName);
    const same = kind === "placed" && !changed.includes(p);
    return (
      <li
        key={p.bookingId}
        onMouseEnter={() => setFocus(p.bookingId)}
        onClick={() => setFocus(p.bookingId)}
        className={cn(
          "cursor-default rounded-lg border p-3",
          focus === p.bookingId && "border-violet-600",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold tabular-nums">{time(b.start)}</span>
          <span className="font-medium">{b.name}</span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {b.partySize}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          {p.previousTableIds.length > 0 && !same && (
            <>
              <span className="text-muted-foreground line-through">
                {tableNamesOf(ctx, p.previousTableIds)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </>
          )}
          <span className="font-medium">{tableNamesOf(ctx, p.option.tableIds)}</span>
          <span className="text-muted-foreground">
            · {t("reservations.seatsCount", { count: p.option.seats })}
          </span>
          {same && (
            <span className="text-muted-foreground">· {t("reservations.unchanged")}</span>
          )}
        </div>
        {notes.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{notes.join(" · ")}</p>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <aside className="flex min-h-0 flex-col gap-4 lg:w-[380px] xl:w-[460px] lg:shrink-0">
        <h2 className="text-lg font-semibold">{t("reservations.reviewTitle")}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {placed.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {t("reservations.reviewPlaced", { count: placed.length })}
              </h3>
              <ul className="flex flex-col gap-2">{placed.map((p) => row(p, "placed"))}</ul>
            </section>
          )}
          {moved.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-amber-700">
                {t("reservations.reviewMoved", { count: moved.length })}
              </h3>
              <ul className="flex flex-col gap-2">{moved.map((p) => row(p, "moved"))}</ul>
            </section>
          )}
          {unplaced.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-destructive">
                {t("reservations.reviewUnplaced", { count: unplaced.length })}
              </h3>
              <ul className="flex flex-col gap-2">
                {unplaced.map((u) => {
                  const b = booking(u.bookingId);
                  return (
                    <li key={u.bookingId} className="rounded-lg border border-destructive p-3">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-semibold tabular-nums">{time(b.start)}</span>
                        <span className="font-medium">{b.name}</span>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-3.5 w-3.5" /> {b.partySize}
                        </span>
                      </div>
                      <p className="mt-1 flex gap-2 text-sm">
                        <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                        {reasonText(t, ctx, b, u.reason, tagName)}
                      </p>
                      {u.previousTableIds.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(u.keepsPrevious ? "reservations.keepsPrevious" : "reservations.losesPrevious", {
                            tables: tableNamesOf(ctx, u.previousTableIds),
                          })}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary"
            checked={allowMoves}
            onChange={(e) => onAllowMovesChange(e.target.checked)}
          />
          <span>
            {t("reservations.allowMoves")}
            <span className="block text-xs text-muted-foreground">
              {t("reservations.allowMovesHint")}
            </span>
          </span>
        </label>
        <div className="flex gap-2 pb-2">
          <Button variant="outline" className="h-11 flex-1" onClick={() => onDone(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            className="h-11 flex-1"
            disabled={busy || writes.length === 0}
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
          marks={marks}
          focusTableIds={focused?.option.tableIds ?? placed[0]?.option.tableIds}
        />
      </div>
    </div>
  );
}
