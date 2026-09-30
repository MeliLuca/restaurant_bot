"use client";

import { useMemo, useState } from "react";
import {
  countByStatus,
  displayStatus,
  type TableDisplayStatus,
} from "@/lib/floor/status";
import type { TableTag } from "@/lib/database.types";
import type { TableWithTags } from "@/lib/settings-api";

export interface FloorFilters {
  search: string;
  setSearch: (value: string) => void;
  /** One visual state to show (null = all) */
  status: TableDisplayStatus | null;
  toggleStatus: (status: TableDisplayStatus) => void;
  /** Feature tags a table must all have (TV screen, accessible…) */
  tagIds: string[];
  toggleTag: (id: string) => void;
  /** Every tag some table has, A–Z */
  allTags: TableTag[];
  /** Tables per visual state, over the whole floor (not the filtered part) */
  counts: Record<TableDisplayStatus, number>;
  /** The tables matching the search, the state AND every chosen tag */
  visible: TableWithTags[];
}

/** The Sala's search and filters, and the at-a-glance count of each state */
export function useFloorFilters(
  tables: TableWithTags[],
  hasOrder: (tableId: string) => boolean,
): FloorFilters {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TableDisplayStatus | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const allTags = useMemo(
    () =>
      Array.from(
        new Map(tables.flatMap((tb) => tb.table_tags).map((tag) => [tag.id, tag])).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [tables],
  );

  const query = search.trim().toLowerCase();
  const visible = tables.filter(
    (tb) =>
      (query === "" || tb.name.toLowerCase().includes(query)) &&
      (status === null || displayStatus(tb.status, hasOrder(tb.id)) === status) &&
      tagIds.every((id) => tb.table_tags.some((tag) => tag.id === id)),
  );

  return {
    search,
    setSearch,
    status,
    toggleStatus: (next) => setStatus((s) => (s === next ? null : next)),
    tagIds,
    toggleTag: (id) =>
      setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    allTags,
    counts: countByStatus(tables, hasOrder),
    visible,
  };
}
