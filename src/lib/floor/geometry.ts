// Geometry for the floor map editor. All values are map units; a table is a
// box (x, y, w, h) rotated by `rotation` degrees clockwise around its centre.
// A free-form table ("path") draws its SVG path inside that box, in absolute
// map coordinates of the UNROTATED box, so moving/resizing the box must
// rewrite the path the same way.

import type { TableShape } from "@/lib/database.types";

export interface Geom {
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  path: string | null;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type AlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vmiddle"
  | "bottom"
  | "hdistribute"
  | "vdistribute";

export const MIN_TABLE_SIZE = 12;
export const ROTATE_SNAP_DEG = 15;

const round = (v: number) => Math.round(v * 100) / 100;

export function snapTo(v: number, grid: number | null): number {
  return grid ? Math.round(v / grid) * grid : round(v);
}

function rotateVec(x: number, y: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

export function center(g: Geom): [number, number] {
  return [g.x + g.w / 2, g.y + g.h / 2];
}

/** Normalise to [0, 360) so a round trip of rotations stays readable. */
export function normDeg(d: number): number {
  return round(((d % 360) + 360) % 360);
}

// ---------------------------------------------------------------------------
// SVG path rewriting (for free-form tables)
// ---------------------------------------------------------------------------

const PARAMS: Record<string, number> = {
  m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0,
};

/**
 * Apply a separable affine map (x → x*sx + tx, y → y*sy + ty) to path data.
 * Absolute commands get the full map; relative ones only the scale.
 */
export function transformPath(
  d: string,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): string {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return d;
  const out: string[] = [];
  let i = 0;
  let cmd = "";
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) {
      cmd = tokens[i++];
      out.push(cmd);
      if (cmd.toLowerCase() === "z") continue;
    } else if (!cmd) {
      return d; // malformed: leave untouched
    }
    const n = PARAMS[cmd.toLowerCase()];
    const args = tokens.slice(i, i + n).map(Number);
    if (args.length < n || args.some(Number.isNaN)) return d;
    i += n;
    const abs = cmd === cmd.toUpperCase();
    const X = (v: number) => (abs ? v * sx + tx : v * sx);
    const Y = (v: number) => (abs ? v * sy + ty : v * sy);
    let mapped: number[];
    switch (cmd.toLowerCase()) {
      case "h":
        mapped = [X(args[0])];
        break;
      case "v":
        mapped = [Y(args[0])];
        break;
      case "a":
        mapped = [
          Math.abs(args[0] * sx),
          Math.abs(args[1] * sy),
          args[2],
          args[3],
          args[4],
          X(args[5]),
          Y(args[6]),
        ];
        break;
      default:
        mapped = args.map((v, k) => (k % 2 === 0 ? X(v) : Y(v)));
    }
    out.push(mapped.map(round).join(" "));
  }
  return out.join(" ");
}

/** Re-express a geometry in a new box, rewriting the path to follow it. */
function withBox(g: Geom, x: number, y: number, w: number, h: number): Geom {
  let path = g.path;
  if (path) {
    const sx = w / g.w;
    const sy = h / g.h;
    path = transformPath(path, sx, sy, x - g.x * sx, y - g.y * sy);
  }
  return { ...g, x: round(x), y: round(y), w: round(w), h: round(h), path };
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

export function moveGeom(g: Geom, dx: number, dy: number): Geom {
  return withBox(g, g.x + dx, g.y + dy, g.w, g.h);
}

/** Move by a delta, snapping the box's top-left corner to the grid. */
export function dragGeom(
  start: Geom,
  dx: number,
  dy: number,
  grid: number | null,
): Geom {
  const x = snapTo(start.x + dx, grid);
  const y = snapTo(start.y + dy, grid);
  return moveGeom(start, x - start.x, y - start.y);
}

/**
 * Resize from a handle toward a pointer (map coordinates), keeping the
 * opposite side fixed. Works in the table's own (rotated) frame. Circles stay
 * round. The grid only applies to unrotated tables.
 */
export function resizeGeom(
  start: Geom,
  handle: Handle,
  px: number,
  py: number,
  grid: number | null,
): Geom {
  const [cx, cy] = center(start);
  const [lx, ly] = rotateVec(px - cx, py - cy, -start.rotation);
  const upright = normDeg(start.rotation) === 0;
  const snapX = (local: number) =>
    upright && grid ? snapTo(cx + local, grid) - cx : local;
  const snapY = (local: number) =>
    upright && grid ? snapTo(cy + local, grid) - cy : local;

  let l = -start.w / 2;
  let r = start.w / 2;
  let t = -start.h / 2;
  let b = start.h / 2;
  if (handle.includes("e")) r = Math.max(l + MIN_TABLE_SIZE, snapX(lx));
  if (handle.includes("w")) l = Math.min(r - MIN_TABLE_SIZE, snapX(lx));
  if (handle.includes("s")) b = Math.max(t + MIN_TABLE_SIZE, snapY(ly));
  if (handle.includes("n")) t = Math.min(b - MIN_TABLE_SIZE, snapY(ly));

  if (start.shape === "circle") {
    // keep it round: the dragged dimension decides, anchored like the handle
    const horizontal = handle === "e" || handle === "w";
    const vertical = handle === "n" || handle === "s";
    const d = horizontal
      ? r - l
      : vertical
        ? b - t
        : Math.max(r - l, b - t);
    if (!handle.includes("w") && !handle.includes("e")) {
      const mid = (l + r) / 2;
      l = mid - d / 2;
      r = mid + d / 2;
    } else if (handle.includes("w")) l = r - d;
    else r = l + d;
    if (!handle.includes("n") && !handle.includes("s")) {
      const mid = (t + b) / 2;
      t = mid - d / 2;
      b = mid + d / 2;
    } else if (handle.includes("n")) t = b - d;
    else b = t + d;
  }

  const w = r - l;
  const h = b - t;
  const [ox, oy] = rotateVec((l + r) / 2, (t + b) / 2, start.rotation);
  const ncx = cx + ox;
  const ncy = cy + oy;
  return withBox(start, ncx - w / 2, ncy - h / 2, w, h);
}

/** Rotate so the handle above the table points at the pointer. */
export function rotateToward(
  start: Geom,
  px: number,
  py: number,
  snapDeg: number | null,
): Geom {
  const [cx, cy] = center(start);
  let deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
  if (snapDeg) deg = Math.round(deg / snapDeg) * snapDeg;
  return { ...start, rotation: normDeg(deg) };
}

export function rotateBy(g: Geom, deg: number): Geom {
  return { ...g, rotation: normDeg(g.rotation + deg) };
}

/** Axis-aligned bounds of the rotated box. */
export function bounds(g: Geom): { x1: number; y1: number; x2: number; y2: number } {
  const [cx, cy] = center(g);
  const pts = [
    [-g.w / 2, -g.h / 2],
    [g.w / 2, -g.h / 2],
    [g.w / 2, g.h / 2],
    [-g.w / 2, g.h / 2],
  ].map(([x, y]) => rotateVec(x, y, g.rotation));
  const xs = pts.map((p) => cx + p[0]);
  const ys = pts.map((p) => cy + p[1]);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

/** Pull a table fully back inside the map sheet. */
export function clampToMap(g: Geom, width: number, height: number): Geom {
  const b = bounds(g);
  let dx = 0;
  let dy = 0;
  if (b.x1 < 0) dx = -b.x1;
  else if (b.x2 > width) dx = width - b.x2;
  if (b.y1 < 0) dy = -b.y1;
  else if (b.y2 > height) dy = height - b.y2;
  return dx || dy ? moveGeom(g, dx, dy) : g;
}

/** Align / distribute several tables by their visible (rotated) bounds. */
export function alignGeoms(geoms: Geom[], mode: AlignMode): Geom[] {
  if (geoms.length < 2) return geoms;
  const bs = geoms.map(bounds);
  const minX = Math.min(...bs.map((b) => b.x1));
  const maxX = Math.max(...bs.map((b) => b.x2));
  const minY = Math.min(...bs.map((b) => b.y1));
  const maxY = Math.max(...bs.map((b) => b.y2));

  if (mode === "hdistribute" || mode === "vdistribute") {
    if (geoms.length < 3) return geoms;
    const horizontal = mode === "hdistribute";
    const mid = (b: (typeof bs)[number]) =>
      horizontal ? (b.x1 + b.x2) / 2 : (b.y1 + b.y2) / 2;
    const order = geoms.map((_, i) => i).sort((a, b) => mid(bs[a]) - mid(bs[b]));
    const first = mid(bs[order[0]]);
    const step = (mid(bs[order[order.length - 1]]) - first) / (order.length - 1);
    const out = [...geoms];
    order.forEach((idx, k) => {
      const delta = first + step * k - mid(bs[idx]);
      out[idx] = horizontal
        ? moveGeom(geoms[idx], delta, 0)
        : moveGeom(geoms[idx], 0, delta);
    });
    return out;
  }

  return geoms.map((g, i) => {
    const b = bs[i];
    switch (mode) {
      case "left":
        return moveGeom(g, minX - b.x1, 0);
      case "right":
        return moveGeom(g, maxX - b.x2, 0);
      case "hcenter":
        return moveGeom(g, (minX + maxX) / 2 - (b.x1 + b.x2) / 2, 0);
      case "top":
        return moveGeom(g, 0, minY - b.y1);
      case "bottom":
        return moveGeom(g, 0, maxY - b.y2);
      case "vmiddle":
        return moveGeom(g, 0, (minY + maxY) / 2 - (b.y1 + b.y2) / 2);
    }
    return g;
  });
}

/** Switch rect ⇄ circle keeping the centre; circles are square boxes. */
export function toShape(g: Geom, shape: "rect" | "circle"): Geom {
  if (g.shape === shape) return g;
  const [cx, cy] = center(g);
  const d = Math.min(g.w, g.h);
  const { w, h } =
    shape === "circle"
      ? { w: d, h: d }
      : g.shape === "circle"
        ? { w: Math.round(d * 1.5), h: d }
        : { w: g.w, h: g.h };
  return {
    ...g,
    shape,
    path: null,
    x: round(cx - w / 2),
    y: round(cy - h / 2),
    w,
    h,
  };
}

/** Table number size that fits its box (shared by the floor view and editor). */
export function labelFontSize(name: string, w: number, h: number, max = 20): number {
  return Math.min(max, h * 0.55, (w * 0.9) / (Math.max(1, name.length) * 0.55));
}

export type RepeatDir = "right" | "down" | "left" | "up";

/**
 * Copies of a group of tables laid out in a row ("Ripeti in fila"): the
 * offset from one copy to the next — the group's visible size along the
 * direction plus `gap` — and how many copies still fit on the sheet.
 */
export function repeatLayout(
  geoms: Geom[],
  dir: RepeatDir,
  gap: number,
  width: number,
  height: number,
): { dx: number; dy: number; fits: number } {
  const bs = geoms.map(bounds);
  const x1 = Math.min(...bs.map((b) => b.x1));
  const y1 = Math.min(...bs.map((b) => b.y1));
  const x2 = Math.max(...bs.map((b) => b.x2));
  const y2 = Math.max(...bs.map((b) => b.y2));
  const stepX = x2 - x1 + gap;
  const stepY = y2 - y1 + gap;
  // a hair of slack so float noise doesn't lose a copy that fits exactly
  const count = (room: number, step: number) =>
    step > 0 ? Math.max(0, Math.floor((room + 1e-6) / step)) : 0;
  switch (dir) {
    case "right":
      return { dx: stepX, dy: 0, fits: count(width - x2, stepX) };
    case "left":
      return { dx: -stepX, dy: 0, fits: count(x1, stepX) };
    case "down":
      return { dx: 0, dy: stepY, fits: count(height - y2, stepY) };
    case "up":
      return { dx: 0, dy: -stepY, fits: count(y1, stepY) };
  }
}
