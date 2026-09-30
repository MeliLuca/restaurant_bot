"use client";

// "Accoglienza" beside the Sala map, the desktop twin of the phone's: who is
// arriving today (seat or cancel them), and with Gestione Sala Smart a table
// for a party walking in ("Trova posto") and the waitlist ("Coda"). Booking
// itself lives on the Prenotazioni page; this panel only links there.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, X } from "lucide-react";
import { useListContext } from "@/components/reservations/list-context";
import { ReservationList } from "@/components/reservations/reservation-list";
import { WaitlistDialog } from "@/components/smart-floor/waitlist-dialog";
import { WaitlistQueue } from "@/components/smart-floor/waitlist-queue";
import { WalkInFinder } from "@/components/smart-floor/walk-in-finder";
import { useWalkInFloor, useWalkInQueue } from "@/components/smart-floor/walk-in-shared";
import { Button } from "@/components/ui/button";
import { setReservationStatus } from "@/lib/api";
import type {
  FloorMap,
  Order,
  Reservation,
  TableLink,
  WaitlistEntry,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import type { WalkIn, WalkInOption } from "@/lib/smart-floor/walk-in";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";

export type HostTab = "arrivals" | "find" | "queue";

const NO_SELECTION = new Set<string>();
const noop = () => {};

export function HostPanel({
  tab,
  onTab,
  walkIns,
  tables,
  reservations,
  links,
  maps,
  openOrders,
  waitlist,
  now,
  onPick,
  onSeat,
  onChanged,
  onClose,
}: {
  tab: HostTab;
  onTab: (tab: HostTab) => void;
  /** "Trova posto" and "Coda" too (Gestione Sala Smart on, manage_tables) */
  walkIns: boolean;
  tables: TableWithTags[];
  /** Today's */
  reservations: Reservation[];
  links: TableLink[];
  maps: FloorMap[];
  openOrders: Order[];
  /** Waiting parties, in arrival order */
  waitlist: WaitlistEntry[];
  now: number;
  /** The walk-in option to show on the map (null = none), with its label there */
  onPick: (option: WalkInOption | null, label: string) => void;
  /** Seat a booked party (checks its table is still free) */
  onSeat: (r: Reservation) => Promise<void>;
  /** The floor, the bookings or the queue changed: read them again */
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const canEdit = usePermission("manage_reservations");
  const list = useListContext({ tables, reservations, maps });
  const floor = useWalkInFloor({
    tables,
    reservations,
    links,
    maps,
    openOrders,
    now,
    enabled: walkIns,
  });
  const { matches, claims } = useWalkInQueue(floor, waitlist);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    editing: WaitlistEntry | null;
    prefill: WalkIn | null;
  } | null>(null);

  const shown: HostTab = walkIns ? tab : "arrivals";
  const arriving = reservations.filter(
    (r) => r.status === "booked" || r.status === "seated",
  ).length;
  const tabs: { value: HostTab; label: string }[] = [
    { value: "arrivals", label: t("floor.arrivalsTab", { count: arriving }) },
    ...(walkIns
      ? [
          { value: "find" as const, label: t("walkIn.title") },
          { value: "queue" as const, label: t("queue.tab", { count: waitlist.length }) },
        ]
      : []),
  ];

  async function cancel(r: Reservation) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, "cancelled");
      await onChanged();
      toast.success(t("floor.reservationCancelled", { name: r.customer_name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotCancel"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      aria-label={t("floor.hostPanel")}
      className="flex h-full min-h-0 flex-col rounded-xl border bg-card"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div role="tablist" className="flex flex-1 flex-wrap gap-1">
          {tabs.map((tb) => (
            <button
              key={tb.value}
              type="button"
              role="tab"
              aria-selected={shown === tb.value}
              onClick={() => onTab(tb.value)}
              className={cn(
                "flex h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                shown === tb.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          aria-label={t("floor.hostPanelClose")}
          title={t("floor.hostPanelClose")}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div
        role="tabpanel"
        className={cn(
          "min-h-0 flex-1",
          shown === "arrivals" ? "flex flex-col gap-3 p-3" : "overflow-y-auto",
        )}
      >
        {shown === "arrivals" ? (
          <>
            {canEdit && (
              <Button asChild variant="outline" className="h-10 w-fit shrink-0">
                <Link href="/prenotazioni?new=1">
                  <CalendarPlus className="mr-2 h-4 w-4" /> {t("floor.newReservation")}
                </Link>
              </Button>
            )}
            {list.ctx ? (
              <ReservationList
                reservations={reservations}
                ctx={list.ctx}
                tags={list.tags}
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
                // tables and details are changed where bookings are made
                onEdit={(r) => router.push(`/prenotazioni?edit=${r.id}`)}
                onSeat={(r) => {
                  setBusyId(r.id);
                  void onSeat(r).finally(() => setBusyId(null));
                }}
                onCancel={(r) => void cancel(r)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
          </>
        ) : shown === "find" ? (
          <WalkInFinder
            floor={floor}
            reservations={reservations}
            maps={maps}
            now={now}
            claims={claims}
            onPick={onPick}
            onQueue={(prefill) => setDialog({ editing: null, prefill })}
            onSeated={async () => {
              await onChanged();
              onClose();
            }}
          />
        ) : (
          <WaitlistQueue
            floor={floor}
            entries={waitlist}
            matches={matches}
            maps={maps}
            now={now}
            onPick={onPick}
            onAdd={() => setDialog({ editing: null, prefill: null })}
            onEdit={(editing) => setDialog({ editing, prefill: null })}
            onChanged={onChanged}
          />
        )}
      </div>

      {walkIns && (
        <WaitlistDialog
          open={dialog !== null}
          editing={dialog?.editing ?? null}
          prefill={dialog?.prefill ?? null}
          tags={floor.tags}
          maps={maps}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            await onChanged();
            // a party just queued from "Trova posto": show it in line
            if (!dialog?.editing) onTab("queue");
          }}
        />
      )}
    </section>
  );
}
