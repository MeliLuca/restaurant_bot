"use client";

// Assistente AI — the analytics task: how much each table and each product
// earns. Every figure comes from POST /api/ai/analytics/{tables,products}
// (pure aggregations); the model only adds a few observations, asked in a
// second round so the numbers show up at once.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnalyticsProducts } from "@/components/ai/analytics-products";
import { AnalyticsTables } from "@/components/ai/analytics-tables";
import { aiFetch } from "@/lib/ai/client";
import type {
  AnalyticsRangeRequest,
  ProductStatsResponse,
  TableStatsResponse,
} from "@/lib/ai/contracts/analytics";
import { rangeFromPreset } from "@/lib/analytics/date-range";
import { fetchCategories } from "@/lib/api";
import type { Category } from "@/lib/database.types";
import { useLangStore, useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

type Preset = "last7" | "last30" | "last90";
const PRESETS: Preset[] = ["last7", "last30", "last90"];
// Radix Select can't carry an empty-string value
const ALL = "all";

type InsightsState = "idle" | "loading" | "done";

function toDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Inclusive service days of a preset, as the API wants them */
function presetDays(preset: Preset): { from: string; to: string } {
  const r = rangeFromPreset(preset);
  const last = new Date(r.end);
  last.setDate(last.getDate() - 1);
  return { from: toDay(r.start), to: toDay(last) };
}

export function AnalyticsTab() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const canViewStats = usePermission("view_stats");

  const [preset, setPreset] = useState<Preset>("last30");
  const [weekday, setWeekday] = useState(ALL);
  const [categoryId, setCategoryId] = useState(ALL);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const [tables, setTables] = useState<TableStatsResponse | null>(null);
  const [products, setProducts] = useState<ProductStatsResponse | null>(null);
  const [tablesAi, setTablesAi] = useState<{ state: InsightsState; list: string[] | null }>({ state: "idle", list: null });
  const [productsAi, setProductsAi] = useState<{ state: InsightsState; list: string[] | null }>({ state: "idle", list: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-US", { weekday: "long" });
    // 2026-06-28 is a Sunday: index 0 = Sunday, like the API
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 5, 28 + i)));
  }, [lang]);

  const base = useMemo<AnalyticsRangeRequest>(
    () => ({
      ...presetDays(preset),
      ...(weekday !== ALL ? { weekday: Number(weekday) } : {}),
    }),
    // reloadKey: "Aggiorna" re-reads the clock too (a preset ends today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, weekday, reloadKey],
  );
  const productReq = useMemo<AnalyticsRangeRequest>(
    () => ({ ...base, ...(categoryId !== ALL ? { categoryId } : {}) }),
    [base, categoryId],
  );

  // The numbers first (fast), then the model's remarks on the same request.
  // A stale answer for a previous filter is dropped.
  const loadTables = useCallback(async (req: AnalyticsRangeRequest, alive: () => boolean) => {
    const data = await aiFetch<TableStatsResponse>("/api/ai/analytics/tables", { ...req, insights: false });
    if (!alive()) return;
    setTables(data);
    if (data.totals.bills === 0) {
      setTablesAi({ state: "idle", list: null });
      return;
    }
    setTablesAi({ state: "loading", list: null });
    const withAi = await aiFetch<TableStatsResponse>("/api/ai/analytics/tables", req).catch(() => null);
    if (alive()) setTablesAi({ state: "done", list: withAi?.insights ?? null });
  }, []);

  const loadProducts = useCallback(async (req: AnalyticsRangeRequest, alive: () => boolean) => {
    const data = await aiFetch<ProductStatsResponse>("/api/ai/analytics/products", { ...req, insights: false });
    if (!alive()) return;
    setProducts(data);
    if (data.products.length === 0) {
      setProductsAi({ state: "idle", list: null });
      return;
    }
    setProductsAi({ state: "loading", list: null });
    const withAi = await aiFetch<ProductStatsResponse>("/api/ai/analytics/products", req).catch(() => null);
    if (alive()) setProductsAi({ state: "done", list: withAi?.insights ?? null });
  }, []);

  useEffect(() => {
    if (!canViewStats) return;
    let live = true;
    const alive = () => live;
    setLoading(true);
    setError(null);
    loadTables(base, alive)
      .catch((e) => alive() && setError(e instanceof Error ? e.message : t("ai.analytics.failed")))
      .finally(() => alive() && setLoading(false));
    return () => {
      live = false;
    };
  }, [base, canViewStats, loadTables, t]);

  useEffect(() => {
    if (!canViewStats) return;
    let live = true;
    const alive = () => live;
    loadProducts(productReq, alive).catch(
      (e) => alive() && setError(e instanceof Error ? e.message : t("ai.analytics.failed")),
    );
    return () => {
      live = false;
    };
  }, [productReq, canViewStats, loadProducts, t]);

  if (!canViewStats) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("ai.analytics.noAccess")}</p>
    );
  }

  const windowLabel = tables
    ? t("ai.analytics.window", {
        from: tables.range.from,
        to: tables.range.to,
        open: tables.range.serviceDays,
        days: tables.range.days,
      })
    : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{windowLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant={preset === p ? "default" : "outline"}
              className="h-10"
              onClick={() => setPreset(p)}
            >
              {t(`ai.analytics.${p}`)}
            </Button>
          ))}
          <Select value={weekday} onValueChange={setWeekday}>
            <SelectTrigger className="h-10 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("ai.analytics.allDays")}</SelectItem>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  <span className="capitalize">{weekdayNames[d]}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="h-10"
            disabled={loading}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {t("ai.analytics.refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : loading && !tables ? (
        <div className="flex flex-col gap-4">
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("ai.analytics.tables.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("ai.analytics.tables.subtitle")}</p>
            </div>
            {tables && tables.totals.bills > 0 ? (
              <AnalyticsTables
                data={tables}
                insightsState={tablesAi.state}
                insights={tablesAi.list}
                weekdayNames={weekdayNames}
              />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("ai.analytics.noData")}</p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{t("ai.analytics.products.title")}</h2>
                <p className="text-sm text-muted-foreground">{t("ai.analytics.products.subtitle")}</p>
              </div>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-10 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("ai.analytics.products.allCategories")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {products && products.products.length > 0 ? (
              <AnalyticsProducts
                data={products}
                insightsState={productsAi.state}
                insights={productsAi.list}
              />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("ai.analytics.noData")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
