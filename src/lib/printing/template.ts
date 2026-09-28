// Print templates: the configurable layout of a comanda or a conto. A template
// is an ordered list of blocks; layout.ts turns (template, ticket) into a
// PrintDoc that both the ESC/POS encoder and the on-screen preview consume, so
// what the editor shows is what the paper gets.
//
// Stored in print_templates.blocks (jsonb). Everything read back goes through
// normalizeBlocks(), so a missing field or an unknown block type degrades to
// a default instead of breaking the kitchen's printer mid-service.

import type {
  PaperSize,
  Printer,
  PrintTemplateKind,
  PrintTemplateRow,
} from "@/lib/database.types";

export type Align = "left" | "center" | "right";
export type PrintFont = "A" | "B";
/** Character magnification, GS ! — the printers support up to 8, 4 is plenty */
export type Magnify = 1 | 2 | 3 | 4;

export interface BlockStyle {
  align: Align;
  font: PrintFont;
  width: Magnify;
  height: Magnify;
  bold: boolean;
  underline: boolean;
  /** White on black (GS B) */
  invert: boolean;
  /** Blank lines before / after the block */
  spaceBefore: number;
  spaceAfter: number;
}

/** Which receipt the CONTO template is printing right now */
export type ContoVariant = "CONTO" | "PRECONTO" | "PARZIALE";

export interface BlockVisibility {
  /** CONTO only: the variants this block prints on. Empty/absent = all. */
  variants?: ContoVariant[];
  /** Dine-in tables, take-away, or both (absent) */
  service?: "table" | "takeaway";
}

interface BlockBase {
  id: string;
  /** Temporarily switched off in the editor (👁) — skipped when printing */
  hidden?: boolean;
  style: BlockStyle;
  visibility: BlockVisibility;
}

/** Static text — the only block the "Testi di stampa" page may edit */
export interface TextBlock extends BlockBase {
  type: "text";
  /** Name shown to whoever edits the text, e.g. "Saluto finale" */
  label: string;
  text: string;
}

/**
 * A line of text with placeholders ("Op: {operatore}"), optionally with a
 * right-hand part pushed to the far edge ("DOC. N. {numero}" … "{data}").
 * `[ … ]` marks an optional part, dropped when every placeholder inside it is
 * empty; a side whose placeholders are all empty prints as nothing, and a row
 * with nothing on either side is skipped.
 */
export interface RowBlock extends BlockBase {
  type: "row";
  left: string;
  right: string;
}

export interface SeparatorBlock extends BlockBase {
  type: "separator";
  char: string;
}

export interface SpaceBlock extends BlockBase {
  type: "space";
  lines: number;
}

/** The repeating body: one entry per order line. Its style sizes the lines. */
export interface ItemsBlock extends BlockBase {
  type: "items";
  uppercase: boolean;
  /** CONTO only: unit price + line total columns */
  showPrices: boolean;
  /** CONTO only: "QT DESCRIZIONE … PREZZO TOTALE" header, printed bold */
  columnHeader: boolean;
  modifierBold: boolean;
  /** Wrap each variation as "* NO BASILICO *" */
  modifierAsterisks: boolean;
  modifierUppercase: boolean;
  /** Columns the variations are indented by */
  modifierIndent: number;
  /** Blank lines between items (normal size) */
  gapLines: number;
}

/** CONTO only: subtotal, IVA line and the big grand total */
export interface TotalsBlock extends BlockBase {
  type: "totals";
  showSubtotal: boolean;
  showTax: boolean;
  showTotal: boolean;
  totalWidth: Magnify;
  totalHeight: Magnify;
  totalBold: boolean;
}

export type TemplateBlock =
  | TextBlock
  | RowBlock
  | SeparatorBlock
  | SpaceBlock
  | ItemsBlock
  | TotalsBlock;

export type BlockType = TemplateBlock["type"];

export interface PrintTemplate {
  /** null for the built-in standard layouts (not stored) */
  id: string | null;
  name: string;
  kind: PrintTemplateKind;
  paperSize: PaperSize;
  blocks: TemplateBlock[];
  feedLines: number;
  cut: boolean;
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

export interface PlaceholderDef {
  key: string;
  /** Carries money: never allowed on a COMANDA */
  money?: boolean;
  /** Only meaningful on a COMANDA / a CONTO */
  only?: PrintTemplateKind;
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { key: "azienda" },
  { key: "indirizzo" },
  { key: "piva" },
  { key: "telefono" },
  { key: "numero" },
  { key: "data" },
  { key: "ora" },
  { key: "tavolo" },
  { key: "cliente" },
  { key: "ritiro" },
  { key: "coperti" },
  { key: "operatore" },
  { key: "destinazione", only: "COMANDA" },
  { key: "variante", only: "CONTO" },
  { key: "saluto" },
  { key: "piede_legale" },
  { key: "subtotale", money: true, only: "CONTO" },
  { key: "iva", money: true, only: "CONTO" },
  { key: "aliquota", only: "CONTO" },
  { key: "totale", money: true, only: "CONTO" },
];

export function placeholdersFor(kind: PrintTemplateKind): PlaceholderDef[] {
  return PLACEHOLDERS.filter((p) => !p.only || p.only === kind);
}

/** Lines the {variante} placeholder expands to, one printed line each */
export const VARIANT_BANNER: Record<ContoVariant, string[]> = {
  CONTO: [],
  PRECONTO: ["PRE-CONTO", "NON FISCALE"],
  PARZIALE: ["PAGAMENTO PARZIALE"],
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STYLE: BlockStyle = {
  align: "left",
  font: "A",
  width: 1,
  height: 1,
  bold: false,
  underline: false,
  invert: false,
  spaceBefore: 0,
  spaceAfter: 0,
};

let idCounter = 0;
export function newBlockId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function style(overrides: Partial<BlockStyle> = {}): BlockStyle {
  return { ...DEFAULT_STYLE, ...overrides };
}

const BIG = { width: 2, height: 2, bold: true } as const;

/** A fresh block of the given type, as the editor's "+ Aggiungi" inserts it */
export function createBlock(type: BlockType, kind: PrintTemplateKind): TemplateBlock {
  const base = { id: newBlockId(), style: style(), visibility: {} };
  switch (type) {
    case "text":
      return { ...base, type, label: "", text: "" };
    case "row":
      return { ...base, type, left: "", right: "" };
    case "separator":
      return { ...base, type, char: "-" };
    case "space":
      return { ...base, type, lines: 1 };
    case "items":
      return kind === "COMANDA"
        ? {
            ...base,
            type,
            style: style({ width: 2, height: 2 }),
            uppercase: true,
            showPrices: false,
            columnHeader: false,
            modifierBold: true,
            modifierAsterisks: true,
            modifierUppercase: true,
            modifierIndent: 3,
            gapLines: 1,
          }
        : {
            ...base,
            type,
            uppercase: false,
            showPrices: true,
            columnHeader: true,
            modifierBold: false,
            modifierAsterisks: false,
            modifierUppercase: false,
            modifierIndent: 5,
            gapLines: 0,
          };
    case "totals":
      return {
        ...base,
        type,
        showSubtotal: true,
        showTax: true,
        showTotal: true,
        totalWidth: 2,
        totalHeight: 2,
        totalBold: true,
      };
  }
}

/** A block literal without id (visibility optional), per block type */
type BlockInit = TemplateBlock extends infer T
  ? T extends TemplateBlock
    ? Omit<T, "id" | "visibility"> & { visibility?: BlockVisibility }
    : never
  : never;

type LegacyOptions = Pick<
  Printer,
  | "paper_size"
  | "print_prices"
  | "print_grand_total"
  | "print_legal_footer"
  | "header_text"
  | "footer_text"
  | "extra_feed_lines"
>;

/**
 * The layout printers used before templates existed, reproduced block by
 * block from a printer's legacy options. Used for printers with no template
 * assigned, and as the starting point for a new template.
 */
export function standardTemplate(
  kind: PrintTemplateKind,
  printer?: LegacyOptions,
): PrintTemplate {
  const opts: LegacyOptions = printer ?? {
    paper_size: "80mm",
    print_prices: true,
    print_grand_total: true,
    print_legal_footer: false,
    header_text: "",
    footer_text: "",
    extra_feed_lines: 0,
  };
  const b = (block: BlockInit): TemplateBlock =>
    ({ id: newBlockId(), visibility: {}, ...block }) as TemplateBlock;
  const center = style({ align: "center" });

  const blocks: TemplateBlock[] = [];
  if (kind === "COMANDA") {
    blocks.push(
      b({ type: "text", label: "Intestazione", text: opts.header_text, style: center }),
      b({ type: "row", left: "{destinazione}", right: "", style: style({ align: "center", ...BIG }) }),
      b({ type: "row", left: "{tavolo}", right: "", style: style({ align: "center", ...BIG }) }),
      b({ type: "row", left: "#{numero} · {data}, {ora}[ · {operatore}]", right: "", style: center }),
      b({ type: "separator", char: "=", style: style() }),
      createBlock("items", "COMANDA"),
      b({ type: "separator", char: "=", style: style() }),
      b({ type: "text", label: "Piè di pagina", text: opts.footer_text, style: center }),
    );
  } else {
    const items = createBlock("items", "CONTO") as ItemsBlock;
    items.showPrices = opts.print_prices;
    items.columnHeader = opts.print_prices;
    blocks.push(
      b({ type: "row", left: "{azienda}", right: "", style: style({ align: "center", ...BIG }) }),
      b({ type: "row", left: "{indirizzo}", right: "", style: center }),
      b({ type: "row", left: "P.IVA {piva}", right: "", style: center }),
      b({ type: "row", left: "Tel. {telefono}", right: "", style: center }),
      b({ type: "text", label: "Intestazione", text: opts.header_text, style: center }),
      b({
        type: "separator",
        char: "-",
        style: style(),
        visibility: { variants: ["PRECONTO", "PARZIALE"] },
      }),
      b({ type: "row", left: "{variante}", right: "", style: style({ align: "center", ...BIG }) }),
      b({ type: "separator", char: "-", style: style() }),
      b({ type: "row", left: "DOC. N. {numero}", right: "{data}, {ora}", style: style() }),
      b({ type: "row", left: "{tavolo}", right: "[Op: {operatore}]", style: style() }),
      b({ type: "separator", char: "-", style: style() }),
      items,
    );
    if (opts.print_prices || opts.print_grand_total) {
      blocks.push(b({ type: "separator", char: "-", style: style() }));
    }
    const totals = createBlock("totals", "CONTO") as TotalsBlock;
    totals.showSubtotal = opts.print_prices;
    totals.showTax = opts.print_prices;
    totals.showTotal = opts.print_grand_total;
    blocks.push(
      totals,
      b({ type: "space", lines: 1, style: style() }),
      b({ type: "row", left: "{saluto}", right: "", style: center }),
    );
    if (opts.print_legal_footer) {
      blocks.push(b({ type: "row", left: "{piede_legale}", right: "", style: center }));
    }
    blocks.push(b({ type: "text", label: "Piè di pagina", text: opts.footer_text, style: center }));
  }

  return {
    id: null,
    name: kind === "COMANDA" ? "Comanda standard" : "Conto standard",
    kind,
    paperSize: opts.paper_size,
    blocks,
    feedLines: opts.extra_feed_lines,
    cut: true,
  };
}

// ---------------------------------------------------------------------------
// Normalization (DB / request body → trusted PrintTemplate)
// ---------------------------------------------------------------------------

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const magnify = (v: unknown, fallback: Magnify) => clampInt(v, 1, 4, fallback) as Magnify;

function normalizeStyle(raw: unknown, fallback: BlockStyle): BlockStyle {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    align: s.align === "center" || s.align === "right" || s.align === "left" ? s.align : fallback.align,
    font: s.font === "B" ? "B" : s.font === "A" ? "A" : fallback.font,
    width: magnify(s.width, fallback.width),
    height: magnify(s.height, fallback.height),
    bold: bool(s.bold, fallback.bold),
    underline: bool(s.underline, fallback.underline),
    invert: bool(s.invert, fallback.invert),
    spaceBefore: clampInt(s.spaceBefore, 0, 10, fallback.spaceBefore),
    spaceAfter: clampInt(s.spaceAfter, 0, 10, fallback.spaceAfter),
  };
}

const VARIANTS: ContoVariant[] = ["CONTO", "PRECONTO", "PARZIALE"];

function normalizeVisibility(raw: unknown): BlockVisibility {
  const v = (raw ?? {}) as Record<string, unknown>;
  const out: BlockVisibility = {};
  if (Array.isArray(v.variants)) {
    const variants = VARIANTS.filter((x) => (v.variants as unknown[]).includes(x));
    if (variants.length > 0 && variants.length < VARIANTS.length) out.variants = variants;
  }
  if (v.service === "table" || v.service === "takeaway") out.service = v.service;
  return out;
}

export function normalizeBlock(raw: unknown, kind: PrintTemplateKind): TemplateBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as BlockType;
  if (!["text", "row", "separator", "space", "items", "totals"].includes(type)) return null;
  if (type === "totals" && kind !== "CONTO") return null;

  const fresh = createBlock(type, kind);
  const common = {
    id: str(r.id) || fresh.id,
    hidden: r.hidden === true ? true : undefined,
    style: normalizeStyle(r.style, fresh.style),
    visibility: normalizeVisibility(r.visibility),
  };
  switch (fresh.type) {
    case "text":
      return { ...fresh, ...common, label: str(r.label), text: str(r.text) };
    case "row":
      return { ...fresh, ...common, left: str(r.left), right: str(r.right) };
    case "separator":
      return { ...fresh, ...common, char: str(r.char, "-").slice(0, 1) || " " };
    case "space":
      return { ...fresh, ...common, lines: clampInt(r.lines, 0, 10, 1) };
    case "items":
      return {
        ...fresh,
        ...common,
        uppercase: bool(r.uppercase, fresh.uppercase),
        // production slips never print money, whatever the stored flag says
        showPrices: kind === "CONTO" && bool(r.showPrices, fresh.showPrices),
        columnHeader: kind === "CONTO" && bool(r.columnHeader, fresh.columnHeader),
        modifierBold: bool(r.modifierBold, fresh.modifierBold),
        modifierAsterisks: bool(r.modifierAsterisks, fresh.modifierAsterisks),
        modifierUppercase: bool(r.modifierUppercase, fresh.modifierUppercase),
        modifierIndent: clampInt(r.modifierIndent, 0, 12, fresh.modifierIndent),
        gapLines: clampInt(r.gapLines, 0, 5, fresh.gapLines),
      };
    case "totals":
      return {
        ...fresh,
        ...common,
        showSubtotal: bool(r.showSubtotal, fresh.showSubtotal),
        showTax: bool(r.showTax, fresh.showTax),
        showTotal: bool(r.showTotal, fresh.showTotal),
        totalWidth: magnify(r.totalWidth, fresh.totalWidth),
        totalHeight: magnify(r.totalHeight, fresh.totalHeight),
        totalBold: bool(r.totalBold, fresh.totalBold),
      };
  }
}

export function normalizeBlocks(raw: unknown, kind: PrintTemplateKind): TemplateBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: TemplateBlock[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const block = normalizeBlock(item, kind);
    if (!block) continue;
    // items/totals are singletons: a second copy would print the order twice
    if ((block.type === "items" || block.type === "totals") && seen.has(block.type)) continue;
    seen.add(block.type);
    blocks.push(block);
  }
  return blocks;
}

export function templateFromRow(row: PrintTemplateRow): PrintTemplate {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    paperSize: row.paper_size,
    blocks: normalizeBlocks(row.blocks, row.kind),
    feedLines: clampInt(row.feed_lines, 0, 10, 0),
    cut: row.cut,
  };
}

/** The template a printer uses for the given document, or its standard one */
export function resolveTemplate(
  printer: Printer,
  kind: PrintTemplateKind,
  templates: PrintTemplateRow[],
): PrintTemplate {
  const id = kind === "COMANDA" ? printer.comanda_template_id : printer.conto_template_id;
  const row = id ? templates.find((t) => t.id === id && t.kind === kind) : undefined;
  return row ? templateFromRow(row) : standardTemplate(kind, printer);
}
