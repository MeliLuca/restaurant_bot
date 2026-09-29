"use client";

import { useCallback, useEffect, useState } from "react";
import type { WaitlistEntry } from "@/lib/database.types";
import { fetchWaitlist } from "@/lib/smart-floor/waitlist-api";
import { useRealtimeRefresh } from "./use-realtime-refresh";

/** A party still "waiting" after this long is from another service */
const STALE_HOURS = 12;

/** Gestione Sala Smart's waitlist, in arrival order, fresh on every device */
export function useWaitlist(enabled = true) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setEntries(await fetchWaitlist(new Date(Date.now() - STALE_HOURS * 3_600_000)));
    } catch {
      // the queue is an aid on top of the floor: keep what we had
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void refresh();
    else setEntries([]);
  }, [enabled, refresh]);

  useRealtimeRefresh("waitlist", ["waitlist"], refresh);

  return { entries, refresh };
}
