// Low-level ESC/POS byte assembly (Epson-compatible command set) plus the
// fixed-width text helpers the layouts are built from. Thermal printers don't
// speak UTF-8: text is encoded to code page PC858 (selected in init()), which
// covers Italian accents and the euro sign.

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

// Non-ASCII characters we can represent in PC858. Anything else degrades to
// its base letter (accent stripped) or '?'.
const CP858: Record<string, number> = {
  "à": 0x85, "è": 0x8a, "é": 0x82, "ì": 0x8d, "ò": 0x95, "ù": 0x97,
  "À": 0xb7, "È": 0xd4, "É": 0x90, "Ì": 0xd6, "Ò": 0xe3, "Ù": 0xeb,
  "ç": 0x87, "ü": 0x81, "ö": 0x94, "ä": 0x84, "ñ": 0xa4,
  "°": 0xf8, "€": 0xd5, "£": 0x9c, "·": 0xfa,
};

function encode(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x80) {
      bytes.push(code);
      continue;
    }
    if (ch === "\n") {
      bytes.push(0x0a);
      continue;
    }
    const mapped = CP858[ch];
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const baseCode = base.codePointAt(0);
    bytes.push(baseCode !== undefined && baseCode >= 0x20 && baseCode < 0x80 ? baseCode : 0x3f);
  }
  return Buffer.from(bytes);
}

export class EscPos {
  private chunks: Buffer[] = [];

  raw(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  /**
   * Reset the printer, leave Chinese/Kanji mode (FS .) and select code page
   * PC858 (ESC t 19). Printers shipped with Chinese mode on read bytes >0x7F
   * as GB18030 pairs and ignore the code page, turning accents into hanzi.
   */
  init(): this {
    return this.raw(ESC, 0x40, FS, 0x2e, ESC, 0x74, 19);
  }

  align(a: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Character magnification 1–8 per axis via GS ! n (width high nibble) */
  size(width: number, height: number): this {
    const clamp = (v: number) => Math.min(8, Math.max(1, Math.round(v))) - 1;
    return this.raw(GS, 0x21, (clamp(width) << 4) | clamp(height));
  }

  /** Font A (12×24, the default) or the smaller Font B (9×17) via ESC M */
  font(f: "A" | "B"): this {
    return this.raw(ESC, 0x4d, f === "B" ? 1 : 0);
  }

  underline(on: boolean): this {
    return this.raw(ESC, 0x2d, on ? 1 : 0);
  }

  /** White-on-black reverse printing via GS B */
  invert(on: boolean): this {
    return this.raw(GS, 0x42, on ? 1 : 0);
  }

  text(s: string): this {
    this.chunks.push(encode(s));
    return this;
  }

  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }

  feed(lines: number): this {
    return lines > 0 ? this.raw(ESC, 0x64, lines) : this;
  }

  /** Feed the printed tail past the blade, then partial-cut (GS V 66) */
  cut(): this {
    return this.raw(ESC, 0x64, 4, GS, 0x56, 0x42, 0x00);
  }

  /** Same tail feed as cut(), without cutting (tear-off by hand) */
  tearOff(): this {
    return this.raw(ESC, 0x64, 4);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

// ---------------------------------------------------------------------------
// Fixed-width layout helpers
// ---------------------------------------------------------------------------

/** Word-wrap to the given column width; words longer than a line are sliced */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!current) current = w;
    else if (current.length + 1 + w.length <= width) current += " " + w;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Left text + right text on one line, padded apart to exactly `width` */
export function padRow(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length;
  if (gap < 1) {
    // never let columns collide — sacrifice the tail of the left side
    const trimmed = left.slice(0, Math.max(0, width - right.length - 1));
    return trimmed + " ".repeat(width - trimmed.length - right.length) + right;
  }
  return left + " ".repeat(gap) + right;
}

/** 12,34 — receipts are Italian, decimal comma + euro sign */
export function formatEuro(amount: number): string {
  return "€" + amount.toFixed(2).replace(".", ",");
}
