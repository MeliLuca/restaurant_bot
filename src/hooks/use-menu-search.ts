"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { Category } from "@/lib/database.types";
import type { MenuItemView } from "@/lib/menu-display";
import { buildMenuIndex, searchMenu } from "@/lib/menu-search";
import { useTicketStore } from "@/stores/ticket-store";

/**
 * The state every dish-picking screen needs: what was typed, what it matches,
 * and which category to jump to. Shared so the till and the phone cannot drift
 * apart again — they answered "prosciutto" differently for months.
 */
export function useMenuSearch(items: MenuItemView[], categories: Category[]) {
  const [query, setQuery] = useState("");
  // deferred rather than debounced: the field stays responsive while the
  // 1,000-row list re-filters at React's pace
  const deferredQuery = useDeferredValue(query);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [scrollToCategoryId, setScrollToCategoryId] = useState<string | null>(
    null,
  );

  const index = useMemo(
    () => buildMenuIndex(items, categories),
    [items, categories],
  );

  const results = useMemo(
    () => searchMenu(index, deferredQuery),
    [index, deferredQuery],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // stable, so the list's scroll effect does not re-run every render
  const onScrolledToCategory = useCallback(
    () => setScrollToCategoryId(null),
    [],
  );

  return {
    query,
    setQuery,
    results,
    categoryCounts,
    jumpOpen,
    setJumpOpen,
    scrollToCategoryId,
    jumpTo: setScrollToCategoryId,
    onScrolledToCategory,
  };
}

/**
 * How many of each dish are on the round being built, keyed by menu_item_id.
 *
 * Summed across lines on purpose: the ticket splits one dish into a line per
 * modifier set, and a waiter asking "how many did I order" wants 3, not
 * "1 here and 2 there". Counts pending lines only, so they clear on send and
 * follow the table you are standing at, both of which the draft stash in the
 * ticket store already does for free.
 */
export function useOrderedCounts(): Map<string, number> {
  const lines = useTicketStore((s) => s.lines);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      counts.set(
        line.menuItemId,
        (counts.get(line.menuItemId) ?? 0) + line.quantity,
      );
    }
    return counts;
  }, [lines]);
}
