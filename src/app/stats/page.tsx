"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillsList } from "@/components/stats/bills-list";
import { buildNightCsv, NightReport } from "@/components/stats/night-report";
import { SummaryCards } from "@/components/stats/summary-cards";
import { TopItems } from "@/components/stats/top-items";
import { fetchCategories } from "@/lib/api";
import {
  currentServiceDayStart,
  fetchOrdersForServiceDay,
  rankCategories,
  rankItems,
  summarizeNight,
  type StatsOrder,
} from "@/lib/stats-api";
import type { Category } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function shiftServiceDay(dayStart: Date, days: number): Date {
  const next = new Date(dayStart);
  next.setDate(next.getDate() + days);
  return next;
}

export default function StatsPage() {
  const t = useT();
  const canViewStats = usePermission("view_stats");

  const [dayStart, setDayStart] = useState(() => currentServiceDayStart());
  const [orders, setOrders] = useState<StatsOrder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isTonight =
    dayStart.getTime() === currentServiceDayStart().getTime();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([
        fetchOrdersForServiceDay(dayStart),
        fetchCategories(),
      ]);
      setOrders(o);
      setCategories(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("stats.failedLoadStats"));
    } finally {
      setLoading(false);
    }
  }, [dayStart, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeNight(orders), [orders]);
  const items = useMemo(() => rankItems(orders), [orders]);
  const categoryStats = useMemo(() => rankCategories(items), [items]);
  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  function downloadCsv() {
    const csv = buildNightCsv(dayStart, summary, items, categoryNames, t);
    const y = dayStart.getFullYear();
    const m = String(dayStart.getMonth() + 1).padStart(2, "0");
    const d = String(dayStart.getDate()).padStart(2, "0");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `night-stats-${y}-${m}-${d}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!canViewStats) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("stats.noAccessTitle")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("stats.noAccessBody")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("floor.cantReachDb")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => load()}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 print:h-auto print:overflow-visible print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">
            {isTonight ? t("stats.tonight") : DAY_FORMATTER.format(dayStart)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("stats.serviceWindow", {
              date: DAY_FORMATTER.format(dayStart),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            aria-label={t("stats.previousNight")}
            onClick={() => setDayStart((d) => shiftServiceDay(d, -1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            aria-label={t("stats.nextNight")}
            disabled={isTonight}
            onClick={() => setDayStart((d) => shiftServiceDay(d, 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> {t("stats.refresh")}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => window.print()}
            disabled={loading}
          >
            <Printer className="mr-2 h-4 w-4" /> {t("stats.printPdf")}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={downloadCsv}
            disabled={loading}
          >
            <Download className="mr-2 h-4 w-4" /> {t("stats.csv")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5 print:hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4 print:hidden">
          <SummaryCards summary={summary} />

          <Tabs defaultValue="items">
            <TabsList>
              <TabsTrigger value="items" className="min-h-9 px-4">
                {t("stats.itemsCategories")}
              </TabsTrigger>
              <TabsTrigger value="bills" className="min-h-9 px-4">
                {t("stats.checkoutBills")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="items">
              <TopItems
                items={items}
                categories={categoryStats}
                categoryNames={categoryNames}
              />
            </TabsContent>
            <TabsContent value="bills">
              <BillsList orders={orders} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {!loading && (
        <NightReport
          dayStart={dayStart}
          summary={summary}
          items={items}
          categoryNames={categoryNames}
        />
      )}
    </div>
  );
}
