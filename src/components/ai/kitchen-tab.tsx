"use client";

// Assistente AI — the kitchen task on /assistente: the live late list (same
// data as the global cards, polled faster) and, on demand, the model's short
// summary of it.

import { useState } from "react";
import Link from "next/link";
import { ChefHat, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimeFormat } from "@/components/reservations/format";
import { aiFetch } from "@/lib/ai/client";
import type { KitchenAlertsResponse } from "@/lib/ai/contracts/kitchen";
import type { AiSettings } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { LateOrderRows, useKitchenAlerts } from "./kitchen-shared";

const POLL_MS = 30_000;

export function KitchenTab({ settings }: { settings: AiSettings }) {
  const t = useT();
  const time = useTimeFormat();
  const { data, error, refresh } = useKitchenAlerts(POLL_MS);
  // the summary is of the list at the moment it was asked for
  const [summary, setSummary] = useState<{ text: string | null } | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const orders = data?.byOrder ?? [];
  // the server's thresholds are the ones the list used; settings until then
  const kitchen = data?.thresholds.CUCINA ?? settings.kitchen_late_minutes;
  const bar = data?.thresholds.BAR ?? settings.bar_late_minutes;

  async function summarize() {
    setSummarizing(true);
    setSummary(null);
    try {
      const res = await aiFetch<KitchenAlertsResponse>("/api/ai/kitchen/alerts?summary=1");
      setSummary({ text: res.summary });
    } catch (e) {
      console.warn("[ai] kitchen summary:", e);
      setSummary({ text: null });
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ChefHat className="h-5 w-5 text-amber-600" />
            {t("ai.kitchen.tabTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("ai.kitchen.tabHelp")}</p>
          <p className="mt-1 text-sm">
            {t("ai.kitchen.thresholds", { kitchen, bar })}{" "}
            <Link
              href="/settings/modules"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t("ai.kitchen.changeThresholds")}
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={t("common.retry")}
            title={t("common.retry")}
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            className="h-9"
            disabled={summarizing || orders.length === 0}
            onClick={() => void summarize()}
          >
            {summarizing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            {t("ai.kitchen.summarize")}
          </Button>
        </div>
      </div>

      {(summarizing || summary) && (
        <div className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950/40">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" /> {t("ai.aiNote")}
          </p>
          {summarizing ? (
            <p className="text-muted-foreground">{t("ai.thinking")}</p>
          ) : summary?.text ? (
            <p>{summary.text}</p>
          ) : (
            <p className="text-muted-foreground">{t("ai.unavailable")}</p>
          )}
        </div>
      )}

      {!data && !error ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      ) : !data ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("ai.kitchen.loadError")}
        </p>
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("ai.kitchen.none")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {orders.map((o) => (
            <li key={o.orderId} className="p-3">
              <LateOrderRows order={o} />
            </li>
          ))}
        </ul>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          {t("ai.kitchen.checkedAt", { time: time(data.checkedAt) })}
          {error && ` · ${t("ai.kitchen.loadError")}`}
        </p>
      )}
    </div>
  );
}
