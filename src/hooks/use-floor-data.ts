"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchOpenDineInOrders,
  fetchOpenTakeaways,
  fetchTodayReservations,
} from "@/lib/api";
import { fetchTablesWithTags, type TableWithTags } from "@/lib/settings-api";
import type { Order, Reservation } from "@/lib/database.types";

interface FloorData {
  /** Tables including their feature tags (TV screen, accessible…) */
  tables: TableWithTags[];
  reservations: Reservation[];
  takeaways: Order[];
  /** Open dine-in orders across all tables (split badges) */
  openOrders: Order[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFloorData(): FloorData {
  const [tables, setTables] = useState<TableWithTags[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [takeaways, setTakeaways] = useState<Order[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, r, ta, oo] = await Promise.all([
        fetchTablesWithTags(),
        fetchTodayReservations(),
        fetchOpenTakeaways(),
        fetchOpenDineInOrders(),
      ]);
      setTables(t);
      setReservations(r);
      setTakeaways(ta);
      setOpenOrders(oo);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load floor data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tables, reservations, takeaways, openOrders, loading, error, refresh };
}
