// Order → printer routing (pure, no I/O): splits one order's lines into
// per-destination payloads. Production slips go wherever the items'
// target_printer_id points; the CASSA receipt always carries the whole order.

import type { Order, Printer, RestaurantSettings } from "@/lib/database.types";
import { formatEuro } from "./escpos";
import type {
  CassaTicket,
  PrintPayload,
  ProductionTicket,
  TicketLine,
  TicketMeta,
} from "./types";

// One structured modifier on an order line (order_item_modifiers snapshot).
export interface RoutableModifier {
  name: string;
  price_adjustment: number;
}

// One order_items row joined with its menu item — the routing input shape.
export interface RoutableItem {
  quantity: number;
  unit_price: number;
  notes: string | null;
  modifiers: RoutableModifier[];
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

// "+ Bufala" / "- Acciughe" — paid additions/discounts get a sign; zero-cost
// modifiers ("No Basilico") already carry their meaning in the name.
function modifierLabel(m: RoutableModifier): string {
  if (m.price_adjustment > 0) return `+ ${m.name}`;
  if (m.price_adjustment < 0) return `- ${m.name}`;
  return m.name;
}

// CASSA shows each adjustment amount; the line's unit price column already
// includes them, so the amounts are detail, not extra charges.
function cassaModifierLabel(m: RoutableModifier): string {
  if (m.price_adjustment === 0) return modifierLabel(m);
  return `${modifierLabel(m)} (${m.price_adjustment > 0 ? "+" : "-"}${formatEuro(Math.abs(m.price_adjustment))})`;
}

/** Structured modifiers first, then free-text notes — one print row each */
function itemModifiers(
  item: RoutableItem,
  label: (m: RoutableModifier) => string,
): string[] {
  return [...item.modifiers.map(label), ...parseModifiers(item.notes)];
}

function toTicketLine(item: RoutableItem): TicketLine {
  return {
    quantity: item.quantity,
    name: item.name,
    modifiers: itemModifiers(item, cassaModifierLabel),
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
      // production slips show the variation, not its price — the kitchen only
      // needs WHAT to make. modifierLabel signs paid additions/removals
      // (+ Bufala / - Acciughe); the renderer uppercases + asterisks them.
      lines: group.map((i) => ({
        quantity: i.quantity,
        name: i.name,
        modifiers: itemModifiers(i, modifierLabel),
      })),
    };
    return { printer, ticket };
  });
}

/**
 * The full customer receipt, bound to the first active CASSA printer.
 * Returns null when no CASSA printer is configured. `banner` marks the
 * non-fiscal variants (pre-conto, partial payment).
 */
export function buildCassaPayload(
  order: Order,
  items: RoutableItem[],
  printers: Printer[],
  company: RestaurantSettings,
  meta: TicketMeta,
  banner?: string[],
): PrintPayload | null {
  const cassa = printers.find(
    (p) => p.is_active && p.printer_type === "CASSA",
  );
  if (!cassa) return null;

  const ticket: CassaTicket = {
    kind: "CASSA",
    meta,
    company,
    banner,
    lines: items.map(toTicketLine),
    subtotal: order.subtotal,
    taxRate: order.tax_rate,
    tax: order.tax,
    total: order.total,
  };
  return { printer: cassa, ticket };
}
