"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { fetchKitchenOrders, type KitchenOrder } from "@/lib/kitchen/data";

/** Kitchen screens poll faster than chat when the websocket is down */
const POLL_INTERVAL_MS = 10_000;
const REFRESH_DEBOUNCE_MS = 400;

export type { Station, KitchenItem, KitchenOrder } from "@/lib/kitchen/data";

interface KitchenData {
  orders: KitchenOrder[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Bump an item (ready=true) or send it back to prep (ready=false) */
  setItemReady: (itemId: string, ready: boolean) => Promise<void>;
  /** Bump every remaining item of an order at once */
  setOrderReady: (order: KitchenOrder) => Promise<void>;
}

export function useKitchenOrders(): KitchenData {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOrders(await fetchKitchenOrders());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime push with poll fallback, same shape as use-floor-data/chat-store
  const realtimeUp = useRef(false);
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
    };

    const channel = getSupabase()
      .channel("kitchen-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        debouncedRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        debouncedRefresh,
      )
      .subscribe((status) => {
        realtimeUp.current = status === "SUBSCRIBED";
      });

    const pollTimer = setInterval(() => {
      if (!realtimeUp.current && document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void getSupabase().removeChannel(channel);
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const setItemReady = useCallback(
    async (itemId: string, ready: boolean) => {
      const ready_at = ready ? new Date().toISOString() : null;
      // optimistic flip; realtime/refresh reconciles
      setOrders((prev) =>
        prev.map((o) => ({
          ...o,
          items: o.items.map((i) =>
            i.id === itemId ? { ...i, readyAt: ready_at } : i,
          ),
        })),
      );
      const { error: updateError } = await getSupabase()
        .from("order_items")
        .update({ ready_at })
        .eq("id", itemId);
      if (updateError) {
        await refresh();
        throw new Error(updateError.message);
      }
    },
    [refresh],
  );

  const setOrderReady = useCallback(
    async (order: KitchenOrder) => {
      const pending = order.items.filter((i) => !i.readyAt);
      if (pending.length === 0) return;
      const ready_at = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                items: o.items.map((i) =>
                  i.readyAt ? i : { ...i, readyAt: ready_at },
                ),
              }
            : o,
        ),
      );
      const { error: updateError } = await getSupabase()
        .from("order_items")
        .update({ ready_at })
        .in(
          "id",
          pending.map((i) => i.id),
        );
      if (updateError) {
        await refresh();
        throw new Error(updateError.message);
      }
    },
    [refresh],
  );

  return { orders, loading, error, refresh, setItemReady, setOrderReady };
}
