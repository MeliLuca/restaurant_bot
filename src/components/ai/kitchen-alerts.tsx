"use client";

// Assistente AI — global late-order cards, mounted once in AppShell (desktop).
// Only with the module on and for floor_alerts (Admin, Sala Manager); hidden
// on /kitchen, whose own cards turn red at the same thresholds.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChefHat, ChevronDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import type { LateOrder } from "@/lib/ai/contracts/kitchen";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { useAiModule } from "@/stores/ai-store";
import { LateOrderRows, isVeryLate, useKitchenAlerts } from "./kitchen-shared";

const POLL_MS = 60_000;
const SEEN_MINUTES = 10;
const SEEN_KEY = "ai-kitchen-seen";

/** "Visto" per device: order item id → hidden until (ms) */
type Seen = Record<string, number>;

function readSeen(): Seen {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Seen) : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // private window / blocked storage: "Visto" lasts until the next reload
  }
}

export function AiKitchenAlerts() {
  const canSee = usePermission("floor_alerts");
  const { enabled } = useAiModule();
  const onKitchen = usePathname().startsWith("/kitchen");
  if (!canSee || !enabled || onKitchen) return null;
  return <KitchenAlertsStack />;
}

function KitchenAlertsStack() {
  const t = useT();
  const now = useNow(30_000);
  const { data } = useKitchenAlerts(POLL_MS);
  const [seen, setSeen] = useState<Seen>(() => readSeen());
  const pathname = usePathname();
  // the corner FloorAlerts leaves free: it sits bottom-left, except on
  // Prenotazioni where it moves right
  const onLeft = pathname.startsWith("/prenotazioni");
  // in Cassa the right column is the ticket with "Invia in cucina": stay a
  // pill beside it (lg: the panel is 400px) and open only when asked
  const onPos = pathname.startsWith("/pos");
  const [collapsed, setCollapsed] = useState(onPos);
  // the stack stays mounted across pages: entering Cassa folds it away
  useEffect(() => {
    if (onPos) setCollapsed(true);
  }, [onPos]);

  // an order shows while one of its late items is not "Visto" (or its 10
  // minutes ran out): a newly late item brings the card back
  const orders: LateOrder[] = (data?.byOrder ?? []).filter((o) =>
    o.items.some((i) => !(seen[i.orderItemId] > now)),
  );

  // a newly late item opens the stack again
  const keys = orders.flatMap((o) => o.items.map((i) => i.orderItemId)).join(",");
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set(keys ? keys.split(",") : []);
    if (!onPos && Array.from(next).some((k) => !known.current.has(k))) setCollapsed(false);
    known.current = next;
  }, [keys, onPos]);

  function markSeen(order: LateOrder) {
    const until = Date.now() + SEEN_MINUTES * 60_000;
    const current = Date.now();
    const next: Seen = {};
    // drop the expired entries while at it
    Object.keys(seen).forEach((id) => {
      if (seen[id] > current) next[id] = seen[id];
    });
    order.items.forEach((i) => {
      next[i.orderItemId] = until;
    });
    setSeen(next);
    writeSeen(next);
  }

  if (orders.length === 0) return null;
  const red = orders.some(isVeryLate);

  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col gap-2 print:hidden",
        // narrower screens: top-right, short enough to clear FloorAlerts'
        // stack (≤ 70dvh from the bottom); wide ones: the free bottom corner,
        // never wider than the room FloorAlerts leaves
        "right-4 top-4 w-[min(24rem,calc(100vw-2rem))] items-end lg:top-auto lg:bottom-4 lg:w-[min(24rem,calc(100vw-41rem))]",
        onLeft && "lg:left-60 lg:right-auto lg:items-start",
        // …and above the menu search bar
        onPos && "lg:right-[26rem] lg:bottom-20",
      )}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className={cn(
            "flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg",
            red ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700",
          )}
        >
          <ChefHat className="h-4 w-4" />
          {t("ai.kitchen.alertsCount", { count: orders.length })}
        </button>
      ) : (
        <div className="flex max-h-[calc(30dvh-6.5rem)] w-full flex-col overflow-hidden rounded-xl border bg-card shadow-2xl sm:max-h-[calc(30dvh-2.5rem)] lg:max-h-[70dvh]">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <ChefHat className={cn("h-4 w-4", red ? "text-red-600" : "text-amber-600")} />
            <span className="flex-1 text-sm font-semibold">
              {t("ai.kitchen.alertsTitle", { count: orders.length })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={t("ai.kitchen.alertsHide")}
              title={t("ai.kitchen.alertsHide")}
              onClick={() => setCollapsed(true)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
          <ul className="flex flex-col divide-y overflow-y-auto">
            {orders.map((o) => (
              <li key={o.orderId} className="flex flex-col gap-2 p-3">
                <LateOrderRows order={o} />
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={() => markSeen(o)}
                  >
                    <Eye className="mr-1 h-4 w-4" /> {t("ai.kitchen.seen")}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-9" asChild>
                    <Link href="/kitchen">
                      <ChefHat className="mr-1 h-4 w-4" /> {t("ai.kitchen.openKitchen")}
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
