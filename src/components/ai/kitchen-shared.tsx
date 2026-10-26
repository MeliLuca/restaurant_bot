"use client";

// Assistente AI — kitchen task: what the global alert cards and the
// /assistente tab share (polling the late list, labels, one order's rows).

import { useCallback, useEffect, useRef, useState } from "react";
import { aiFetch, AiRequestError } from "@/lib/ai/client";
import type {
  KitchenAlertsResponse,
  KitchenPlace,
  KitchenStation,
  LateOrder,
} from "@/lib/ai/contracts/kitchen";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * The late list from /api/ai/kitchen/alerts, re-read every `everyMs` while
 * the tab is visible (and as soon as it comes back). Errors only go to the
 * console: a missed poll keeps the last list; the module switched off
 * (404/503) clears it.
 */
export function useKitchenAlerts(everyMs: number, active = true) {
  const [data, setData] = useState<KitchenAlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await aiFetch<KitchenAlertsResponse>("/api/ai/kitchen/alerts");
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      console.warn("[ai] kitchen alerts:", e);
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof AiRequestError && (e.status === 404 || e.status === 503)) {
        setData(null);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, everyMs, refresh]);

  return { data, error, refresh };
}

/** Same wording as the /kitchen cards, in the current language */
export function placeText(t: TFn, p: KitchenPlace): string {
  if (p.orderType === "dine_in") {
    const table = t("kitchen.table", { name: p.tableName ?? "?" });
    return p.subtable ? `${table} · ${p.subtable}` : table;
  }
  const name = p.customerName ?? t("kitchen.takeaway");
  return p.deliveryNumber != null
    ? `${t("kitchen.takeaway")} #${p.deliveryNumber} · ${name}`
    : `${t("kitchen.takeaway")} · ${name}`;
}

export function stationText(t: TFn, s: KitchenStation): string {
  return t(s === "BAR" ? "kitchen.stationBar" : "kitchen.stationKitchen");
}

/** Late = amber; twice the station's threshold or more = red */
export function isVeryLate(o: LateOrder): boolean {
  return o.items.some((i) => i.minutes >= 2 * i.threshold);
}

/** One late order: where + ticket, then its late items with minutes */
export function LateOrderRows({ order }: { order: LateOrder }) {
  const t = useT();
  const red = isVeryLate(order);
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
          red ? "bg-red-600" : "bg-amber-500",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="truncate font-medium">{placeText(t, order.place)}</span>
          <span className="text-muted-foreground">
            {t("ai.kitchen.ticket", { number: order.ticketNumber })}
          </span>
        </p>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {order.items.map((i) => (
            <li key={i.orderItemId} className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {i.quantity} × {i.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {stationText(t, i.station)}
              </span>
              <span
                className={cn(
                  "shrink-0 font-semibold tabular-nums",
                  i.minutes >= 2 * i.threshold ? "text-red-600" : "text-amber-600",
                )}
                title={t("ai.kitchen.over", { minutes: i.threshold })}
              >
                {t("kitchen.minutesShort", { count: i.minutes })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
