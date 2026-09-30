"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bike,
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  ChevronDown,
  LayoutGrid,
  Map as MapIcon,
  RotateCcw,
  Search,
  ShoppingBag,
  TriangleAlert,
  UserRoundSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewDeliveryDialog } from "@/components/floor-plan/new-delivery-dialog";
import { FloorMapView } from "@/components/floor-map/floor-map-view";
import { ReservationsPanel } from "@/components/floor-plan/reservations-panel";
import { STATUS_CONFIG, type TableDisplayStatus } from "@/lib/floor/status";
import {
  TableActionsDialog,
  type TableBooking,
} from "@/components/floor-plan/table-actions-dialog";
import {
  TimeControl,
  spotLabel,
  useSmartFloorLayer,
} from "@/components/smart-floor/floor-layer";
import { useTimeFormat } from "@/components/reservations/format";
import { useSeatFlow } from "@/components/reservations/seat-flow";
import { WalkInPanel, type WalkInTab } from "@/components/smart-floor/walk-in-panel";
import { walkInMarks } from "@/components/smart-floor/walk-in-shared";
import { TableCard } from "@/components/floor-plan/table-card";
import { TakeawayPanel } from "@/components/floor-plan/takeaway-panel";
import { releaseReservationTables, resetDeliveryCounter } from "@/lib/api";
import { compareTableNames } from "@/lib/floor/maps";
import { useIsPhone } from "@/lib/device";
import { useNow } from "@/hooks/use-now";
import { useWaitlist } from "@/hooks/use-waitlist";
import {
  readStoredView,
  storeView,
  type FloorView,
} from "@/lib/floor/view-pref";
import { linkedNamesByTable } from "@/lib/floor/links";
import { useFloorData } from "@/hooks/use-floor-data";
import type {
  Reservation,
  RestaurantTable,
  TableStatus,
} from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import type { WalkInOption } from "@/lib/smart-floor/walk-in";
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
  const canPlanFloor = usePermission("plan_floor");
  const canManageTables = usePermission("manage_tables");
  const isPhone = useIsPhone();
  const { settings: floorSettings } = useSmartFloor();
  const time = useTimeFormat();
  const now = useNow(30_000);
  /** Gestione Sala Smart: a time later today to look at (null = now) */
  const [viewAt, setViewAt] = useState<number | null>(null);
  /** "Trova posto" open, and the tables it shows on the map */
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderTab, setFinderTab] = useState<WalkInTab>("find");
  const [finderPick, setFinderPick] = useState<{
    option: WalkInOption;
    label: string;
  } | null>(null);

  const tableNameById = new Map(tables.map((tb) => [tb.id, tb.name]));
  const tableNames = (ids: string[]) =>
    ids
      .map((id) => tableNameById.get(id) ?? "?")
      .sort(compareTableNames)
      .join(" + ");
  const seatFlow = useSeatFlow({
    maps,
    canPlan: canPlanFloor && !isPhone,
    tableNames,
    onDone: refresh,
  });

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

  const layer = useSmartFloorLayer({
    tables,
    reservations,
    links,
    mapTableIds: new Set(mapTables.map((tb) => tb.id)),
    now,
    at: viewAt,
  });

  const waitlist = useWaitlist(layer.active);
  const finder = walkInMarks(
    layer.active && finderOpen ? (finderPick?.option ?? null) : null,
    tables,
    layer.marks,
    finderPick?.label ?? "",
  );

  function pickWalkIn(option: WalkInOption | null, label: string) {
    setFinderPick(option ? { option, label } : null);
    // bring its room on screen
    const room = option && tables.find((tb) => tb.id === option.tableIds[0])?.map_id;
    if (room) setActiveMapId(room);
  }

  function toggleFinder() {
    setFinderOpen((open) => !open);
    setReservationsExpanded(false);
    setViewAt(null);
  }

  /** The next booked party on a table today (Gestione Sala Smart) */
  function bookingFor(table: RestaurantTable | null): TableBooking | null {
    if (!layer.active || !table || !floorSettings) return null;
    const next = reservations
      .filter((r) => r.status === "booked" && r.table_ids.includes(table.id))
      .sort((a, b) => Date.parse(a.reserved_at) - Date.parse(b.reserved_at))[0];
    if (!next) return null;
    const start = Date.parse(next.reserved_at);
    const span =
      (floorSettings.meal_minutes + floorSettings.buffer_minutes) * 60_000;
    return {
      reservation: next,
      tables: tableNames(next.table_ids),
      time: time(start),
      lateMinutes: start <= now ? Math.floor((now - start) / 60_000) : null,
      clashesWithWalkIn: start > now && start - now < span,
    };
  }

  /** Grid view: the party booked on a table, as a chip */
  function bookingChip(id: string) {
    const spot = layer.spots.get(id);
    if (!spot) return undefined;
    return {
      text: `${time(spot.reservation.reserved_at)} ${spot.reservation.customer_name}`,
      title: spotLabel(spot, time),
      late: spot.kind === "late" || spot.kind === "overdue",
    };
  }

  async function releaseBooking(r: Reservation) {
    try {
      await releaseReservationTables(r.id);
      await refresh();
      toast.success(
        t("smartFloor.released", {
          tables: tableNames(r.table_ids),
          name: r.customer_name,
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    }
  }

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
        <div className="hidden flex-wrap items-center gap-4 sm:flex">
          {LEGEND.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <span className={`h-3 w-3 rounded-full ${STATUS_CONFIG[s].dot}`} />
              {t(STATUS_CONFIG[s].labelKey)}
            </span>
          ))}
          {layer.active && (
            <>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="h-3 w-3 rounded-full border-[3px] border-violet-600" />
                {t("smartFloor.legendSoon")}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="h-3 w-3 rounded-full bg-fuchsia-600" />
                {t("smartFloor.legendLate")}
              </span>
            </>
          )}
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
          <div
            className={cn(
              "flex h-full min-h-0 flex-col gap-4",
              // the finder's picks show on the map: keep both on screen
              finderOpen ? "lg:flex-row" : "xl:flex-row",
            )}
          >
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
                  onClick={() => {
                    setReservationsExpanded((e) => !e);
                    setFinderOpen(false);
                  }}
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
                <div className="ml-auto flex flex-wrap gap-2">
                  {layer.active && canManageTables && (
                    <Button
                      variant={finderOpen ? "secondary" : "outline"}
                      className="h-11"
                      aria-expanded={finderOpen}
                      onClick={toggleFinder}
                    >
                      <UserRoundSearch className="mr-2 h-4 w-4" /> {t("walkIn.open")}
                      {waitlist.entries.length > 0 && (
                        <span
                          className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white"
                          title={t("queue.tab", { count: waitlist.entries.length })}
                        >
                          <span className="sr-only">{t("queue.inLine")} </span>
                          {waitlist.entries.length}
                        </span>
                      )}
                    </Button>
                  )}
                  {canReserve && (
                    <Button
                      className="h-11"
                      // bookings are made on their own page
                      onClick={() => router.push("/prenotazioni?new=1")}
                    >
                      <CalendarPlus className="mr-2 h-4 w-4" /> {t("floor.newReservation")}
                    </Button>
                  )}
                </div>
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
                  {layer.active && viewAt !== null && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm dark:border-violet-800 dark:bg-violet-950">
                      <span className="font-medium">
                        {t("smartFloor.viewAtBanner", { time: time(viewAt) })}
                      </span>
                      <span className="text-muted-foreground">
                        {t("smartFloor.viewAtLegend")}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-8"
                        onClick={() => setViewAt(null)}
                      >
                        {t("smartFloor.backToNow")}
                      </Button>
                    </div>
                  )}
                  <div className="min-h-[320px] flex-1">
                    <FloorMapView
                      map={activeMap}
                      tables={mapTables}
                      splitsByTable={splitsByTable}
                      linkedByTable={linkedByTable}
                      dimmed={dimmedOnMap}
                      onSelect={handleTableClick}
                      neutral={layer.active && viewAt !== null}
                      marks={finder.marks}
                      underlay={
                        <>
                          {layer.underlay}
                          {finder.underlay}
                        </>
                      }
                      toolbar={
                        (maps.length > 1 || layer.active) && (
                          <div className="flex flex-wrap items-center gap-2">
                            {layer.active && (
                              <TimeControl at={viewAt} now={now} onChange={setViewAt} />
                            )}
                            {maps.length > 1 && maps.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                aria-pressed={m.id === activeMap.id}
                                onClick={() => setActiveMapId(m.id)}
                                title={m.bookable ? undefined : t("floor.roomNotBookable")}
                                className={cn(
                                  "flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                                  m.id === activeMap.id
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent",
                                )}
                              >
                                {m.name}
                                {!m.bookable && (
                                  <>
                                    <CalendarOff className="h-3.5 w-3.5" aria-hidden />
                                    <span className="sr-only">
                                      {t("floor.roomNotBookable")}
                                    </span>
                                  </>
                                )}
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
                          booking={bookingChip(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {layer.active && finderOpen ? (
              <div className="max-h-[55%] min-h-0 shrink-0 overflow-y-auto lg:h-full lg:max-h-none lg:w-[340px] xl:w-[380px]">
                <WalkInPanel
                  tab={finderTab}
                  onTab={setFinderTab}
                  tables={tables}
                  reservations={reservations}
                  links={links}
                  maps={maps}
                  openOrders={openOrders}
                  waitlist={waitlist.entries}
                  now={now}
                  onPick={pickWalkIn}
                  onChanged={async () => {
                    await Promise.all([refresh(), waitlist.refresh()]);
                  }}
                  onClose={() => setFinderOpen(false)}
                />
              </div>
            ) : (
              reservationsExpanded && (
                <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto xl:h-full xl:max-h-none xl:w-[380px]">
                  <ReservationsPanel
                    reservations={reservations}
                    tables={tables}
                    onChanged={refresh}
                    onSeat={layer.active ? seatFlow.seat : undefined}
                  />
                </div>
              )
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
        booking={bookingFor(selectedTable)}
        onSeatBooking={seatFlow.seat}
        onReleaseBooking={canPlanFloor ? releaseBooking : undefined}
      />
      {seatFlow.element}
      <NewDeliveryDialog
        open={deliveryOpen}
        onClose={() => setDeliveryOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
}
