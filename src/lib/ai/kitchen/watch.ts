// Assistente AI — the kitchen watch: which items have been in preparation too
// long. Pure (no I/O), so it runs on the server for /api/ai/kitchen/alerts and
// in the browser for the /kitchen display's colours. Input = the same
// KitchenOrder list the display shows (fetchKitchenOrders), so the two can
// never disagree on what is pending or which station an item belongs to.

import type { KitchenOrder } from "@/lib/kitchen/data";
import type {
  KitchenPlace,
  KitchenStation,
  LateItem,
  LateOrder,
} from "@/lib/ai/contracts/kitchen";

export type KitchenThresholds = Record<KitchenStation, number>;

/** Whole minutes since `iso`, floored like the /kitchen badges */
export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

export function placeOf(order: KitchenOrder): KitchenPlace {
  return {
    orderType: order.orderType,
    tableName: order.tableName,
    subtable: order.subtable,
    customerName: order.customerName,
    deliveryNumber: order.deliveryNumber,
  };
}

/** Italian, i18n-free (the API answers any client, and feeds the model):
 * "Tavolo 12", "Tavolo 12 · Gino", "Asporto Rossi (#3)", "Asporto #3" */
export function placeLabel(p: KitchenPlace): string {
  if (p.orderType === "dine_in") {
    const table = `Tavolo ${p.tableName ?? "?"}`;
    return p.subtable ? `${table} · ${p.subtable}` : table;
  }
  const number = p.deliveryNumber != null ? `#${p.deliveryNumber}` : null;
  if (p.customerName) {
    return number ? `Asporto ${p.customerName} (${number})` : `Asporto ${p.customerName}`;
  }
  return number ? `Asporto ${number}` : "Asporto";
}

/** Every item still to prepare for at least its station's threshold,
 * longest wait first (ties: older ticket first) */
export function lateItems(
  orders: KitchenOrder[],
  thresholds: KitchenThresholds,
  now: number,
): LateItem[] {
  const out: LateItem[] = [];
  orders.forEach((o) => {
    const where = placeLabel(placeOf(o));
    o.items.forEach((i) => {
      if (i.readyAt) return;
      const threshold = thresholds[i.station];
      const minutes = minutesSince(i.createdAt, now);
      if (minutes < threshold) return;
      out.push({
        orderId: o.id,
        orderItemId: i.id,
        ticketNumber: o.ticketNumber,
        where,
        station: i.station,
        name: i.name,
        quantity: i.quantity,
        minutes,
        threshold,
        createdAt: i.createdAt,
      });
    });
  });
  return out.sort(
    (a, b) => b.minutes - a.minutes || a.ticketNumber - b.ticketNumber,
  );
}

/** The late items per order, keeping lateItems' order inside each group and
 * between groups (an order ranks by its longest wait) */
export function groupByOrder(
  late: LateItem[],
  orders: KitchenOrder[],
): LateOrder[] {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const groups = new Map<string, LateOrder>();
  const out: LateOrder[] = [];
  late.forEach((item) => {
    let group = groups.get(item.orderId);
    if (!group) {
      const order = orderById.get(item.orderId);
      const place: KitchenPlace = order
        ? placeOf(order)
        : {
            orderType: "dine_in",
            tableName: null,
            subtable: null,
            customerName: null,
            deliveryNumber: null,
          };
      group = {
        orderId: item.orderId,
        ticketNumber: item.ticketNumber,
        where: item.where,
        place,
        minutes: item.minutes,
        items: [],
      };
      groups.set(item.orderId, group);
      out.push(group);
    }
    group.items.push(item);
  });
  return out;
}

/** The threshold an order card on /kitchen is judged by: the smallest among
 * the stations it still has pending items for (null = nothing pending) */
export function orderThreshold(
  order: KitchenOrder,
  thresholds: KitchenThresholds,
): number | null {
  const pending = order.items.filter((i) => !i.readyAt);
  if (pending.length === 0) return null;
  return Math.min(...pending.map((i) => thresholds[i.station]));
}
