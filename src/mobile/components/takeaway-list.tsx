"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, ShoppingBag, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LoadDot, pressureDetail } from "@/components/takeaway/load-dot";
import { formatMoney } from "@/lib/constants";
import { arrangeFamilies } from "@/lib/takeaway/families";
import {
  createFollowUpOrder,
  fetchTakeawayOrders,
} from "@/lib/takeaway/api";
import {
  buildSlots,
  formatTime,
  groupBySlot,
  sameInstant,
  slotFor,
} from "@/lib/takeaway/slots";
import { useTakeawayPressure } from "@/hooks/use-takeaway-load";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { useAuthStore, usePermission } from "@/stores/auth-store";
import { useTicketStore } from "@/stores/ticket-store";
import { mRoutes } from "@/mobile/lib/routes";
import { MHeader, DesktopSwitch } from "./m-header";
import { NewTakeawaySheet } from "./new-takeaway-sheet";

/** How close to the promised time an order starts asking for attention */
const SOON_MINUTES = 15;

/**
 * The evening's take-aways on a phone.
 *
 * Same reading as the till's board — by promised time, grouped into slots,
 * follow-ups under their parent — because a waiter who learns the shape of the
 * queue on one screen should not have to learn it again on the other. What
 * changes is the hand it is held in: one column of cards, a thumb-height slot
 * strip, and the new-order flow in a sheet instead of a dialog.
 */
export function TakeawayList() {
  const t = useT();
  const router = useRouter();
  const canView = usePermission("view_takeaway");
  const canTakeOrders = usePermission("take_orders");
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setTakeaway = useTicketStore((s) => s.setTakeaway);

  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const { config, load, refresh: refreshLoad } = useTakeawayPressure(null);

  const load_ = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      setOrders(await fetchTakeawayOrders("open"));
      await refreshLoad();
      setNow(new Date());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canView, refreshLoad]);

  useEffect(() => {
    void load_();
  }, [load_]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load_();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load_]);

  const slots = useMemo(() => buildSlots(config, now), [config, now]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return orders.filter((o) => {
      if (slotKey !== null) {
        if (o.pickup_at === null) return false;
        const slot = slotFor(o.pickup_at, config, slots);
        if (!slot || !sameInstant(slot.key, slotKey)) return false;
      }
      if (q === "") return true;
      return (
        (o.customer_name ?? "").toLowerCase().includes(q) ||
        String(o.delivery_number ?? "").includes(q)
      );
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

  function openOrder(o: Order) {
    setTakeaway(o.id, o.customer_name ?? "");
    router.push(mRoutes.takeawayOrder(o.id));
  }

  async function addOrder(parent: Order) {
    try {
      const { orderId } = await createFollowUpOrder(parent, userId);
      setTakeaway(orderId, parent.customer_name ?? "");
      router.push(mRoutes.takeawayOrder(orderId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("takeaway.couldNotLoad"));
    }
  }

  if (!canView) {
    return (
      <>
        <MHeader title={t("takeaway.title")} action={<DesktopSwitch />} />
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            {t("takeaway.needsPermission")}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <MHeader title={t("takeaway.title")} action={<DesktopSwitch />} />

      <div className="flex shrink-0 gap-2 overflow-x-auto border-b p-2">
        <button
          type="button"
          onClick={() => setSlotKey(null)}
          className={cn(
            "flex h-11 shrink-0 items-center rounded-lg border px-3 text-sm font-medium",
            slotKey === null
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground",
          )}
        >
          {t("takeaway.allSlots")}
        </button>
        {slots.map((s) => {
          const active = slotKey !== null && sameInstant(s.key, slotKey);
          const pressure = load.hasRules ? load.pressureAt(s.at) : null;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSlotKey(active ? null : s.key)}
              title={pressureDetail(pressure) || undefined}
              className={cn(
                "flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold tabular-nums",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : s.isPast
                    ? "text-muted-foreground/60"
                    : "",
              )}
            >
              {s.label}
              <LoadDot pressure={pressure} />
            </button>
          );
        })}
      </div>

      <div className="relative shrink-0 border-b p-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("takeaway.searchPlaceholder")}
          aria-label={t("takeaway.searchAria")}
          className="h-11 pl-9"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-36">
        {error && (
          <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>
        )}
        {loading && (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        )}
        {!loading && !error && groups.length === 0 && (
          <p className="p-4 text-muted-foreground">
            {orders.length === 0
              ? t("takeaway.noneTonight")
              : t("takeaway.noneMatch")}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <h2 className="flex items-center justify-between bg-muted/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              <span className="tabular-nums">
                {group.label === null
                  ? t("takeaway.noTime")
                  : `${group.label} – ${group.endLabel}`}
              </span>
              <span>
                {t("takeaway.slotOrders", { count: group.items.length })}
              </span>
            </h2>
            <div className="flex flex-col gap-2 p-3">
              {arrangeFamilies(group.items, numberById).map((row) => {
                const o = row.order;
                const followUp = row.isFollowUp;
                const due =
                  o.pickup_at === null ? null : new Date(o.pickup_at).getTime();
                const late = due !== null && due < now.getTime();
                const soon =
                  due !== null &&
                  !late &&
                  due - now.getTime() <= SOON_MINUTES * 60_000;
                return (
                  <div
                    key={o.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border-l-4 bg-card px-3 py-2",
                      followUp && "ml-4 bg-muted/40",
                      late
                        ? "border-l-red-500"
                        : soon
                          ? "border-l-amber-500"
                          : "border-l-transparent",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openOrder(o)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="w-12 shrink-0 text-base font-semibold tabular-nums">
                        {o.pickup_at === null
                          ? t("takeaway.noTimeShort")
                          : formatTime(o.pickup_at)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {o.delivery_number !== null && (
                            <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                              #{o.delivery_number}
                            </span>
                          )}
                          <span className="truncate font-semibold">
                            {o.customer_name}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {followUp
                            ? t("takeaway.followUpOf", {
                                number: row.parentNumber ?? "?",
                              })
                            : t("takeaway.openedAt", {
                                time: formatTime(o.opened_at),
                              })}
                          {" · "}
                          {formatMoney(o.total)}
                        </span>
                      </span>
                    </button>
                    {canTakeOrders && (
                      <button
                        type="button"
                        onClick={() => void addOrder(o)}
                        aria-label={t("takeaway.addOrderAria", {
                          name: o.customer_name ?? "",
                        })}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {canTakeOrders && (
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          aria-label={t("takeaway.newTakeaway")}
          className="absolute bottom-20 right-4 z-10 flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-lg ring-4 ring-background"
        >
          <ShoppingBag className="h-5 w-5" />
          {t("takeaway.newTakeaway")}
        </button>
      )}

      <NewTakeawaySheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        openOrders={orders}
        onCreated={load_}
      />
    </>
  );
}
