"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCategories,
  fetchMenuItems,
  fetchTables,
  fetchVariationData,
  type VariationData,
} from "@/lib/api";
import type { Category, RestaurantTable } from "@/lib/database.types";
import type { MenuItemView } from "@/lib/menu-display";
import { useT } from "@/lib/i18n/use-translation";

const NO_VARIATIONS: VariationData = { pantry: [], byItem: {}, quickNotes: [] };

interface MenuData {
  categories: Category[];
  items: MenuItemView[];
  /** The pantry, each modifiable dish's own ingredients, and the note rapide */
  variations: VariationData;
  tables: RestaurantTable[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * The slow-moving reference data an order-taking screen needs: menu,
 * categories, variation data and tables, in one round of parallel fetches.
 *
 * Extracted from the POS page so the phone UI loads the same data the same
 * way rather than assembling its own subtly different set.
 */
export function useMenuData(): MenuData {
  const t = useT();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItemView[]>([]);
  const [variations, setVariations] = useState<VariationData>(NO_VARIATIONS);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [c, i, tb, v] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
        fetchTables(),
        fetchVariationData(),
      ]);
      setCategories(c);
      setItems(i);
      setTables(tb);
      setVariations(v);
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

  return { categories, items, variations, tables, loading, error, reload };
}
