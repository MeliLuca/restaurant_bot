"use client";

// The Sala: the tables, live, and the door ("Accoglienza") beside them.
// Take-aways and making bookings have their own pages; the nav badges keep
// them in sight from here.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TriangleAlert, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloorCanvas } from "@/components/floor-plan/floor-canvas";
import { FloorToolbar } from "@/components/floor-plan/floor-toolbar";
import { HostPanel, type HostTab } from "@/components/floor-plan/host-panel";
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
import { walkInMarks } from "@/components/smart-floor/walk-in-shared";
import { releaseReservationTables } from "@/lib/api";
import { compareTableNames } from "@/lib/floor/maps";
import { useIsPhone } from "@/lib/device";
import { useFloorFilters } from "@/hooks/use-floor-filters";
import { useNow } from "@/hooks/use-now";
import { useWaitlist } from "@/hooks/use-waitlist";
import { readStoredView, storeView, type FloorView } from "@/lib/floor/view-pref";
import { linkedNamesByTable } from "@/lib/floor/links";
import { useFloorData } from "@/hooks/use-floor-data";
import type { Reservation, RestaurantTable } from "@/lib/database.types";
import { minutesLate } from "@/lib/reservations/late";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";
import type { WalkInOption } from "@/lib/smart-floor/walk-in";
import { useSmartFloor } from "@/stores/smart-floor-store";
import { useTicketStore } from "@/stores/ticket-store";
import { cn } from "@/lib/utils";

export default function FloorPlanPage() {
  const router = useRouter();
  const t = useT();
  const setTicketTable = useTicketStore((s) => s.setTable);
  const setSubtable = useTicketStore((s) => s.setSubtable);
  const { tables, reservations, openOrders, links, maps, loading, error, refresh } =
    useFloorData();
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
  const filters = useFloorFilters(tables, (id) => splitsByTable.has(id));

  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [storedView, setStoredView] = useState<FloorView | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  useEffect(() => setStoredView(readStoredView()), []);
  const canPlanFloor = usePermission("plan_floor");
  const canManageTables = usePermission("manage_tables");
  const isPhone = useIsPhone();
  const { settings: floorSettings } = useSmartFloor();
  const time = useTimeFormat();
  const now = useNow(30_000);
  /** Gestione Sala Smart: a time later today to look at (null = now) */
  const [viewAt, setViewAt] = useState<number | null>(null);
  /** "Accoglienza" open, on which tab, and the walk-in option it shows on the map */
  const [hostOpen, setHostOpen] = useState(false);
  const [hostTab, setHostTab] = useState<HostTab>("arrivals");
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

  // Default to the map whenever one exists; fall back to the grid otherwise.
  const view: FloorView = maps.length === 0 ? "grid" : (storedView ?? "map");
  const activeMap = maps.find((m) => m.id === activeMapId) ?? maps[0] ?? null;
  const visibleIds = new Set(filters.visible.map((tb) => tb.id));
  const mapTables = activeMap ? tables.filter((tb) => tb.map_id === activeMap.id) : [];
  const dimmedOnMap = new Set(
    mapTables.filter((tb) => !visibleIds.has(tb.id)).map((tb) => tb.id),
  );

  const layer = useSmartFloorLayer({
    tables,
    reservations,
    links,
    mapTableIds: new Set(mapTables.map((tb) => tb.id)),
    now,
    at: viewAt,
  });

  // Gestione Sala Smart adds walk-ins and the waitlist to the door
  const walkIns = layer.active && canManageTables;
  const waitlist = useWaitlist(walkIns);
  const finder = walkInMarks(
    walkIns && hostOpen && hostTab !== "arrivals" ? (finderPick?.option ?? null) : null,
    tables,
    layer.marks,
    finderPick?.label ?? "",
  );
  const lateArrivals = reservations.filter((r) => minutesLate(r, now) !== null).length;

  function pickWalkIn(option: WalkInOption | null, label: string) {
    setFinderPick(option ? { option, label } : null);
    // bring its room on screen
    const room = option && tables.find((tb) => tb.id === option.tableIds[0])?.map_id;
    if (room) setActiveMapId(room);
  }

  function toggleHost() {
    setHostOpen((open) => !open);
    setFinderPick(null);
    setViewAt(null);
  }

  function chooseHostTab(tab: HostTab) {
    setHostTab(tab);
    if (tab === "arrivals") setFinderPick(null);
  }

  /** The next booked party on a table today (Gestione Sala Smart) */
  function bookingFor(table: RestaurantTable | null): TableBooking | null {
    if (!layer.active || !table || !floorSettings) return null;
    const next = reservations
      .filter((r) => r.status === "booked" && r.table_ids.includes(table.id))
      .sort((a, b) => Date.parse(a.reserved_at) - Date.parse(b.reserved_at))[0];
    if (!next) return null;
    const start = Date.parse(next.reserved_at);
    const span = (floorSettings.meal_minutes + floorSettings.buffer_minutes) * 60_000;
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
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="text-2xl font-semibold">{t("floor.title")}</h1>
        {layer.active && (
          <div className="hidden flex-wrap items-center gap-4 sm:flex">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="h-3 w-3 rounded-full border-[3px] border-violet-600" />
              {t("smartFloor.legendSoon")}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="h-3 w-3 rounded-full bg-fuchsia-600" />
              {t("smartFloor.legendLate")}
            </span>
          </div>
        )}
        <Button
          variant={hostOpen ? "secondary" : "outline"}
          className="ml-auto h-11"
          aria-expanded={hostOpen}
          onClick={toggleHost}
        >
          <UserRoundSearch className="mr-2 h-4 w-4" /> {t("floor.hostPanel")}
          {lateArrivals > 0 && (
            <span
              className="ml-2 rounded-full bg-fuchsia-600 px-2 py-0.5 text-xs font-semibold text-white"
              title={t("floor.lateArrivals", { count: lateArrivals })}
            >
              <span aria-hidden>{lateArrivals}</span>
              <span className="sr-only">{t("floor.lateArrivals", { count: lateArrivals })}</span>
            </span>
          )}
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
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4",
          // the panel's picks show on the map: keep both on screen
          hostOpen && "lg:flex-row",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <FloorToolbar
            view={maps.length > 0 ? view : null}
            onView={chooseView}
            filters={filters}
          />
          <FloorCanvas
            view={view}
            loading={loading}
            maps={maps}
            activeMap={activeMap}
            onActiveMap={setActiveMapId}
            mapTables={mapTables}
            visibleTables={filters.visible}
            dimmed={dimmedOnMap}
            splitsByTable={splitsByTable}
            linkedByTable={linkedByTable}
            onSelect={handleTableClick}
            neutral={layer.active && viewAt !== null}
            marks={finder.marks}
            underlay={
              <>
                {layer.underlay}
                {finder.underlay}
              </>
            }
            timeControl={
              layer.active && <TimeControl at={viewAt} now={now} onChange={setViewAt} />
            }
            banner={
              layer.active &&
              viewAt !== null && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm dark:border-violet-800 dark:bg-violet-950">
                  <span className="font-medium">
                    {t("smartFloor.viewAtBanner", { time: time(viewAt) })}
                  </span>
                  <span className="text-muted-foreground">{t("smartFloor.viewAtLegend")}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-8"
                    onClick={() => setViewAt(null)}
                  >
                    {t("smartFloor.backToNow")}
                  </Button>
                </div>
              )
            }
            bookingChip={bookingChip}
          />
        </div>

        {hostOpen && (
          <div className="max-h-[55%] min-h-0 shrink-0 overflow-y-auto lg:h-full lg:max-h-none lg:w-[360px] xl:w-[400px]">
            <HostPanel
              tab={hostTab}
              onTab={chooseHostTab}
              walkIns={walkIns}
              tables={tables}
              reservations={reservations}
              links={links}
              maps={maps}
              openOrders={openOrders}
              waitlist={waitlist.entries}
              now={now}
              onPick={pickWalkIn}
              onSeat={seatFlow.seat}
              onChanged={async () => {
                await Promise.all([refresh(), waitlist.refresh()]);
              }}
              onClose={toggleHost}
            />
          </div>
        )}
      </div>

      <TableActionsDialog
        table={selectedTable}
        onClose={() => setSelectedTable(null)}
        onChanged={refresh}
        booking={bookingFor(selectedTable)}
        onSeatBooking={seatFlow.seat}
        onReleaseBooking={canPlanFloor ? releaseBooking : undefined}
      />
      {seatFlow.element}
    </div>
  );
}
