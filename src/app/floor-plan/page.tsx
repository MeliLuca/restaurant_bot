"use client";

import { useState } from "react";
import {
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReservationDialog } from "@/components/floor-plan/reservation-dialog";
import { ReservationsPanel } from "@/components/floor-plan/reservations-panel";
import { STATUS_CONFIG } from "@/components/floor-plan/status";
import { TableActionsDialog } from "@/components/floor-plan/table-actions-dialog";
import { TableCard } from "@/components/floor-plan/table-card";
import { TakeawayPanel } from "@/components/floor-plan/takeaway-panel";
import { useFloorData } from "@/hooks/use-floor-data";
import type { RestaurantTable, TableStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";

const LEGEND: TableStatus[] = ["available", "occupied", "dirty"];

export default function FloorPlanPage() {
  const { tables, reservations, takeaways, openOrders, loading, error, refresh } =
    useFloorData();

  const splitsByTable = new Map<string, (string | null)[]>();
  for (const o of openOrders) {
    if (!o.table_id) continue;
    const list = splitsByTable.get(o.table_id) ?? [];
    list.push(o.subtable);
    splitsByTable.set(o.table_id, list);
  }
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(
    null,
  );
  const [reservationOpen, setReservationOpen] = useState(false);
  const [reservationsExpanded, setReservationsExpanded] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const canReserve = usePermission("manage_reservations");

  const activeReservations = reservations.filter(
    (r) => r.status === "booked" || r.status === "seated",
  ).length;

  const allTags = Array.from(
    new Map(
      tables.flatMap((t) => t.table_tags).map((tag) => [tag.id, tag]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  // AND semantics: a table must offer every selected feature
  const visibleTables = tables.filter((t) =>
    selectedTagIds.every((id) => t.table_tags.some((tag) => tag.id === id)),
  );

  function toggleTag(id: string) {
    setSelectedTagIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

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
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
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

      <Tabs defaultValue="tables" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-12 w-fit shrink-0">
          <TabsTrigger value="tables" className="h-10 px-6 text-base">
            Tables
          </TabsTrigger>
          <TabsTrigger value="delivery" className="h-10 px-6 text-base">
            Delivery
            {takeaways.length > 0 && (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {takeaways.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="tables"
          className="mt-4 min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          <div className="flex h-full min-h-0 flex-col gap-4 xl:flex-row">
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-11"
                  aria-expanded={reservationsExpanded}
                  onClick={() => setReservationsExpanded((e) => !e)}
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Today&apos;s reservations
                  {activeReservations > 0 && ` (${activeReservations})`}
                  <ChevronDown
                    className={cn(
                      "ml-2 h-4 w-4 transition-transform",
                      reservationsExpanded && "rotate-180",
                    )}
                  />
                </Button>
                {allTags.map((tag) => {
                  const active = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "flex h-11 items-center rounded-full border px-4 text-sm transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {loading ? (
                  <div className="flex flex-wrap content-start gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-36 w-36 animate-pulse rounded-xl bg-muted"
                      />
                    ))}
                  </div>
                ) : visibleTables.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">
                    No tables offer all the selected features.
                  </p>
                ) : (
                  <div className="flex flex-wrap content-start gap-4">
                    {visibleTables.map((t) => (
                      <TableCard
                        key={t.id}
                        table={t}
                        splits={splitsByTable.get(t.id) ?? []}
                        onSelect={setSelectedTable}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {reservationsExpanded && (
              <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto xl:h-full xl:max-h-none xl:w-[380px]">
                <ReservationsPanel
                  reservations={reservations}
                  tables={tables}
                  onChanged={refresh}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="delivery"
          className="mt-4 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
        >
          <div className="max-w-2xl">
            <TakeawayPanel takeaways={takeaways} />
          </div>
        </TabsContent>
      </Tabs>

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
