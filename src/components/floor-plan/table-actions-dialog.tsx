"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Armchair,
  CalendarClock,
  Phone,
  ReceiptText,
  Sparkles,
  Trash2,
  TriangleAlert,
  Unlock,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  fetchOpenOrdersWithItems,
  updateTableStatus,
  type OrderWithItems,
} from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import type {
  Reservation,
  RestaurantTable,
  TableStatus,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";
import { STATUS_CONFIG } from "@/lib/floor/status";
import { menuLabelText, orderItemLabel } from "@/lib/menu-display";

/** Gestione Sala Smart: the next booked party on the table today */
export interface TableBooking {
  reservation: Reservation;
  /** "201 + 202" */
  tables: string;
  /** "20:30" */
  time: string;
  /** Minutes past its time (null = not due yet) */
  lateMinutes: number | null;
  /** Guests seated here now would still be eating when it's due */
  clashesWithWalkIn: boolean;
}

interface TableActionsDialogProps {
  table: RestaurantTable | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  booking?: TableBooking | null;
  /** Seat the booked party (all its tables) */
  onSeatBooking?: (r: Reservation) => Promise<void>;
  /** Late party: give its tables back to the floor */
  onReleaseBooking?: (r: Reservation) => Promise<void>;
}

export function TableActionsDialog({
  table,
  onClose,
  onChanged,
  booking = null,
  onSeatBooking,
  onReleaseBooking,
}: TableActionsDialogProps) {
  const router = useRouter();
  const t = useT();
  const setTicketTable = useTicketStore((s) => s.setTable);
  const setSubtable = useTicketStore((s) => s.setSubtable);
  const canManageTables = usePermission("manage_tables");
  const canTakeOrders = usePermission("take_orders");
  const canReserve = usePermission("manage_reservations");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);

  const tableDbId = table?.id ?? null;
  useEffect(() => {
    setOrders([]);
    if (!tableDbId) return;
    fetchOpenOrdersWithItems(tableDbId)
      .then(setOrders)
      .catch(() => {
        // order list is supplementary; table actions still work without it
      });
  }, [tableDbId]);

  if (!table) return null;
  const status = STATUS_CONFIG[table.status];
  const noActions =
    (!canManageTables && !canTakeOrders) ||
    (table.status === "dirty" && !canManageTables);

  async function changeStatus(next: TableStatus, message: string) {
    if (!table) return;
    setBusy(true);
    try {
      await updateTableStatus(table.id, next);
      await onChanged();
      toast.success(message);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function bookingAction(action: (r: Reservation) => Promise<void>) {
    if (!booking) return;
    setBusy(true);
    try {
      onClose();
      await action(booking.reservation);
    } finally {
      setBusy(false);
    }
  }

  function openInPos(subtable: string | null = null) {
    if (!table) return;
    setTicketTable(table.id, table.name);
    setSubtable(subtable);
    onClose();
    router.push("/pos");
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-2xl">
            {t("floor.tableTitle", { name: table.name })}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.badge}`}
            >
              {t(status.labelKey)}
            </span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            <Users className="h-4 w-4" />{" "}
            {t("floor.seats", { count: table.capacity })}
          </DialogDescription>
        </DialogHeader>

        {orders.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("floor.openOrders")}
            </h3>
            {orders.map((o, idx) => (
              <div key={o.id}>
                {idx > 0 && <Separator className="mb-3" />}
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {o.subtable ? `${table.name}/${o.subtable}` : table.name}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatMoney(o.total)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      {o.order_items.map((i) => (
                        <span
                          key={i.id}
                          className="text-xs text-muted-foreground"
                        >
                          {i.quantity} ×{" "}
                          {menuLabelText(
                            orderItemLabel(i.menu_items, t("floor.itemFallback")),
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                  {canTakeOrders && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 shrink-0"
                      onClick={() => openInPos(o.subtable)}
                    >
                      <ReceiptText className="mr-1 h-4 w-4" /> {t("common.open")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Separator />
          </div>
        )}

        {booking && (
          <div className="flex flex-col gap-2 rounded-lg border border-violet-300 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" /> {t("smartFloor.bookingTitle")}
            </h3>
            <p className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="font-semibold tabular-nums">{booking.time}</span>
              <span className="font-medium">{booking.reservation.customer_name}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> {booking.reservation.party_size}
              </span>
              {booking.lateMinutes !== null && (
                <span className="rounded-full bg-fuchsia-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {t("smartFloor.lateBy", { minutes: booking.lateMinutes })}
                </span>
              )}
            </p>
            {booking.reservation.table_ids.length > 1 && (
              <p className="text-sm text-muted-foreground">
                {t("reservations.tablesLabel", { tables: booking.tables })}
              </p>
            )}
            {booking.reservation.phone && (
              <a
                href={`tel:${booking.reservation.phone.replace(/\s+/g, "")}`}
                className="flex w-fit items-center gap-1 text-sm underline-offset-2 hover:underline"
              >
                <Phone className="h-3.5 w-3.5" /> {booking.reservation.phone}
              </a>
            )}
            <div className="flex flex-wrap gap-2">
              {canReserve && onSeatBooking && (
                <Button
                  className="h-11 flex-1"
                  disabled={busy}
                  onClick={() => void bookingAction(onSeatBooking)}
                >
                  <Armchair className="mr-2 h-4 w-4" />
                  {t("smartFloor.seatParty", { name: booking.reservation.customer_name })}
                </Button>
              )}
              {booking.lateMinutes !== null && onReleaseBooking && (
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={busy}
                  onClick={() => void bookingAction(onReleaseBooking)}
                >
                  <Unlock className="mr-2 h-4 w-4" /> {t("smartFloor.release")}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {noActions && (
            <p className="py-2 text-sm text-muted-foreground">
              {t("floor.noActionsAllowed")}
            </p>
          )}

          {table.status === "available" && (
            <>
              {canManageTables && (
                <Button
                  size="lg"
                  className="h-14 text-base"
                  disabled={busy}
                  onClick={() =>
                    changeStatus(
                      "occupied",
                      t("floor.tableSeated", { name: table.name }),
                    )
                  }
                >
                  <Armchair className="mr-2 h-5 w-5" /> {t("floor.seatGuests")}
                </Button>
              )}
              {booking?.clashesWithWalkIn && (
                <p className="flex gap-2 text-sm text-muted-foreground">
                  <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                  {t("smartFloor.walkInClash", {
                    time: booking.time,
                    name: booking.reservation.customer_name,
                  })}
                </p>
              )}
              {canTakeOrders && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="h-14 text-base"
                  disabled={busy}
                  onClick={() => openInPos()}
                >
                  <ReceiptText className="mr-2 h-5 w-5" /> {t("floor.startOrderInPos")}
                </Button>
              )}
            </>
          )}

          {table.status === "occupied" && (
            <>
              {canTakeOrders && (
                <Button
                  size="lg"
                  className="h-14 text-base"
                  disabled={busy}
                  onClick={() => openInPos()}
                >
                  <ReceiptText className="mr-2 h-5 w-5" /> {t("floor.openTicketInPos")}
                </Button>
              )}
              {canManageTables && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="h-14 text-base"
                  disabled={busy}
                  onClick={() =>
                    changeStatus(
                      "dirty",
                      t("floor.tableMarkedDirty", { name: table.name }),
                    )
                  }
                >
                  <Trash2 className="mr-2 h-5 w-5" /> {t("floor.clearTableDirty")}
                </Button>
              )}
            </>
          )}

          {table.status === "dirty" && canManageTables && (
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy}
              onClick={() =>
                changeStatus(
                  "available",
                  t("floor.tableIsClean", { name: table.name }),
                )
              }
            >
              <Sparkles className="mr-2 h-5 w-5" /> {t("floor.markAsClean")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
