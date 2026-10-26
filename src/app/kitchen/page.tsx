"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-translation";
import { orderThreshold } from "@/lib/ai/kitchen/watch";
import { useAiModule } from "@/stores/ai-store";
import {
  useKitchenOrders,
  type KitchenOrder,
  type Station,
} from "@/hooks/use-kitchen-orders";

type StationFilter = "all" | Station;

/** Minutes an order has been waiting drive the header colour: fresh → calm,
 * 10+ → warning, 20+ → alarm. Times restart per un-bumped item, so a bumped
 * order that gets a new round starts counting again. With the Assistente AI
 * on, the alarm is its station threshold instead (the smallest among the
 * stations still pending) and the warning half of it. */
function waitingMinutes(order: KitchenOrder, now: number): number {
  const pending = order.items.filter((i) => !i.readyAt);
  const since = pending.length
    ? Math.min(...pending.map((i) => Date.parse(i.createdAt)))
    : Date.parse(order.openedAt);
  return Math.max(0, Math.floor((now - since) / 60_000));
}

export default function KitchenPage() {
  const t = useT();
  const { orders, loading, error, refresh, setItemReady, setOrderReady } =
    useKitchenOrders();
  const [station, setStation] = useState<StationFilter>("all");
  const ai = useAiModule();
  const thresholds =
    ai.enabled && ai.settings
      ? { CUCINA: ai.settings.kitchen_late_minutes, BAR: ai.settings.bar_late_minutes }
      : null;

  // re-render every 30s so the elapsed-time badges keep counting
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("floor.cantReachDb")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => refresh()}>{t("common.retry")}</Button>
      </div>
    );
  }

  // An order shows while it has un-bumped items for the selected station;
  // once everything is bumped it drops off the board.
  const visible = orders
    .map((o) => ({
      ...o,
      items: o.items.filter(
        (i) => station === "all" || i.station === station,
      ),
    }))
    .filter((o) => o.items.some((i) => !i.readyAt));

  const orderLabel = (o: KitchenOrder) => {
    if (o.orderType === "dine_in") {
      const table = t("kitchen.table", { name: o.tableName ?? "?" });
      return o.subtable ? `${table} · ${o.subtable}` : table;
    }
    const name = o.customerName ?? t("kitchen.takeaway");
    return o.deliveryNumber != null
      ? `${t("kitchen.takeaway")} #${o.deliveryNumber} · ${name}`
      : `${t("kitchen.takeaway")} · ${name}`;
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("kitchen.title")}</h1>
        <Tabs
          value={station}
          onValueChange={(v) => setStation(v as StationFilter)}
        >
          <TabsList>
            <TabsTrigger value="all">{t("kitchen.allStations")}</TabsTrigger>
            <TabsTrigger value="CUCINA">
              {t("kitchen.stationKitchen")}
            </TabsTrigger>
            <TabsTrigger value="BAR">{t("kitchen.stationBar")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {t("kitchen.noOpenOrders")}
        </div>
      ) : (
        <div className="grid content-start gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((order) => {
            const minutes = waitingMinutes(order, now);
            const limit = thresholds ? orderThreshold(order, thresholds) : null;
            const alarm = limit != null ? minutes >= limit : minutes >= 20;
            const warning = limit != null ? minutes >= limit / 2 : minutes >= 10;
            const readyCount = order.items.filter((i) => i.readyAt).length;
            return (
              <div
                key={order.id}
                className="flex flex-col overflow-hidden rounded-xl border bg-card"
              >
                <div
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-2 text-sm font-semibold",
                    alarm
                      ? "bg-red-500 text-white"
                      : warning
                        ? "bg-amber-500 text-white"
                        : "bg-muted",
                  )}
                >
                  <span className="min-w-0 truncate">
                    #{order.ticketNumber} · {orderLabel(order)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {t("kitchen.minutesShort", { count: minutes })}
                  </span>
                </div>

                <ul className="flex flex-1 flex-col">
                  {order.items.map((item) => (
                    <li key={item.id} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() =>
                          setItemReady(item.id, !item.readyAt).catch(() =>
                            toast.error(t("kitchen.couldNotUpdate")),
                          )
                        }
                        aria-label={
                          item.readyAt
                            ? t("kitchen.markNotReady", { name: item.name })
                            : t("kitchen.markReady", { name: item.name })
                        }
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                          item.readyAt
                            ? "text-muted-foreground/50 line-through"
                            : "hover:bg-accent",
                        )}
                      >
                        <span className="text-lg font-medium leading-tight">
                          {item.quantity} × {item.name}
                        </span>
                        {item.modifiers.length > 0 && (
                          <span className="pl-6 text-sm uppercase text-muted-foreground">
                            {item.modifiers.join(" · ")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between gap-2 border-t p-2">
                  <span className="pl-1 text-xs tabular-nums text-muted-foreground">
                    {t("kitchen.itemsReady", {
                      ready: readyCount,
                      total: order.items.length,
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={() =>
                      setOrderReady(order).catch(() =>
                        toast.error(t("kitchen.couldNotUpdate")),
                      )
                    }
                  >
                    <CheckCheck className="mr-1 h-4 w-4" />
                    {t("kitchen.allReady")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
