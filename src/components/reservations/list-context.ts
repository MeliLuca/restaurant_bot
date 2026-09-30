"use client";

import { useMemo } from "react";
import type { FloorMap, Reservation, TableTag } from "@/lib/database.types";
import type { TableWithTags } from "@/lib/settings-api";
import { buildFloorContext } from "@/lib/smart-floor/context";
import type { FloorContext } from "@/lib/smart-floor/types";
import { useSmartFloor } from "@/stores/smart-floor-store";

/**
 * What ReservationList reads of the floor (table names, rooms closed to
 * bookings, mandatory tags) from the live floor data, for today's arrivals.
 * Unlike the walk-in floor it reads nothing more (no join rules, no open
 * bills), so it works, and costs nothing extra, with Gestione Sala Smart off.
 */
export function useListContext({
  tables,
  reservations,
  maps,
}: {
  tables: TableWithTags[];
  reservations: Reservation[];
  maps: FloorMap[];
}): { ctx: FloorContext | null; tags: TableTag[] } {
  const { settings } = useSmartFloor();
  const tags = useMemo(
    () =>
      Array.from(
        new Map(tables.flatMap((tb) => tb.table_tags).map((tg) => [tg.id, tg])).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [tables],
  );
  const ctx = useMemo(
    () =>
      settings
        ? buildFloorContext({ settings, tables, tags, reservations, joinRules: [], maps })
        : null,
    [settings, tables, tags, reservations, maps],
  );
  return { ctx, tags };
}
