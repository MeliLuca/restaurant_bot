"use client";

import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// globals.css variables hold complete oklch(...) values, so charts must use
// bare var() references — never hsl(var(...)).
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
export const GRID_STROKE = "var(--border)";

// Recharts' default tooltip is white-on-white in dark mode.
export const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  fontSize: "0.75rem",
};

export function ChartCard({
  title,
  note,
  actions,
  children,
  height = "h-72",
}: {
  title: string;
  note?: string;
  actions?: ReactNode;
  children: ReactNode; // a single recharts chart
  height?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {note ? (
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
          ) : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        <div className={`${height} w-full`}>
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
