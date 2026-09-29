"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_TICK,
  CHART_COLORS,
  ChartCard,
  GRID_STROKE,
  TOOLTIP_STYLE,
} from "@/components/analytics/chart-card";
import { KpiCard } from "@/components/analytics/kpi-card";
import { reservationStats } from "@/lib/analytics/aggregate";
import type { ServiceDateRange } from "@/lib/analytics/date-range";
import type { ReservationRow } from "@/lib/database.types";
import { useLangStore, useT } from "@/lib/i18n/use-translation";

export function ReservationsTab({
  reservations,
  range,
}: {
  reservations: ReservationRow[];
  range: ServiceDateRange;
}) {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const stats = useMemo(
    () => reservationStats(reservations, range),
    [reservations, range],
  );

  const statusData = useMemo(
    () =>
      (
        [
          ["booked", stats.booked],
          ["seated", stats.seated],
          ["cancelled", stats.cancelled],
          ["no_show", stats.noShow],
        ] as const
      )
        .map(([key, value]) => ({
          name: t(`analytics.reservations.status.${key}`),
          value,
        }))
        .filter((d) => d.value > 0),
    [stats, t],
  );

  const coversData = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", {
      day: "numeric",
      month: "short",
    });
    return stats.coversPerNight.map((n) => ({
      label: fmt.format(n.date),
      covers: n.covers,
    }));
  }, [stats, lang]);

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label={t("analytics.reservations.total")}
          value={String(stats.total)}
        />
        <KpiCard
          label={t("analytics.reservations.noShowRate")}
          value={pct(stats.noShowRate)}
        />
        <KpiCard
          label={t("analytics.reservations.cancellationRate")}
          value={pct(stats.cancellationRate)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("analytics.reservations.statusMix")} height="h-64">
          <PieChart>
            <Pie
              data={statusData}
              dataKey="value"
              nameKey="name"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
            >
              {statusData.map((entry, i) => (
                <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend />
          </PieChart>
        </ChartCard>

        <ChartCard title={t("analytics.reservations.partySize")} height="h-64">
          <BarChart data={stats.partySizes}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
            <YAxis tick={AXIS_TICK} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>

      <ChartCard title={t("analytics.reservations.coversPerNight")} height="h-64">
        <BarChart data={coversData}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar
            dataKey="covers"
            name={t("analytics.reservations.covers")}
            fill={CHART_COLORS[0]}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartCard>
    </div>
  );
}
