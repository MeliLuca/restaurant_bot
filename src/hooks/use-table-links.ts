"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTableLinks } from "@/lib/floor/links";
import { getSupabase } from "@/lib/supabase/client";
import type { TableLink } from "@/lib/database.types";

/**
 * Linked-table members, kept live across devices. Same realtime pattern as
 * useFloorData (coarse refetch on change + refetch when the tab comes back);
 * the topic is unique per mount so two mounts never share one channel.
 */
export function useTableLinks(): {
  links: TableLink[];
  refresh: () => Promise<void>;
} {
  const [links, setLinks] = useState<TableLink[]>([]);

  const refresh = useCallback(async () => {
    try {
      setLinks(await fetchTableLinks());
    } catch {
      // links are advisory; the POS works without them
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = getSupabase()
      .channel(`table-links-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "table_links" },
        () => void refresh(),
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      void getSupabase().removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { links, refresh };
}
