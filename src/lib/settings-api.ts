import { getSupabase } from "@/lib/supabase/client";
import { compareTableNames, type MapTableGeometry } from "@/lib/floor/maps";
import type {
  Database,
  Ingredient,
  LineNote,
  MenuItem,
  Printer,
  PrintTemplateRow,
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
    .select("*, table_tags(*)");
  if (error) throw new Error(error.message);
  return (data as unknown as TableWithTags[]).sort((a, b) =>
    compareTableNames(a.name, b.name),
  );
}

export async function createTable(
  name: string,
  capacity: number,
  tagIds: string[],
  /** Put the new table straight onto a floor map */
  placement?: { map_id: string } & MapTableGeometry,
): Promise<string> {
  const { data, error } = await getSupabase()
    .from("tables")
    .insert({ name: name.trim(), capacity, ...placement })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (tagIds.length > 0) await setTableTags(data.id, tagIds);
  return data.id;
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

// Bulk edits (several tables selected in the map editor). Ids go in the URL
// (`in.(…)`), so long lists are sent in chunks to stay under its limit.
const ID_CHUNK = 100;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
}

export async function setTablesCapacity(
  tableIds: string[],
  capacity: number,
): Promise<void> {
  for (const ids of chunks(tableIds)) {
    const { error } = await getSupabase()
      .from("tables")
      .update({ capacity })
      .in("id", ids);
    if (error) throw new Error(error.message);
  }
}

/** Give every table the tag (tables that already have it are left alone). */
export async function addTagToTables(
  tagId: string,
  tableIds: string[],
): Promise<void> {
  const { error } = await getSupabase()
    .from("table_tag_links")
    .upsert(
      tableIds.map((table_id) => ({ table_id, tag_id: tagId })),
      { onConflict: "table_id,tag_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

export async function removeTagFromTables(
  tagId: string,
  tableIds: string[],
): Promise<void> {
  for (const ids of chunks(tableIds)) {
    const { error } = await getSupabase()
      .from("table_tag_links")
      .delete()
      .eq("tag_id", tagId)
      .in("table_id", ids);
    if (error) throw new Error(error.message);
  }
}

// ---------------------------------------------------------------------------
// Ingredients & the 86 board
// ---------------------------------------------------------------------------

// PostgREST caps a select at 1000 rows; menus and pantries can be larger, so
// page through with .range() until a short page signals the end.
const FETCH_PAGE = 1000;

export async function fetchIngredients(): Promise<Ingredient[]> {
  const sb = getSupabase();
  const rows: Ingredient[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await sb
      .from("ingredients")
      .select("*")
      .order("name")
      .order("id")
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < FETCH_PAGE) break;
  }
  return rows;
}

export async function createIngredient(
  name: string,
  price = 0,
): Promise<void> {
  const { error } = await getSupabase()
    .from("ingredients")
    .insert({ name: name.trim(), price });
  if (error) throw new Error(error.message);
}

/** Rename an ingredient or reprice it as an add-on (0 = free to add). */
export async function updateIngredient(
  ingredientId: string,
  fields: { name?: string; price?: number },
): Promise<void> {
  const { error } = await getSupabase()
    .from("ingredients")
    .update({
      ...(fields.name !== undefined ? { name: fields.name.trim() } : {}),
      ...(fields.price !== undefined ? { price: fields.price } : {}),
    })
    .eq("id", ingredientId);
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
// Note rapide (line_notes)
// ---------------------------------------------------------------------------

export async function fetchLineNotes(): Promise<LineNote[]> {
  const { data, error } = await getSupabase()
    .from("line_notes")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

/** New notes go to the end of the list, after the house's own. */
export async function createLineNote(name: string): Promise<void> {
  const sb = getSupabase();
  const { data: last, error: lastError } = await sb
    .from("line_notes")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) throw new Error(lastError.message);
  const { error } = await sb
    .from("line_notes")
    .insert({ name: name.trim(), sort_order: (last[0]?.sort_order ?? 0) + 10 });
  if (error) throw new Error(error.message);
}

export async function deleteLineNote(id: string): Promise<void> {
  const { error } = await getSupabase().from("line_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Menu (categories + items + their ingredients)
// ---------------------------------------------------------------------------

export type MenuItemWithIngredients = MenuItem & {
  ingredients: Ingredient[];
};

export async function fetchMenuItemsWithIngredients(): Promise<
  MenuItemWithIngredients[]
> {
  const sb = getSupabase();
  const rows: MenuItemWithIngredients[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    // sort_order repeats across categories, so tie-break on id to keep the
    // pagination windows stable
    const { data, error } = await sb
      .from("menu_items")
      .select("*, ingredients(*)")
      .order("sort_order")
      .order("id")
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data as unknown as typeof rows));
    if (data.length < FETCH_PAGE) break;
  }
  return rows;
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
  codice: string | null;
  allowsVariations: boolean;
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from("menu_items")
    .insert({
      category_id: item.categoryId,
      name: item.name.trim(),
      price: item.price,
      sort_order: item.sortOrder,
      target_printer_id: item.targetPrinterId,
      codice: item.codice,
      allows_variations: item.allowsVariations,
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
    codice?: string | null;
    allows_variations?: boolean;
  },
): Promise<void> {
  const { error } = await getSupabase()
    .from("menu_items")
    .update(fields)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** PostgREST puts the id filter in the query string, so a whole category at
 * once would build a URL long enough to be refused. Chunked, not looped
 * per item: 65 pizzas become one or two requests instead of 65. */
const BULK_CHUNK = 100;

/** Apply the same field(s) to many menu items — the bulk counterpart of
 * `updateMenuItem`, used by multi-select in the menu manager. */
export async function updateMenuItems(
  itemIds: string[],
  fields: {
    is_available?: boolean;
    allows_variations?: boolean;
    target_printer_id?: string | null;
    category_id?: string;
  },
): Promise<void> {
  for (let i = 0; i < itemIds.length; i += BULK_CHUNK) {
    const { error } = await getSupabase()
      .from("menu_items")
      .update(fields)
      .in("id", itemIds.slice(i, i + BULK_CHUNK));
    if (error) throw new Error(error.message);
  }
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

// ---------------------------------------------------------------------------
// Print templates (layouts in src/lib/printing/template.ts)
// ---------------------------------------------------------------------------

export type PrintTemplateInput =
  Database["public"]["Tables"]["print_templates"]["Insert"];

export async function fetchPrintTemplates(): Promise<PrintTemplateRow[]> {
  const { data, error } = await getSupabase()
    .from("print_templates")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchPrintTemplate(id: string): Promise<PrintTemplateRow | null> {
  const { data, error } = await getSupabase()
    .from("print_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Postgres unique violation on the name → a readable message */
function templateError(error: { code?: string; message: string }, name: string): Error {
  return new Error(
    error.code === "23505" ? `A template named "${name}" already exists` : error.message,
  );
}

export async function createPrintTemplate(tpl: PrintTemplateInput): Promise<string> {
  const { data, error } = await getSupabase()
    .from("print_templates")
    .insert(tpl)
    .select("id")
    .single();
  if (error) throw templateError(error, tpl.name);
  return data.id;
}

export async function updatePrintTemplate(
  id: string,
  fields: Partial<PrintTemplateInput>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("print_templates")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw templateError(error, fields.name ?? "");
}

/** Blocked by the FK while a printer still uses the template */
export async function deletePrintTemplate(id: string): Promise<void> {
  const { error } = await getSupabase().from("print_templates").delete().eq("id", id);
  if (error) {
    throw friendly(error, "A printer still uses this template: assign another one first.");
  }
}

/**
 * "Testi di stampa": replace the text of some text blocks, and nothing else.
 * Goes through a server route that re-reads the template and refuses any
 * change outside its text blocks.
 */
export async function savePrintTexts(
  templateId: string,
  texts: Record<string, string>,
): Promise<void> {
  const res = await fetch("/api/print-templates/texts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, texts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Could not save the texts");
  }
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
