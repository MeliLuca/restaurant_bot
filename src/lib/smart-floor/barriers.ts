// What the drawing of a room says about joining tables, besides distance:
// two tables with a line (a wall) or a divider drawn between them are not
// pushed together. Areas, arrows and text don't count, nor a divider taken
// away for now ("off"). Map units in, straight segments out.

import type { FloorMap, FloorMapElement } from "@/lib/database.types";

type Pt = [number, number];
type Segment = [Pt, Pt];

export type BarrierKind = "wall" | "divider";

export interface Barrier {
  a: Pt;
  b: Pt;
  kind: BarrierKind;
}

/** Straight pieces a curve is cut into */
const CURVE_STEPS = 8;
/** Sides of the polygon standing in for a circle or an oval */
const ROUND_SIDES = 24;

const PARAMS: Record<string, number> = {
  m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0,
};

/** Whether an element keeps tables apart, and how */
export function barrierKind(el: FloorMapElement): BarrierKind | null {
  if (el.kind === "text") return null;
  const style = el.style ?? "wall";
  if (style === "wall") return "wall";
  if (style === "divider" && !el.off) return "divider";
  return null;
}

/** SVG path data as straight segments: curves sampled, arcs as their chord */
export function pathSegments(d: string): Segment[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return [];
  const out: Segment[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  // the last control point, mirrored by a following S / T
  let ctrl: Pt | null = null;
  let prev = "";
  let cmd = "";
  let i = 0;
  const lineTo = (p: Pt) => {
    out.push([cur, p]);
    cur = p;
  };
  const mirrored = (after: string): Pt =>
    ctrl && after.includes(prev) ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur;

  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd.toLowerCase() === "z") {
        if (cur[0] !== start[0] || cur[1] !== start[1]) lineTo(start);
        ctrl = null;
        prev = "z";
        continue;
      }
    } else if (!cmd) {
      return out;
    }
    const kind = cmd.toLowerCase();
    const n = PARAMS[kind];
    const a = tokens.slice(i, i + n).map(Number);
    if (a.length < n || a.some(Number.isNaN)) return out;
    i += n;
    const rel = cmd === kind;
    const P = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    let nextCtrl: Pt | null = null;
    switch (kind) {
      case "m":
        cur = P(a[0], a[1]);
        start = cur;
        // further pairs after a moveto are linetos
        cmd = rel ? "l" : "L";
        break;
      case "l":
        lineTo(P(a[0], a[1]));
        break;
      case "h":
        lineTo([rel ? cur[0] + a[0] : a[0], cur[1]]);
        break;
      case "v":
        lineTo([cur[0], rel ? cur[1] + a[0] : a[0]]);
        break;
      case "c":
      case "s": {
        const p0 = cur;
        const c1 = kind === "c" ? P(a[0], a[1]) : mirrored("cs");
        const k = kind === "c" ? 2 : 0;
        const c2 = P(a[k], a[k + 1]);
        const end = P(a[k + 2], a[k + 3]);
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS;
          const u = 1 - t;
          lineTo([
            u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
            u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
          ]);
        }
        nextCtrl = c2;
        break;
      }
      case "q":
      case "t": {
        const p0 = cur;
        const c = kind === "q" ? P(a[0], a[1]) : mirrored("qt");
        const k = kind === "q" ? 2 : 0;
        const end = P(a[k], a[k + 1]);
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS;
          const u = 1 - t;
          lineTo([
            u * u * p0[0] + 2 * u * t * c[0] + t * t * end[0],
            u * u * p0[1] + 2 * u * t * c[1] + t * t * end[1],
          ]);
        }
        nextCtrl = c;
        break;
      }
      case "a":
        lineTo(P(a[5], a[6]));
        break;
    }
    ctrl = nextCtrl;
    prev = kind;
  }
  return out;
}

function ring(cx: number, cy: number, rx: number, ry: number, deg = 0): Segment[] {
  const r = (deg * Math.PI) / 180;
  const pts = Array.from({ length: ROUND_SIDES }, (_, i): Pt => {
    const a = (i / ROUND_SIDES) * 2 * Math.PI;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return [cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)];
  });
  return pts.map((p, i): Segment => [p, pts[(i + 1) % pts.length]]);
}

/** An element's outline as straight segments (text has none) */
export function elementSegments(el: FloorMapElement): Segment[] {
  switch (el.kind) {
    case "rect": {
      const c: Pt[] = [
        [el.x, el.y],
        [el.x + el.w, el.y],
        [el.x + el.w, el.y + el.h],
        [el.x, el.y + el.h],
      ];
      return c.map((p, i): Segment => [p, c[(i + 1) % 4]]);
    }
    case "circle":
      return ring(el.cx, el.cy, el.r, el.r);
    case "ellipse":
      return ring(el.cx, el.cy, el.rx, el.ry, el.rotate ?? 0);
    case "path":
      return pathSegments(el.d);
    case "text":
      return [];
  }
}

/** map id → the lines and dividers standing in it */
export function mapBarriers(
  maps: Pick<FloorMap, "id" | "elements">[],
): Map<string, Barrier[]> {
  const out = new Map<string, Barrier[]>();
  for (const m of maps) {
    const list: Barrier[] = [];
    for (const el of m.elements) {
      const kind = barrierKind(el);
      if (!kind) continue;
      for (const [a, b] of elementSegments(el)) list.push({ a, b, kind });
    }
    out.set(m.id, list);
  }
  return out;
}

function side(p: Pt, q: Pt, r: Pt): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

/** Do p→q and a→b cross each other (touching an end doesn't count)? */
function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const d1 = side(a, b, p);
  const d2 = side(a, b, q);
  const d3 = side(p, q, a);
  const d4 = side(p, q, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** What the straight line p→q runs into: a wall first, else a divider */
export function barrierBetween(p: Pt, q: Pt, barriers: Barrier[]): BarrierKind | null {
  let hit: BarrierKind | null = null;
  for (const b of barriers) {
    if (!crosses(p, q, b.a, b.b)) continue;
    if (b.kind === "wall") return "wall";
    hit = "divider";
  }
  return hit;
}
