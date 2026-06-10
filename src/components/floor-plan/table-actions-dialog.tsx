"use client";

import { useState } from "react";
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
import { updateTableStatus } from "@/lib/api";
import type { RestaurantTable, TableStatus } from "@/lib/database.types";
import { useTicketStore } from "@/stores/ticket-store";
import { STATUS_CONFIG } from "./status";

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
  const setTicketTable = useTicketStore((s) => s.setTable);
  const [busy, setBusy] = useState(false);

  if (!table) return null;
  const status = STATUS_CONFIG[table.status];

  async function changeStatus(next: TableStatus, message: string) {
    if (!table) return;
    setBusy(true);
    try {
      await updateTableStatus(table.id, next);
      await onChanged();
      toast.success(message);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  function openInPos() {
    if (!table) return;
    setTicketTable(table.id, table.name);
    onClose();
    router.push("/pos");
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-2xl">
            Table {table.name}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.badge}`}
            >
              {status.label}
            </span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            <Users className="h-4 w-4" /> Seats {table.capacity}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {table.status === "available" && (
            <>
              <Button
                size="lg"
                className="h-14 text-base"
                disabled={busy}
                onClick={() =>
                  changeStatus("occupied", `Table ${table.name} seated`)
                }
              >
                <Armchair className="mr-2 h-5 w-5" /> Seat guests
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 text-base"
                disabled={busy}
                onClick={openInPos}
              >
                <ReceiptText className="mr-2 h-5 w-5" /> Start order in POS
              </Button>
            </>
          )}

          {table.status === "occupied" && (
            <>
              <Button
                size="lg"
                className="h-14 text-base"
                disabled={busy}
                onClick={openInPos}
              >
                <ReceiptText className="mr-2 h-5 w-5" /> Open ticket in POS
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 text-base"
                disabled={busy}
                onClick={() =>
                  changeStatus("dirty", `Table ${table.name} marked dirty`)
                }
              >
                <Trash2 className="mr-2 h-5 w-5" /> Clear table (mark dirty)
              </Button>
            </>
          )}

          {table.status === "dirty" && (
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy}
              onClick={() =>
                changeStatus("available", `Table ${table.name} is clean`)
              }
            >
              <Sparkles className="mr-2 h-5 w-5" /> Mark as clean
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
