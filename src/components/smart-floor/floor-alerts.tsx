"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Armchair,
  ArrowRight,
  BellRing,
  ChevronDown,
  Clock,
  Hourglass,
  LogOut,
  Phone,
  SkipForward,
  Sparkles,
  Unlock,
  UserX,
  Users,
} from "lucide-react";
import { useSeatFlow } from "@/components/reservations/seat-flow";
import { useTimeFormat } from "@/components/reservations/format";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { dayKey, useReservationsDay } from "@/hooks/use-reservations-day";
import { useWaitlist } from "@/hooks/use-waitlist";
import {
  releaseReservationTables,
  seatReservation,
  setReservationStatus,
  snoozeReservationAlert,
} from "@/lib/api";
import type { TableStatus, WaitlistEntry } from "@/lib/database.types";
import { useIsPhone } from "@/lib/device";
import { compareTableNames } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import { floorAlerts, snoozeUntil, type FloorAlert } from "@/lib/smart-floor/alerts";
import { buildFloorContext } from "@/lib/smart-floor/context";
import { QUEUE_SKIP_MINUTES, matchQueue, readyParties } from "@/lib/smart-floor/queue";
import type { WalkInOption } from "@/lib/smart-floor/walk-in";
import {
  resolveWaitlistEntry,
  seatWaitlistEntry,
  skipWaitlistEntry,
  toQueueParty,
} from "@/lib/smart-floor/waitlist-api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor } from "@/stores/smart-floor-store";
import { takenMeanwhile, waitedText } from "./walk-in-shared";

/**
 * Gestione Sala Smart's alerts, on every page, only for floor_alerts
 * (Admin, Sala Manager): a table ready for a party on the waitlist, a party
 * late beyond the limit ("Aspetta / Libera il tavolo") or due soon while its
 * table is still occupied ("Altro tavolo").
 */
export function FloorAlerts() {
  const canSee = usePermission("floor_alerts");
  const { enabled } = useSmartFloor();
  if (!canSee || !enabled) return null;
  return <FloorAlertsStack />;
}

function FloorAlertsStack() {
  const t = useT();
  const time = useTimeFormat();
  const now = useNow(30_000);
  const { snapshot, maps, refresh } = useReservationsDay(dayKey(new Date(now)));
  const waitlist = useWaitlist();
  const canRelease = usePermission("plan_floor");
  const canSeat = usePermission("manage_tables");
  const isPhone = useIsPhone();
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // bottom-left sits over the map on Sala and over the menu in Cassa (never
  // over the pay buttons); on Prenotazioni the list is there, the map right
  const onRight = usePathname().startsWith("/prenotazioni");

  const tableName = new Map((snapshot?.tables ?? []).map((tb) => [tb.id, tb.name]));
  const tableNames = (ids: string[]) =>
    ids
      .map((id) => tableName.get(id) ?? "?")
      .sort(compareTableNames)
      .join(" + ") || "—";
  const flow = useSeatFlow({
    maps,
    canPlan: canRelease && !isPhone,
    tableNames,
    onDone: refresh,
  });

  const alerts: FloorAlert[] = snapshot
    ? floorAlerts(
        snapshot.reservations,
        new Map<string, TableStatus>(snapshot.tables.map((tb) => [tb.id, tb.status])),
        snapshot.settings,
        now,
      )
    : [];

  // the waitlist, first come first served: parties whose table is ready
  const ready: { entry: WaitlistEntry; option: WalkInOption }[] = useMemo(() => {
    if (!snapshot || waitlist.entries.length === 0) return [];
    const parties = waitlist.entries.map(toQueueParty);
    // pre-conto and desserts only matter for tables not free yet: not read here
    const matches = matchQueue(buildFloorContext(snapshot, now), parties, new Map());
    const byId = new Map(waitlist.entries.map((e) => [e.id, e]));
    return readyParties(parties, matches).map(({ party, option }) => ({
      entry: byId.get(party.id)!,
      option,
    }));
  }, [snapshot, now, waitlist.entries]);

  // a new alert opens the stack again
  const keys = [
    ...ready.map((q) => `queue:${q.entry.id}:${q.option.tableIds.join("+")}`),
    ...alerts.map((a) => `${a.kind}:${a.reservation.id}`),
  ].join(",");
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set(keys ? keys.split(",") : []);
    if (Array.from(next).some((k) => !seen.current.has(k))) setCollapsed(false);
    seen.current = next;
  }, [keys]);

  async function run(r: { id: string }, action: () => Promise<void>, success: string) {
    setBusyId(r.id);
    try {
      await action();
      toast.success(success);
      await Promise.all([refresh(), waitlist.refresh()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusyId(null);
    }
  }

  async function seatFromQueue(entry: WaitlistEntry, option: WalkInOption) {
    const tables = tableNames(option.tableIds);
    const taken = await takenMeanwhile(option.tableIds).catch(() => []);
    if (taken.length > 0) {
      toast.error(t("walkIn.justTaken", { tables: tableNames(taken) }));
      await refresh();
      return;
    }
    await run(
      entry,
      () => seatWaitlistEntry(entry.id, option.tableIds),
      t("queue.seated", { name: entry.customer_name, tables }),
    );
  }

  const total = ready.length + alerts.length;
  if (total === 0) return <>{flow.element}</>;

  return (
    <>
      <div
        className={cn(
          "fixed bottom-20 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 print:hidden sm:bottom-4",
          onRight ? "right-4 items-end" : "left-4 sm:left-28 lg:left-60",
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex w-fit items-center gap-2 rounded-full bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-fuchsia-700"
          >
            <BellRing className="h-4 w-4" />
            {t("smartFloor.alertsCount", { count: total })}
          </button>
        ) : (
          <div className="flex max-h-[70dvh] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <BellRing className="h-4 w-4 text-fuchsia-600" />
              <span className="flex-1 text-sm font-semibold">
                {t("smartFloor.alertsTitle", { count: total })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label={t("smartFloor.alertsHide")}
                title={t("smartFloor.alertsHide")}
                onClick={() => setCollapsed(true)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            <ul className="flex flex-col divide-y overflow-y-auto">
              {ready.map(({ entry, option }) => {
                const busy = busyId === entry.id;
                const dirty = option.state === "dirty";
                return (
                  <li key={`queue:${entry.id}`} className="flex flex-col gap-2 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm">
                          <span className="truncate font-medium">{entry.customer_name}</span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" /> {entry.party_size}
                          </span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Hourglass className="h-3.5 w-3.5" />
                            {waitedText(t, Date.parse(entry.created_at), now)}
                          </span>
                        </p>
                        <p className="text-sm">
                          {t(dirty ? "queue.state.dirty" : "queue.state.free", {
                            tables: tableNames(option.tableIds),
                          })}
                        </p>
                        {entry.phone && (
                          <a
                            href={`tel:${entry.phone.replace(/\s+/g, "")}`}
                            className="mt-0.5 flex w-fit items-center gap-1 text-sm underline-offset-2 hover:underline"
                          >
                            <Phone className="h-3.5 w-3.5" /> {entry.phone}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {canSeat && (
                        <Button
                          size="sm"
                          className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
                          disabled={busy}
                          onClick={() => void seatFromQueue(entry, option)}
                        >
                          {dirty ? (
                            <Sparkles className="mr-1 h-4 w-4" />
                          ) : (
                            <Armchair className="mr-1 h-4 w-4" />
                          )}
                          {t(dirty ? "walkIn.seatClean" : "walkIn.seat")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            entry,
                            () =>
                              skipWaitlistEntry(
                                entry.id,
                                new Date(Date.now() + QUEUE_SKIP_MINUTES * 60_000),
                              ),
                            t("queue.skipped", { name: entry.customer_name }),
                          )
                        }
                      >
                        <SkipForward className="mr-1 h-4 w-4" /> {t("queue.skip")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 text-muted-foreground"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            entry,
                            () => resolveWaitlistEntry(entry.id, "left"),
                            t("queue.leftDone", { name: entry.customer_name }),
                          )
                        }
                      >
                        <LogOut className="mr-1 h-4 w-4" /> {t("queue.left")}
                      </Button>
                    </div>
                  </li>
                );
              })}
              {alerts.map((a) => {
                const r = a.reservation;
                const late = a.kind === "late";
                const busy = busyId === r.id;
                return (
                  <li key={`${a.kind}:${r.id}`} className="flex flex-col gap-2 p-3">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                          late ? "bg-fuchsia-600" : "bg-amber-500",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm">
                          <span className="font-semibold tabular-nums">
                            {time(r.reserved_at)}
                          </span>
                          <span className="truncate font-medium">{r.customer_name}</span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" /> {r.party_size}
                          </span>
                          <span className="text-muted-foreground">
                            · {t("reservations.tablesLabel", { tables: tableNames(r.table_ids) })}
                          </span>
                        </p>
                        <p className="text-sm">
                          {late
                            ? t("smartFloor.lateBy", { minutes: a.lateMinutes })
                            : a.lateMinutes < 0
                              ? t("smartFloor.occupiedDueIn", {
                                  tables: tableNames(a.occupiedTableIds),
                                  minutes: -a.lateMinutes,
                                })
                              : t("smartFloor.occupiedDueNow", {
                                  tables: tableNames(a.occupiedTableIds),
                                })}
                          {late && a.occupiedTableIds.length > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {t("smartFloor.tableTaken", {
                                tables: tableNames(a.occupiedTableIds),
                              })}
                            </span>
                          )}
                        </p>
                        {r.phone && (
                          <a
                            href={`tel:${r.phone.replace(/\s+/g, "")}`}
                            className="mt-0.5 flex w-fit items-center gap-1 text-sm underline-offset-2 hover:underline"
                          >
                            <Phone className="h-3.5 w-3.5" /> {r.phone}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            r,
                            () => snoozeReservationAlert(r.id, snoozeUntil(a, Date.now())),
                            t("smartFloor.snoozed", { name: r.customer_name }),
                          )
                        }
                      >
                        <Clock className="mr-1 h-4 w-4" /> {t("smartFloor.wait")}
                      </Button>
                      {late && canRelease && (
                        <Button
                          size="sm"
                          className="h-9 bg-fuchsia-600 text-white hover:bg-fuchsia-700"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              r,
                              () => releaseReservationTables(r.id),
                              t("smartFloor.released", {
                                tables: tableNames(r.table_ids),
                                name: r.customer_name,
                              }),
                            )
                          }
                        >
                          <Unlock className="mr-1 h-4 w-4" /> {t("smartFloor.release")}
                        </Button>
                      )}
                      {late && a.occupiedTableIds.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              r,
                              () => seatReservation(r),
                              t("floor.seatedAt", {
                                name: r.customer_name,
                                table: tableNames(r.table_ids),
                              }),
                            )
                          }
                        >
                          <Armchair className="mr-1 h-4 w-4" /> {t("smartFloor.alreadySeated")}
                        </Button>
                      )}
                      {!late && canRelease && !isPhone && (
                        <Button
                          size="sm"
                          className="h-9"
                          disabled={busy}
                          onClick={() => flow.move(r, a.occupiedTableIds)}
                        >
                          <ArrowRight className="mr-1 h-4 w-4" /> {t("smartFloor.otherTable")}
                        </Button>
                      )}
                      {late && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 text-muted-foreground"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              r,
                              () => setReservationStatus(r.id, "no_show"),
                              t("smartFloor.noShowDone", { name: r.customer_name }),
                            )
                          }
                        >
                          <UserX className="mr-1 h-4 w-4" /> {t("smartFloor.noShow")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      {flow.element}
    </>
  );
}
