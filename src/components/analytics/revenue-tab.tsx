"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
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
  bucketRevenue,
  defaultGranularity,
  percentChange,
  type Granularity,
} from "@/lib/analytics/aggregate";
import { rangeDays, type ServiceDateRange } from "@/lib/analytics/date-range";
import { summarizeNight } from "@/lib/stats-api";
import { formatMoney } from "@/lib/constants";
import { useLangStore, useT } from "@/lib/i18n/use-translation";

const GRANULARITIES: Granularity[] = ["day", "week", "month"];

export function RevenueTab({
  orders,
  prevOrders,
  range,
}: {
  orders: AnalyticsOrder[];
  prevOrders: AnalyticsOrder[];
  range: ServiceDateRange;
}) {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const [granularity, setGranularity] = useState<Granularity | null>(null);
  const g = granularity ?? defaultGranularity(rangeDays(range));

  const summary = useMemo(() => summarizeNight(orders), [orders]);
  const prev = useMemo(() => summarizeNight(prevOrders), [prevOrders]);
  const buckets = useMemo(() => bucketRevenue(orders, range, g), [orders, range, g]);

  const dateLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
      day: "numeric",
      month: "short",
    });
    return (b: (typeof buckets)[number]) =>
      g === "month"
        ? new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
            month: "short",
            year: "2-digit",
          }).format(b.date)
        : fmt.format(b.date);
  }, [lang, g]);

  const data = useMemo(
    () => buckets.map((b) => ({ ...b, label: dateLabel(b) })),
    [buckets, dateLabel],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <KpiCard
          label={t("analytics.kpi.revenue")}
          value={formatMoney(summary.paidTotal)}
          delta={percentChange(summary.paidTotal, prev.paidTotal)}
          deltaLabel={t("analytics.kpi.vsPrev")}
        />
        <KpiCard
          label={t("analytics.kpi.bills")}
          value={String(summary.paidCount)}
          delta={percentChange(summary.paidCount, prev.paidCount)}
          deltaLabel={t("analytics.kpi.vsPrev")}
        />
        <KpiCard
          label={t("analytics.kpi.avgBill")}
          value={formatMoney(summary.avgBill)}
          delta={percentChange(summary.avgBill, prev.avgBill)}
          deltaLabel={t("analytics.kpi.vsPrev")}
        />
        <KpiCard
          label={t("analytics.kpi.dineIn")}
          value={formatMoney(summary.dineInPaidTotal)}
          delta={percentChange(summary.dineInPaidTotal, prev.dineInPaidTotal)}
          deltaLabel={t("analytics.kpi.vsPrev")}
        />
        <KpiCard
          label={t("analytics.kpi.takeaway")}
          value={formatMoney(summary.takeawayPaidTotal)}
          delta={percentChange(summary.takeawayPaidTotal, prev.takeawayPaidTotal)}
          deltaLabel={t("analytics.kpi.vsPrev")}
        />
      </div>

      <ChartCard
        title={t("analytics.revenue.chartTitle")}
        actions={
          <div className="flex gap-1">
            {GRANULARITIES.map((opt) => (
              <Button
                key={opt}
                size="sm"
                variant={g === opt ? "default" : "outline"}
                onClick={() => setGranularity(opt)}
              >
                {t(`analytics.granularity.${opt}`)}
              </Button>
            ))}
          </div>
        }
      >
        <ComposedChart data={data}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
          <YAxis yAxisId="rev" tick={AXIS_TICK} tickLine={false} width={70} />
          <YAxis
            yAxisId="avg"
            orientation="right"
            tick={AXIS_TICK}
            tickLine={false}
            width={60}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [formatMoney(Number(value ?? 0)), name]}
          />
          <Legend />
          <Bar
            yAxisId="rev"
            dataKey="dineInTotal"
            name={t("analytics.kpi.dineIn")}
            stackId="rev"
            fill={CHART_COLORS[0]}
          />
          <Bar
            yAxisId="rev"
            dataKey="takeawayTotal"
            name={t("analytics.kpi.takeaway")}
            stackId="rev"
            fill={CHART_COLORS[2]}
          />
          <Line
            yAxisId="avg"
            type="monotone"
            dataKey="avgBill"
            name={t("analytics.revenue.avgBillLine")}
            stroke={CHART_COLORS[4]}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}
