"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createReservation } from "@/lib/api";
import type { RestaurantTable } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";

function todayISODate(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

interface ReservationDialogProps {
  open: boolean;
  tables: RestaurantTable[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export function ReservationDialog({
  open,
  tables,
  onClose,
  onCreated,
}: ReservationDialogProps) {
  const t = useT();
  const [customerName, setCustomerName] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [date, setDate] = useState(todayISODate());
  const [time, setTime] = useState("19:00");
  const [tableId, setTableId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setCustomerName("");
    setPartySize("2");
    setDate(todayISODate());
    setTime("19:00");
    setTableId("");
    setNotes("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const size = parseInt(partySize, 10);
    if (!customerName.trim()) {
      toast.error(t("floor.customerNameRequired"));
      return;
    }
    if (!Number.isFinite(size) || size < 1) {
      toast.error(t("floor.partySizeMin"));
      return;
    }
    if (!tableId) {
      toast.error(t("floor.pickTableError"));
      return;
    }
    const reservedAt = new Date(`${date}T${time}`);
    if (Number.isNaN(reservedAt.getTime())) {
      toast.error(t("floor.invalidDateTime"));
      return;
    }

    const table = tables.find((tb) => tb.id === tableId);
    if (table && size > table.capacity) {
      toast.error(
        t("floor.tableWontFit", {
          name: table.name,
          capacity: table.capacity,
          size,
        }),
      );
      return;
    }

    setBusy(true);
    try {
      await createReservation({
        tableId,
        customerName: customerName.trim(),
        partySize: size,
        reservedAt,
        notes: notes.trim() || undefined,
      });
      await onCreated();
      toast.success(
        t("floor.reservationCreated", { name: customerName.trim() }),
      );
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("floor.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("floor.newReservation")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="res-name">{t("floor.customerName")}</Label>
            <Input
              id="res-name"
              className="h-12"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t("floor.customerNamePlaceholder")}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="res-party">{t("floor.partySize")}</Label>
              <Input
                id="res-party"
                className="h-12"
                type="number"
                min={1}
                inputMode="numeric"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("floor.table")}</Label>
              <Select value={tableId} onValueChange={setTableId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder={t("floor.pickTable")} />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((tb) => (
                    <SelectItem key={tb.id} value={tb.id}>
                      {t("floor.tableSeatsOption", {
                        name: tb.name,
                        count: tb.capacity,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="res-date">{t("floor.date")}</Label>
              <Input
                id="res-date"
                className="h-12"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="res-time">{t("floor.time")}</Label>
              <Input
                id="res-time"
                className="h-12"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="res-notes">{t("floor.notesOptional")}</Label>
            <Input
              id="res-notes"
              className="h-12"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("floor.notesPlaceholder")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={onClose}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {busy ? t("common.saving") : t("floor.createReservation")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
