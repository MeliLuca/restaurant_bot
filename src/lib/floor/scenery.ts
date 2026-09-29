// Geometry for floor-map scenery (walls, stages, labels, arrows) in the
// layout editor. Elements are the jsonb items documented in the floor_maps
// migration; everything here is map units and pure.

import type { FloorMapElement } from "@/lib/database.types";
import { transformPath } from "@/lib/floor/geometry";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (v: number) => Math.round(v * 100) / 100;
/** Rough advance width of one character, as a share of the font size */
const CHAR_W = 0.6;
const ARROW_HEAD = 10;
const ARROW_HEAD_DEG = 30;

function rotatePt(x: number, y: number, ox: number, oy: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - ox;
  const dy = y - oy;
  return [ox + dx * c - dy * s, oy + dx * s + dy * c];
}

function boxOf(pts: [number, number][]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Bounds of SVG path data from its end and control points (curves may be a
 * little smaller than this box, which is fine for selecting and resizing).
 */
export function pathBounds(d: string): Box | null {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return null;
  const PARAMS: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };
  const pts: [number, number][] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let i = 0;
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd.toLowerCase() === "z") {
        cx = sx;
        cy = sy;
        continue;
      }
    } else if (!cmd) return null;
    const n = PARAMS[cmd.toLowerCase()];
    const a = tokens.slice(i, i + n).map(Number);
    if (a.length < n || a.some(Number.isNaN)) return null;
    i += n;
    const rel = cmd === cmd.toLowerCase();
    const X = (v: number) => (rel ? cx + v : v);
    const Y = (v: number) => (rel ? cy + v : v);
    switch (cmd.toLowerCase()) {
      case "h":
        cx = X(a[0]);
        break;
      case "v":
        cy = Y(a[0]);
        break;
      case "a":
        cx = X(a[5]);
        cy = Y(a[6]);
        break;
      default:
        // control points first, end point last
        for (let k = 0; k < n - 2; k += 2) pts.push([X(a[k]), Y(a[k + 1])]);
        cx = X(a[n - 2]);
        cy = Y(a[n - 1]);
    }
    pts.push([cx, cy]);
    if (cmd === "M" || cmd === "m") {
      sx = cx;
      sy = cy;
      // further pairs after a moveto are linetos
      cmd = cmd === "M" ? "L" : "l";
    }
  }
  return pts.length ? boxOf(pts) : null;
}

function textBox(el: Extract<FloorMapElement, { kind: "text" }>): Box {
  const size = el.size ?? 18;
  const w = el.text.length * size * CHAR_W;
  const anchor = el.anchor ?? "start";
  const x0 = anchor === "start" ? el.x : anchor === "middle" ? el.x - w / 2 : el.x - w;
  const corners: [number, number][] = [
    [x0, el.y - size * 0.8],
    [x0 + w, el.y - size * 0.8],
    [x0 + w, el.y + size * 0.25],
    [x0, el.y + size * 0.25],
  ];
  return boxOf(corners.map(([x, y]) => rotatePt(x, y, el.x, el.y, el.rotate ?? 0)));
}

export function elementBounds(el: FloorMapElement): Box {
  switch (el.kind) {
    case "rect":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "circle":
      return { x: el.cx - el.r, y: el.cy - el.r, w: el.r * 2, h: el.r * 2 };
    case "ellipse": {
      const pts: [number, number][] = [
        [el.cx - el.rx, el.cy - el.ry],
        [el.cx + el.rx, el.cy - el.ry],
        [el.cx + el.rx, el.cy + el.ry],
        [el.cx - el.rx, el.cy + el.ry],
      ];
      return boxOf(pts.map(([x, y]) => rotatePt(x, y, el.cx, el.cy, el.rotate ?? 0)));
    }
    case "path":
      return pathBounds(el.d) ?? { x: 0, y: 0, w: 0, h: 0 };
    case "text":
      return textBox(el);
  }
}

export function moveElement(el: FloorMapElement, dx: number, dy: number): FloorMapElement {
  switch (el.kind) {
    case "rect":
      return { ...el, x: round(el.x + dx), y: round(el.y + dy) };
    case "circle":
    case "ellipse":
      return { ...el, cx: round(el.cx + dx), cy: round(el.cy + dy) };
    case "path":
      return { ...el, d: transformPath(el.d, 1, 1, dx, dy) };
    case "text":
      return { ...el, x: round(el.x + dx), y: round(el.y + dy) };
  }
}

/** Map an element from its old bounds onto new ones (handle resize). */
export function resizeElement(el: FloorMapElement, from: Box, to: Box): FloorMapElement {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const X = (v: number) => round(to.x + (v - from.x) * sx);
  const Y = (v: number) => round(to.y + (v - from.y) * sy);
  switch (el.kind) {
    case "rect":
      return { ...el, x: X(el.x), y: Y(el.y), w: round(el.w * sx), h: round(el.h * sy) };
    case "circle":
      return { ...el, cx: X(el.cx), cy: Y(el.cy), r: round(el.r * Math.min(sx, sy)) };
    case "ellipse":
      return { ...el, cx: X(el.cx), cy: Y(el.cy), rx: round(el.rx * sx), ry: round(el.ry * sy) };
    case "path":
      return {
        ...el,
        d: transformPath(el.d, sx, sy, to.x - from.x * sx, to.y - from.y * sy),
      };
    case "text": {
      // text scales by height (it can't stretch): size follows, anchor moves
      const k = sy;
      return { ...el, x: X(el.x), y: Y(el.y), size: Math.max(6, round((el.size ?? 18) * k)) };
    }
  }
}

/** Shaft plus a two-stroke head, as the traced arrows are drawn. */
export function arrowPath(x1: number, y1: number, x2: number, y2: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = (deg: number) => {
    const a = ang + Math.PI + (deg * Math.PI) / 180;
    return `${round(x2 + ARROW_HEAD * Math.cos(a))} ${round(y2 + ARROW_HEAD * Math.sin(a))}`;
  };
  const tip = `${round(x2)} ${round(y2)}`;
  return `M${round(x1)} ${round(y1)} L${tip} M${head(ARROW_HEAD_DEG)} L${tip} L${head(-ARROW_HEAD_DEG)}`;
}

export function polylinePath(points: [number, number][]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`)
    .join(" ");
}

/** Constrain a segment to 0/45/90° steps (Shift while drawing). */
export function constrain45(
  x0: number,
  y0: number,
  x: number,
  y: number,
): [number, number] {
  const ang = Math.atan2(y - y0, x - x0);
  const step = Math.PI / 4;
  const a = Math.round(ang / step) * step;
  const len = Math.hypot(x - x0, y - y0);
  return [x0 + len * Math.cos(a), y0 + len * Math.sin(a)];
}

/**
 * Ramer–Douglas–Peucker: keep only the points that stray more than `tol`
 * from the straight line between their neighbours, so a hand-drawn stroke
 * of hundreds of pointer samples is stored as a few dozen corners.
 */
export function simplifyPoints(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Path data for a freehand stroke: simplified, and closed (Z) when it ends
 * within `closeGap` of where it started, so a hand-drawn outline becomes a
 * shape. Null for a stroke too short to keep.
 */
export function freehandPath(
  pts: [number, number][],
  tol: number,
  closeGap: number,
): string | null {
  if (pts.length < 2) return null;
  const box = boxOf(pts);
  if (Math.max(box.w, box.h) < tol * 2) return null;
  const simple = simplifyPoints(pts, tol);
  const [x0, y0] = simple[0];
  const [xn, yn] = simple[simple.length - 1];
  const closed =
    simple.length > 3 &&
    Math.hypot(xn - x0, yn - y0) <= closeGap &&
    Math.max(box.w, box.h) > closeGap * 2;
  return closed ? `${polylinePath(simple.slice(0, -1))} Z` : polylinePath(simple);
}
