// SVG import / export for floor maps (browser-only: parsing measures the
// drawing in a hidden DOM node, PNG export draws on a canvas).
//
// The format is plain SVG any editor can open. A table is a group whose id
// starts with "t-" (or that has data-table="NAME"); its first shape is the
// table, its <text> (or data-table, or the id) is the name, data-seats the
// covers. Groups with class "off" or data-ignore are skipped (the traced
// TAVOLI.svg keeps crossed-out tables that way). Everything else drawable is
// background scenery. An exported map re-imports to the same map.

import type { FloorMapElement, FloorMapElementStyle } from "@/lib/database.types";
import { normDeg, transformPath, type Geom } from "@/lib/floor/geometry";
import { pathBounds, polylinePath } from "@/lib/floor/scenery";

const round = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Seat estimate from a table's drawn size (same rule the Sala import used). */
export function estimateSeats(shape: Geom["shape"], w: number, h: number): number {
  if (shape === "circle") return Math.min(w, h) / 2 < 25 ? 2 : 6;
  const long = Math.max(w, h);
  for (const [limit, seats] of [[50, 2], [75, 4], [95, 6], [120, 8]] as const) {
    if (long < limit) return seats;
  }
  return 10;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportTable {
  name: string;
  capacity: number;
  geom: Geom;
}

const EXPORT_STYLE: Record<FloorMapElementStyle, string> = {
  wall: 'fill="none" stroke="#555" stroke-width="1.5"',
  area: 'fill="#eeeeee" stroke="#555" stroke-width="1.5"',
  arrow: 'fill="none" stroke="#222" stroke-width="3"',
};

function elementSvg(el: FloorMapElement): string {
  if (el.kind === "text") {
    const rot = el.rotate ? ` transform="rotate(${el.rotate} ${el.x} ${el.y})"` : "";
    const anchor = el.anchor && el.anchor !== "start" ? ` text-anchor="${el.anchor}"` : "";
    const font =
      el.font === "hand"
        ? "'Comic Sans MS', cursive"
        : "'Times New Roman', serif";
    return `<text x="${el.x}" y="${el.y}" font-size="${el.size ?? 18}" font-family="${font}" fill="#444"${anchor}${rot}>${esc(el.text)}</text>`;
  }
  const style = EXPORT_STYLE[el.style ?? "wall"];
  switch (el.kind) {
    case "rect":
      return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${style}/>`;
    case "circle":
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" ${style}/>`;
    case "path":
      return `<path d="${esc(el.d)}" ${style}/>`;
    case "ellipse": {
      const label = el.label
        ? `<text transform="rotate(90)" font-size="11" text-anchor="middle" dominant-baseline="central" fill="#444">${esc(el.label)}</text>`
        : "";
      return `<g transform="translate(${el.cx} ${el.cy}) rotate(${el.rotate ?? 0})"><ellipse rx="${el.rx}" ry="${el.ry}" ${style}/>${label}</g>`;
    }
  }
}

function tableSvg({ name, capacity, geom: g }: ExportTable): string {
  const cx = round(g.x + g.w / 2);
  const cy = round(g.y + g.h / 2);
  const rot = g.rotation ? ` transform="rotate(${g.rotation} ${cx} ${cy})"` : "";
  const paint = 'fill="#dbe7fb" stroke="#2563eb" stroke-width="1.75"';
  const shape =
    g.shape === "circle"
      ? `<circle cx="${cx}" cy="${cy}" r="${round(Math.min(g.w, g.h) / 2)}" ${paint}/>`
      : g.shape === "path" && g.path
        ? `<path d="${esc(g.path)}" ${paint}/>`
        : `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="2" ${paint}/>`;
  const id = `t-${name.replace(/[^\w-]/g, "-")}`;
  const size = round(Math.min(20, g.h * 0.55, (g.w * 0.9) / (Math.max(1, name.length) * 0.55)));
  return (
    `<g id="${esc(id)}" data-table="${esc(name)}" data-seats="${capacity}"${rot}>` +
    shape +
    `<text x="${cx}" y="${cy}" font-size="${size}" font-family="Arial, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="#111">${esc(name)}</text>` +
    `</g>`
  );
}

/** A standalone SVG of the map (explicit colours: no app CSS needed). */
export function mapToSvg(
  map: { name: string; width: number; height: number },
  elements: FloorMapElement[],
  tables: ExportTable[],
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${map.width} ${map.height}" width="${map.width}" height="${map.height}">`,
    `<title>${esc(map.name)}</title>`,
    `<rect width="${map.width}" height="${map.height}" fill="#ffffff"/>`,
    `<g id="sfondo">${elements.map(elementSvg).join("")}</g>`,
    `<g id="tavoli">${tables.map(tableSvg).join("")}</g>`,
    `</svg>`,
  ].join("\n");
}

/** Render an SVG string to a PNG at `scale`× its own size. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportedTable {
  name: string;
  seats: number | null;
  geom: Geom;
}

export interface ImportedMap {
  width: number;
  height: number;
  tables: ImportedTable[];
  elements: FloorMapElement[];
}

type M = DOMMatrix;
const SHAPES = "rect, circle, ellipse, path, polygon, polyline, line";
const SKIP = "defs, pattern, clipPath, mask, symbol, marker, title, desc, style, metadata";

const angleOf = (m: M) => normDeg((Math.atan2(m.b, m.a) * 180) / Math.PI);
const scaleX = (m: M) => Math.hypot(m.a, m.b);
const scaleY = (m: M) => Math.hypot(m.c, m.d);
const apply = (m: M, x: number, y: number): [number, number] => [
  m.a * x + m.c * y + m.e,
  m.b * x + m.d * y + m.f,
];
const num = (el: Element, attr: string) => Number(el.getAttribute(attr) ?? 0) || 0;
/** Only translate + scale: paths can be rewritten exactly */
const axisAligned = (m: M) => Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6;

function paintStyle(el: SVGGraphicsElement): FloorMapElementStyle {
  const cs = getComputedStyle(el);
  const fill = cs.fill;
  const filled = fill && fill !== "none" && !/rgba\(.*,\s*0\)$/.test(fill) && fill !== "rgb(255, 255, 255)";
  if (filled && el.tagName !== "line" && el.tagName !== "polyline") return "area";
  const m = el.getCTM();
  const width = (parseFloat(cs.strokeWidth) || 1) * (m ? scaleX(m) : 1);
  return width >= 2.5 ? "arrow" : "wall";
}

/** Any shape as a path in root coordinates (sampled when rotated/skewed). */
function toRootPath(el: SVGGeometryElement, m: M): string | null {
  const tag = el.tagName;
  if (tag === "path" && axisAligned(m)) {
    return transformPath(el.getAttribute("d") ?? "", m.a, m.d, m.e, m.f);
  }
  if (tag === "line") {
    const p1 = apply(m, num(el, "x1"), num(el, "y1"));
    const p2 = apply(m, num(el, "x2"), num(el, "y2"));
    return polylinePath([p1, p2]);
  }
  if (tag === "polyline" || tag === "polygon") {
    const nums = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push(apply(m, nums[i], nums[i + 1]));
    if (pts.length < 2) return null;
    return polylinePath(pts) + (tag === "polygon" ? " Z" : "");
  }
  // rotated path / anything else: sample the outline
  const len = el.getTotalLength();
  if (!len) return null;
  const n = Math.min(200, Math.max(8, Math.round(len / 4)));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = el.getPointAtLength((len * i) / n);
    pts.push(apply(m, p.x, p.y));
  }
  return polylinePath(pts);
}

function tableGeom(shape: SVGGeometryElement, m: M): Geom | null {
  const tag = shape.tagName;
  const rot = angleOf(m);
  const sx = scaleX(m);
  const sy = scaleY(m);
  const boxAround = (cx: number, cy: number, w: number, h: number, s: Geom["shape"]): Geom => {
    const [rx, ry] = apply(m, cx, cy);
    return {
      shape: s,
      x: round(rx - (w * sx) / 2),
      y: round(ry - (h * sy) / 2),
      w: round(w * sx),
      h: round(h * sy),
      rotation: rot,
      path: null,
    };
  };
  if (tag === "rect") {
    const w = num(shape, "width");
    const h = num(shape, "height");
    return boxAround(num(shape, "x") + w / 2, num(shape, "y") + h / 2, w, h, "rect");
  }
  if (tag === "circle") {
    const r = num(shape, "r");
    return boxAround(num(shape, "cx"), num(shape, "cy"), 2 * r, 2 * r, "circle");
  }
  if (tag === "ellipse") {
    const rx = num(shape, "rx");
    const ry = num(shape, "ry");
    const round_ = Math.abs(rx - ry) < 0.5;
    return boxAround(num(shape, "cx"), num(shape, "cy"), 2 * rx, 2 * ry, round_ ? "circle" : "rect");
  }
  const d = toRootPath(shape, m);
  if (!d) return null;
  // the drawn curve's exact box when the browser can measure it (path
  // control points would overshoot), else the point-based estimate
  let b = pathBounds(d);
  if (axisAligned(m)) {
    const bb = shape.getBBox();
    if (bb.width > 0 && bb.height > 0) {
      const [x, y] = apply(m, bb.x, bb.y);
      b = { x, y, w: bb.width * m.a, h: bb.height * m.d };
    }
  }
  if (!b || b.w <= 0 || b.h <= 0) return null;
  return { shape: "path", x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), rotation: 0, path: d };
}

function sceneryOf(el: SVGGraphicsElement, sheet: { w: number; h: number }): FloorMapElement | null {
  const m = el.getCTM();
  if (!m) return null;
  const tag = el.tagName;
  if (tag === "text") {
    const text = (el.textContent ?? "").trim();
    if (!text) return null;
    const cs = getComputedStyle(el);
    const [x, y] = apply(m, num(el, "x"), num(el, "y"));
    const anchor = cs.textAnchor === "middle" || cs.textAnchor === "end" ? cs.textAnchor : undefined;
    const rotate = angleOf(m);
    return {
      kind: "text",
      x: round(x),
      y: round(y),
      text,
      size: round((parseFloat(cs.fontSize) || 16) * scaleY(m)),
      ...(rotate ? { rotate } : {}),
      ...(anchor ? { anchor } : {}),
      ...(/cursive|comic|hand/i.test(cs.fontFamily) || cs.fontStyle === "italic" ? { font: "hand" as const } : {}),
    };
  }
  const style = paintStyle(el);
  const withStyle = <T extends FloorMapElement>(e: T): T =>
    style === "wall" ? e : ({ ...e, style } as T);
  if (tag === "rect" && axisAligned(m)) {
    const [x, y] = apply(m, num(el, "x"), num(el, "y"));
    const w = num(el, "width") * m.a;
    const h = num(el, "height") * m.d;
    // the sheet's own background, not scenery
    if (w >= sheet.w * 0.95 && h >= sheet.h * 0.95) return null;
    return withStyle({ kind: "rect", x: round(x), y: round(y), w: round(w), h: round(h) });
  }
  if (tag === "circle" && Math.abs(scaleX(m) - scaleY(m)) < 1e-6) {
    const [cx, cy] = apply(m, num(el, "cx"), num(el, "cy"));
    return withStyle({ kind: "circle", cx: round(cx), cy: round(cy), r: round(num(el, "r") * scaleX(m)) });
  }
  if (tag === "ellipse") {
    const [cx, cy] = apply(m, num(el, "cx"), num(el, "cy"));
    const rotate = angleOf(m);
    const label = el.parentElement?.querySelector(":scope > text")?.textContent?.trim();
    return withStyle({
      kind: "ellipse",
      cx: round(cx),
      cy: round(cy),
      rx: round(num(el, "rx") * scaleX(m)),
      ry: round(num(el, "ry") * scaleY(m)),
      ...(rotate ? { rotate } : {}),
      ...(label ? { label } : {}),
    });
  }
  const d = toRootPath(el as SVGGeometryElement, m);
  return d ? withStyle({ kind: "path", d }) : null;
}

/** Parse an SVG file into a map layout. Throws on files that aren't SVG. */
export function parseMapSvg(source: string): ImportedMap {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) {
    throw new Error("not-svg");
  }
  const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(root.getAttribute("width") ?? "") || 1000;
  const height = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(root.getAttribute("height") ?? "") || 700;

  // Measure in the live document: CTMs and computed styles need layout.
  // Width/height = viewBox size, so root user units are map units.
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const isSkipped = (el: Element) =>
      !!el.closest(SKIP) || !!el.closest('[class~="off"], [data-ignore]');
    // a table is a group (shape + label) or a bare shape carrying the id
    const tableGroups = Array.from(svg.querySelectorAll("[id], [data-table]")).filter(
      (g) =>
        !isSkipped(g) &&
        (g.tagName === "g" || g.matches(SHAPES)) &&
        (g.hasAttribute("data-table") || /^t-./.test(g.id)),
    );

    const tables: ImportedTable[] = [];
    for (const g of tableGroups) {
      const shape = (g.matches(SHAPES) ? g : g.querySelector(SHAPES)) as SVGGeometryElement | null;
      const m = shape?.getCTM();
      if (!shape || !m) continue;
      const geom = tableGeom(shape, m);
      if (!geom) continue;
      const name =
        g.getAttribute("data-table")?.trim() ||
        g.querySelector("text")?.textContent?.trim() ||
        g.id.slice(2);
      const seats = Number(g.getAttribute("data-seats"));
      tables.push({ name, seats: seats > 0 ? seats : null, geom });
    }

    const inTable = (el: Element) => tableGroups.some((g) => g.contains(el));
    const elements: FloorMapElement[] = [];
    for (const el of Array.from(svg.querySelectorAll(`${SHAPES}, text`))) {
      if (isSkipped(el) || inTable(el)) continue;
      // an ellipse's label is folded into the ellipse
      if (el.tagName === "text" && el.parentElement?.querySelector(":scope > ellipse")) continue;
      const item = sceneryOf(el as SVGGraphicsElement, { w: width, h: height });
      if (item) elements.push(item);
    }
    return { width: Math.round(width), height: Math.round(height), tables, elements };
  } finally {
    host.remove();
  }
}
