// Where to draw the line between two joinable tables: across the gap between
// their outlines, not over their names.

import { center, type Geom } from "@/lib/floor/geometry";
import { outline } from "./adjacency";

type Pt = [number, number];

/** Shortest line drawn, so touching tables still show (and click) a joint */
const MIN_LENGTH = 14;

/** How far along a→b (0..1) the segment leaves the polygon it starts in */
function exitAt(poly: Pt[], a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return best;
}

/** The joint between two tables, from one outline to the other */
export function joinSegment(a: Geom, b: Geom): [Pt, Pt] {
  const ca = center(a);
  const cb = center(b);
  const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
  let from = exitAt(outline(a), ca, cb);
  let to = 1 - exitAt(outline(b), cb, ca);
  if ((to - from) * len < MIN_LENGTH) {
    const mid = (from + to) / 2;
    const half = MIN_LENGTH / 2 / len;
    from = mid - half;
    to = mid + half;
  }
  const at = (t: number): Pt => [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t];
  return [at(from), at(to)];
}
