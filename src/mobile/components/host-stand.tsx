"use client";

// "Accoglienza" on the phone (Gestione Sala Smart): whoever is at the door
// finds a table for a party walking in, runs the waitlist and sees today's
// bookings. No planning here — assigning tables is done from a computer.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReservationList } from "@/components/reservations/reservation-list";
import { useSeatFlow } from "@/components/reservations/seat-flow";
import { tableNamesOf } from "@/components/reservations/format";
import { WaitlistDialog } from "@/components/smart-floor/waitlist-dialog";
import { WaitlistQueue } from "@/components/smart-floor/waitlist-queue";
import { WalkInFinder } from "@/components/smart-floor/walk-in-finder";
import { useWalkInFloor, useWalkInQueue } from "@/components/smart-floor/walk-in-shared";
import type { WalkIn } from "@/lib/smart-floor/walk-in";
import { useFloorData } from "@/hooks/use-floor-data";
import { useNow } from "@/hooks/use-now";
import { useWaitlist } from "@/hooks/use-waitlist";
import { setReservationStatus } from "@/lib/api";
import type { WaitlistEntry } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor } from "@/stores/smart-floor-store";
import { mRoutes, type HostStandTab } from "@/mobile/lib/routes";
import { MHeader } from "./m-header";

const NO_SELECTION = new Set<string>();
const noop = () => {};

export function HostStand({ initialTab }: { initialTab: HostStandTab }) {
  const t = useT();
  const router = useRouter();
  const { enabled } = useSmartFloor();
  const canEdit = usePermission("manage_reservations");
  const now = useNow(30_000);
  const { tables, reservations, links, maps, openOrders, loading, refresh } = useFloorData();
  const waitlist = useWaitlist(enabled);
  const floor = useWalkInFloor({ tables, reservations, links, maps, openOrders, now });
  const { matches, claims } = useWalkInQueue(floor, waitlist.entries);
  const [tab, setTab] = useState<HostStandTab>(initialTab);
  const [dialog, setDialog] = useState<{
    editing: WaitlistEntry | null;
    prefill: WalkIn | null;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tableNames = (ids: string[]) => (floor.ctx ? tableNamesOf(floor.ctx, ids) : "—");
  const seatFlow = useSeatFlow({ maps, canPlan: false, tableNames, onDone: refresh });

  async function changed() {
    await Promise.all([refresh(), waitlist.refresh()]);
  }

  const active = reservations.filter((r) => r.status === "booked" || r.status === "seated");
  const tabs: { value: HostStandTab; label: string }[] = [
    { value: "find", label: t("walkIn.title") },
    { value: "queue", label: t("queue.tab", { count: waitlist.entries.length }) },
    { value: "today", label: t("m.todayTab", { count: active.length }) },
  ];

  function pickTab(next: HostStandTab) {
    setTab(next);
    // the tab is in the URL, so "back" from a table returns to it
    router.replace(mRoutes.hostStand(next));
  }

  if (!enabled) {
    return (
      <>
        <MHeader title={t("m.hostStand")} backHref={mRoutes.tables()} />
        <p className="p-4 text-sm text-muted-foreground">{t("m.smartFloorOff")}</p>
      </>
    );
  }

  return (
    <>
      <MHeader title={t("m.hostStand")} backHref={mRoutes.tables()} />
      <div role="tablist" className="flex shrink-0 gap-1 border-b bg-card p-2">
        {tabs.map((tb) => (
          <button
            key={tb.value}
            type="button"
            role="tab"
            aria-selected={tab === tb.value}
            onClick={() => pickTab(tb.value)}
            className={cn(
              "flex h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors",
              tab === tb.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        className={cn(
          "min-h-0 flex-1",
          tab === "today" ? "flex flex-col p-3" : "overflow-y-auto",
        )}
      >
        {loading || !floor.ctx ? (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        ) : tab === "find" ? (
          <WalkInFinder
            floor={floor}
            reservations={reservations}
            maps={maps}
            now={now}
            claims={claims}
            onPick={noop}
            onQueue={(prefill) => setDialog({ editing: null, prefill })}
            onSeated={async () => {
              await changed();
              router.push(mRoutes.tables());
            }}
          />
        ) : tab === "queue" ? (
          <WaitlistQueue
            floor={floor}
            entries={waitlist.entries}
            matches={matches}
            maps={maps}
            now={now}
            onPick={noop}
            onAdd={() => setDialog({ editing: null, prefill: null })}
            onEdit={(editing) => setDialog({ editing, prefill: null })}
            onChanged={changed}
          />
        ) : (
          <ReservationList
            reservations={reservations}
            ctx={floor.ctx}
            tags={floor.tags}
            maps={maps}
            canPlan={false}
            canEdit={canEdit}
            isToday
            now={now}
            busyId={busyId}
            focusId={null}
            onFocus={noop}
            selected={NO_SELECTION}
            onSelectedChange={noop}
            onAssign={noop}
            onToggleLock={noop}
            onSeat={(r) => {
              setBusyId(r.id);
              void seatFlow.seat(r).finally(() => setBusyId(null));
            }}
            onCancel={async (r) => {
              if (!window.confirm(t("m.cancelBookingConfirm", { name: r.customer_name }))) {
                return;
              }
              setBusyId(r.id);
              try {
                await setReservationStatus(r.id, "cancelled");
                await refresh();
                toast.success(t("floor.reservationCancelled", { name: r.customer_name }));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
              } finally {
                setBusyId(null);
              }
            }}
          />
        )}
      </div>

      <WaitlistDialog
        open={dialog !== null}
        editing={dialog?.editing ?? null}
        prefill={dialog?.prefill ?? null}
        tags={floor.tags}
        maps={maps}
        onClose={() => setDialog(null)}
        onSaved={async () => {
          await changed();
          if (!dialog?.editing) pickTab("queue");
        }}
      />
      {seatFlow.element}
    </>
  );
}
