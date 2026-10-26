// Assistente AI — GET /api/ai/kitchen/alerts, the handler's logic. SERVER ONLY.

import type { AiSettings } from "@/lib/database.types";
import { fetchKitchenOrders } from "@/lib/kitchen/data";
import type { KitchenAlertsResponse } from "@/lib/ai/contracts/kitchen";
import { groupByOrder, lateItems, type KitchenThresholds } from "./watch";
import { summarizeLate } from "./summary";

export function kitchenThresholds(settings: AiSettings): KitchenThresholds {
  return { CUCINA: settings.kitchen_late_minutes, BAR: settings.bar_late_minutes };
}

/** The late list right now; with `summary`, plus the model's note on it */
export async function kitchenAlerts(
  settings: AiSettings,
  opts: { summary: boolean },
): Promise<KitchenAlertsResponse> {
  const thresholds = kitchenThresholds(settings);
  const orders = await fetchKitchenOrders();
  const now = Date.now();
  const late = lateItems(orders, thresholds, now);
  const byOrder = groupByOrder(late, orders);
  const summary = opts.summary ? await summarizeLate(byOrder) : null;
  return {
    thresholds,
    late,
    byOrder,
    summary: summary?.text ?? null,
    checkedAt: new Date(now).toISOString(),
    ai: summary?.meta ?? null,
  };
}
