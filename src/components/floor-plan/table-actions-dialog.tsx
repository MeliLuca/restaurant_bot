"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Armchair, ReceiptText, Sparkles, Trash2, Users } from "lucide-react";
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
import type { RestaurantTable, TableStatus } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";
import { STATUS_CONFIG } from "@/lib/floor/status";

interface TableActionsDialogProps {
  table: RestaurantTable | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

export function TableActionsDialog({
  table,
  onClose,
  onChanged,
}: TableActionsDialogProps) {
  const router = useRouter();
  const t = useT();
  const setTicketTable = useTicketStore((s) => s.setTable);
  const setSubtable = useTicketStore((s) => s.setSubtable);
  const canManageTables = usePermission("manage_tables");
  const canTakeOrders = usePermission("take_orders");
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
                          {i.quantity} × {i.menu_items?.name ?? t("floor.itemFallback")}
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
