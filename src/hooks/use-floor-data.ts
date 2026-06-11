"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchOpenDineInOrders,
  fetchOpenTakeaways,
  fetchTables,
  fetchTodayReservations,
} from "@/lib/api";
import type { Order, Reservation, RestaurantTable } from "@/lib/database.types";

interface FloorData {
  tables: RestaurantTable[];
  reservations: Reservation[];
  takeaways: Order[];
  /** Open dine-in orders across all tables (split badges) */
  openOrders: Order[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFloorData(): FloorData {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [takeaways, setTakeaways] = useState<Order[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, r, ta, oo] = await Promise.all([
        fetchTables(),
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
