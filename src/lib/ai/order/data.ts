// Assistente AI — order task: the menu as the matcher needs it. SERVER ONLY.
// The same data the POS reads (fetchMenuItems / fetchCategories /
// fetchVariationData), plus every dish's ingredient ids — byItem only covers
// the dishes that allow variations, the off-menu pricing compares them all.

import { fetchCategories, fetchMenuItems, fetchVariationData, type VariationData } from "@/lib/api";
import type { Category } from "@/lib/database.types";
import type { MenuItemView } from "@/lib/menu-display";
import type { VariationOption } from "@/lib/pos/variation-selection";
import { getSupabase } from "@/lib/supabase/client";

export interface OrderData {
  categories: Category[];
  /** orderable right now, coperto and "Fuori menù" placeholders excluded */
  items: MenuItemView[];
  /** every orderable dish's own ingredients (id, name, price) */
  itemIngredients: Record<string, VariationOption[]>;
  variations: VariationData;
}

export async function loadOrderData(): Promise<OrderData> {
  const [categories, items, variations, dishRes] = await Promise.all([
    fetchCategories(),
    fetchMenuItems(),
    fetchVariationData(),
    getSupabase()
      .from("menu_items")
      .select("id, ingredients(id, name, price)")
      .eq("is_available", true)
      .eq("is_custom", false),
  ]);
  if (dishRes.error) throw new Error(dishRes.error.message);
  const itemIngredients: Record<string, VariationOption[]> = {};
  for (const row of dishRes.data as unknown as Array<{
    id: string;
    ingredients: VariationOption[];
  }>) {
    itemIngredients[row.id] = row.ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      price: Number(i.price),
    }));
  }
  return {
    categories,
    items: items.filter((i) => !i.is_coperto),
    itemIngredients,
    variations,
  };
}
