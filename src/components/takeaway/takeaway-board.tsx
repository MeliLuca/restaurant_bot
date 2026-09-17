"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ReceiptText, Search, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { LoadDot, pressureDetail } from "@/components/takeaway/load-dot";
import { formatMoney } from "@/lib/constants";
import {
  DEFAULT_SLOT_CONFIG,
  buildSlots,
  formatTime,
  groupBySlot,
  sameInstant,
  slotFor,
  type SlotConfig,
} from "@/lib/takeaway/slots";
import { arrangeFamilies } from "@/lib/takeaway/families";
import type { SlotPressure } from "@/lib/takeaway/load";
import { createFollowUpOrder, type TakeawayStatusFilter } from "@/lib/takeaway/api";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { useTicketStore } from "@/stores/ticket-store";
import { useAuthStore, usePermission } from "@/stores/auth-store";

/** How close to the promised time an order starts asking for attention */
const SOON_MINUTES = 15;

type Urgency = "late" | "soon" | "none";

function urgencyOf(order: Order, now: Date): Urgency {
  if (order.status !== "open" || order.pickup_at === null) return "none";
  const due = new Date(order.pickup_at).getTime();
  if (Number.isNaN(due)) return "none";
  if (due < now.getTime()) return "late";
  if (due - now.getTime() <= SOON_MINUTES * 60_000) return "soon";
  return "none";
}

const STATUSES: TakeawayStatusFilter[] = ["open", "closed", "all"];

interface TakeawayBoardProps {
  orders: Order[];
  status: TakeawayStatusFilter;
  onStatusChange: (status: TakeawayStatusFilter) => void;
  config?: SlotConfig;
  /** Frozen by the page so the grid and the "late" marks agree with each other */
  now: Date;
  /** How full each slot is; omitted when no capacity rules are configured */
  pressureAt?: (at: Date | string) => SlotPressure | null;
}

/**
 * The evening's take-aways, read by time.
 *
 * Grouped by pickup slot rather than listed flat: the question at the counter
 * is never "which order is this" but "what leaves in the next half hour", and
 * a flat list makes you answer it by scanning. The slot strip on top doubles as
 * the filter, so the same chips that show how full the evening is are the ones
 * you tap to narrow it.
 */
export function TakeawayBoard({
  orders,
  status,
  onStatusChange,
  config = DEFAULT_SLOT_CONFIG,
  now,
  pressureAt,
}: TakeawayBoardProps) {
  const router = useRouter();
  const t = useT();
  const setTakeaway = useTicketStore((s) => s.setTakeaway);
  const canTakeOrders = usePermission("take_orders");
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [query, setQuery] = useState("");
  const [slotKey, setSlotKey] = useState<string | null>(null);

  const slots = useMemo(() => buildSlots(config, now), [config, now]);

  // Counts come from the unfiltered set: a strip that emptied as you searched
  // would stop being a picture of the evening.
  const countBySlot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      if (o.pickup_at === null) continue;
      const slot = slotFor(o.pickup_at, config, slots);
      if (!slot) continue;
      counts.set(slot.key, (counts.get(slot.key) ?? 0) + 1);
    }
    return counts;
  }, [orders, config, slots]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return orders.filter((o) => {
      if (slotKey !== null) {
        if (o.pickup_at === null) return false;
        const slot = slotFor(o.pickup_at, config, slots);
        if (!slot || !sameInstant(slot.key, slotKey)) return false;
      }
      if (q === "") return true;
      const name = (o.customer_name ?? "").toLowerCase();
      return name.includes(q) || String(o.delivery_number ?? "").includes(q);
    });
  }, [orders, query, slotKey, config, slots]);

  const groups = useMemo(
    () => groupBySlot(filtered, (o) => o.pickup_at, config, now),
    [filtered, config, now],
  );

  const numberById = useMemo(
    () => new Map(orders.map((o) => [o.id, o.delivery_number])),
    [orders],
  );

  function openInPos(order: Order) {
    setTakeaway(order.id, order.customer_name ?? "");
    router.push("/pos");
  }

  async function addOrder(parent: Order) {
    try {
      const { orderId } = await createFollowUpOrder(parent, userId);
      setTakeaway(orderId, parent.customer_name ?? "");
      router.push("/pos");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("takeaway.couldNotLoad"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Slot strip — the shape of the evening, and the time filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSlotKey(null)}
          className={cn(
            "flex h-12 shrink-0 items-center rounded-lg border px-3 text-sm font-medium",
            slotKey === null
              ? "border-primary bg-primary text-primary-foreground"
              : "hover:bg-accent",
          )}
        >
          {t("takeaway.allSlots")}
        </button>
        {slots.map((s) => {
          const count = countBySlot.get(s.key) ?? 0;
          const active = slotKey !== null && sameInstant(s.key, slotKey);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSlotKey(active ? null : s.key)}
              title={pressureDetail(pressureAt?.(s.at) ?? null) || undefined}
              className={cn(
                "flex h-12 w-16 shrink-0 flex-col items-center justify-center rounded-lg border text-sm font-semibold tabular-nums",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
                s.isPast && !active && "text-muted-foreground/60",
              )}
            >
              <span className="flex items-center gap-1">
                {s.label}
                <LoadDot pressure={pressureAt?.(s.at) ?? null} />
              </span>
              <span
                className={cn(
                  "text-[11px] font-normal",
                  active ? "opacity-80" : "text-muted-foreground",
                )}
              >
                {count === 0 ? "—" : t("takeaway.slotOrders", { count })}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + status */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("takeaway.searchPlaceholder")}
            aria-label={t("takeaway.searchAria")}
            className="h-11 pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              className={cn(
                "h-9 rounded-md px-3 text-sm font-medium",
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(
                s === "open"
                  ? "takeaway.statusOpen"
                  : s === "closed"
                    ? "takeaway.statusClosed"
                    : "takeaway.statusAll",
              )}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {orders.length === 0
              ? t("takeaway.noneTonight")
              : t("takeaway.noneMatch")}
          </CardContent>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.key}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-semibold tabular-nums">
                {group.label === null
                  ? t("takeaway.noTime")
                  : `${group.label} – ${group.endLabel}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {group.at !== null && pressureDetail(pressureAt?.(group.at) ?? null)
                  ? `${pressureDetail(pressureAt?.(group.at) ?? null)} · `
                  : ""}
                {t("takeaway.slotOrders", { count: group.items.length })}
              </span>
            </div>
            <Separator />
            <div className="flex flex-col">
              {arrangeFamilies(group.items, numberById).map((row, i) => {
                const o = row.order;
                const urgency = urgencyOf(o, now);
                return (
                  <div key={o.id}>
                    {i > 0 && <Separator />}
                    <div
                      className={cn(
                        "flex items-center gap-3 border-l-4 px-4 py-3",
                        row.isFollowUp && "bg-muted/40 pl-8",
                        urgency === "late"
                          ? "border-l-red-500"
                          : urgency === "soon"
                            ? "border-l-amber-500"
                            : "border-l-transparent",
                      )}
                    >
                      <div className="w-14 shrink-0 text-base font-semibold tabular-nums">
                        {o.pickup_at === null
                          ? t("takeaway.noTimeShort")
                          : formatTime(o.pickup_at)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {o.delivery_number !== null && (
                            <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                              #{o.delivery_number}
                            </span>
                          )}
                          <span className="truncate font-medium">
                            {o.customer_name}
                          </span>
                          {row.isFollowUp && (
                            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {row.parentNumber === null
                                ? t("takeaway.followUp")
                                : t("takeaway.followUpOf", {
                                    number: row.parentNumber,
                                  })}
                            </span>
                          )}
                          {urgency === "late" && (
                            <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                              {t("takeaway.late")}
                            </span>
                          )}
                          {urgency === "soon" && (
                            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                              {t("takeaway.soon")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatMoney(o.total)} ·{" "}
                          {o.status === "open"
                            ? t("floor.openLower")
                            : t("takeaway.closedLower")}{" "}
                          · {t("takeaway.openedAt", { time: formatTime(o.opened_at) })}
                        </div>
                      </div>
                      {canTakeOrders && o.status === "open" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 shrink-0"
                            aria-label={t("takeaway.addOrderAria", {
                              name: o.customer_name ?? "",
                            })}
                            onClick={() => void addOrder(o)}
                          >
                            <Plus className="h-4 w-4 sm:mr-1" />
                            <span className="hidden sm:inline">
                              {t("takeaway.addOrder")}
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            className="h-10 shrink-0"
                            onClick={() => openInPos(o)}
                          >
                            <ReceiptText className="mr-1 h-4 w-4" />{" "}
                            {t("floor.openInPos")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {groups.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShoppingBag className="h-3.5 w-3.5" />
          {t("takeaway.countSummary", { count: filtered.length })}
        </p>
      )}
    </div>
  );
}
