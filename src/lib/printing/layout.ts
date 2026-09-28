// Template + ticket → PrintDoc: the printed lines, already wrapped and padded,
// each with its character style. Pure and isomorphic — the server encodes the
// doc to ESC/POS (render.ts) and the settings editor draws the very same doc
// as a preview, so the two can't drift apart.

import type { PaperSize, RestaurantSettings } from "@/lib/database.types";
import { formatEuro, padRow, wrap } from "./escpos";
import type { Ticket, TicketLine, TicketMeta } from "./types";
import { PAPER_WIDTH_CHARS, PAPER_WIDTH_CHARS_FONT_B } from "./types";
import type {
  Align,
  BlockStyle,
  ContoVariant,
  ItemsBlock,
  PrintFont,
  PrintTemplate,
  RowBlock,
  TemplateBlock,
  TotalsBlock,
} from "./template";
import { VARIANT_BANNER } from "./template";

export interface LineStyle {
  align: Align;
  font: PrintFont;
  width: number;
  height: number;
  bold: boolean;
  underline: boolean;
  invert: boolean;
}

export interface DocLine {
  text: string;
  style: LineStyle;
  /** Block that produced the line (preview: click a line → select its block) */
  blockId: string | null;
  /** Columns available at this line's font/size */
  cols: number;
  /** Text didn't fit and was cut or overflows (preview warning) */
  overflow: boolean;
}

export interface PrintDoc {
  lines: DocLine[];
  feedLines: number;
  cut: boolean;
}

const NORMAL: LineStyle = {
  align: "left",
  font: "A",
  width: 1,
  height: 1,
  bold: false,
  underline: false,
  invert: false,
};

export function columnsFor(paper: PaperSize, font: PrintFont, width: number): number {
  const base = font === "B" ? PAPER_WIDTH_CHARS_FONT_B[paper] : PAPER_WIDTH_CHARS[paper];
  return Math.max(1, Math.floor(base / Math.max(1, width)));
}

function lineStyle(s: BlockStyle): LineStyle {
  const { align, font, width, height, bold, underline, invert } = s;
  return { align, font, width, height, bold, underline, invert };
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function targetLabel(meta: TicketMeta): string {
  if (meta.tableName !== null) {
    return `TAVOLO ${meta.tableName}${meta.subtable ? `/${meta.subtable}` : ""}`;
  }
  return `ASPORTO ${meta.customerName ?? ""}`.trim();
}

export function placeholderValues(
  ticket: Ticket,
  company: RestaurantSettings,
): Record<string, string> {
  const { meta } = ticket;
  const values: Record<string, string> = {
    azienda: company.business_name,
    indirizzo: company.address,
    piva: company.vat_number,
    telefono: company.phone,
    numero: String(meta.ticketNumber),
    data: formatDate(meta.openedAt),
    ora: formatTime(meta.openedAt),
    tavolo: targetLabel(meta),
    cliente: meta.customerName ?? "",
    ritiro: meta.pickupAt ? formatTime(meta.pickupAt) : "",
    coperti: meta.covers ? String(meta.covers) : "",
    operatore: meta.serverName ?? "",
    saluto: company.receipt_greeting,
    piede_legale: company.legal_footer,
  };
  if (ticket.kind === "CASSA") {
    values.variante = VARIANT_BANNER[ticket.variant].join("\n");
    values.subtotale = formatEuro(ticket.subtotal);
    values.iva = formatEuro(ticket.tax);
    values.aliquota = `${(ticket.taxRate * 100).toFixed(0)}%`;
    values.totale = formatEuro(ticket.total);
  } else {
    values.destinazione = ticket.kind;
  }
  return values;
}

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/**
 * Substitute placeholders. `[ … ]` groups whose placeholders are all empty are
 * dropped; a text whose placeholders are all empty resolves to "" (so
 * "P.IVA {piva}" vanishes when no P.IVA is set). Unknown placeholders — e.g.
 * a money one on a comanda — resolve to empty.
 */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  const fill = (s: string) => {
    let total = 0;
    let filled = 0;
    const text = s.replace(PLACEHOLDER_RE, (_, key: string) => {
      total += 1;
      const v = values[key] ?? "";
      if (v) filled += 1;
      return v;
    });
    return { text, total, filled };
  };
  const withGroups = template.replace(/\[([^\[\]]*)\]/g, (_, inner: string) => {
    const r = fill(inner);
    return r.total > 0 && r.filled === 0 ? "" : inner;
  });
  const r = fill(withGroups);
  return r.total > 0 && r.filled === 0 ? "" : r.text;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const QTY_W = 3;
const UNIT_W = 7;
const TOTAL_W = 8;

class DocBuilder {
  lines: DocLine[] = [];
  constructor(private paper: PaperSize) {}

  cols(style: LineStyle): number {
    return columnsFor(this.paper, style.font, style.width);
  }

  push(text: string, style: LineStyle, blockId: string | null) {
    const cols = this.cols(style);
    this.lines.push({ text, style, blockId, cols, overflow: text.length > cols });
  }

  blank(count: number, blockId: string | null) {
    for (let i = 0; i < count; i++) this.push("", NORMAL, blockId);
  }

  /** Free text: kept verbatim when it fits, word-wrapped when it doesn't */
  paragraph(text: string, style: LineStyle, blockId: string | null) {
    const cols = this.cols(style);
    for (const raw of text.split("\n")) {
      const line = raw.trimEnd();
      if (line.length <= cols) this.push(line, style, blockId);
      else for (const w of wrap(line, cols)) this.push(w, style, blockId);
    }
  }
}

function isVisible(block: TemplateBlock, ticket: Ticket, variant: ContoVariant | null): boolean {
  if (block.hidden) return false;
  const { variants, service } = block.visibility;
  if (variants && variant && !variants.includes(variant)) return false;
  if (service) {
    const isTable = ticket.meta.tableName !== null;
    if ((service === "table") !== isTable) return false;
  }
  return true;
}

function layoutRow(b: DocBuilder, block: RowBlock, values: Record<string, string>): boolean {
  const left = fillPlaceholders(block.left, values);
  const right = fillPlaceholders(block.right, values);
  if (!left.trim() && !right.trim()) return false;
  const style = lineStyle(block.style);
  if (!right) {
    b.paragraph(left, style, block.id);
    return true;
  }
  // right part sits on the last line of the left part, pushed to the edge
  const cols = b.cols(style);
  const leftLines = left.split("\n");
  const last = leftLines.pop() ?? "";
  for (const l of leftLines) b.paragraph(l, style, block.id);
  b.push(padRow(last, right, cols), { ...style, align: "left" }, block.id);
  return true;
}

function layoutItems(
  b: DocBuilder,
  block: ItemsBlock,
  lines: Array<Pick<TicketLine, "quantity" | "name" | "modifiers"> & Partial<TicketLine>>,
  money: boolean,
) {
  const style = { ...lineStyle(block.style), align: "left" as const };
  const cols = b.cols(style);
  const prices = money && block.showPrices;
  const nameW = Math.max(4, prices ? cols - QTY_W - 1 - UNIT_W - 1 - TOTAL_W : cols - QTY_W);

  if (prices && block.columnHeader) {
    b.push(
      padRow(
        `QT ${"DESCRIZIONE".padEnd(nameW)}`,
        `${"PREZZO".padStart(UNIT_W)} ${"TOTALE".padStart(TOTAL_W)}`,
        cols,
      ),
      { ...style, bold: true },
      block.id,
    );
  }

  const modStyle = { ...style, bold: block.modifierBold };
  for (const line of lines) {
    const qty = String(line.quantity).padStart(2).slice(0, 2);
    const name = block.uppercase ? line.name.toUpperCase() : line.name;
    const nameLines = wrap(name, nameW);
    if (prices) {
      b.push(
        `${qty} ${nameLines[0].padEnd(nameW)} ` +
          `${formatEuro(line.unitPrice ?? 0).padStart(UNIT_W)} ${formatEuro(line.lineTotal ?? 0).padStart(TOTAL_W)}`,
        style,
        block.id,
      );
    } else {
      b.push(`${qty} ${nameLines[0]}`, style, block.id);
    }
    for (const cont of nameLines.slice(1)) b.push(`   ${cont}`, style, block.id);

    const indent = " ".repeat(Math.min(block.modifierIndent, cols - 1));
    for (const raw of line.modifiers) {
      let mod = block.modifierUppercase ? raw.toUpperCase() : raw;
      if (block.modifierAsterisks) mod = `* ${mod} *`;
      for (const modLine of wrap(mod, cols - indent.length)) {
        b.push(`${indent}${modLine}`, modStyle, block.id);
      }
    }
    b.blank(block.gapLines, block.id);
  }
}

function layoutTotals(
  b: DocBuilder,
  block: TotalsBlock,
  ticket: Extract<Ticket, { kind: "CASSA" }>,
): boolean {
  const style = { ...lineStyle(block.style), align: "left" as const };
  const cols = b.cols(style);
  let printed = false;
  if (block.showSubtotal) {
    b.push(padRow("SUBTOTALE", formatEuro(ticket.subtotal), cols), { ...style, bold: true }, block.id);
    printed = true;
  }
  if (block.showTax) {
    b.push(
      padRow(
        `IVA ALIQUOTA ${(ticket.taxRate * 100).toFixed(0)}% - IMPOSTA`,
        formatEuro(ticket.tax),
        cols,
      ),
      style,
      block.id,
    );
    printed = true;
  }
  if (block.showTotal) {
    const totalStyle = {
      ...style,
      width: block.totalWidth,
      height: block.totalHeight,
      bold: block.totalBold,
    };
    b.push(padRow("TOTALE", formatEuro(ticket.total), b.cols(totalStyle)), totalStyle, block.id);
    printed = true;
  }
  return printed;
}

/**
 * Lay the ticket out on `paper` following the template. Blocks whose
 * visibility excludes this ticket, or that resolve to nothing, print nothing
 * (including their spacing).
 */
export function layoutTicket(
  template: PrintTemplate,
  ticket: Ticket,
  company: RestaurantSettings,
  paper: PaperSize,
): PrintDoc {
  const b = new DocBuilder(paper);
  const values = placeholderValues(ticket, company);
  const variant = ticket.kind === "CASSA" ? ticket.variant : null;
  const money = ticket.kind === "CASSA" && template.kind === "CONTO";

  for (const block of template.blocks) {
    if (!isVisible(block, ticket, variant)) continue;
    const start = b.lines.length;
    b.blank(block.style.spaceBefore, block.id);
    const bodyStart = b.lines.length;
    let printed = true;

    switch (block.type) {
      case "text":
        if (block.text.trim()) b.paragraph(block.text, lineStyle(block.style), block.id);
        else printed = false;
        break;
      case "row":
        printed = layoutRow(b, block, values);
        break;
      case "separator": {
        const style = lineStyle(block.style);
        b.push((block.char || " ").repeat(b.cols(style)), style, block.id);
        break;
      }
      case "space":
        b.blank(block.lines, block.id);
        break;
      case "items":
        layoutItems(b, block, ticket.lines, money);
        break;
      case "totals":
        printed = ticket.kind === "CASSA" && layoutTotals(b, block, ticket);
        break;
    }

    if (!printed || (b.lines.length === bodyStart && block.type !== "space")) {
      b.lines.length = start; // nothing printed: drop the spacing too
      continue;
    }
    b.blank(block.style.spaceAfter, block.id);
  }

  return { lines: b.lines, feedLines: template.feedLines, cut: template.cut };
}
