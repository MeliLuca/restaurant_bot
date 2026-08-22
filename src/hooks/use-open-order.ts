"use client";

import { useCallback, useEffect, useState } from "react";
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

  const refresh = useCallback(async () => {
    try {
      if (mode === "table") {
        setOpenOrder(tableId ? await fetchOpenOrder(tableId, subtable) : null);
        setOpenSplits(tableId ? await fetchOpenOrdersForTable(tableId) : []);
      } else {
        setOpenOrder(
          takeawayOrderId ? await fetchOpenOrderById(takeawayOrderId) : null,
        );
        setOpenSplits([]);
      }
      setOpenTakeaways(await fetchOpenTakeaways());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.failedLoadOrder"));
    }
  }, [mode, tableId, subtable, takeawayOrderId, t]);

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

  return { openOrder, openSplits, openTakeaways, refresh };
}
