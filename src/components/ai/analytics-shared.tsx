"use client";

// Assistente AI → Analisi: the bits both sections share — the sortable header
// cell and the model's observations box.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

/** Rows sorted by one numeric/string column; nulls always last. */
export function useSorted<T, K extends keyof T & string>(rows: T[], initial: K) {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>("desc");
  const sorted = useMemo(() => {
    const sign = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[key] as unknown;
      const y = b[key] as unknown;
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
    });
  }, [rows, key, dir]);
  function toggle(next: K) {
    if (next === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(next);
      setDir("desc");
    }
  }
  return { sorted, key, dir, toggle };
}

export function SortTh<K extends string>({
  label,
  column,
  sort,
  align = "right",
}: {
  label: string;
  column: K;
  sort: { key: K; dir: SortDir; toggle: (k: K) => void };
  align?: "left" | "right";
}) {
  const active = sort.key === column;
  return (
    <th className={cn("pb-2 font-medium", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => sort.toggle(column)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active &&
          (sort.dir === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          ))}
      </button>
    </th>
  );
}

/** The model's 3–5 remarks: loading, unavailable, or the list. */
export function InsightsBox({
  state,
  insights,
}: {
  state: "idle" | "loading" | "done";
  insights: string[] | null;
}) {
  const t = useT();
  if (state === "idle") return null;
  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-violet-600" />
          {t("ai.analytics.insightsTitle")}
          <span className="text-xs font-normal text-muted-foreground">· {t("ai.aiNote")}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("ai.thinking")}
          </p>
        ) : insights && insights.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {insights.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("ai.unavailable")}</p>
        )}
      </CardContent>
    </Card>
  );
}

export const pctLabel = (n: number | null, digits = 0) =>
  n === null ? "—" : `${(n * 100).toFixed(digits)}%`;

export const signedPct = (n: number | null) =>
  n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
