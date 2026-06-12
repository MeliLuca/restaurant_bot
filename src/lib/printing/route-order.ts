// Order → printer routing (pure, no I/O): splits one order's lines into
// per-destination payloads. Production slips go wherever the items'
// target_printer_id points; the CASSA receipt always carries the whole order.

import type { Order, Printer, RestaurantSettings } from "@/lib/database.types";
import type {
  CassaTicket,
  PrintPayload,
  ProductionTicket,
  TicketLine,
  TicketMeta,
} from "./types";

// One order_items row joined with its menu item — the routing input shape.
export interface RoutableItem {
  quantity: number;
  unit_price: number;
  notes: string | null;
  name: string;
  target_printer_id: string | null;
}

// order_items.notes holds comma-separated modifiers ("NO BASILICO, ben cotta")
export function parseModifiers(notes: string | null): string[] {
  if (!notes) return [];
  return notes
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function toTicketLine(item: RoutableItem): TicketLine {
  return {
    quantity: item.quantity,
    name: item.name,
    modifiers: parseModifiers(item.notes),
    unitPrice: item.unit_price,
    // integer-cent math, same convention as lib/money.ts
    lineTotal: (Math.round(item.unit_price * 100) * item.quantity) / 100,
  };
}

/**
 * Group items by destination and build one production slip per printer.
 * Items with no target, or whose target is inactive, print nowhere — they
 * only ever appear on the receipt. A CASSA-typed target still gets a slip
 * (admin chose to route there) rendered in the CUCINA style.
 */
export function buildProductionPayloads(
  items: RoutableItem[],
  printers: Printer[],
  meta: TicketMeta,
): PrintPayload[] {
  const active = new Map(
    printers.filter((p) => p.is_active).map((p) => [p.id, p]),
  );
  const groups = new Map<string, RoutableItem[]>();
  for (const item of items) {
    if (!item.target_printer_id || !active.has(item.target_printer_id)) {
      continue;
    }
    const group = groups.get(item.target_printer_id) ?? [];
    group.push(item);
    groups.set(item.target_printer_id, group);
  }

  return Array.from(groups, ([printerId, group]) => {
    const printer = active.get(printerId)!;
    const ticket: ProductionTicket = {
      kind: printer.printer_type === "BAR" ? "BAR" : "CUCINA",
      meta,
      lines: group.map((i) => ({
        quantity: i.quantity,
        name: i.name,
        modifiers: parseModifiers(i.notes),
      })),
    };
    return { printer, ticket };
  });
}

/**
 * The full customer receipt, bound to the first active CASSA printer.
 * Returns null when no CASSA printer is configured.
 */
export function buildCassaPayload(
  order: Order,
  items: RoutableItem[],
  printers: Printer[],
  company: RestaurantSettings,
  meta: TicketMeta,
): PrintPayload | null {
  const cassa = printers.find(
    (p) => p.is_active && p.printer_type === "CASSA",
  );
  if (!cassa) return null;

  const ticket: CassaTicket = {
    kind: "CASSA",
    meta,
    company,
    lines: items.map(toTicketLine),
    subtotal: order.subtotal,
    taxRate: order.tax_rate,
    tax: order.tax,
    total: order.total,
  };
  return { printer: cassa, ticket };
}
