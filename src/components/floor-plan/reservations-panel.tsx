"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Armchair, CalendarClock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  setReservationStatus,
  updateTableStatus,
} from "@/lib/api";
import type { Reservation, RestaurantTable } from "@/lib/database.types";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

interface ReservationsPanelProps {
  reservations: Reservation[];
  tables: RestaurantTable[];
  onChanged: () => Promise<void>;
}

export function ReservationsPanel({
  reservations,
  tables,
  onChanged,
}: ReservationsPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const tableName = (id: string) =>
    tables.find((t) => t.id === id)?.name ?? "?";

  async function seat(r: Reservation) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, "seated");
      await updateTableStatus(r.table_id, "occupied");
      await onChanged();
      toast.success(`${r.customer_name} seated at ${tableName(r.table_id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not seat party");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(r: Reservation) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, "cancelled");
      await onChanged();
      toast.success(`Reservation for ${r.customer_name} cancelled`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusyId(null);
    }
  }

  const active = reservations.filter(
    (r) => r.status === "booked" || r.status === "seated",
  );

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarClock className="h-5 w-5" /> Today&apos;s reservations
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {active.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            No reservations for today yet.
          </p>
        )}
        {active.map((r, i) => (
          <div key={r.id}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-center gap-3 py-2">
              <div className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                {TIME_FORMATTER.format(new Date(r.reserved_at))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.customer_name}</div>
                <div className="text-xs text-muted-foreground">
                  Party of {r.party_size} · Table {tableName(r.table_id)}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>
              {r.status === "seated" ? (
                <Badge variant="secondary">Seated</Badge>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={busyId === r.id}
                    onClick={() => seat(r)}
                  >
                    <Armchair className="mr-1 h-4 w-4" /> Seat
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 w-10 p-0"
                    aria-label={`Cancel reservation for ${r.customer_name}`}
                    disabled={busyId === r.id}
                    onClick={() => cancel(r)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
