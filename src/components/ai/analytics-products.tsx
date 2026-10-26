"use client";

// Assistente AI → Analisi → Prodotti: KPIs, a bar chart, the cost-coverage
// note and the sortable table of ProductStatsResponse. Pure view.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
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
import {
  InsightsBox,
  SortTh,
  pctLabel,
  signedPct,
  useSorted,
} from "@/components/ai/analytics-shared";
import type { MenuClass, ProductStat, ProductStatsResponse } from "@/lib/ai/contracts/analytics";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const CHART_CAP = 10;
const PAGE = 30;
const money = (n: number | null) => (n === null ? "—" : formatMoney(n));

// same colour per quadrant as the /analytics menu scatter
const CLASS_COLOR: Record<MenuClass, string> = {
  star: CHART_COLORS[0],
  workhorse: CHART_COLORS[1],
  puzzle: CHART_COLORS[2],
  dog: CHART_COLORS[3],
};

export function AnalyticsProducts({
  data,
  insightsState,
  insights,
}: {
  data: ProductStatsResponse;
  insightsState: "idle" | "loading" | "done";
  insights: string[] | null;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const sort = useSorted<ProductStat, keyof ProductStat & string>(data.products, "revenue");
  const shown = all ? sort.sorted : sort.sorted.slice(0, PAGE);

  const chart = useMemo(
    () =>
      data.products.slice(0, CHART_CAP).map((p) => ({
        name: p.name.length > 18 ? `${p.name.slice(0, 17)}…` : p.name,
        full: p.name,
        revenue: p.revenue,
        fill: p.class ? CLASS_COLOR[p.class] : CHART_COLORS[4],
      })),
    [data.products],
  );

  const tot = data.totals;
  const hasCost = tot.costedRevenue > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          label={t("ai.analytics.products.revenue")}
          value={formatMoney(tot.revenue)}
          delta={tot.trend}
        />
        <KpiCard label={t("ai.analytics.products.quantity")} value={String(tot.quantity)} />
        <KpiCard
          label={t("ai.analytics.products.trend")}
          value={signedPct(tot.trend)}
          detail={formatMoney(tot.prevRevenue)}
        />
        <KpiCard label={t("ai.analytics.products.coverage")} value={pctLabel(data.costCoverage)} />
        <KpiCard
          label={t("ai.analytics.products.foodCost")}
          value={pctLabel(tot.foodCostPct, 1)}
        />
        <KpiCard
          label={t("ai.analytics.products.margin")}
          value={hasCost ? formatMoney(tot.margin) : "—"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {hasCost
            ? t("ai.analytics.products.coverageNote", { pct: pctLabel(data.costCoverage) })
            : t("ai.analytics.products.coverageNone")}
        </span>
        <Link href="/settings/menu" className="font-medium text-primary hover:underline">
          {t("ai.analytics.products.fillCosts")}
        </Link>
      </div>

      <InsightsBox state={insightsState} insights={insights} />

      <ChartCard title={t("ai.analytics.products.chartTitle")}>
        <BarChart data={chart} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} width={150} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "var(--muted)" }}
            labelFormatter={(_, p) => String(p?.[0]?.payload?.full ?? "")}
            formatter={(v) => [formatMoney(Number(v ?? 0)), t("ai.analytics.products.revenue")]}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
            {chart.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <SortTh label={t("ai.analytics.products.product")} column="name" sort={sort} align="left" />
                  <SortTh label={t("ai.analytics.products.category")} column="categoryName" sort={sort} align="left" />
                  <SortTh label={t("ai.analytics.products.quantity")} column="quantity" sort={sort} />
                  <SortTh label={t("ai.analytics.products.revenue")} column="revenue" sort={sort} />
                  <SortTh label={t("ai.analytics.tables.share")} column="share" sort={sort} />
                  <SortTh label={t("ai.analytics.products.trend")} column="trend" sort={sort} />
                  <SortTh label={t("ai.analytics.products.unitCost")} column="unitCost" sort={sort} />
                  <SortTh label={t("ai.analytics.products.margin")} column="margin" sort={sort} />
                  <SortTh label={t("ai.analytics.products.foodCost")} column="foodCostPct" sort={sort} />
                  <SortTh label={t("ai.analytics.products.class")} column="class" sort={sort} align="left" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.menuItemId} className="border-t border-border">
                    <td className="max-w-64 py-1.5 pr-2">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.isCustom && (
                          <Badge variant="outline" className="shrink-0 border-amber-500 text-amber-600">
                            {t("ai.analytics.products.custom")}
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{p.categoryName ?? "—"}</td>
                    <td className="py-1.5 text-right">{p.quantity}</td>
                    <td className="py-1.5 text-right font-medium">{formatMoney(p.revenue)}</td>
                    <td className="py-1.5 text-right">{pctLabel(p.share, 1)}</td>
                    <td
                      className={cn(
                        "py-1.5 text-right",
                        p.trend !== null && (p.trend >= 0 ? "text-emerald-600" : "text-red-600"),
                      )}
                    >
                      {signedPct(p.trend)}
                    </td>
                    <td className="py-1.5 text-right">{money(p.unitCost)}</td>
                    <td className="py-1.5 text-right">{money(p.margin)}</td>
                    <td className="py-1.5 text-right">{pctLabel(p.foodCostPct, 1)}</td>
                    <td className="py-1.5 pl-2">
                      {p.isCoperto ? (
                        <span className="text-xs text-muted-foreground">
                          {t("ai.analytics.products.coperto")}
                        </span>
                      ) : p.class ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: CLASS_COLOR[p.class] }}
                          />
                          {t(`analytics.menu.${p.class}`)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.products.length > PAGE && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
              {all
                ? t("ai.analytics.products.showLess")
                : t("ai.analytics.products.showAll", { count: data.products.length })}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
