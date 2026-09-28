// Ticket → ESC/POS byte buffer. The layout itself (what prints, in which
// order, at which size) comes from the printer's print template via
// layoutTicket(); this file only encodes the resulting PrintDoc, emitting a
// style command only when the next line's style differs from the current one.

import type { PrintDoc, LineStyle } from "./layout";
import { layoutTicket } from "./layout";
import type { PrintPayload } from "./types";
import { EscPos } from "./escpos";

/** Printer state right after init() (ESC @) */
const RESET: LineStyle = {
  align: "left",
  font: "A",
  width: 1,
  height: 1,
  bold: false,
  underline: false,
  invert: false,
};

export function encodeDoc(doc: PrintDoc): Buffer {
  const p = new EscPos().init();
  let cur = RESET;
  for (const line of doc.lines) {
    const s = line.style;
    if (s.align !== cur.align) p.align(s.align);
    if (s.font !== cur.font) p.font(s.font);
    if (s.width !== cur.width || s.height !== cur.height) p.size(s.width, s.height);
    if (s.bold !== cur.bold) p.bold(s.bold);
    if (s.underline !== cur.underline) p.underline(s.underline);
    if (s.invert !== cur.invert) p.invert(s.invert);
    cur = s;
    p.line(line.text);
  }
  // back to normal so the tail feed isn't a run of double-height blank lines
  if (cur.width !== 1 || cur.height !== 1) p.size(1, 1);
  if (cur.invert) p.invert(false);
  p.feed(doc.feedLines);
  return (doc.cut ? p.cut() : p.tearOff()).build();
}

export function renderTicket(payload: PrintPayload): Buffer {
  const { printer, ticket, template } = payload;
  return encodeDoc(layoutTicket(template, ticket, ticket.company, printer.paper_size));
}
