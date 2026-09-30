"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchBookedTimes } from "@/lib/api";
import type { Reservation } from "@/lib/database.types";
import { minutesLate } from "@/lib/reservations/late";
import { useNow } from "./use-now";
import { useRealtimeRefresh } from "./use-realtime-refresh";
import { dayKey, dayStart } from "./use-reservations-day";

/**
 * The reservations module's summary for the nav: how many of today's parties
 * are past their time and not seated yet (the list's own "in ritardo").
 * `enabled` false (no manage_reservations) reads nothing and opens no channel.
 */
export function useReservationsBadge(enabled: boolean): { late: number } {
  const [booked, setBooked] = useState<Pick<Reservation, "status" | "reserved_at">[]>([]);
  const now = useNow(60_000);
  // a new day, a new list (the badge may stay mounted past midnight)
  const day = dayKey(new Date(now));

  const refresh = useCallback(async () => {
    if (!enabled) {
      setBooked([]);
      return;
    }
    const start = dayStart(day);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    try {
      setBooked(await fetchBookedTimes(start, end));
    } catch {
      // a badge isn't worth an error message: keep the last count
    }
  }, [enabled, day]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtimeRefresh("reservations-badge", ["reservations"], refresh, enabled);

  return { late: booked.filter((r) => minutesLate(r, now) !== null).length };
}
