"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, ShoppingBag, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewDeliveryDialog } from "@/components/floor-plan/new-delivery-dialog";
import { TakeawayBoard } from "@/components/takeaway/takeaway-board";
import {
  fetchTakeawayOrders,
  type TakeawayStatusFilter,
} from "@/lib/takeaway/api";
import { resetDeliveryCounter } from "@/lib/api";
import { useTakeawayPressure } from "@/hooks/use-takeaway-load";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

export default function TakeawayPage() {
  const t = useT();
  const canTakeOrders = usePermission("take_orders");
  const canView = usePermission("view_takeaway");
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<TakeawayStatusFilter>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // One clock for the whole page: the slot strip, the grouping and the "late"
  // marks must agree, and three calls to `new Date()` in one render can't.
  const [now, setNow] = useState(() => new Date());
  // The board reads the evening as a whole: no ticket in hand, nothing to move.
  const { config, load, refresh: refreshLoad } = useTakeawayPressure(null);

  const refresh = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      setOrders(await fetchTakeawayOrders(status));
      await refreshLoad();
      setNow(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("takeaway.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [canView, status, t, refreshLoad]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The evening moves on even when nobody touches the screen: without this the
  // board would still call 20:00 "next up" at half past.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  async function resetCounter() {
    try {
      await resetDeliveryCounter();
      await refresh();
      toast.success(t("floor.counterReset"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.resetFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShoppingBag className="h-6 w-6" /> {t("takeaway.title")}
        </h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold tabular-nums">
          {orders.filter((o) => o.status === "open").length}
        </span>
        <div className="ml-auto flex gap-2">
          {canView && canTakeOrders && (
            <>
              <Button className="h-11" onClick={() => setNewOpen(true)}>
                <ShoppingBag className="mr-2 h-4 w-4" />{" "}
                {t("takeaway.newTakeaway")}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void resetCounter()}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> {t("floor.resetCounter")}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center gap-3 py-5 text-sm">
            <TriangleAlert className="h-5 w-5 text-destructive" />
            <span className="flex-1">{error}</span>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      {!canView ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("takeaway.needsPermission")}
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <TakeawayBoard
          orders={orders}
          status={status}
          onStatusChange={setStatus}
          config={config}
          now={now}
          pressureAt={
            load.hasRules ? (at) => load.pressureAt(at) : undefined
          }
        />
      )}

      <NewDeliveryDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
}
