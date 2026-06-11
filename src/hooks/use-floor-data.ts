"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchOpenTakeaways,
  fetchTables,
  fetchTodayReservations,
} from "@/lib/api";
import type { Order, Reservation, RestaurantTable } from "@/lib/database.types";

interface FloorData {
  tables: RestaurantTable[];
  reservations: Reservation[];
  takeaways: Order[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFloorData(): FloorData {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [takeaways, setTakeaways] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, r, ta] = await Promise.all([
        fetchTables(),
        fetchTodayReservations(),
        fetchOpenTakeaways(),
      ]);
      setTables(t);
      setReservations(r);
      setTakeaways(ta);
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

  return { tables, reservations, takeaways, loading, error, refresh };
}
