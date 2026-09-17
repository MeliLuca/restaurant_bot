"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCategoryLimits,
  fetchLoadRows,
  fetchMenuItemCategories,
  fetchSlotConfig,
} from "@/lib/takeaway/api";
import {
  TakeawayLoad,
  type CategoryRule,
  type PressureOptions,
  type SlotPressure,
} from "@/lib/takeaway/load";
import {
  DEFAULT_SLOT_CONFIG,
  type Slot,
  type SlotConfig,
} from "@/lib/takeaway/slots";
import { fetchCategories } from "@/lib/api";
import { useTicketStore } from "@/stores/ticket-store";

interface TakeawayLoadData {
  config: SlotConfig;
  load: TakeawayLoad;
  /** Category of a menu item — the bridge from an unsent ticket to the rules */
  categoryOfItem: (menuItemId: string) => string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_LOAD = new TakeawayLoad([], []);

/**
 * The slot grid, the capacity rules, and what is already promised against them.
 *
 * One hook because the three are useless apart: a rule with no counts can't
 * warn, and counts with no grid can't suggest a different time. Failures are
 * swallowed into an empty load on purpose — a capacity warning is an aid, and
 * a settings table that won't load must never stop an order being taken.
 */
export function useTakeawayLoad(): TakeawayLoadData {
  const [config, setConfig] = useState<SlotConfig>(DEFAULT_SLOT_CONFIG);
  const [load, setLoad] = useState<TakeawayLoad>(EMPTY_LOAD);
  const [itemCategories, setItemCategories] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [cfg, limits, categories, rows, itemCats] = await Promise.all([
        fetchSlotConfig(),
        fetchCategoryLimits(),
        fetchCategories(),
        fetchLoadRows(),
        fetchMenuItemCategories(),
      ]);
      const nameById = new Map(categories.map((c) => [c.id, c.name]));
      const rules: CategoryRule[] = limits
        .filter((l) => l.is_active && nameById.has(l.category_id))
        .map((l) => ({
          categoryId: l.category_id,
          categoryName: nameById.get(l.category_id) as string,
          maxItems: l.max_items,
          windowMinutes: l.window_minutes,
        }));
      setConfig(cfg);
      setLoad(new TakeawayLoad(rules, rows));
      setItemCategories(itemCats);
    } catch {
      setLoad(EMPTY_LOAD);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categoryOfItem = useCallback(
    (menuItemId: string) => itemCategories.get(menuItemId) ?? null,
    [itemCategories],
  );

  return useMemo(
    () => ({ config, load, categoryOfItem, loading, refresh }),
    [config, load, categoryOfItem, loading, refresh],
  );
}

interface TakeawayPressure extends TakeawayLoadData {
  /** What to assume about the ticket in hand when reading any slot */
  options: PressureOptions;
  /** Ready to hand to SlotGrid; null when no rules are configured */
  pressureFor: ((slot: Slot) => SlotPressure | null) | undefined;
}

/**
 * The load, read from the point of view of one order being written.
 *
 * Folds in the two things that make a slot look different to the person
 * holding it than to everyone else: the unsent lines on their ticket, and the
 * fact that moving THIS order to a slot also takes its pieces out of the one
 * it is leaving.
 */
export function useTakeawayPressure(orderId: string | null): TakeawayPressure {
  const data = useTakeawayLoad();
  const { load, categoryOfItem } = data;
  const lines = useTicketStore((s) => s.lines);
  const takeawayOrderId = useTicketStore((s) => s.takeawayOrderId);

  // The draft belongs to this order only while the till is pointed at it.
  const draftIsOurs = orderId !== null && takeawayOrderId === orderId;

  const extraByCategory = useMemo(() => {
    const map = new Map<string, number>();
    if (!draftIsOurs) return map;
    for (const line of lines) {
      const categoryId = categoryOfItem(line.menuItemId);
      if (!categoryId) continue;
      map.set(categoryId, (map.get(categoryId) ?? 0) + line.quantity);
    }
    return map;
  }, [draftIsOurs, lines, categoryOfItem]);

  const options = useMemo<PressureOptions>(
    () => ({ extraByCategory, moveOrderId: orderId }),
    [extraByCategory, orderId],
  );

  const pressureFor = useMemo(
    () =>
      load.hasRules
        ? (slot: Slot) => load.pressureAt(slot.at, options)
        : undefined,
    [load, options],
  );

  return { ...data, options, pressureFor };
}
