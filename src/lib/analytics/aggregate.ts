import type { MenuItem, ReservationRow } from "@/lib/database.types";
import type { AnalyticsOrder } from "@/lib/analytics-api";
import { rankItems, serviceDayEnd, type ItemStat } from "@/lib/stats-api";
import { addedIngredientsCharges, toCents } from "@/lib/money";
import {
  previousPeriod,
  serviceDayOf,
  type ServiceDateRange,
} from "@/lib/analytics/date-range";

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

// ---------------------------------------------------------------------------
// Table rotation & revenue per table (Assistente AI → Analisi)
// ---------------------------------------------------------------------------

export interface TableRef {
  id: string;
  name: string;
  capacity: number;
  mapName: string | null;
}

export interface TableStatRow {
  tableId: string;
  tableName: string;
  mapName: string | null;
  capacity: number;
  /** seatings: a party's splits/subtables count once */
  bills: number;
  rotationsPerService: number;
  covers: number;
  revenue: number;
  revenuePerCover: number | null;
  avgMinutes: number | null;
  revenuePerTableHour: number | null;
  revenuePerSeatHour: number | null;
  share: number;
}

export interface WeekdayTableStat {
  weekday: number; // 0 = Sunday … 6 = Saturday, of the SERVICE day
  openDays: number;
  revenue: number;
  bills: number;
  covers: number;
  /** seatings across the whole room per open service day */
  seatingsPerService: number;
}

export interface TableStatsResult {
  /** service days in range (after the weekday filter) */
  days: number;
  /** …of which the venue had at least one paid order: the rotation base */
  openDays: number;
  /** Σ open span of those days (first opened_at → last closed_at, dine-in) */
  openHours: number;
  tables: TableStatRow[];
  totals: {
    revenue: number;
    bills: number;
    covers: number;
    avgMinutes: number | null;
    revenuePerCover: number | null;
    rotationsPerService: number;
    occupiedHours: number;
  };
  byWeekday: WeekdayTableStat[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
const money = (cents: number | null) => (cents === null ? null : Math.round(cents) / 100);

function inRange(iso: string, range: ServiceDateRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

/** Service days [start, end) of the range, optionally one weekday only. */
function serviceDaysOf(range: ServiceDateRange, weekday: number | null): Date[] {
  const days: Date[] = [];
  for (let d = serviceDayOf(range.start); d < range.end; d = nextBucket(d, "day")) {
    if (weekday === null || d.getDay() === weekday) days.push(d);
  }
  return days;
}

interface Seating {
  tableId: string;
  day: string; // service-day key
  weekday: number;
  orderIds: Set<string>;
  start: number;
  end: number; // ms; = start while no order of the party has closed_at
  cents: number;
  covers: number;
}

/**
 * Per-table rotation and revenue over PAID DINE-IN orders opened in `range`
 * (optionally on one service weekday, 0 = Sunday).
 *
 * Definitions, chosen to match the rest of /analytics:
 * - Revenue = Σ orders.total (what the table paid, tax included) — the same
 *   figure as bucketRevenue's dineInTotal, so the Tavoli total equals the
 *   Sala revenue on the Revenue tab. Line revenue (unit_price × quantity, as
 *   rankItems) is what productStats uses; the two differ by the tax.
 * - A seating is one party: the paid orders of one table whose
 *   [opened_at, closed_at] overlap, or that were split off one another
 *   (parent_order_id). Splits/subtables of the same party count once.
 * - Occupied time = Σ seating durations (last closed_at − first opened_at),
 *   like turnoverStats; seatings without a closed_at add no time.
 * - rotationsPerService = seatings / service days on which the venue had any
 *   paid order (a closed night is not a slow night).
 * - Seat-hours = capacity × Σ open spans, the span of a service day being the
 *   first opened_at → last closed_at of that day's paid dine-in orders
 *   (clipped to the 6 AM day end).
 * Tables without a bill are listed too (zeros), so dead tables show up.
 */
export function tableStats(
  orders: AnalyticsOrder[],
  tables: TableRef[],
  range: ServiceDateRange,
  weekday: number | null = null,
): TableStatsResult {
  const days = serviceDaysOf(range, weekday);
  const dayKeys = new Set(days.map((d) => bucketKey(d, "day")));

  // Orders in the selected service days; open days need any paid order
  const openDayKeys = new Set<string>();
  const dineIn: { o: AnalyticsOrder; day: Date; key: string }[] = [];
  for (const o of orders) {
    if (o.status !== "paid" || !inRange(o.opened_at, range)) continue;
    const day = serviceDayOf(new Date(o.opened_at));
    const key = bucketKey(day, "day");
    if (!dayKeys.has(key)) continue;
    openDayKeys.add(key);
    if (o.order_type === "dine_in" && o.table_id) dineIn.push({ o, day, key });
  }

  // Open span per service day (dine-in), clipped to the day's end
  const spans = new Map<string, { start: number; end: number }>();
  for (const { o, day, key } of dineIn) {
    const start = new Date(o.opened_at).getTime();
    const closed = o.closed_at ? new Date(o.closed_at).getTime() : start;
    const end = Math.min(closed, serviceDayEnd(day).getTime());
    const s = spans.get(key);
    if (!s) spans.set(key, { start, end: Math.max(start, end) });
    else {
      s.start = Math.min(s.start, start);
      s.end = Math.max(s.end, end);
    }
  }
  let openMs = 0;
  spans.forEach((s) => (openMs += s.end - s.start));

  // Seatings: per table, sweep the orders by opened_at and merge overlaps
  const byTable = new Map<string, typeof dineIn>();
  for (const entry of dineIn) {
    const list = byTable.get(entry.o.table_id!) ?? [];
    list.push(entry);
    byTable.set(entry.o.table_id!, list);
  }
  const seatings: Seating[] = [];
  byTable.forEach((list, tableId) => {
    list.sort(
      (a, b) => new Date(a.o.opened_at).getTime() - new Date(b.o.opened_at).getTime(),
    );
    let cur: Seating | null = null;
    for (const { o, day, key } of list) {
      const start = new Date(o.opened_at).getTime();
      const end = o.closed_at ? Math.max(start, new Date(o.closed_at).getTime()) : start;
      const sameParty =
        cur !== null &&
        cur.day === key &&
        (start < cur.end || (!!o.parent_order_id && cur.orderIds.has(o.parent_order_id)));
      if (cur && sameParty) {
        cur.orderIds.add(o.id);
        cur.end = Math.max(cur.end, end);
        cur.cents += toCents(o.total);
        cur.covers += o.covers ?? 0;
      } else {
        cur = {
          tableId,
          day: key,
          weekday: day.getDay(),
          orderIds: new Set([o.id]),
          start,
          end,
          cents: toCents(o.total),
          covers: o.covers ?? 0,
        };
        seatings.push(cur);
      }
    }
  });

  const openDays = openDayKeys.size;
  const acc = new Map<string, { bills: number; cents: number; covers: number; ms: number; timed: number }>();
  for (const s of seatings) {
    const e = acc.get(s.tableId) ?? { bills: 0, cents: 0, covers: 0, ms: 0, timed: 0 };
    e.bills += 1;
    e.cents += s.cents;
    e.covers += s.covers;
    if (s.end > s.start) {
      e.ms += s.end - s.start;
      e.timed += 1;
    }
    acc.set(s.tableId, e);
  }

  const totalCents = seatings.reduce((sum, s) => sum + s.cents, 0);
  const known = new Map(tables.map((t) => [t.id, t]));
  // a table deleted since still has its history
  acc.forEach((_, id) => {
    if (!known.has(id)) known.set(id, { id, name: "—", capacity: 0, mapName: null });
  });

  const rows: TableStatRow[] = Array.from(known.values()).map((t) => {
    const e = acc.get(t.id) ?? { bills: 0, cents: 0, covers: 0, ms: 0, timed: 0 };
    const hours = e.ms / 3600000;
    const seatHours = (t.capacity * openMs) / 3600000;
    return {
      tableId: t.id,
      tableName: t.name,
      mapName: t.mapName,
      capacity: t.capacity,
      bills: e.bills,
      rotationsPerService: openDays > 0 ? round2(e.bills / openDays) : 0,
      covers: e.covers,
      revenue: e.cents / 100,
      revenuePerCover: money(ratio(e.cents, e.covers)),
      avgMinutes: e.timed > 0 ? Math.round(e.ms / e.timed / 60000) : null,
      revenuePerTableHour: money(ratio(e.cents, hours)),
      revenuePerSeatHour: money(ratio(e.cents, seatHours)),
      share: totalCents > 0 ? e.cents / totalCents : 0,
    };
  });
  rows.sort((a, b) => b.revenue - a.revenue || b.bills - a.bills || a.tableName.localeCompare(b.tableName));

  // By weekday: open days per weekday from the open-day keys
  const openPerWeekday = new Array<number>(7).fill(0);
  days.forEach((d) => {
    if (openDayKeys.has(bucketKey(d, "day"))) openPerWeekday[d.getDay()] += 1;
  });
  const wk = Array.from({ length: 7 }, () => ({ cents: 0, bills: 0, covers: 0 }));
  for (const s of seatings) {
    wk[s.weekday].cents += s.cents;
    wk[s.weekday].bills += 1;
    wk[s.weekday].covers += s.covers;
  }

  const timed = seatings.filter((s) => s.end > s.start);
  const occupiedMs = timed.reduce((sum, s) => sum + (s.end - s.start), 0);
  const totalCovers = seatings.reduce((sum, s) => sum + s.covers, 0);
  const usedTables = rows.filter((r) => r.bills > 0).length;
  return {
    days: days.length,
    openDays,
    openHours: round2(openMs / 3600000),
    tables: rows,
    totals: {
      revenue: totalCents / 100,
      bills: seatings.length,
      covers: totalCovers,
      avgMinutes: timed.length > 0 ? Math.round(occupiedMs / timed.length / 60000) : null,
      revenuePerCover: money(ratio(totalCents, totalCovers)),
      // per table that seated anyone, so 90 tables with 3 busy ones isn't ~0
      rotationsPerService:
        openDays > 0 && usedTables > 0 ? round2(seatings.length / openDays / usedTables) : 0,
      occupiedHours: round2(occupiedMs / 3600000),
    },
    byWeekday: wk.map((w, i) => ({
      weekday: i,
      openDays: openPerWeekday[i],
      revenue: w.cents / 100,
      bills: w.bills,
      covers: w.covers,
      seatingsPerService: openPerWeekday[i] > 0 ? round2(w.bills / openPerWeekday[i]) : 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Revenue & margin per product (Assistente AI → Analisi)
// ---------------------------------------------------------------------------

export interface ProductStatRow {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  isCoperto: boolean;
  /** a "Fuori menù" placeholder: every off-menu dish of its category */
  isCustom: boolean;
  quantity: number;
  revenue: number;
  share: number;
  prevQuantity: number;
  prevRevenue: number;
  trend: number | null;
  unitCost: number | null;
  /** cost of the add-ons with a known cost included */
  totalCost: number | null;
  margin: number | null;
  foodCostPct: number | null;
  /** engineerMenu quadrant; null for the coperto (a charge, not a dish) */
  class: Quadrant | null;
}

export interface ProductStatsResult {
  days: number;
  openDays: number;
  products: ProductStatRow[];
  totals: {
    revenue: number;
    quantity: number;
    prevRevenue: number;
    trend: number | null;
    /** over the products with a known cost only */
    costedRevenue: number;
    cost: number;
    margin: number;
    foodCostPct: number | null;
  };
  /** share of (non-coperto) revenue whose cost is known, 0..1 */
  costCoverage: number;
}

interface LineCost {
  /** null = the dish has no cost (or is a "Fuori menù" line) */
  cents: number | null;
}

/** Food cost of one line: (dish cost + Σ added ingredients' cost) × qty.
 * An add-on without a cost counts 0 — the dish cost is what makes a line
 * "costed"; add-on costs only refine it. Costs are CURRENT values (not
 * snapshotted), like a removal's swap credit in modifierStats. */
function lineCost(line: AnalyticsOrder["order_items"][number]): LineCost {
  const item = line.menu_items;
  if (!item || item.is_custom || item.cost === null || item.cost === undefined) {
    return { cents: null };
  }
  let unit = toCents(Number(item.cost));
  for (const m of line.order_item_modifiers) {
    if (!m.is_removal && m.ingredients?.cost != null) unit += toCents(Number(m.ingredients.cost));
  }
  return { cents: unit * line.quantity };
}

function paidInDays(
  orders: AnalyticsOrder[],
  range: ServiceDateRange,
  weekday: number | null,
): { kept: AnalyticsOrder[]; days: number; openDays: number } {
  const days = serviceDaysOf(range, weekday);
  const keys = new Set(days.map((d) => bucketKey(d, "day")));
  const open = new Set<string>();
  const kept = orders.filter((o) => {
    if (o.status !== "paid" || !inRange(o.opened_at, range)) return false;
    const key = bucketKey(serviceDayOf(new Date(o.opened_at)), "day");
    if (!keys.has(key)) return false;
    open.add(key);
    return true;
  });
  return { kept, days: days.length, openDays: open.size };
}

/**
 * Per-product quantity, revenue, trend and (where a cost is set) margin over
 * PAID orders — dine-in and take-away — opened in `range`, optionally one
 * service weekday (0 = Sunday) and one category. Unlike rankItems' live view
 * (paid + open), a range analysis counts what was actually cashed.
 *
 * - Revenue per line = unit_price × quantity via rankItems (unit_price is
 *   authoritative: modifiers already baked in, never re-derived).
 * - Previous range: same length, immediately before, same filters.
 * - class: engineerMenu's quadrant over the selection, coperto left out — it
 *   stays in revenue (as on the Menu tab) but is never a dish to judge, and
 *   is left out of costCoverage for the same reason.
 * - share is within the selection (the category, when filtered).
 */
export function productStats(
  orders: AnalyticsOrder[],
  prevOrders: AnalyticsOrder[],
  range: ServiceDateRange,
  opts: {
    weekday?: number | null;
    categoryId?: string | null;
    categoryNames?: Map<string, string>;
  } = {},
): ProductStatsResult {
  const weekday = opts.weekday ?? null;
  const cur = paidInDays(orders, range, weekday);
  const prev = paidInDays(prevOrders, previousPeriod(range), weekday);

  const inCategory = (categoryId: string | null) =>
    !opts.categoryId || categoryId === opts.categoryId;
  const ranked = rankItems(cur.kept).filter((i) => inCategory(i.categoryId));
  const prevRanked = new Map(rankItems(prev.kept).map((i) => [i.menuItemId, i]));

  // Cost and flags per menu item, from the lines
  const meta = new Map<string, { costCents: number | null; unitCost: number | null; coperto: boolean; custom: boolean }>();
  for (const o of cur.kept) {
    for (const line of o.order_items) {
      const item = line.menu_items;
      const m = meta.get(line.menu_item_id) ?? {
        costCents: 0 as number | null,
        unitCost:
          item && !item.is_custom && item.cost != null ? Number(item.cost) : null,
        coperto: !!item?.is_coperto,
        custom: !!item?.is_custom,
      };
      const c = lineCost(line);
      m.costCents = c.cents === null || m.costCents === null ? null : m.costCents + c.cents;
      meta.set(line.menu_item_id, m);
    }
  }

  const engineered = engineerMenu(
    ranked.filter((i) => !meta.get(i.menuItemId)?.coperto),
  );
  const quadrant = new Map(engineered.items.map((i) => [i.menuItemId, i.quadrant]));
  const totalCents = ranked.reduce((s, i) => s + toCents(i.revenue), 0);

  let costedCents = 0;
  let costCents = 0;
  let foodCents = 0;
  const products: ProductStatRow[] = ranked.map((i) => {
    const m = meta.get(i.menuItemId);
    const cents = toCents(i.revenue);
    const p = prevRanked.get(i.menuItemId);
    const cost = m?.costCents ?? null;
    if (!m?.coperto) foodCents += cents;
    if (cost !== null && !m?.coperto) {
      costedCents += cents;
      costCents += cost;
    }
    return {
      menuItemId: i.menuItemId,
      name: i.name,
      categoryId: i.categoryId,
      categoryName: i.categoryId ? (opts.categoryNames?.get(i.categoryId) ?? null) : null,
      isCoperto: !!m?.coperto,
      isCustom: !!m?.custom,
      quantity: i.quantity,
      revenue: i.revenue,
      share: totalCents > 0 ? cents / totalCents : 0,
      prevQuantity: p?.quantity ?? 0,
      prevRevenue: p?.revenue ?? 0,
      trend: percentChange(i.revenue, p?.revenue ?? 0),
      unitCost: m?.unitCost ?? null,
      totalCost: cost === null ? null : cost / 100,
      margin: cost === null ? null : (cents - cost) / 100,
      foodCostPct: cost === null || cents === 0 ? null : cost / cents,
      class: m?.coperto ? null : (quadrant.get(i.menuItemId) ?? null),
    };
  });
  products.sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity);

  const prevCents = Array.from(prevRanked.values())
    .filter((i) => inCategory(i.categoryId))
    .reduce((s, i) => s + toCents(i.revenue), 0);
  return {
    days: cur.days,
    openDays: cur.openDays,
    products,
    totals: {
      revenue: totalCents / 100,
      quantity: ranked.reduce((s, i) => s + i.quantity, 0),
      prevRevenue: prevCents / 100,
      trend: percentChange(totalCents, prevCents),
      costedRevenue: costedCents / 100,
      cost: costCents / 100,
      margin: (costedCents - costCents) / 100,
      foodCostPct: costedCents > 0 ? costCents / costedCents : null,
    },
    costCoverage: foodCents > 0 ? costedCents / foodCents : 0,
  };
}
