// The outline drawn around a party's pushed-together tables on the map.

import type { Geom } from "@/lib/floor/geometry";
import { outline } from "./adjacency";

type Pt = [number, number];

/** Points per table corner when rounding the outline off */
const ROUND_STEPS = 12;

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone chain; counter-clockwise, no repeated end point */
function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * SVG path of a rounded outline `pad` map units around the tables (the convex
 * hull of their outlines, each corner swept by a circle).
 */
export function hullPath(geoms: Geom[], pad: number): string {
  const pts: Pt[] = [];
  for (const g of geoms) {
    for (const [x, y] of outline(g)) {
      for (let i = 0; i < ROUND_STEPS; i++) {
        const a = (i / ROUND_STEPS) * 2 * Math.PI;
        pts.push([x + pad * Math.cos(a), y + pad * Math.sin(a)]);
      }
    }
  }
  const hull = convexHull(pts);
  if (hull.length === 0) return "";
  return `M${hull.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
}
