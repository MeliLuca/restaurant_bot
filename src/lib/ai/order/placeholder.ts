// Assistente AI — order task: the "Fuori menù" placeholder of a category.
// SERVER ONLY.
//
// An off-menu line still needs a menu_items row (order_items.menu_item_id is
// NOT NULL): one hidden placeholder per category (menu_items.is_custom, the
// partial unique index menu_items_one_custom_per_category), never shown on
// the menu (fetchMenuItems skips it). The line's real name goes in
// order_items.custom_name. The placeholder prints where most of its
// category's dishes print, so the comanda reaches the right station.

import { getSupabase } from "@/lib/supabase/client";
import type { CustomItemResponse } from "../contracts/order";

const UNIQUE_VIOLATION = "23505";

async function findPlaceholder(categoryId: string) {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .select("id, name, category_id, target_printer_id")
    .eq("category_id", categoryId)
    .eq("is_custom", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** null = the category does not exist */
export async function ensureCustomItem(categoryId: string): Promise<CustomItemResponse | null> {
  const existing = await findPlaceholder(categoryId);
  if (existing) {
    return {
      menuItemId: existing.id,
      name: existing.name,
      categoryId: existing.category_id,
      targetPrinterId: existing.target_printer_id,
      created: false,
    };
  }

  const sb = getSupabase();
  const [catRes, itemsRes] = await Promise.all([
    sb.from("categories").select("id, name").eq("id", categoryId).maybeSingle(),
    sb
      .from("menu_items")
      .select("target_printer_id, sort_order")
      .eq("category_id", categoryId)
      .eq("is_custom", false),
  ]);
  if (catRes.error) throw new Error(catRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (!catRes.data) return null;

  // the station most of the category prints at (unrouted dishes don't vote)
  const votes = new Map<string, number>();
  itemsRes.data.forEach((i) => {
    if (i.target_printer_id) votes.set(i.target_printer_id, (votes.get(i.target_printer_id) ?? 0) + 1);
  });
  let printer: string | null = null;
  votes.forEach((n, id) => {
    if (printer === null || n > (votes.get(printer) ?? 0)) printer = id;
  });
  const sortOrder = itemsRes.data.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1;

  const name = `Fuori menù — ${catRes.data.name}`;
  const { data, error } = await sb
    .from("menu_items")
    .insert({
      category_id: categoryId,
      name,
      price: 0,
      is_available: true,
      allows_variations: false,
      is_custom: true,
      target_printer_id: printer,
      sort_order: sortOrder,
    })
    .select("id, name, category_id, target_printer_id")
    .single();
  if (error) {
    // another till created it in the meantime: use theirs
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findPlaceholder(categoryId);
      if (raced) {
        return {
          menuItemId: raced.id,
          name: raced.name,
          categoryId: raced.category_id,
          targetPrinterId: raced.target_printer_id,
          created: false,
        };
      }
    }
    throw new Error(error.message);
  }
  return {
    menuItemId: data.id,
    name: data.name,
    categoryId: data.category_id,
    targetPrinterId: data.target_printer_id,
    created: true,
  };
}
