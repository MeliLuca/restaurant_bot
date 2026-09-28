"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOpenDineInOrders,
  fetchOpenTakeaways,
  fetchTodayReservations,
} from "@/lib/api";
import { fetchTableLinks } from "@/lib/floor/links";
import { fetchFloorMaps } from "@/lib/floor/maps";
import { fetchTablesWithTags, type TableWithTags } from "@/lib/settings-api";
import { getSupabase } from "@/lib/supabase/client";
import type {
  FloorMap,
  Order,
  Reservation,
  TableLink,
} from "@/lib/database.types";

/** Poll cadence when the realtime websocket is down (mirrors chat-store) */
const POLL_INTERVAL_MS = 15_000;
/** Collapse bursts of change events into one coarse refetch */
const REFRESH_DEBOUNCE_MS = 400;

interface FloorData {
  /** Tables including their feature tags (TV screen, accessible…) */
  tables: TableWithTags[];
  reservations: Reservation[];
  takeaways: Order[];
  /** Open dine-in orders across all tables (split badges) */
  openOrders: Order[];
  /** Linked-table members (🔗 badges) */
  links: TableLink[];
  /** Drawn floor maps (rooms), in display order */
  maps: FloorMap[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFloorData(): FloorData {
  const [tables, setTables] = useState<TableWithTags[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [takeaways, setTakeaways] = useState<Order[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [links, setLinks] = useState<TableLink[]>([]);
  const [maps, setMaps] = useState<FloorMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, r, ta, oo, li, fm] = await Promise.all([
        fetchTablesWithTags(),
        fetchTodayReservations(),
        fetchOpenTakeaways(),
        fetchOpenDineInOrders(),
        fetchTableLinks(),
        fetchFloorMaps(),
      ]);
      setTables(t);
      setReservations(r);
      setTakeaways(ta);
      setOpenOrders(oo);
      setLinks(li);
      setMaps(fm);
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

  // Keep the floor fresh across devices: subscribe to table/order changes and
  // coarsely refetch (the queries are cheap; no merge logic needed). When the
  // websocket is down, fall back to polling — and always refetch when the tab
  // becomes visible again, since phones suspend sockets constantly.
  const realtimeUp = useRef(false);
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
    };

    const channel = getSupabase()
      .channel("floor-data")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables" },
        debouncedRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        debouncedRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "table_links" },
        debouncedRefresh,
      )
      .subscribe((status) => {
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
  }, [refresh]);

  return {
    tables,
    reservations,
    takeaways,
    openOrders,
    links,
    maps,
    loading,
    error,
    refresh,
  };
}
