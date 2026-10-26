// Assistente AI — contract of the ANALYTICS task (owned by the analytics task).
//   POST /api/ai/analytics/tables     rotation and revenue per table
//   POST /api/ai/analytics/products   revenue (and margin, where a cost is set) per product
// The numbers are pure aggregations (lib/analytics/aggregate.ts: tableStats,
// productStats); the model only receives the aggregates (totals + top/bottom
// 5, rounded) and writes a few observations. Errors: 400 bad_request on an
// invalid range, the usual guardAi 404/503, 500 failed.
import type { AiMeta } from "./common";

export interface AnalyticsRangeRequest {
  /** service days (6:00 → 6:00), "YYYY-MM-DD", inclusive; from ≤ to, ≤ 366 days */
  from: string;
  to: string;
  /** 0 = Sunday … 6 = Saturday (of the service day); only those service days */
  weekday?: number;
  /** products only: one category */
  categoryId?: string;
  /** ask the model for observations (default true) */
  insights?: boolean;
}

export interface AnalyticsRange {
  from: string;
  to: string;
  weekday: number | null;
  /** service days in the range (after the weekday filter) */
  days: number;
  /** …of which the venue had at least one paid order — the rotation base */
  serviceDays: number;
}

export interface TableStat {
  tableId: string;
  tableName: string;
  mapName: string | null;
  capacity: number;
  /** seatings: paid dine-in parties (splits/subtables of one party count once) */
  bills: number;
  /** seatings per service day the venue was open */
  rotationsPerService: number;
  /** Σ orders.covers */
  covers: number;
  /** Σ orders.total (tax included) — same figure as the Sala revenue in /analytics */
  revenue: number;
  revenuePerCover: number | null;
  /** average seated time (first opened_at → last closed_at of the party), minutes */
  avgMinutes: number | null;
  /** revenue per hour the table was occupied */
  revenuePerTableHour: number | null;
  /** revenue per seat per open hour of service (capacity × Σ open spans) */
  revenuePerSeatHour: number | null;
  /** share of total dine-in revenue, 0..1 */
  share: number;
}

export interface TableStatsResponse {
  range: AnalyticsRange;
  /** every table, zero-bill ones included; biggest revenue first */
  tables: TableStat[];
  totals: {
    revenue: number;
    bills: number;
    covers: number;
    avgMinutes: number | null;
    revenuePerCover: number | null;
    /** seatings per open service day per table that seated anyone */
    rotationsPerService: number;
    occupiedHours: number;
    /** Σ open spans of the service days, hours */
    openHours: number;
  };
  /** always 7 rows, 0 = Sunday */
  byWeekday: {
    weekday: number;
    openDays: number;
    revenue: number;
    bills: number;
    covers: number;
    /** seatings across the whole room per open service day */
    seatingsPerService: number;
  }[];
  /** 3–5 short observations in Italian; null when not asked / model unavailable */
  insights: string[] | null;
  ai: AiMeta | null;
}

export type MenuClass = "star" | "workhorse" | "puzzle" | "dog";

export interface ProductStat {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  /** the cover charge: in revenue, never classified or judged */
  isCoperto: boolean;
  /** a "Fuori menù" placeholder (all off-menu dishes of its category); no cost */
  isCustom: boolean;
  quantity: number;
  /** Σ unit_price × quantity (tax excluded, modifiers included) */
  revenue: number;
  /** share of revenue in the selection, 0..1 */
  share: number;
  prevQuantity: number;
  prevRevenue: number;
  /** revenue change vs the previous range of equal length (0.25 = +25%), null when no base */
  trend: number | null;
  /** food cost per portion (menu_items.cost), null when not set */
  unitCost: number | null;
  /** cost of what was sold, priced add-ons included; null when the dish has no cost */
  totalCost: number | null;
  margin: number | null;
  /** totalCost / revenue, 0..1 */
  foodCostPct: number | null;
  /** menu-engineering quadrant (median quantity × median revenue); null for the coperto */
  class: MenuClass | null;
}

export interface ProductStatsResponse {
  range: AnalyticsRange & { categoryId: string | null };
  /** products sold in the range, biggest revenue first */
  products: ProductStat[];
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
  /** share of revenue (coperto excluded) whose cost is known, 0..1 */
  costCoverage: number;
  insights: string[] | null;
  ai: AiMeta | null;
}
