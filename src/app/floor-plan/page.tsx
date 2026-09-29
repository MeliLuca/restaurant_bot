"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bike,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  LayoutGrid,
  Map as MapIcon,
  RotateCcw,
  Search,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewDeliveryDialog } from "@/components/floor-plan/new-delivery-dialog";
import { ReservationDialog } from "@/components/floor-plan/reservation-dialog";
import { FloorMapView } from "@/components/floor-map/floor-map-view";
import { ReservationsPanel } from "@/components/floor-plan/reservations-panel";
import { STATUS_CONFIG, type TableDisplayStatus } from "@/lib/floor/status";
import { TableActionsDialog } from "@/components/floor-plan/table-actions-dialog";
import { TableCard } from "@/components/floor-plan/table-card";
import { TakeawayPanel } from "@/components/floor-plan/takeaway-panel";
import { resetDeliveryCounter } from "@/lib/api";
import {
  readStoredView,
  storeView,
  type FloorView,
} from "@/lib/floor/view-pref";
import { linkedNamesByTable } from "@/lib/floor/links";
import { useFloorData } from "@/hooks/use-floor-data";
import type { RestaurantTable, TableStatus } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor } from "@/stores/smart-floor-store";
import { useTicketStore } from "@/stores/ticket-store";

const LEGEND: TableDisplayStatus[] = [
  "available",
  "occupied",
  "ordered",
  "dirty",
];

// Status quick-filters (by stored status; "occupied" covers ordered tables too).
const STATUS_FILTERS: { value: TableStatus; labelKey: TranslationKey }[] = [
  { value: "available", labelKey: "floor.status.available" },
  { value: "occupied", labelKey: "floor.status.occupied" },
  { value: "dirty", labelKey: "floor.status.dirty" },
];

export default function FloorPlanPage() {
  const router = useRouter();
  const t = useT();
  const setTicketTable = useTicketStore((s) => s.setTable);
  const setSubtable = useTicketStore((s) => s.setSubtable);
  const {
    tables,
    reservations,
    takeaways,
    openOrders,
    links,
    maps,
    loading,
    error,
    refresh,
  } = useFloorData();
  const linkedByTable = linkedNamesByTable(
    links,
    new Map(tables.map((tb) => [tb.id, tb.name])),
  );

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
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [reservationsExpanded, setReservationsExpanded] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TableStatus | null>(null);
  const [storedView, setStoredView] = useState<FloorView | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  useEffect(() => setStoredView(readStoredView()), []);
  const canReserve = usePermission("manage_reservations");
  const canTakeOrders = usePermission("take_orders");
  const smartFloor = useSmartFloor().enabled;

  const activeReservations = reservations.filter(
    (r) => r.status === "booked" || r.status === "seated",
  ).length;

  const allTags = Array.from(
    new Map(
      tables.flatMap((t) => t.table_tags).map((tag) => [tag.id, tag]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const query = search.trim().toLowerCase();
  // A table must match the search, the status filter, AND every selected tag.
  const visibleTables = tables.filter(
    (t) =>
      (query === "" || t.name.toLowerCase().includes(query)) &&
      (statusFilter === null || t.status === statusFilter) &&
      selectedTagIds.every((id) => t.table_tags.some((tag) => tag.id === id)),
  );

  // Default to the map whenever one exists; fall back to the grid otherwise.
  const view: FloorView = maps.length === 0 ? "grid" : (storedView ?? "map");
  const activeMap = maps.find((m) => m.id === activeMapId) ?? maps[0] ?? null;
  const visibleIds = new Set(visibleTables.map((tb) => tb.id));
  const mapTables = activeMap
    ? tables.filter((tb) => tb.map_id === activeMap.id)
    : [];
  const dimmedOnMap = new Set(
    mapTables.filter((tb) => !visibleIds.has(tb.id)).map((tb) => tb.id),
  );
  // Tables no map places (new ones, or a map was deleted) stay reachable.
  const offMapTables = visibleTables.filter(
    (tb) => tb.map_id === null || !maps.some((m) => m.id === tb.map_id),
  );

  function chooseView(v: FloorView) {
    setStoredView(v);
    storeView(v);
  }

  function toggleTag(id: string) {
    setSelectedTagIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  // Clicking a table with exactly one open order jumps straight to its bill in
  // the POS. No order (or several splits) falls back to the actions/picker.
  function handleTableClick(table: RestaurantTable) {
    const splits = splitsByTable.get(table.id) ?? [];
    if (splits.length === 1) {
      setTicketTable(table.id, table.name);
      setSubtable(splits[0]);
      router.push("/pos");
      return;
    }
    setSelectedTable(table);
  }

  async function handleResetCounter() {
    try {
      await resetDeliveryCounter();
      await refresh();
      toast.success(t("floor.counterReset"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.resetFailed"));
    }
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("floor.cantReachDb")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => refresh()}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <div className="flex flex-wrap items-center gap-6">
        <h1 className="text-2xl font-semibold">{t("floor.title")}</h1>
        <div className="hidden items-center gap-4 sm:flex">
          {LEGEND.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <span className={`h-3 w-3 rounded-full ${STATUS_CONFIG[s].dot}`} />
              {t(STATUS_CONFIG[s].labelKey)}
            </span>
          ))}
        </div>
      </div>

      <Tabs defaultValue="tables" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-12 w-fit shrink-0">
          <TabsTrigger value="tables" className="h-10 px-6 text-base">
            {t("floor.tablesTab")}
          </TabsTrigger>
          <TabsTrigger value="delivery" className="h-10 px-6 text-base">
            {t("floor.deliveryTab")}
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
              {/* Search + status filters + reservation actions */}
              <div className="flex flex-wrap items-center gap-2">
                {maps.length > 0 && (
                  <div
                    role="group"
                    aria-label={t("floor.viewAria")}
                    className="flex h-11 items-center rounded-lg border p-1"
                  >
                    {(
                      [
                        ["map", MapIcon, "floor.viewMap"],
                        ["grid", LayoutGrid, "floor.viewGrid"],
                      ] as const
                    ).map(([v, Icon, labelKey]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={view === v}
                        onClick={() => chooseView(v)}
                        className={cn(
                          "flex h-full items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                          view === v
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("floor.searchTables")}
                    className="h-11 w-44 pl-9"
                    aria-label={t("floor.searchTablesAria")}
                  />
                </div>
                {STATUS_FILTERS.map((f) => {
                  const active = statusFilter === f.value;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setStatusFilter(active ? null : f.value)
                      }
                      className={cn(
                        "flex h-11 items-center rounded-full border px-4 text-sm transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {t(f.labelKey)}
                    </button>
                  );
                })}

                <Button
                  variant="outline"
                  className="h-11"
                  aria-expanded={reservationsExpanded}
                  onClick={() => setReservationsExpanded((e) => !e)}
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  {t("floor.todaysReservations")}
                  {activeReservations > 0 && ` (${activeReservations})`}
                  <ChevronDown
                    className={cn(
                      "ml-2 h-4 w-4 transition-transform",
                      reservationsExpanded && "rotate-180",
                    )}
                  />
                </Button>
                {canReserve && (
                  <Button
                    className="ml-auto h-11"
                    onClick={() =>
                      // Gestione Sala Smart books (and seats) from its own page
                      smartFloor
                        ? router.push("/prenotazioni?new=1")
                        : setReservationOpen(true)
                    }
                  >
                    <CalendarPlus className="mr-2 h-4 w-4" /> {t("floor.newReservation")}
                  </Button>
                )}
              </div>

              {/* Feature tags (TV screen, accessible…) on their own row */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {allTags.map((tag) => {
                    const active = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
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
              )}

              {view === "map" && activeMap ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="min-h-[320px] flex-1">
                    <FloorMapView
                      map={activeMap}
                      tables={mapTables}
                      splitsByTable={splitsByTable}
                      linkedByTable={linkedByTable}
                      dimmed={dimmedOnMap}
                      onSelect={handleTableClick}
                      toolbar={
                        maps.length > 1 && (
                          <div className="flex flex-wrap gap-2">
                            {maps.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                aria-pressed={m.id === activeMap.id}
                                onClick={() => setActiveMapId(m.id)}
                                className={cn(
                                  "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
                                  m.id === activeMap.id
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent",
                                )}
                              >
                                {m.name}
                              </button>
                            ))}
                          </div>
                        )
                      }
                    />
                  </div>
                  {offMapTables.length > 0 && (
                    <div className="flex shrink-0 flex-col gap-2">
                      <h2 className="text-sm font-medium text-muted-foreground">
                        {t("floor.offMap")}
                      </h2>
                      <div className="flex gap-4 overflow-x-auto pb-1">
                        {offMapTables.map((tb) => (
                          <TableCard
                            key={tb.id}
                            table={tb}
                            splits={splitsByTable.get(tb.id) ?? []}
                            linkedTo={linkedByTable.get(tb.id)}
                            onSelect={handleTableClick}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
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
                      {t("floor.noTablesMatch")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap content-start gap-4">
                      {visibleTables.map((t) => (
                        <TableCard
                          key={t.id}
                          table={t}
                          splits={splitsByTable.get(t.id) ?? []}
                          linkedTo={linkedByTable.get(t.id)}
                          onSelect={handleTableClick}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
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
          <div className="flex max-w-2xl flex-col gap-4">
            {canTakeOrders && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  className="h-12"
                  onClick={() => setDeliveryOpen(true)}
                >
                  <Bike className="mr-2 h-5 w-5" /> {t("floor.newDeliveryOrder")}
                </Button>
                <Button
                  variant="outline"
                  className="h-12"
                  onClick={() => void handleResetCounter()}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> {t("floor.resetCounter")}
                </Button>
                {/* The panel here is the glance; the board is where the evening
                    is actually worked, so the tab always offers the way over. */}
                <Button
                  variant="ghost"
                  className="h-12"
                  onClick={() => router.push("/asporto")}
                >
                  <ShoppingBag className="mr-2 h-4 w-4" /> {t("takeaway.openBoard")}
                </Button>
              </div>
            )}
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
      <NewDeliveryDialog
        open={deliveryOpen}
        onClose={() => setDeliveryOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
}
