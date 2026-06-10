"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTables, fetchTodayReservations } from "@/lib/api";
import type { Reservation, RestaurantTable } from "@/lib/database.types";

interface FloorData {
  tables: RestaurantTable[];
  reservations: Reservation[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFloorData(): FloorData {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([
        fetchTables(),
        fetchTodayReservations(),
      ]);
      setTables(t);
      setReservations(r);
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

  return { tables, reservations, loading, error, refresh };
}
