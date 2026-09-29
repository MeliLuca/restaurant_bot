"use client";

import { useCallback, useEffect, useState } from "react";
import type { FloorMap } from "@/lib/database.types";
import { fetchFloorMaps } from "@/lib/floor/maps";
import type { FloorSnapshot } from "@/lib/smart-floor/context";
import { fetchFloorSnapshot } from "@/lib/smart-floor/data";
import { useRealtimeRefresh } from "./use-realtime-refresh";

/** Local calendar day as "YYYY-MM-DD" */
export function dayKey(d: Date): string {
  const local = new Date(d);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

/** Midnight (local) of a "YYYY-MM-DD" day */
export function dayStart(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * One service day for Gestione Sala Smart: its reservations plus everything
 * the assignment engine reads, kept fresh across devices.
 */
export function useReservationsDay(day: string) {
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [maps, setMaps] = useState<FloorMap[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [snap, m] = await Promise.all([
        fetchFloorSnapshot(dayStart(day)),
        fetchFloorMaps(),
      ]);
      setSnapshot(snap);
      setMaps(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reservations");
    }
  }, [day]);

  useEffect(() => {
    setSnapshot(null);
    void refresh();
  }, [refresh]);

  useRealtimeRefresh(
    "reservations-day",
    ["reservations", "reservation_tables", "tables", "smart_floor_settings"],
    refresh,
  );

  return { snapshot, maps, error, refresh };
}
