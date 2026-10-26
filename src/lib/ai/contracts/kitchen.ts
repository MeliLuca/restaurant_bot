// Assistente AI — contract of the KITCHEN task (owned by the kitchen task).
//   GET /api/ai/kitchen/alerts[?summary=1]   items waiting too long
// "Late" = still to prepare (order_items.ready_at null) for at least the
// station's threshold (ai_settings.kitchen_late_minutes / bar_late_minutes),
// counted from order_items.created_at and floored to whole minutes — the same
// clock and the same station rule as the /kitchen display.
import type { AiMeta } from "./common";

export type KitchenStation = "CUCINA" | "BAR";

/** Where an order is served, as parts — a client builds its own (translated)
 * label from these; `where` is the same thing in Italian, ready to show */
export interface KitchenPlace {
  orderType: "dine_in" | "takeaway";
  tableName: string | null;
  subtable: string | null;
  customerName: string | null;
  deliveryNumber: number | null;
}

export interface LateItem {
  orderId: string;
  orderItemId: string;
  ticketNumber: number;
  /** "Tavolo 12", "Tavolo 12 · Gino", "Asporto Rossi", "Asporto Rossi (#3)" */
  where: string;
  station: KitchenStation;
  /** display name, "(1/3)" suffix for split items, as on /kitchen */
  name: string;
  quantity: number;
  /** whole minutes waiting so far (≥ threshold) */
  minutes: number;
  /** the station's threshold, minutes */
  threshold: number;
  createdAt: string;
}

export interface LateOrder {
  orderId: string;
  ticketNumber: number;
  where: string;
  place: KitchenPlace;
  /** longest wait among its late items */
  minutes: number;
  /** its late items, longest wait first */
  items: LateItem[];
}

export interface KitchenAlertsResponse {
  thresholds: Record<KitchenStation, number>;
  /** every late item, longest wait first */
  late: LateItem[];
  /** the same items per order, the order with the longest wait first */
  byOrder: LateOrder[];
  /** model's short Italian summary: only with ?summary=1 and something late;
   * null otherwise, when the model is unavailable, or when its text carried
   * a number that is not in the computed list */
  summary: string | null;
  checkedAt: string;
  /** how the summary was produced; null when there is no summary */
  ai: AiMeta | null;
}
