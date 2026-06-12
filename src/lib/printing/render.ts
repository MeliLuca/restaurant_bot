// Ticket → ESC/POS byte buffer (Phase 3). Two layouts:
//   CASSA — full customer receipt: company header, tabular priced lines,
//           subtotal / IVA breakdown / grand total, greeting + legal footer.
//   CUCINA/BAR — stripped production slip: double-size quantity + item name,
//           modifiers bold between asterisks, never any monetary value.

import type { Printer } from "@/lib/database.types";
import type { CassaTicket, PrintPayload, ProductionTicket, TicketMeta } from "./types";
import { PAPER_WIDTH_CHARS, PRODUCTION_BODY_CHARS } from "./types";
import { EscPos, SIZE_DOUBLE, SIZE_NORMAL, formatEuro, padRow, wrap } from "./escpos";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    timeZone: undefined,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function targetLabel(meta: TicketMeta): string {
  if (meta.tableName !== null) {
    return `TAVOLO ${meta.tableName}${meta.subtable ? `/${meta.subtable}` : ""}`;
  }
  return `ASPORTO ${meta.customerName ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// CASSA — customer receipt
// ---------------------------------------------------------------------------

// Priced line columns: "QT " + name + " " + unit(7) + " " + total(8)
const QTY_W = 3;
const UNIT_W = 7;
const TOTAL_W = 8;

function renderCassa(printer: Printer, ticket: CassaTicket): Buffer {
  const width = PAPER_WIDTH_CHARS[printer.paper_size];
  const nameW = width - QTY_W - 1 - UNIT_W - 1 - TOTAL_W;
  const divider = "-".repeat(width);
  const p = new EscPos().init();

  // Company header — centered; bold double-size business name
  p.align("center");
  const { company } = ticket;
  if (company.business_name) {
    p.size(SIZE_DOUBLE).bold(true).line(company.business_name).bold(false).size(SIZE_NORMAL);
  }
  for (const detail of [
    company.address,
    company.vat_number ? `P.IVA ${company.vat_number}` : "",
    company.phone ? `Tel. ${company.phone}` : "",
    printer.header_text,
  ]) {
    if (detail) p.line(detail);
  }

  // Variant banner — pre-conto / partial payment markers, impossible to miss
  if (ticket.banner && ticket.banner.length > 0) {
    p.line(divider);
    p.size(SIZE_DOUBLE).bold(true);
    for (const bannerLine of ticket.banner) p.line(bannerLine);
    p.bold(false).size(SIZE_NORMAL);
  }

  // Document meta — ticket number, date, table, server
  p.align("left").line(divider);
  p.line(padRow(`DOC. N. ${ticket.meta.ticketNumber}`, formatTimestamp(ticket.meta.openedAt), width));
  p.line(padRow(targetLabel(ticket.meta), ticket.meta.serverName ? `Op: ${ticket.meta.serverName}` : "", width));
  p.line(divider);

  // Body — tabular lines, modifiers indented under their item
  if (printer.print_prices) {
    p.bold(true).line(
      padRow(`QT ${"DESCRIZIONE".padEnd(nameW)}`, `${"PREZZO".padStart(UNIT_W)} ${"TOTALE".padStart(TOTAL_W)}`, width),
    ).bold(false);
  }
  for (const line of ticket.lines) {
    const qty = String(line.quantity).padStart(2).slice(0, 2);
    const nameLines = wrap(line.name, nameW);
    if (printer.print_prices) {
      p.line(
        `${qty} ${nameLines[0].padEnd(nameW)} ` +
          `${formatEuro(line.unitPrice).padStart(UNIT_W)} ${formatEuro(line.lineTotal).padStart(TOTAL_W)}`,
      );
    } else {
      p.line(`${qty} ${nameLines[0]}`);
    }
    for (const cont of nameLines.slice(1)) p.line(`   ${cont}`);
    for (const mod of line.modifiers) {
      for (const modLine of wrap(mod, width - 5)) p.line(`     ${modLine}`);
    }
  }

  // Totals — bold subtotal, IVA breakdown, double-size grand total
  if (printer.print_prices || printer.print_grand_total) p.line(divider);
  if (printer.print_prices) {
    p.bold(true).line(padRow("SUBTOTALE", formatEuro(ticket.subtotal), width)).bold(false);
    p.line(
      padRow(
        `IVA ALIQUOTA ${(ticket.taxRate * 100).toFixed(0)}% - IMPOSTA`,
        formatEuro(ticket.tax),
        width,
      ),
    );
  }
  if (printer.print_grand_total) {
    // double-size characters are twice as wide: half the columns fit
    p.size(SIZE_DOUBLE).bold(true)
      .line(padRow("TOTALE", formatEuro(ticket.total), Math.floor(width / 2)))
      .bold(false).size(SIZE_NORMAL);
  }

  // Footer — greeting, legal text, custom printer footer
  p.align("center").line();
  if (company.receipt_greeting) p.line(company.receipt_greeting);
  if (printer.print_legal_footer && company.legal_footer) {
    for (const legalLine of wrap(company.legal_footer, width)) p.line(legalLine);
  }
  if (printer.footer_text) p.line(printer.footer_text);

  return p.feed(printer.extra_feed_lines).cut().build();
}

// ---------------------------------------------------------------------------
// CUCINA / BAR — production slip
// ---------------------------------------------------------------------------

function renderProduction(printer: Printer, ticket: ProductionTicket): Buffer {
  const width = PAPER_WIDTH_CHARS[printer.paper_size];
  const bodyW = PRODUCTION_BODY_CHARS[printer.paper_size]; // double-size columns
  const divider = "=".repeat(width);
  const p = new EscPos().init();

  // Header — destination + table big and centered, then ticket/time/server
  p.align("center");
  if (printer.header_text) p.line(printer.header_text);
  p.size(SIZE_DOUBLE).bold(true)
    .line(ticket.kind)
    .line(targetLabel(ticket.meta))
    .bold(false).size(SIZE_NORMAL);
  p.line(
    `#${ticket.meta.ticketNumber} · ${formatTimestamp(ticket.meta.openedAt)}` +
      (ticket.meta.serverName ? ` · ${ticket.meta.serverName}` : ""),
  );
  p.align("left").line(divider);

  // Body — large quantity + item name; modifiers bold with asterisks
  p.size(SIZE_DOUBLE);
  for (const line of ticket.lines) {
    const qty = String(line.quantity).padStart(2).slice(0, 2);
    const nameLines = wrap(line.name.toUpperCase(), bodyW - QTY_W);
    p.line(`${qty} ${nameLines[0]}`);
    for (const cont of nameLines.slice(1)) p.line(`   ${cont}`);
    for (const mod of line.modifiers) {
      p.bold(true);
      for (const modLine of wrap(`* ${mod.toUpperCase()} *`, bodyW - QTY_W)) {
        p.line(`   ${modLine}`);
      }
      p.bold(false);
    }
    p.size(SIZE_NORMAL).line().size(SIZE_DOUBLE); // breathing room between items
  }
  p.size(SIZE_NORMAL).line(divider);

  if (printer.footer_text) p.align("center").line(printer.footer_text);

  return p.feed(printer.extra_feed_lines).cut().build();
}

export function renderTicket(payload: PrintPayload): Buffer {
  const { printer, ticket } = payload;
  return ticket.kind === "CASSA"
    ? renderCassa(printer, ticket)
    : renderProduction(printer, ticket);
}
