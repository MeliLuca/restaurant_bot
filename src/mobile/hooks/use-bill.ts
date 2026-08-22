"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchOpenOrderById,
  fetchTables,
  type OpenOrder,
} from "@/lib/api";

interface BillData {
  bill: OpenOrder | null;
  /** Name of the table the bill belongs to (null for take-away) */
  tableName: string | null;
  /** What to call this bill in a header: "T3", "T3/Gino", or the customer */
  label: string;
  /** The order id resolved to nothing: paid, cancelled, or never existed.
   * Distinct from `loading` so the screen can say so instead of rendering an
   * empty bill — a back gesture onto a just-settled bill lands exactly here. */
  closed: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * One bill, addressed by order id.
 *
 * Deliberately not useOpenOrder: that hook resolves whatever the ticket store
 * currently targets, which is the right question while *adding* items and the
 * wrong one while settling — a bill has to keep showing the order in the URL
 * even when the ticket has moved on.
 */
export function useBill(orderId: string): BillData {
  const [bill, setBill] = useState<OpenOrder | null>(null);
  const [tableName, setTableName] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const open = await fetchOpenOrderById(orderId);
      setBill(open);
      setClosed(open === null);
      if (open?.order.table_id) {
        const tables = await fetchTables();
        setTableName(
          tables.find((x) => x.id === open.order.table_id)?.name ?? null,
        );
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bill");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // another till may have taken a share while this phone was in a pocket
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const order = bill?.order;
  const label =
    order?.order_type === "takeaway"
      ? (order.customer_name ?? "")
      : order?.subtable
        ? `${tableName ?? ""}/${order.subtable}`
        : (tableName ?? "");

  return { bill, tableName, label, closed, loading, error, refresh };
}
