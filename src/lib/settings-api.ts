import { getSupabase } from "@/lib/supabase/client";
import type {
  Database,
  Ingredient,
  MenuItem,
  Printer,
  RestaurantSettings,
  RestaurantTable,
  TableTag,
} from "@/lib/database.types";

/** Postgres FK violation → a message a restaurant manager can act on */
function friendly(error: { code?: string; message: string }, hint: string): Error {
  return new Error(error.code === "23503" ? hint : error.message);
}

// ---------------------------------------------------------------------------
// Table tags
// ---------------------------------------------------------------------------

export async function fetchTableTags(): Promise<TableTag[]> {
  const { data, error } = await getSupabase()
    .from("table_tags")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function createTableTag(name: string): Promise<void> {
  const { error } = await getSupabase()
    .from("table_tags")
    .insert({ name: name.trim() });
  if (error) throw new Error(error.message);
}

export async function deleteTableTag(tagId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("table_tags")
    .delete()
    .eq("id", tagId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Tables (floor layout)
// ---------------------------------------------------------------------------

export type TableWithTags = RestaurantTable & { table_tags: TableTag[] };

export async function fetchTablesWithTags(): Promise<TableWithTags[]> {
  const { data, error } = await getSupabase()
    .from("tables")
    .select("*, table_tags(*)")
    .order("name");
  if (error) throw new Error(error.message);
  return data as unknown as TableWithTags[];
}

export async function createTable(
  name: string,
  capacity: number,
  tagIds: string[],
): Promise<void> {
  const { data, error } = await getSupabase()
    .from("tables")
    .insert({ name: name.trim(), capacity })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (tagIds.length > 0) await setTableTags(data.id, tagIds);
}

export async function updateTable(
  tableId: string,
  fields: { name?: string; capacity?: number },
): Promise<void> {
  const { error } = await getSupabase()
    .from("tables")
    .update(fields)
    .eq("id", tableId);
  if (error) throw new Error(error.message);
}

export async function deleteTable(tableId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("tables")
    .delete()
    .eq("id", tableId);
  if (error)
    throw friendly(
      error,
      "This table has order history and can't be deleted.",
    );
}

export async function setTableTags(
  tableId: string,
  tagIds: string[],
): Promise<void> {
  const sb = getSupabase();
  const { error: delError } = await sb
    .from("table_tag_links")
    .delete()
    .eq("table_id", tableId);
  if (delError) throw new Error(delError.message);
  if (tagIds.length === 0) return;
  const { error } = await sb
    .from("table_tag_links")
    .insert(tagIds.map((tag_id) => ({ table_id: tableId, tag_id })));
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Ingredients & the 86 board
// ---------------------------------------------------------------------------

export async function fetchIngredients(): Promise<Ingredient[]> {
  const { data, error } = await getSupabase()
    .from("ingredients")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function createIngredient(name: string): Promise<void> {
  const { error } = await getSupabase()
    .from("ingredients")
    .insert({ name: name.trim() });
  if (error) throw new Error(error.message);
}

export async function deleteIngredient(ingredientId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("ingredients")
    .delete()
    .eq("id", ingredientId);
  if (error) throw new Error(error.message);
}

export async function setIngredientAvailability(
  ingredientId: string,
  isAvailable: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from("ingredients")
    .update({ is_available: isAvailable })
    .eq("id", ingredientId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Menu (categories + items + their ingredients)
// ---------------------------------------------------------------------------

export type MenuItemWithIngredients = MenuItem & { ingredients: Ingredient[] };

export async function fetchMenuItemsWithIngredients(): Promise<
  MenuItemWithIngredients[]
> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .select("*, ingredients(*)")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data as unknown as MenuItemWithIngredients[];
}

export async function createCategory(
  name: string,
  sortOrder: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("categories")
    .insert({ name: name.trim(), sort_order: sortOrder });
  if (error) throw new Error(error.message);
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("categories")
    .delete()
    .eq("id", categoryId);
  if (error)
    throw friendly(error, "Move or delete this category's items first.");
}

export async function createMenuItem(item: {
  categoryId: string;
  name: string;
  price: number;
  sortOrder: number;
  targetPrinterId: string | null;
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .insert({
      category_id: item.categoryId,
      name: item.name.trim(),
      price: item.price,
      sort_order: item.sortOrder,
      target_printer_id: item.targetPrinterId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function updateMenuItem(
  itemId: string,
  fields: {
    name?: string;
    price?: number;
    category_id?: string;
    is_available?: boolean;
    target_printer_id?: string | null;
  },
): Promise<void> {
  const { error } = await getSupabase()
    .from("menu_items")
    .update(fields)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteMenuItem(itemId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("menu_items")
    .delete()
    .eq("id", itemId);
  if (error)
    throw friendly(
      error,
      "This item appears on past orders and can't be deleted — mark it unavailable instead.",
    );
}

// ---------------------------------------------------------------------------
// Printers & receipt settings
// ---------------------------------------------------------------------------

export type PrinterInput = Database["public"]["Tables"]["printers"]["Insert"];

export async function fetchPrinters(): Promise<Printer[]> {
  const { data, error } = await getSupabase()
    .from("printers")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function createPrinter(printer: PrinterInput): Promise<void> {
  const { error } = await getSupabase().from("printers").insert(printer);
  if (error) throw new Error(error.message);
}

export async function updatePrinter(
  printerId: string,
  fields: Partial<PrinterInput>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("printers")
    .update(fields)
    .eq("id", printerId);
  if (error) throw new Error(error.message);
}

/** Items routed to the printer fall back to "receipt only" (FK set-null) */
export async function deletePrinter(printerId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("printers")
    .delete()
    .eq("id", printerId);
  if (error) throw new Error(error.message);
}

export async function fetchRestaurantSettings(): Promise<RestaurantSettings> {
  const { data, error } = await getSupabase()
    .from("restaurant_settings")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateRestaurantSettings(
  fields: Partial<Omit<RestaurantSettings, "id" | "updated_at">>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("restaurant_settings")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

export async function setMenuItemIngredients(
  itemId: string,
  ingredientIds: string[],
): Promise<void> {
  const sb = getSupabase();
  const { error: delError } = await sb
    .from("menu_item_ingredients")
    .delete()
    .eq("menu_item_id", itemId);
  if (delError) throw new Error(delError.message);
  if (ingredientIds.length === 0) return;
  const { error } = await sb
    .from("menu_item_ingredients")
    .insert(
      ingredientIds.map((ingredient_id) => ({
        menu_item_id: itemId,
        ingredient_id,
      })),
    );
  if (error) throw new Error(error.message);
}
