"use client";

// Assistente AI → Analisi → Tavoli: KPIs, a bar chart and the sortable table
// of TableStatsResponse. Pure view: the tab fetches.

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AXIS_TICK,
  CHART_COLORS,
  ChartCard,
  GRID_STROKE,
  TOOLTIP_STYLE,
} from "@/components/analytics/chart-card";
import { KpiCard } from "@/components/analytics/kpi-card";
import { InsightsBox, SortTh, pctLabel, useSorted } from "@/components/ai/analytics-shared";
import type { TableStat, TableStatsResponse } from "@/lib/ai/contracts/analytics";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const CHART_CAP = 15;
const money = (n: number | null) => (n === null ? "—" : formatMoney(n));

export function AnalyticsTables({
  data,
  insightsState,
  insights,
  weekdayNames,
}: {
  data: TableStatsResponse;
  insightsState: "idle" | "loading" | "done";
  insights: string[] | null;
  /** 0 = Sunday */
  weekdayNames: string[];
}) {
  const t = useT();
  const [showIdle, setShowIdle] = useState(false);
  const idleCount = data.tables.filter((r) => r.bills === 0).length;
  const rows = useMemo(
    () => (showIdle ? data.tables : data.tables.filter((r) => r.bills > 0)),
    [data.tables, showIdle],
  );
  const sort = useSorted<TableStat, keyof TableStat & string>(rows, "revenue");

  const chart = useMemo(
    () =>
      data.tables
        .filter((r) => r.revenue > 0)
        .slice(0, CHART_CAP)
        .map((r) => ({ name: r.tableName, revenue: r.revenue })),
    [data.tables],
  );
  // Monday first, like the /analytics heatmap
  const weekdays = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 0]
        .map((d) => data.byWeekday[d])
        .filter((d) => d && d.openDays > 0),
    [data.byWeekday],
  );

  const tot = data.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label={t("ai.analytics.tables.revenue")} value={formatMoney(tot.revenue)} />
        <KpiCard label={t("ai.analytics.tables.seatings")} value={String(tot.bills)} />
        <KpiCard label={t("ai.analytics.tables.covers")} value={String(tot.covers)} />
        <KpiCard label={t("ai.analytics.tables.perCover")} value={money(tot.revenuePerCover)} />
        <KpiCard
          label={t("ai.analytics.tables.avgTime")}
          value={
            tot.avgMinutes === null
              ? "—"
              : t("ai.analytics.tables.minutesValue", { n: tot.avgMinutes })
          }
        />
        <KpiCard
          label={t("ai.analytics.tables.rotations")}
          value={tot.rotationsPerService.toFixed(2)}
          detail={t("ai.analytics.tables.rotationsHelp")}
        />
      </div>

      <InsightsBox state={insightsState} insights={insights} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard title={t("ai.analytics.tables.chartTitle")}>
            <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} width={70} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: "var(--muted)" }}
                formatter={(v) => [formatMoney(Number(v ?? 0)), t("ai.analytics.tables.revenue")]}
              />
              <Bar dataKey="revenue" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="text-sm font-medium">{t("ai.analytics.tables.byWeekday")}</p>
            {weekdays.map((d) => (
              <div key={d.weekday} className="flex items-center justify-between gap-2 text-sm">
                <span className="capitalize">{weekdayNames[d.weekday]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("ai.analytics.tables.weekdayTip", {
                    bills: d.bills,
                    revenue: formatMoney(d.revenue),
                  })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <SortTh label={t("ai.analytics.tables.table")} column="tableName" sort={sort} align="left" />
                  <SortTh label={t("ai.analytics.tables.map")} column="mapName" sort={sort} align="left" />
                  <SortTh label={t("ai.analytics.tables.seats")} column="capacity" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.seatings")} column="bills" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.rotations")} column="rotationsPerService" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.covers")} column="covers" sort={sort} />
                  <SortTh label={t("ai.analytics.products.revenue")} column="revenue" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.perCover")} column="revenuePerCover" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.minutes")} column="avgMinutes" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.perHour")} column="revenuePerTableHour" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.perSeatHour")} column="revenuePerSeatHour" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.share")} column="share" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map((r) => (
                  <tr
                    key={r.tableId}
                    className={cn("border-t border-border", r.bills === 0 && "text-muted-foreground")}
                  >
                    <td className="py-1.5 pr-2 font-medium">{r.tableName}</td>
                    <td className="py-1.5 pr-2">{r.mapName ?? "—"}</td>
                    <td className="py-1.5 text-right">{r.capacity}</td>
                    <td className="py-1.5 text-right">{r.bills}</td>
                    <td className="py-1.5 text-right">{r.rotationsPerService.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{r.covers}</td>
                    <td className="py-1.5 text-right font-medium">{formatMoney(r.revenue)}</td>
                    <td className="py-1.5 text-right">{money(r.revenuePerCover)}</td>
                    <td className="py-1.5 text-right">{r.avgMinutes ?? "—"}</td>
                    <td className="py-1.5 text-right">{money(r.revenuePerTableHour)}</td>
                    <td className="py-1.5 text-right">{money(r.revenuePerSeatHour)}</td>
                    <td className="py-1.5 text-right">{pctLabel(r.share, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {idleCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setShowIdle((v) => !v)}
            >
              {showIdle
                ? t("ai.analytics.tables.hideIdle")
                : t("ai.analytics.tables.showIdle", { count: idleCount })}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
