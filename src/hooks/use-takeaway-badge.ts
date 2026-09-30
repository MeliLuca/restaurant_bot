"use client";

import { useCallback, useEffect, useState } from "react";
import type { Order } from "@/lib/database.types";
import { fetchOpenTakeawayDue } from "@/lib/takeaway/api";
import { urgencyOf } from "@/lib/takeaway/urgency";
import { useNow } from "./use-now";
import { useRealtimeRefresh } from "./use-realtime-refresh";

export interface TakeawayBadge {
  /** Take-aways still open */
  open: number;
  /** Of those, past the time the customer was promised */
  late: number;
}

/**
 * The take-away module's summary for the nav: kept fresh across devices, and
 * re-judged every minute, since an order turns late without anyone touching it.
 * `enabled` false (no view_takeaway) reads nothing and opens no channel.
 */
export function useTakeawayBadge(enabled: boolean): TakeawayBadge {
  const [orders, setOrders] = useState<Pick<Order, "id" | "status" | "pickup_at">[]>([]);
  const now = useNow(60_000);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setOrders([]);
      return;
    }
    try {
      setOrders(await fetchOpenTakeawayDue());
    } catch {
      // a badge isn't worth an error message: keep the last count
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtimeRefresh("takeaway-badge", ["orders"], refresh, enabled);

  const at = new Date(now);
  return {
    open: orders.length,
    late: orders.filter((o) => urgencyOf(o, at) === "late").length,
  };
}
