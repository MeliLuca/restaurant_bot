// Order → printer routing (pure, no I/O): splits one order's lines into
// per-destination payloads. Production slips go wherever the items'
// target_printer_id points; the CASSA receipt always carries the whole order.

import type {
  Order,
  Printer,
  PrintTemplateRow,
  RestaurantSettings,
} from "@/lib/database.types";
import { formatEuro } from "./escpos";
import type {
  CassaTicket,
  PrintPayload,
  ProductionTicket,
  TicketLine,
  TicketMeta,
} from "./types";
import type { ContoVariant } from "./template";
import { resolveTemplate } from "./template";

// One structured modifier on an order line (order_item_modifiers snapshot).
export interface RoutableModifier {
  name: string;
  price_adjustment: number;
  is_removal: boolean;
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

// "+ Bufala" / "- Basilico". The sign comes from is_removal, not from the
// amount: a free addition and a removal are both worth 0, and a cook reading a
// bare "Mozzarella" cannot tell which one was meant.
function modifierLabel(m: RoutableModifier): string {
  return `${m.is_removal ? "-" : "+"} ${m.name}`;
}

// CASSA shows each addition's list price as detail; the line's unit price
// already carries the (diminishing-scaled) surcharge, so these are detail, not
// extra charges. Removals never deduct, so they print without an amount.
function cassaModifierLabel(m: RoutableModifier): string {
  if (m.is_removal || m.price_adjustment <= 0) return modifierLabel(m);
  return `${modifierLabel(m)} (+${formatEuro(m.price_adjustment)})`;
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
 * (admin chose to route there) rendered with its COMANDA template.
 */
export function buildProductionPayloads(
  items: RoutableItem[],
  printers: Printer[],
  templates: PrintTemplateRow[],
  company: RestaurantSettings,
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
      company,
      // production slips show the variation, not its price — the kitchen only
      // needs WHAT to make. modifierLabel signs paid additions/removals
      // (+ Bufala / - Acciughe); the renderer uppercases + asterisks them.
      lines: group.map((i) => ({
        quantity: i.quantity,
        name: i.name,
        modifiers: itemModifiers(i, modifierLabel),
      })),
    };
    return { printer, ticket, template: resolveTemplate(printer, "COMANDA", templates) };
  });
}

/**
 * The full customer receipt, bound to the first active CASSA printer.
 * Returns null when no CASSA printer is configured. `variant` marks the
 * non-fiscal variants (pre-conto, partial payment).
 */
export function buildCassaPayload(
  order: Order,
  items: RoutableItem[],
  printers: Printer[],
  templates: PrintTemplateRow[],
  company: RestaurantSettings,
  meta: TicketMeta,
  variant: ContoVariant = "CONTO",
): PrintPayload | null {
  const cassa = printers.find(
    (p) => p.is_active && p.printer_type === "CASSA",
  );
  if (!cassa) return null;

  const ticket: CassaTicket = {
    kind: "CASSA",
    meta,
    company,
    variant,
    lines: items.map(toTicketLine),
    subtotal: order.subtotal,
    taxRate: order.tax_rate,
    tax: order.tax,
    total: order.total,
  };
  return { printer: cassa, ticket, template: resolveTemplate(cassa, "CONTO", templates) };
}
