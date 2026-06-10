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
      toast.error("Customer name is required");
      return;
    }
    if (!Number.isFinite(size) || size < 1) {
      toast.error("Party size must be at least 1");
      return;
    }
    if (!tableId) {
      toast.error("Pick a table");
      return;
    }
    const reservedAt = new Date(`${date}T${time}`);
    if (Number.isNaN(reservedAt.getTime())) {
      toast.error("Invalid date or time");
      return;
    }

    const table = tables.find((t) => t.id === tableId);
    if (table && size > table.capacity) {
      toast.error(
        `Table ${table.name} seats ${table.capacity} — party of ${size} won't fit`,
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
      toast.success(`Reservation for ${customerName.trim()} created`);
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New reservation</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="res-name">Customer name</Label>
            <Input
              id="res-name"
              className="h-12"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Rossi"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="res-party">Party size</Label>
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
              <Label>Table</Label>
              <Select value={tableId} onValueChange={setTableId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Pick a table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · seats {t.capacity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="res-date">Date</Label>
              <Input
                id="res-date"
                className="h-12"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="res-time">Time</Label>
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
            <Label htmlFor="res-notes">Notes (optional)</Label>
            <Input
              id="res-notes"
              className="h-12"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Allergies, occasion, seating preference…"
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
              Cancel
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {busy ? "Saving…" : "Create reservation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
