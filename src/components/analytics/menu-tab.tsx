"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
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
import type { AnalyticsOrder } from "@/lib/analytics-api";
import {
  deadItems,
  engineerMenu,
  modifierStats,
  type Quadrant,
} from "@/lib/analytics/aggregate";
import { rankItems } from "@/lib/stats-api";
import type { Category, MenuItem } from "@/lib/database.types";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";

const SCATTER_CAP = 300;
const QUADRANTS: { key: Quadrant; color: string }[] = [
  { key: "star", color: CHART_COLORS[0] },
  { key: "workhorse", color: CHART_COLORS[1] },
  { key: "puzzle", color: CHART_COLORS[2] },
  { key: "dog", color: CHART_COLORS[3] },
];

export function MenuTab({
  orders,
  menu,
  categories,
}: {
  orders: AnalyticsOrder[];
  menu: MenuItem[];
  categories: Map<string, Category>;
}) {
  const t = useT();
  const [includeUnavailable, setIncludeUnavailable] = useState(false);

  const ranked = useMemo(() => rankItems(orders), [orders]);
  const engineering = useMemo(() => engineerMenu(ranked), [ranked]);
  const modifiers = useMemo(() => modifierStats(orders), [orders]);
  const dead = useMemo(() => {
    const all = deadItems(menu, ranked);
    return includeUnavailable ? all : all.filter((d) => d.isAvailable);
  }, [menu, ranked, includeUnavailable]);

  // The menu can hold thousands of items — keep the scatter readable.
  const plotted = useMemo(
    () =>
      [...engineering.items]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, SCATTER_CAP),
    [engineering],
  );
  const byQuadrant = useMemo(
    () =>
      QUADRANTS.map(({ key, color }) => ({
        key,
        color,
        items: plotted.filter((i) => i.quadrant === key),
      })),
    [plotted],
  );

  return (
    <div className="flex flex-col gap-4">
      <ChartCard
        title={t("analytics.menu.quadrantTitle")}
        note={`${t("analytics.menu.marginProxyNote")}${
          engineering.items.length > SCATTER_CAP
            ? ` ${t("analytics.menu.topNNote", { count: SCATTER_CAP })}`
            : ""
        }`}
        height="h-80"
      >
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis
            type="number"
            dataKey="quantity"
            name={t("analytics.menu.quantityAxis")}
            tick={AXIS_TICK}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="revenue"
            name={t("analytics.menu.revenueAxis")}
            tick={AXIS_TICK}
            tickLine={false}
            width={70}
          />
          <ReferenceLine
            x={engineering.medianQuantity}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={engineering.medianRevenue}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value, name) =>
              name === t("analytics.menu.revenueAxis")
                ? [formatMoney(Number(value ?? 0)), name]
                : [value ?? 0, name]
            }
            labelFormatter={() => ""}
          />
          <Legend />
          {byQuadrant.map(({ key, color, items }) => (
            <Scatter
              key={key}
              name={t(`analytics.menu.${key}`)}
              data={items}
              fill={color}
            />
          ))}
        </ScatterChart>
      </ChartCard>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {QUADRANTS.map(({ key }) => (
          <Card key={key}>
            <CardContent className="flex items-center justify-between p-4">
              <span className="text-sm font-medium">
                {t(`analytics.menu.${key}`)}
              </span>
              <Badge variant="secondary">
                {engineering.items.filter((i) => i.quadrant === key).length}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("analytics.menu.modifiersTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {modifiers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("analytics.empty")}
              </p>
            ) : (
              <ScrollArea className="h-72">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2">{t("analytics.menu.modifier")}</th>
                      <th className="pb-2 text-right">
                        {t("analytics.menu.attached")}
                      </th>
                      <th className="pb-2 text-right">
                        {t("analytics.menu.attachRate")}
                      </th>
                      <th className="pb-2 text-right">
                        {t("analytics.menu.modifierRevenue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {modifiers.map((m) => (
                      <tr key={m.name} className="border-t border-border">
                        <td className="py-1.5 pr-2">{m.name}</td>
                        <td className="py-1.5 text-right">{m.attachedQuantity}</td>
                        <td className="py-1.5 text-right">
                          {(m.attachRate * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right">
                          {formatMoney(m.chargedRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              {t("analytics.menu.deadTitle")}
            </CardTitle>
            <Button
              size="sm"
              variant={includeUnavailable ? "default" : "outline"}
              onClick={() => setIncludeUnavailable((v) => !v)}
            >
              {t("analytics.menu.includeUnavailable")}
            </Button>
          </CardHeader>
          <CardContent>
            {dead.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("analytics.menu.deadEmpty")}
              </p>
            ) : (
              <ScrollArea className="h-72">
                <div className="flex flex-col gap-1.5">
                  {dead.map((d) => (
                    <div
                      key={d.menuItemId}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {d.categoryId
                          ? (categories.get(d.categoryId)?.name ??
                            t("stats.uncategorized"))
                          : t("stats.uncategorized")}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
