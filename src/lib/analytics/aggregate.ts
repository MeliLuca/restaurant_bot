import type { MenuItem, ReservationRow } from "@/lib/database.types";
import type { AnalyticsOrder } from "@/lib/analytics-api";
import type { ItemStat } from "@/lib/stats-api";
import { addedIngredientsCharges, toCents } from "@/lib/money";
import { serviceDayOf, type ServiceDateRange } from "@/lib/analytics/date-range";

// Pure aggregation over already-fetched rows. Math in integer cents (like
// lib/money.ts); only status === "paid" orders count toward revenue, matching
// summarizeNight in stats-api.ts.

// ---------------------------------------------------------------------------
// Revenue trends
// ---------------------------------------------------------------------------

export type Granularity = "day" | "week" | "month";

export interface RevenueBucket {
  key: string; // "2026-07-01" | "2026-W27" | "2026-07"
  date: Date; // bucket start, service-day aligned
  paidTotal: number;
  dineInTotal: number;
  takeawayTotal: number;
  paidCount: number;
  avgBill: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Monday 6 AM of the service week containing `dayStart`. */
function weekStart(dayStart: Date): Date {
  const d = new Date(dayStart);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift);
  return d;
}

function bucketStart(dayStart: Date, g: Granularity): Date {
  if (g === "day") return dayStart;
  if (g === "week") return weekStart(dayStart);
  const d = new Date(dayStart);
  d.setDate(1);
  return d;
}

function isoWeekLabel(d: Date): string {
  // ISO week number of the week's Thursday
  const thu = new Date(d);
  thu.setDate(thu.getDate() + 3);
  const jan1 = new Date(thu.getFullYear(), 0, 1);
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${thu.getFullYear()}-W${pad(week)}`;
}

function bucketKey(start: Date, g: Granularity): string {
  if (g === "day")
    return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  if (g === "week") return isoWeekLabel(start);
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}`;
}

function nextBucket(start: Date, g: Granularity): Date {
  const d = new Date(start);
  if (g === "day") d.setDate(d.getDate() + 1);
  else if (g === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Paid revenue bucketed by service day/week/month. Buckets with no sales are
 * emitted as zeros so chart lines stay continuous. Weeks start Monday.
 */
export function bucketRevenue(
  orders: AnalyticsOrder[],
  range: ServiceDateRange,
  g: Granularity,
): RevenueBucket[] {
  const acc = new Map<
    string,
    { date: Date; paid: number; dineIn: number; takeaway: number; count: number }
  >();

  // Zero-fill every bucket touching the range
  for (
    let d = bucketStart(serviceDayOf(range.start), g);
    d < range.end;
    d = nextBucket(d, g)
  ) {
    acc.set(bucketKey(d, g), { date: d, paid: 0, dineIn: 0, takeaway: 0, count: 0 });
  }

  for (const o of orders) {
    if (o.status !== "paid") continue;
    const day = serviceDayOf(new Date(o.opened_at));
    const key = bucketKey(bucketStart(day, g), g);
    const b = acc.get(key);
    if (!b) continue;
    const cents = toCents(o.total);
    b.paid += cents;
    b.count += 1;
    if (o.order_type === "takeaway") b.takeaway += cents;
    else b.dineIn += cents;
  }

  return Array.from(acc, ([key, b]) => ({
    key,
    date: b.date,
    paidTotal: b.paid / 100,
    dineInTotal: b.dineIn / 100,
    takeawayTotal: b.takeaway / 100,
    paidCount: b.count,
    avgBill: b.count > 0 ? Math.round(b.paid / b.count) / 100 : 0,
  })).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** null when there is no previous value to compare against. */
export function percentChange(curr: number, prev: number): number | null {
  if (!prev) return null;
  return (curr - prev) / prev;
}

export function defaultGranularity(days: number): Granularity {
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

// ---------------------------------------------------------------------------
// Menu engineering
// ---------------------------------------------------------------------------

export type Quadrant = "star" | "workhorse" | "puzzle" | "dog";

export interface EngineeredItem extends ItemStat {
  quadrant: Quadrant;
  avgPrice: number;
}

export interface MenuEngineering {
  items: EngineeredItem[];
  medianQuantity: number;
  medianRevenue: number; // profitability proxy — schema has no cost data
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function engineerMenu(items: ItemStat[]): MenuEngineering {
  const medQ = median(items.map((i) => i.quantity).sort((a, b) => a - b));
  const medR = median(items.map((i) => i.revenue).sort((a, b) => a - b));
  return {
    medianQuantity: medQ,
    medianRevenue: medR,
    items: items.map((i) => {
      const popular = i.quantity >= medQ;
      const profitable = i.revenue >= medR;
      const quadrant: Quadrant = popular
        ? profitable
          ? "star"
          : "workhorse"
        : profitable
          ? "puzzle"
          : "dog";
      return {
        ...i,
        quadrant,
        avgPrice: i.quantity > 0 ? Math.round((i.revenue / i.quantity) * 100) / 100 : 0,
      };
    }),
  };
}

export interface ModifierStat {
  /** Signed snapshot name ("+ Bufala" / "− Basilico") — grouped by name
   * because ingredient_id nulls out once the pantry row is deleted, and signed
   * because adding and removing the same ingredient are opposite events that
   * must not collapse into one row. */
  name: string;
  attachedQuantity: number; // Σ line quantity where this modifier appears
  attachRate: number; // attachedQuantity / total item quantity in range
  chargedRevenue: number; // euros actually charged, after the taper
}

/**
 * What each modifier actually earned. unit_price bakes in the surcharge from
 * addedIngredientsSurcharge (lib/money.ts): swaps settled, diminishing
 * per-rank weights, rounded down to the 10 cents. addedIngredientsCharges
 * splits that same surcharge per modifier; attribute it ×quantity. Removals
 * earn 0 but still count for attach rate. A removal's swap credit is its
 * CURRENT listino price (only the addition side is snapshotted), so a
 * repriced ingredient shifts old attributions slightly.
 */
const statKey = (m: { name: string; is_removal: boolean }) =>
  `${m.is_removal ? "−" : "+"} ${m.name}`;

export function modifierStats(orders: AnalyticsOrder[]): ModifierStat[] {
  const acc = new Map<string, { attached: number; revenueCents: number }>();
  let totalQuantity = 0;

  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const line of o.order_items) {
      totalQuantity += line.quantity;
      if (line.order_item_modifiers.length === 0) continue;

      const charges = addedIngredientsCharges(
        line.order_item_modifiers.map((m) => ({
          priceAdjustment: m.price_adjustment,
          isRemoval: m.is_removal,
          creditPrice: m.is_removal ? m.ingredients?.price ?? 0 : undefined,
        })),
      );
      const chargedByName = new Map<string, number>();
      line.order_item_modifiers.forEach((m, i) => {
        if (charges[i] <= 0) return;
        const k = statKey(m);
        chargedByName.set(k, (chargedByName.get(k) ?? 0) + charges[i]);
      });

      for (const m of line.order_item_modifiers) {
        const k = statKey(m);
        const entry = acc.get(k) ?? { attached: 0, revenueCents: 0 };
        entry.attached += line.quantity;
        acc.set(k, entry);
      }
      chargedByName.forEach((cents, name) => {
        const entry = acc.get(name)!;
        entry.revenueCents += cents * line.quantity;
      });
    }
  }

  return Array.from(acc, ([name, e]) => ({
    name,
    attachedQuantity: e.attached,
    attachRate: totalQuantity > 0 ? e.attached / totalQuantity : 0,
    chargedRevenue: Math.round(e.revenueCents) / 100,
  })).sort((a, b) => b.chargedRevenue - a.chargedRevenue || b.attachedQuantity - a.attachedQuantity);
}

export interface DeadItem {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  quantity: number;
  isAvailable: boolean;
}

/** Menu items that sold at most `threshold` units in the range. */
export function deadItems(
  menu: MenuItem[],
  ranked: ItemStat[],
  threshold = 0,
): DeadItem[] {
  const sold = new Map(ranked.map((i) => [i.menuItemId, i.quantity]));
  return menu
    .filter((m) => (sold.get(m.id) ?? 0) <= threshold)
    .map((m) => ({
      menuItemId: m.id,
      name: m.name,
      categoryId: m.category_id,
      quantity: sold.get(m.id) ?? 0,
      isAvailable: m.is_available,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Peak hours & staffing
// ---------------------------------------------------------------------------

export interface HeatCell {
  weekday: number; // 0=Mon … 6=Sun, of the SERVICE day
  hour: number; // 0–23 clock hour
  orders: number;
  revenue: number;
}

/**
 * Dense 7×24 matrix from opened_at. The weekday comes from the service day,
 * so a 1 AM Saturday order lands on Friday's row.
 */
export function hourWeekdayMatrix(orders: AnalyticsOrder[]): HeatCell[] {
  const cells: HeatCell[] = [];
  for (let w = 0; w < 7; w++)
    for (let h = 0; h < 24; h++) cells.push({ weekday: w, hour: h, orders: 0, revenue: 0 });

  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const opened = new Date(o.opened_at);
    const weekday = (serviceDayOf(opened).getDay() + 6) % 7;
    const cell = cells[weekday * 24 + opened.getHours()];
    cell.orders += 1;
    if (o.status === "paid") cell.revenue += o.total;
  }
  for (const c of cells) c.revenue = Math.round(c.revenue * 100) / 100;
  return cells;
}

export interface TurnoverStats {
  count: number;
  avgMinutes: number;
  medianMinutes: number;
  histogram: { label: string; count: number }[];
}

const TURNOVER_BINS = [
  { label: "<30", max: 30 },
  { label: "30–60", max: 60 },
  { label: "60–90", max: 90 },
  { label: "90–120", max: 120 },
  { label: "120+", max: Infinity },
];

/** Dine-in, paid, with closed_at — table occupancy from open to payment. */
export function turnoverStats(orders: AnalyticsOrder[]): TurnoverStats {
  const minutes: number[] = [];
  for (const o of orders) {
    if (o.order_type !== "dine_in" || o.status !== "paid" || !o.closed_at) continue;
    const mins =
      (new Date(o.closed_at).getTime() - new Date(o.opened_at).getTime()) / 60000;
    if (mins > 0) minutes.push(mins);
  }
  minutes.sort((a, b) => a - b);
  const histogram = TURNOVER_BINS.map((bin, i) => ({
    label: bin.label,
    count: minutes.filter(
      (m) => m < bin.max && (i === 0 || m >= TURNOVER_BINS[i - 1].max),
    ).length,
  }));
  return {
    count: minutes.length,
    avgMinutes:
      minutes.length > 0
        ? Math.round(minutes.reduce((s, m) => s + m, 0) / minutes.length)
        : 0,
    medianMinutes: Math.round(median(minutes)),
    histogram,
  };
}

export interface StaffStat {
  userId: string | null;
  name: string;
  orders: number;
  revenue: number;
  avgBill: number;
  itemsSold: number;
}

/** Paid orders grouped by opened_by, biggest revenue first. */
export function staffPerformance(
  orders: AnalyticsOrder[],
  staffNames: Map<string, string>,
): StaffStat[] {
  const acc = new Map<
    string | null,
    { orders: number; cents: number; items: number }
  >();
  for (const o of orders) {
    if (o.status !== "paid") continue;
    const key = o.opened_by ?? null;
    const entry = acc.get(key) ?? { orders: 0, cents: 0, items: 0 };
    entry.orders += 1;
    entry.cents += toCents(o.total);
    entry.items += o.order_items.reduce((s, i) => s + i.quantity, 0);
    acc.set(key, entry);
  }
  return Array.from(acc, ([userId, e]) => ({
    userId,
    name: userId ? (staffNames.get(userId) ?? "—") : "—",
    orders: e.orders,
    revenue: e.cents / 100,
    avgBill: e.orders > 0 ? Math.round(e.cents / e.orders) / 100 : 0,
    itemsSold: e.items,
  })).sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export interface ReservationSummary {
  total: number;
  booked: number;
  seated: number;
  cancelled: number;
  noShow: number;
  noShowRate: number | null; // no_show / (seated + no_show)
  cancellationRate: number | null; // cancelled / total
  partySizes: { label: string; count: number }[]; // "1"…"5", "6+"
  coversPerNight: { date: Date; covers: number }[]; // Σ party_size of seated
}

export function reservationStats(
  reservations: ReservationRow[],
  range: ServiceDateRange,
): ReservationSummary {
  let booked = 0;
  let seated = 0;
  let cancelled = 0;
  let noShow = 0;
  const partyCounts = new Map<string, number>();
  const covers = new Map<string, { date: Date; covers: number }>();

  for (let d = serviceDayOf(range.start); d < range.end; d = nextBucket(d, "day")) {
    covers.set(bucketKey(d, "day"), { date: d, covers: 0 });
  }

  for (const r of reservations) {
    if (r.status === "booked") booked += 1;
    else if (r.status === "seated") seated += 1;
    else if (r.status === "cancelled") cancelled += 1;
    else noShow += 1;

    const label = r.party_size >= 6 ? "6+" : String(r.party_size);
    partyCounts.set(label, (partyCounts.get(label) ?? 0) + 1);

    if (r.status === "seated") {
      const key = bucketKey(serviceDayOf(new Date(r.reserved_at)), "day");
      const night = covers.get(key);
      if (night) night.covers += r.party_size;
    }
  }

  const total = reservations.length;
  const arrivalsDue = seated + noShow;
  return {
    total,
    booked,
    seated,
    cancelled,
    noShow,
    noShowRate: arrivalsDue > 0 ? noShow / arrivalsDue : null,
    cancellationRate: total > 0 ? cancelled / total : null,
    partySizes: ["1", "2", "3", "4", "5", "6+"].map((label) => ({
      label,
      count: partyCounts.get(label) ?? 0,
    })),
    coversPerNight: Array.from(covers.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    ),
  };
}
