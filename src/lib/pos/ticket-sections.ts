/**
 * How the Cassa lays out the sent part of a bill: unpaid lines grouped by the
 * send ("giro") that put them on the order, identical lines within a giro shown
 * as one, and paid lines set apart. Display only — the rows stay separate in
 * the DB, so every action on a merged row is translated back onto real ids
 * (see planQuantityChange).
 */
import { collapseCoperto } from "./coperto";
import { toCents } from "@/lib/money";

export interface SectionItem {
  id: string;
  menu_item_id: string;
  custom_name: string | null;
  quantity: number;
  unit_price: number;
  fraction_of: number | null;
  notes: string | null;
  paid_by_payment_id: string | null;
  created_at: string;
  menu_items: { is_coperto: boolean } | null;
  order_item_modifiers: Array<{
    name: string;
    is_removal: boolean;
    price_adjustment: number;
  }>;
}

/** One row on screen, standing for one or more identical DB rows. */
export interface MergedRow<T extends SectionItem> {
  /** Stable across refetches: the first DB row's id */
  key: string;
  /** The DB rows it stands for, oldest first (never empty) */
  rows: T[];
  /** Sum of the rows' quantities */
  quantity: number;
  /** The coperto row: its quantity goes through the guest count */
  isCoperto: boolean;
}

/** The lines one send put on the order. */
export interface SentRound<T extends SectionItem> {
  key: string;
  /** created_at of the round's first line (ISO) */
  sentAt: string;
  rows: MergedRow<T>[];
}

export interface BillSections<T extends SectionItem> {
  /** Oldest send first */
  rounds: SentRound<T>[];
  paid: T[];
  paidTotal: number;
}

/** A send writes all its lines in one go; a minute of slack covers a slow
 * insert without ever joining two sends a waiter would tell apart. */
export const ROUND_GAP_MS = 60_000;

function mergeKey(i: SectionItem): string {
  const mods = i.order_item_modifiers
    .map((m) => `${m.name}:${m.is_removal ? 1 : 0}:${toCents(m.price_adjustment)}`)
    .sort()
    .join("|");
  return [
    i.menu_item_id,
    i.custom_name ?? "",
    toCents(i.unit_price),
    i.fraction_of ?? "",
    i.notes ?? "",
    mods,
  ].join("\u0000");
}

function mergeRows<T extends SectionItem>(items: T[]): MergedRow<T>[] {
  const out: MergedRow<T>[] = [];
  const byKey = new Map<string, MergedRow<T>>();
  for (const item of items) {
    const isCoperto = item.menu_items?.is_coperto ?? false;
    // the coperto row is already folded by collapseCoperto; never merge it
    const k = isCoperto ? null : mergeKey(item);
    const existing = k === null ? undefined : byKey.get(k);
    if (existing) {
      existing.rows.push(item);
      existing.quantity += item.quantity;
      continue;
    }
    const row: MergedRow<T> = {
      key: item.id,
      rows: [item],
      quantity: item.quantity,
      isCoperto,
    };
    if (k !== null) byKey.set(k, row);
    out.push(row);
  }
  return out;
}

export function buildBillSections<T extends SectionItem>(
  items: T[],
  gapMs: number = ROUND_GAP_MS,
): BillSections<T> {
  const paid = items.filter((i) => i.paid_by_payment_id !== null);
  const unpaid = collapseCoperto(
    items.filter((i) => i.paid_by_payment_id === null),
  );
  const sorted = [...unpaid].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );

  const groups: T[][] = [];
  let prev = -Infinity;
  for (const item of sorted) {
    const at = Date.parse(item.created_at);
    if (groups.length === 0 || at - prev > gapMs) groups.push([]);
    groups[groups.length - 1].push(item);
    prev = at;
  }

  return {
    rounds: groups.map((g) => ({
      key: g[0].id,
      sentAt: g[0].created_at,
      rows: mergeRows(g),
    })),
    paid,
    paidTotal:
      paid.reduce((s, i) => s + toCents(i.unit_price) * i.quantity, 0) / 100,
  };
}

/**
 * The DB writes that bring a merged row from its current quantity to `target`:
 * growth lands on the first row, shrinking takes from the last rows first (so
 * −1 touches a single row), and 0 removes them all. Quantity 0 removes a row.
 */
export function planQuantityChange(
  rows: Array<{ id: string; quantity: number }>,
  target: number,
): Array<{ id: string; quantity: number }> {
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const next = Math.max(0, target);
  if (next === total || rows.length === 0) return [];
  if (next > total) {
    return [{ id: rows[0].id, quantity: rows[0].quantity + (next - total) }];
  }
  let remove = total - next;
  const writes: Array<{ id: string; quantity: number }> = [];
  for (let k = rows.length - 1; k >= 0 && remove > 0; k--) {
    const take = Math.min(rows[k].quantity, remove);
    writes.push({ id: rows[k].id, quantity: rows[k].quantity - take });
    remove -= take;
  }
  return writes;
}
