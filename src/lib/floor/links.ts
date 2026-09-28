import { getSupabase } from "@/lib/supabase/client";
import type { Order, TableLink } from "@/lib/database.types";

/**
 * Linked tables — bills that belong together, so paying one warns while the
 * others are still open. See migration 20260928020000_table_links.sql.
 *
 * A member is a POS target (table, subtable). The whole-table member
 * (subtable null) covers every open bill on its table; a named member covers
 * just that split. Members leave their group on their own once their bill
 * closes (DB triggers), so the app never has to clean up.
 */

export interface LinkTarget {
  tableId: string;
  subtable: string | null;
}

/** An open bill in another member of the group — what the pay warning lists */
export interface LinkedBill {
  orderId: string;
  tableId: string;
  subtable: string | null;
  /** "T10" or "T10/Gino" */
  label: string;
  total: number;
}

const sameTarget = (l: TableLink, t: LinkTarget) =>
  l.table_id === t.tableId && (l.subtable ?? null) === (t.subtable ?? null);

/** The member a target belongs to: its exact split first, else its table. */
export function findMember(
  links: TableLink[],
  target: LinkTarget,
): TableLink | null {
  return (
    links.find((l) => sameTarget(l, target)) ??
    links.find((l) => l.table_id === target.tableId && l.subtable === null) ??
    null
  );
}

/** The other members linked to a target (empty when not linked). */
export function linkPartners(
  links: TableLink[],
  target: LinkTarget,
): TableLink[] {
  const own = findMember(links, target);
  if (!own) return [];
  return links.filter((l) => l.group_id === own.group_id && l.id !== own.id);
}

export function targetLabel(
  tableName: string,
  subtable: string | null,
): string {
  return subtable ? `${tableName}/${subtable}` : tableName;
}

/**
 * Per table, the labels of everything linked to it (any of its members),
 * for the 🔗 badges on the floor. Members on the same table are skipped.
 */
export function linkedNamesByTable(
  links: TableLink[],
  tableNames: Map<string, string>,
): Map<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const m of links) {
    for (const p of links) {
      if (p.group_id !== m.group_id || p.table_id === m.table_id) continue;
      const set = byTable.get(m.table_id) ?? new Set<string>();
      set.add(targetLabel(tableNames.get(p.table_id) ?? "?", p.subtable));
      byTable.set(m.table_id, set);
    }
  }
  return new Map(Array.from(byTable, ([id, set]) => [id, Array.from(set)]));
}

/**
 * Open bills held by the target's partners, i.e. what is still unpaid on the
 * other side of the link. `excludeOrderId` is the bill being paid.
 */
export function linkedOpenBills(
  links: TableLink[],
  openOrders: Order[],
  tableNames: Map<string, string>,
  target: LinkTarget,
  excludeOrderId: string | null,
): LinkedBill[] {
  const partners = linkPartners(links, target);
  const seen = new Set<string>();
  const bills: LinkedBill[] = [];
  for (const p of partners) {
    for (const o of openOrders) {
      if (o.id === excludeOrderId || seen.has(o.id)) continue;
      if (o.table_id !== p.table_id) continue;
      if (p.subtable !== null && o.subtable !== p.subtable) continue;
      seen.add(o.id);
      bills.push({
        orderId: o.id,
        tableId: o.table_id,
        subtable: o.subtable,
        label: targetLabel(tableNames.get(o.table_id) ?? "?", o.subtable),
        total: o.total,
      });
    }
  }
  return bills;
}

export async function fetchTableLinks(): Promise<TableLink[]> {
  const { data, error } = await getSupabase()
    .from("table_links")
    .select("*")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function linkTables(a: LinkTarget, b: LinkTarget): Promise<void> {
  const { error } = await getSupabase().rpc("link_tables", {
    a_table: a.tableId,
    a_sub: a.subtable,
    b_table: b.tableId,
    b_sub: b.subtable,
  });
  if (error) throw new Error(error.message);
}

export async function unlinkTable(target: LinkTarget): Promise<void> {
  const { error } = await getSupabase().rpc("unlink_table", {
    p_table: target.tableId,
    p_sub: target.subtable,
  });
  if (error) throw new Error(error.message);
}

/** Fresh look-up right before a checkout: links + open bills + table names. */
export async function fetchLinkedOpenBills(
  target: LinkTarget,
  excludeOrderId: string | null,
): Promise<LinkedBill[]> {
  const sb = getSupabase();
  const links = await fetchTableLinks();
  if (!findMember(links, target)) return [];
  const [orders, tables] = await Promise.all([
    sb
      .from("orders")
      .select("*")
      .eq("status", "open")
      .eq("order_type", "dine_in")
      .in(
        "table_id",
        Array.from(new Set(links.map((l) => l.table_id))),
      ),
    sb.from("tables").select("id, name"),
  ]);
  if (orders.error) throw new Error(orders.error.message);
  if (tables.error) throw new Error(tables.error.message);
  const names = new Map(tables.data.map((t) => [t.id, t.name]));
  return linkedOpenBills(links, orders.data, names, target, excludeOrderId);
}
