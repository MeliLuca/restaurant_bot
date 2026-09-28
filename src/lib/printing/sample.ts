// Example tickets for test prints and the template editor's preview: a few
// dishes with variations, so every block of a template has something to show.

import type { RestaurantSettings } from "@/lib/database.types";
import type { ContoVariant } from "./template";
import type { Ticket, TicketLine, TicketMeta } from "./types";

const SAMPLE_LINES: TicketLine[] = [
  { quantity: 2, name: "Margherita", modifiers: ["+ Bufala (+€2,00)", "- Basilico"], unitPrice: 9, lineTotal: 18 },
  { quantity: 1, name: "Tagliatelle al ragù della casa", modifiers: ["ben cotta"], unitPrice: 12.5, lineTotal: 12.5 },
  { quantity: 3, name: "Acqua naturale 0,75", modifiers: [], unitPrice: 2.5, lineTotal: 7.5 },
];

export type SampleService = "table" | "takeaway";

export function sampleTicket(opts: {
  kind: "CASSA" | "CUCINA" | "BAR";
  company: RestaurantSettings;
  variant?: ContoVariant;
  service?: SampleService;
}): Ticket {
  const takeaway = opts.service === "takeaway";
  const now = new Date();
  const pickup = new Date(now.getTime() + 30 * 60_000);
  const meta: TicketMeta = {
    ticketNumber: 42,
    tableName: takeaway ? null : "5",
    subtable: null,
    customerName: takeaway ? "Rossi" : null,
    serverName: "Ava",
    openedAt: now.toISOString(),
    covers: takeaway ? null : 4,
    pickupAt: takeaway ? pickup.toISOString() : null,
  };

  if (opts.kind !== "CASSA") {
    // production slips never carry money — not even inside a variation label
    const lines = SAMPLE_LINES.map((l) => ({
      quantity: l.quantity,
      name: l.name,
      modifiers: l.modifiers.map((m) => m.replace(/ \(\+€[\d,]+\)$/, "")),
    }));
    return { kind: opts.kind, meta, company: opts.company, lines };
  }
  const subtotal = SAMPLE_LINES.reduce((sum, l) => sum + l.lineTotal, 0);
  const taxRate = 0.1;
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  return {
    kind: "CASSA",
    meta,
    company: opts.company,
    variant: opts.variant ?? "CONTO",
    lines: SAMPLE_LINES,
    subtotal,
    taxRate,
    tax,
    total: Math.round((subtotal + tax) * 100) / 100,
  };
}
