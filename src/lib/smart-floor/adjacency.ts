// Which tables can be pushed together: those drawn close on the same map,
// plus/minus the hand-made exceptions in table_join_rules.

import { center, type Geom } from "@/lib/floor/geometry";
import type { TableJoinRule } from "@/lib/database.types";
import type { FloorTable } from "./types";

type Pt = [number, number];

const CIRCLE_SIDES = 16;

/** The table's outline as a convex polygon, in map units */
export function outline(g: Geom): Pt[] {
  const [cx, cy] = center(g);
  const hw = g.w / 2;
  const hh = g.h / 2;
  // free-form tables are drawn inside their box: the box is close enough
  const local: Pt[] =
    g.shape === "circle"
      ? Array.from({ length: CIRCLE_SIDES }, (_, i) => {
          const a = (i / CIRCLE_SIDES) * 2 * Math.PI;
          return [hw * Math.cos(a), hh * Math.sin(a)] as Pt;
        })
      : [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ];
  const r = (g.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return local.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Separating-axis test; both polygons are convex */
function overlaps(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of b) {
        const d = v[0] * nx + v[1] * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

/** Shortest distance between two outlines; 0 when they touch or overlap */
export function outlineGap(a: Pt[], b: Pt[]): number {
  if (overlaps(a, b)) return 0;
  let best = Infinity;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    for (const p of from) {
      for (let i = 0; i < to.length; i++) {
        best = Math.min(best, pointSegmentDistance(p, to[i], to[(i + 1) % to.length]));
      }
    }
  }
  return best;
}

function boxOf(poly: Pt[]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

/**
 * table id → the tables it can be pushed together with. Two tables qualify
 * when they are drawn on the same map with outlines at most `maxGap` apart;
 * a rule overrides that either way.
 */
export function buildAdjacency(
  tables: FloorTable[],
  maxGap: number,
  rules: TableJoinRule[] = [],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>(tables.map((t) => [t.id, new Set()]));
  const link = (a: string, b: string, on: boolean) => {
    if (!adj.has(a) || !adj.has(b) || a === b) return;
    if (on) {
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    } else {
      adj.get(a)!.delete(b);
      adj.get(b)!.delete(a);
    }
  };

  const placed = tables
    .filter((t) => t.mapId && t.geom)
    .map((t) => {
      const poly = outline(t.geom!);
      return { t, poly, box: boxOf(poly) };
    });
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.t.mapId !== b.t.mapId) continue;
      // cheap reject before the polygon maths
      if (
        a.box.x1 - b.box.x2 > maxGap ||
        b.box.x1 - a.box.x2 > maxGap ||
        a.box.y1 - b.box.y2 > maxGap ||
        b.box.y1 - a.box.y2 > maxGap
      ) {
        continue;
      }
      if (outlineGap(a.poly, b.poly) <= maxGap) link(a.t.id, b.t.id, true);
    }
  }
  for (const r of rules) link(r.table_a, r.table_b, r.joinable);
  return adj;
}
