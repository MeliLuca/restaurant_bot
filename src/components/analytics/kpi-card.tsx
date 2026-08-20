"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  detail,
}: {
  label: string;
  value: string;
  /** percentChange result: null hides the badge */
  delta?: number | null;
  deltaLabel?: string;
  detail?: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {delta != null ? (
          <p
            className={cn(
              "mt-1 flex items-center gap-1 text-xs",
              up ? "text-emerald-600" : "text-red-600",
            )}
          >
            {up ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {`${up ? "+" : ""}${(delta * 100).toFixed(1)}%`}
            {deltaLabel ? (
              <span className="text-muted-foreground">{deltaLabel}</span>
            ) : null}
          </p>
        ) : detail ? (
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
