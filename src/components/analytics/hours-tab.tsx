"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AXIS_TICK,
  CHART_COLORS,
  ChartCard,
  GRID_STROKE,
  TOOLTIP_STYLE,
} from "@/components/analytics/chart-card";
import { KpiCard } from "@/components/analytics/kpi-card";
import type { AnalyticsOrder } from "@/lib/analytics-api";
import {
  hourWeekdayMatrix,
  staffPerformance,
  turnoverStats,
} from "@/lib/analytics/aggregate";
import type { StaffMember } from "@/lib/staff-api";
import { formatMoney } from "@/lib/constants";
import { useLangStore, useT } from "@/lib/i18n/use-translation";

// Display hours rotated to the service day: 6,7,…,23,0,…,5
const HOUR_ORDER = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);

export function HoursTab({
  orders,
  staff,
}: {
  orders: AnalyticsOrder[];
  staff: StaffMember[];
}) {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const [metric, setMetric] = useState<"orders" | "revenue">("orders");

  const cells = useMemo(() => hourWeekdayMatrix(orders), [orders]);
  const turnover = useMemo(() => turnoverStats(orders), [orders]);
  const staffStats = useMemo(
    () => staffPerformance(orders, new Map(staff.map((s) => [s.id, s.name]))),
    [orders, staff],
  );

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
      weekday: "short",
    });
    // 2026-06-29 is a Monday
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(2026, 5, 29 + i)),
    );
  }, [lang]);

  const max = useMemo(
    () => Math.max(1, ...cells.map((c) => c[metric])),
    [cells, metric],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            {t("analytics.hours.heatmapTitle")}
          </CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={metric === "orders" ? "default" : "outline"}
              onClick={() => setMetric("orders")}
            >
              {t("analytics.hours.byOrders")}
            </Button>
            <Button
              size="sm"
              variant={metric === "revenue" ? "default" : "outline"}
              onClick={() => setMetric("revenue")}
            >
              {t("analytics.hours.byRevenue")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[640px] gap-px"
              style={{ gridTemplateColumns: "3rem repeat(24, 1fr)" }}
            >
              <div />
              {HOUR_ORDER.map((h) => (
                <div
                  key={`h${h}`}
                  className="pb-1 text-center text-[10px] text-muted-foreground"
                >
                  {h}
                </div>
              ))}
              {weekdayLabels.map((label, w) => (
                <div key={label} className="contents">
                  <div className="pr-2 text-right text-xs text-muted-foreground">
                    {label}
                  </div>
                  {HOUR_ORDER.map((h) => {
                    const cell = cells[w * 24 + h];
                    const value = cell[metric];
                    return (
                      <div
                        key={`${w}-${h}`}
                        className="aspect-square rounded-sm"
                        title={`${label} ${h}:00 — ${
                          metric === "revenue"
                            ? formatMoney(value)
                            : `${value} ${t("analytics.hours.byOrders").toLowerCase()}`
                        }`}
                        style={{
                          backgroundColor:
                            value > 0 ? "var(--chart-1)" : "var(--muted)",
                          opacity: value > 0 ? 0.25 + 0.75 * (value / max) : 1,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard
          label={t("analytics.hours.avgTurnover")}
          value={t("analytics.hours.minutes", { count: turnover.avgMinutes })}
          detail={t("analytics.hours.turnoverNote")}
        />
        <KpiCard
          label={t("analytics.hours.medianTurnover")}
          value={t("analytics.hours.minutes", { count: turnover.medianMinutes })}
        />
        <KpiCard
          label={t("analytics.hours.turnoverTitle")}
          value={String(turnover.count)}
          detail={t("analytics.kpi.bills")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("analytics.hours.turnoverTitle")} height="h-64">
          <BarChart data={turnover.histogram}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
            <YAxis tick={AXIS_TICK} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("analytics.hours.staffTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {staffStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("analytics.empty")}
              </p>
            ) : (
              <ScrollArea className="h-64">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2">{t("analytics.hours.staff")}</th>
                      <th className="pb-2 text-right">
                        {t("analytics.hours.orders")}
                      </th>
                      <th className="pb-2 text-right">
                        {t("analytics.hours.itemsSold")}
                      </th>
                      <th className="pb-2 text-right">
                        {t("analytics.kpi.avgBill")}
                      </th>
                      <th className="pb-2 text-right">
                        {t("analytics.kpi.revenue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffStats.map((s) => (
                      <tr
                        key={s.userId ?? "unknown"}
                        className="border-t border-border"
                      >
                        <td className="py-1.5 pr-2">{s.name}</td>
                        <td className="py-1.5 text-right">{s.orders}</td>
                        <td className="py-1.5 text-right">{s.itemsSold}</td>
                        <td className="py-1.5 text-right">
                          {formatMoney(s.avgBill)}
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          {formatMoney(s.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
