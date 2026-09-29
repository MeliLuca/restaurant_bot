"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/lib/supabase/client";

/** Poll cadence when the realtime websocket is down (mirrors use-floor-data) */
const POLL_INTERVAL_MS = 15_000;
/** Collapse bursts of change events into one coarse refetch */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Call `refresh` whenever one of `tables` changes on any device: realtime
 * postgres_changes, debounced; polling while the socket is down; and always
 * when the tab becomes visible again (phones suspend sockets constantly).
 */
export function useRealtimeRefresh(
  channelName: string,
  tables: string[],
  refresh: () => Promise<void> | void,
) {
  const realtimeUp = useRef(false);
  const key = tables.join(",");

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
    };

    let channel = getSupabase().channel(channelName);
    for (const table of key.split(",")) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        debounced,
      );
    }
    channel.subscribe((status) => {
      realtimeUp.current = status === "SUBSCRIBED";
    });

    const pollTimer = setInterval(() => {
      if (!realtimeUp.current && document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void getSupabase().removeChannel(channel);
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [channelName, key, refresh]);
}
