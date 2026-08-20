"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { HoursTab } from "@/components/analytics/hours-tab";
import { MenuTab } from "@/components/analytics/menu-tab";
import { ReservationsTab } from "@/components/analytics/reservations-tab";
import { RevenueTab } from "@/components/analytics/revenue-tab";
import {
  fetchOrdersForRange,
  fetchReservationsForRange,
  type AnalyticsOrder,
} from "@/lib/analytics-api";
import {
  customRange,
  previousPeriod,
  rangeFromPreset,
  type RangePreset,
} from "@/lib/analytics/date-range";
import { fetchCategories, fetchMenuItems } from "@/lib/api";
import { fetchStaff, type StaffMember } from "@/lib/staff-api";
import type { Category, MenuItem, Reservation } from "@/lib/database.types";
import { useLangStore, useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

function toDayInput(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function AnalyticsPage() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const canViewStats = usePermission("view_stats");

  const [preset, setPreset] = useState<RangePreset>("last30");
  const [customStart, setCustomStart] = useState(() =>
    toDayInput(rangeFromPreset("last30").start),
  );
  const [customEnd, setCustomEnd] = useState(() => toDayInput(new Date()));
  const [orders, setOrders] = useState<AnalyticsOrder[]>([]);
  const [prevOrders, setPrevOrders] = useState<AnalyticsOrder[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () =>
      preset === "custom"
        ? customRange(customStart, customEnd)
        : rangeFromPreset(preset),
    [preset, customStart, customEnd],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, po, r, c, m, s] = await Promise.all([
        fetchOrdersForRange(range),
        fetchOrdersForRange(previousPeriod(range)),
        fetchReservationsForRange(range),
        fetchCategories(),
        fetchMenuItems(),
        fetchStaff(),
      ]);
      setOrders(o);
      setPrevOrders(po);
      setReservations(r);
      setCategories(c);
      setMenuItems(m);
      setStaff(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("analytics.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [range, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const windowLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const lastDay = new Date(range.end);
    lastDay.setDate(lastDay.getDate() - 1);
    return t("analytics.window", {
      start: fmt.format(range.start),
      end: fmt.format(lastDay),
    });
  }, [range, lang, t]);

  if (!canViewStats) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("stats.noAccessTitle")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("stats.noAccessBody")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("floor.cantReachDb")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => load()}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("analytics.title")}</h1>
          <p className="text-sm text-muted-foreground">{windowLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            preset={preset}
            customStart={customStart}
            customEnd={customEnd}
            onPresetChange={setPreset}
            onCustomChange={(s, e) => {
              setCustomStart(s);
              setCustomEnd(e);
            }}
          />
          <Button
            variant="outline"
            className="h-11"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {t("stats.refresh")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
          <div className="h-80 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : orders.length === 0 && reservations.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("analytics.empty")}
        </p>
      ) : (
        <Tabs defaultValue="revenue">
          <TabsList>
            <TabsTrigger value="revenue" className="min-h-9 px-4">
              {t("analytics.tabs.revenue")}
            </TabsTrigger>
            <TabsTrigger value="menu" className="min-h-9 px-4">
              {t("analytics.tabs.menu")}
            </TabsTrigger>
            <TabsTrigger value="hours" className="min-h-9 px-4">
              {t("analytics.tabs.hours")}
            </TabsTrigger>
            <TabsTrigger value="reservations" className="min-h-9 px-4">
              {t("analytics.tabs.reservations")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="revenue">
            <RevenueTab orders={orders} prevOrders={prevOrders} range={range} />
          </TabsContent>
          <TabsContent value="menu">
            <MenuTab orders={orders} menu={menuItems} categories={categoryNames} />
          </TabsContent>
          <TabsContent value="hours">
            <HoursTab orders={orders} staff={staff} />
          </TabsContent>
          <TabsContent value="reservations">
            <ReservationsTab reservations={reservations} range={range} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
