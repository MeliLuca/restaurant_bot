"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCategories,
  fetchMenuItems,
  fetchMenuModifierGroups,
  fetchTables,
  type ModifierGroupWithModifiers,
} from "@/lib/api";
import type { Category, MenuItem, RestaurantTable } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";

interface MenuData {
  categories: Category[];
  items: MenuItem[];
  /** Modifier groups keyed by menu_item_id */
  modifierGroups: Record<string, ModifierGroupWithModifiers[]>;
  tables: RestaurantTable[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * The slow-moving reference data an order-taking screen needs: menu,
 * categories, modifier groups and tables, in one round of parallel fetches.
 *
 * Extracted from the POS page so the phone UI loads the same data the same
 * way rather than assembling its own subtly different set.
 */
export function useMenuData(): MenuData {
  const t = useT();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modifierGroups, setModifierGroups] = useState<
    Record<string, ModifierGroupWithModifiers[]>
  >({});
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [c, i, tb, mg] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
        fetchTables(),
        fetchMenuModifierGroups(),
      ]);
      setCategories(c);
      setItems(i);
      setTables(tb);
      setModifierGroups(mg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("pos.failedLoadMenu"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { categories, items, modifierGroups, tables, loading, error, reload };
}
