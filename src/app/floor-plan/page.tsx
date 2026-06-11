"use client";

import { useState } from "react";
import { CalendarPlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReservationDialog } from "@/components/floor-plan/reservation-dialog";
import { ReservationsPanel } from "@/components/floor-plan/reservations-panel";
import { STATUS_CONFIG } from "@/components/floor-plan/status";
import { TableActionsDialog } from "@/components/floor-plan/table-actions-dialog";
import { TableCard } from "@/components/floor-plan/table-card";
import { TakeawayPanel } from "@/components/floor-plan/takeaway-panel";
import { useFloorData } from "@/hooks/use-floor-data";
import type { RestaurantTable, TableStatus } from "@/lib/database.types";
import { usePermission } from "@/stores/auth-store";

const LEGEND: TableStatus[] = ["available", "occupied", "dirty"];

export default function FloorPlanPage() {
  const { tables, reservations, takeaways, loading, error, refresh } =
    useFloorData();
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(
    null,
  );
  const [reservationOpen, setReservationOpen] = useState(false);
  const canReserve = usePermission("manage_reservations");

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">Can&apos;t reach the database</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-semibold">Floor Plan</h1>
          <div className="hidden items-center gap-4 sm:flex">
            {LEGEND.map((s) => (
              <span
                key={s}
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <span
                  className={`h-3 w-3 rounded-full ${STATUS_CONFIG[s].dot}`}
                />
                {STATUS_CONFIG[s].label}
              </span>
            ))}
          </div>
        </div>
        {canReserve && (
          <Button
            size="lg"
            className="h-12"
            onClick={() => setReservationOpen(true)}
          >
            <CalendarPlus className="mr-2 h-5 w-5" /> New reservation
          </Button>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="min-h-28 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <div className="grid auto-rows-min grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {tables.map((t) => (
              <TableCard key={t.id} table={t} onSelect={setSelectedTable} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-6">
          <ReservationsPanel
            reservations={reservations}
            tables={tables}
            onChanged={refresh}
          />
          <TakeawayPanel takeaways={takeaways} />
        </div>
      </div>

      <TableActionsDialog
        table={selectedTable}
        onClose={() => setSelectedTable(null)}
        onChanged={refresh}
      />
      <ReservationDialog
        open={reservationOpen}
        tables={tables}
        onClose={() => setReservationOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
}
