// Printing domain model (Phase 1). The flow across phases:
//   order submit → route items by menu_items.target_printer_id (Phase 2)
//   → render a Ticket per destination into an ESC/POS buffer (Phase 3)
//   → TCP-dispatch the buffer to printers.local_ip:port, logging to print_jobs.
// Admin UI (Phase 4) edits the printers table + restaurant_settings directly.

import type {
  PaperSize,
  Printer,
  PrinterType,
  RestaurantSettings,
} from "@/lib/database.types";
import type { ContoVariant, PrintTemplate } from "./template";

// Printable columns per paper width and font (Font A 12×24, Font B 9×17 on
// standard Epson-compatible thermal heads). All wrapping/truncation math keys
// off this single map; a magnified line gets columns / width multiplier.
export const PAPER_WIDTH_CHARS: Record<PaperSize, number> = {
  "80mm": 48,
  "58mm": 32,
};
export const PAPER_WIDTH_CHARS_FONT_B: Record<PaperSize, number> = {
  "80mm": 64,
  "58mm": 42,
};

export const DEFAULT_PRINTER_PORT = 9100;

// One order line as the layout engine consumes it. Money stays in euro
// decimals like the rest of the app (cent-safe math lives in lib/money.ts).
export interface TicketLine {
  quantity: number;
  name: string;
  modifiers: string[]; // order_item_modifiers + free-text notes; rendered "* NO BASILICO *"
  unitPrice: number;
  lineTotal: number;
}

// Shared envelope every layout prints in its header.
export interface TicketMeta {
  ticketNumber: number;
  tableName: string | null; // null for takeaway
  subtable: string | null;
  customerName: string | null; // takeaway pickup name
  serverName: string | null; // from orders.opened_by
  openedAt: string; // ISO timestamp
  covers: number | null; // coperti
  pickupAt: string | null; // take-away pickup time, ISO
}

// Full customer receipt for the CASSA printer.
export interface CassaTicket {
  kind: "CASSA";
  meta: TicketMeta;
  company: RestaurantSettings;
  // Which receipt this is: the pre-conto and partial-payment variants print
  // a banner ({variante}) and can show/hide blocks of the template.
  variant: ContoVariant;
  lines: TicketLine[];
  subtotal: number;
  taxRate: number; // aliquota IVA, e.g. 0.08
  tax: number; // imposta
  total: number;
}

// Stripped production slip for CUCINA/BAR: no money, ever.
export interface ProductionTicket {
  kind: "CUCINA" | "BAR";
  meta: TicketMeta;
  company: RestaurantSettings; // for company placeholders on the slip
  lines: Array<Pick<TicketLine, "quantity" | "name" | "modifiers">>;
  /** Printed above the template, whatever the template says — e.g. the
   * "CAMBIO TAVOLO" notice, which must never be lost to a custom layout */
  banner?: string[];
}

export type Ticket = CassaTicket | ProductionTicket;

// A rendered ticket bound to its destination, ready for the TCP dispatcher.
export interface PrintPayload {
  printer: Printer;
  ticket: Ticket;
  template: PrintTemplate;
}

export function isProductionType(
  type: PrinterType,
): type is "CUCINA" | "BAR" {
  return type !== "CASSA";
}
