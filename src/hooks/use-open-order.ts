"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchOpenOrder,
  fetchOpenOrderById,
  fetchOpenOrdersForTable,
  fetchOpenTakeaways,
  type OpenOrder,
} from "@/lib/api";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";

interface OpenOrderData {
  /** The open order for the ticket store's current target, if any */
  openOrder: OpenOrder | null;
  /** True once `openOrder` has been fetched for the CURRENT target. Until then
   * a null `openOrder` means "not known yet", not "no order": the ticket store
   * outlives the page, so coming back to the Cassa re-targets the table at
   * once while its order is still loading — and treating that gap as a table
   * with no check re-asked for covers on every return. */
  loaded: boolean;
  /** Other open splits on the same table */
  openSplits: Order[];
  openTakeaways: Order[];
  /** The `onOrderChanged` callback every write path wants */
  refresh: () => Promise<void>;
}

/**
 * The open order for whatever the ticket store currently targets.
 *
 * Extracted from the POS page, which inlined it. No realtime channel here on
 * purpose: useFloorData already hard-codes the "floor-data" topic, and
 * RealtimeClient.channel() hands back the *existing* channel for a repeated
 * topic — so adding a second subscriber is how you get one screen silently
 * tearing down another's realtime. A visibilitychange refetch covers the case
 * that actually matters (a phone waking up to an order another device changed).
 */
export function useOpenOrder(): OpenOrderData {
  const t = useT();
  const mode = useTicketStore((s) => s.mode);
  const tableId = useTicketStore((s) => s.tableId);
  const subtable = useTicketStore((s) => s.subtable);
  const takeawayOrderId = useTicketStore((s) => s.takeawayOrderId);

  const [openOrder, setOpenOrder] = useState<OpenOrder | null>(null);
  const [openSplits, setOpenSplits] = useState<Order[]>([]);
  const [openTakeaways, setOpenTakeaways] = useState<Order[]>([]);

  // Which target `openOrder` was fetched for. The ref is the target being
  // asked for right now, so a slow answer for the previous table can't land
  // on top of the current one.
  const targetKey =
    mode === "table"
      ? `t:${tableId ?? ""}:${subtable ?? ""}`
      : `ta:${takeawayOrderId ?? ""}`;
  const currentKey = useRef(targetKey);
  currentKey.current = targetKey;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const key = targetKey;
    try {
      let order: OpenOrder | null;
      let splits: Order[];
      if (mode === "table") {
        order = tableId ? await fetchOpenOrder(tableId, subtable) : null;
        splits = tableId ? await fetchOpenOrdersForTable(tableId) : [];
      } else {
        order = takeawayOrderId
          ? await fetchOpenOrderById(takeawayOrderId)
          : null;
        splits = [];
      }
      if (currentKey.current !== key) return;
      setOpenOrder(order);
      setOpenSplits(splits);
      setLoadedKey(key);
      setOpenTakeaways(await fetchOpenTakeaways());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.failedLoadOrder"));
    }
  }, [targetKey, mode, tableId, subtable, takeawayOrderId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return {
    openOrder,
    loaded: loadedKey === targetKey,
    openSplits,
    openTakeaways,
    refresh,
  };
}
