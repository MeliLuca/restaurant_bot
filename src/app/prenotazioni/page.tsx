"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { TableMark } from "@/components/floor-map/floor-map-view";
import { PlanReview } from "@/components/reservations/plan-review";
import { PlanningMap } from "@/components/reservations/planning-map";
import { ReservationForm } from "@/components/reservations/reservation-form";
import { ReservationList } from "@/components/reservations/reservation-list";
import { tableNamesOf } from "@/components/reservations/format";
import { useSeatFlow } from "@/components/reservations/seat-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import { dayKey, dayStart, useReservationsDay } from "@/hooks/use-reservations-day";
import { setReservationStatus, updateReservation } from "@/lib/api";
import type { Reservation } from "@/lib/database.types";
import { useIsPhone } from "@/lib/device";
import { useT } from "@/lib/i18n/use-translation";
import { planAssignments } from "@/lib/smart-floor/assign";
import { buildFloorContext } from "@/lib/smart-floor/context";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor } from "@/stores/smart-floor-store";

type View =
  | { kind: "list" }
  | { kind: "form"; editing: Reservation | null }
  | { kind: "review"; ids: string[]; allowMoves: boolean };

function shiftDay(key: string, days: number): string {
  const d = dayStart(key);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

export default function ReservationsPage() {
  const t = useT();
  const canEdit = usePermission("manage_reservations");
  const canPlanPerm = usePermission("plan_floor");
  const canManageFloor = usePermission("manage_floor");
  const isPhone = useIsPhone();
  const canPlan = canPlanPerm && !isPhone;
  const { enabled, loaded } = useSmartFloor();

  const [day, setDay] = useState(() => dayKey(new Date()));
  const [view, setView] = useState<View>({ kind: "list" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const { snapshot, maps, error, refresh } = useReservationsDay(day);
  const now = useNow(30_000);

  // Sala → "Nuova prenotazione" lands here with ?new=1 (and maybe ?d=)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get("d");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDay(d);
    if (q.get("new") === "1") setView({ kind: "form", editing: null });
    if (window.location.search) window.history.replaceState(null, "", "/prenotazioni");
  }, []);

  // a new day, a new selection
  useEffect(() => setSelected(new Set()), [day]);

  const ctx = useMemo(
    () => (snapshot ? buildFloorContext(snapshot) : null),
    [snapshot],
  );
  const reservations = snapshot?.reservations ?? [];
  const tables = snapshot?.tables ?? [];
  const isToday = day === dayKey(new Date());
  const seatFlow = useSeatFlow({
    maps,
    canPlan,
    tableNames: (ids) => (ctx ? tableNamesOf(ctx, ids) : ""),
    onDone: refresh,
  });

  const plan = useMemo(
    () =>
      ctx && view.kind === "review"
        ? planAssignments(ctx, view.ids, { allowMoves: view.allowMoves })
        : null,
    [ctx, view],
  );

  async function run(id: string, action: () => Promise<void>, success: string) {
    setBusyId(id);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusyId(null);
    }
  }

  if (!canEdit && !canPlanPerm) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("reservations.needsPermission")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loaded && !enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{t("reservations.moduleOffTitle")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("reservations.moduleOffBody")}
        </p>
        {canManageFloor && (
          <Button asChild>
            <Link href="/settings/modules">{t("reservations.openModules")}</Link>
          </Button>
        )}
      </div>
    );
  }

  const focused = reservations.find((r) => r.id === focusId);
  const listMarks = new Map<string, TableMark>();
  for (const id of focused?.table_ids ?? []) {
    listMarks.set(id, { tone: "picked", label: focused!.customer_name });
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t("reservations.title")}</h1>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            aria-label={t("reservations.prevDay")}
            disabled={view.kind !== "list"}
            onClick={() => setDay((d) => shiftDay(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            className="h-11 w-44"
            value={day}
            aria-label={t("floor.date")}
            disabled={view.kind !== "list"}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            aria-label={t("reservations.nextDay")}
            disabled={view.kind !== "list"}
            onClick={() => setDay((d) => shiftDay(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && view.kind === "list" && (
            <Button variant="ghost" className="h-11" onClick={() => setDay(dayKey(new Date()))}>
              {t("reservations.today")}
            </Button>
          )}
        </div>
        {canEdit && view.kind === "list" && (
          <Button
            className="ml-auto h-11"
            onClick={() => setView({ kind: "form", editing: null })}
          >
            <CalendarPlus className="mr-2 h-4 w-4" /> {t("floor.newReservation")}
          </Button>
        )}
      </div>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <p className="max-w-md text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => void refresh()}>{t("common.retry")}</Button>
        </div>
      ) : view.kind === "form" ? (
        <ReservationForm
          ctx={ctx}
          reservations={reservations}
          tags={snapshot?.tags ?? []}
          maps={maps}
          tables={tables}
          phoneRequired={snapshot?.settings.phone_required ?? true}
          day={day}
          onDayChange={setDay}
          editing={view.editing}
          canPlan={canPlan}
          activeMapId={activeMapId}
          onActiveMapChange={setActiveMapId}
          onDone={(savedId) => {
            setView({ kind: "list" });
            if (savedId) {
              setFocusId(savedId);
              void refresh();
            }
          }}
        />
      ) : !ctx || !snapshot ? (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="w-[460px] animate-pulse rounded-xl bg-muted" />
          <div className="flex-1 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : view.kind === "review" && plan ? (
        <PlanReview
          ctx={ctx}
          plan={plan}
          allowMoves={view.allowMoves}
          onAllowMovesChange={(on) => setView({ ...view, allowMoves: on })}
          tags={snapshot.tags}
          maps={maps}
          tables={tables}
          activeMapId={activeMapId}
          onActiveMapChange={setActiveMapId}
          onDone={(applied) => {
            setView({ kind: "list" });
            if (applied) {
              setSelected(new Set());
              void refresh();
            }
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <aside className="flex min-h-0 flex-col lg:w-[380px] xl:w-[460px] lg:shrink-0">
            <ReservationList
              reservations={reservations}
              ctx={ctx}
              tags={snapshot.tags}
              canPlan={canPlan}
              canEdit={canEdit}
              isToday={isToday}
              now={now}
              busyId={busyId}
              focusId={focusId}
              onFocus={setFocusId}
              selected={selected}
              onSelectedChange={setSelected}
              onEdit={(r) => setView({ kind: "form", editing: r })}
              onAssign={(ids) => setView({ kind: "review", ids, allowMoves: false })}
              onSeat={(r) => {
                setBusyId(r.id);
                void seatFlow.seat(r).finally(() => setBusyId(null));
              }}
              onCancel={(r) =>
                void run(
                  r.id,
                  () => setReservationStatus(r.id, "cancelled"),
                  t("floor.reservationCancelled", { name: r.customer_name }),
                )
              }
              onToggleLock={(r) =>
                void run(
                  r.id,
                  () => updateReservation(r.id, { locked: !r.locked }),
                  t(r.locked ? "reservations.unlocked" : "reservations.lockedToast", {
                    name: r.customer_name,
                  }),
                )
              }
            />
          </aside>
          <div className="min-h-[360px] flex-1">
            <PlanningMap
              maps={maps}
              tables={tables}
              activeMapId={activeMapId}
              onActiveMapChange={setActiveMapId}
              marks={listMarks}
              focusTableIds={focused?.table_ids}
            />
          </div>
        </div>
      )}
      {seatFlow.element}
    </div>
  );
}
