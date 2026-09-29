// What Gestione Sala Smart draws over the live floor: who is due where in
// the next two hours, who is late, and — for a time picked ahead — which
// tables are expected to be taken then.

import { compareTableNames } from "@/lib/floor/maps";
import type { Reservation, TableLink } from "@/lib/database.types";
import { outline, outlineGap } from "./adjacency";
import { currentHold } from "./availability";
import type { FloorTable, SeatRules } from "./types";

const MINUTE = 60_000;
/** How far ahead a booking shows on its tables */
export const UPCOMING_MINUTES = 120;

export type SpotKind =
  /** live: the party is past its time and not seated yet */
  | "late"
  /** live: late beyond "prenotazione in ritardo dopo" (the alert is out) */
  | "overdue"
  /** the party is due within the next two hours */
  | "soon"
  /** time picked ahead: a booked party sits here then */
  | "seated";

/** A booked party on one of its tables */
export interface FloorSpot {
  kind: SpotKind;
  reservation: Reservation;
  /** Minutes past the booking time (late / overdue) */
  lateMinutes: number;
  /**
   * Live: due soon (or late) while one of its tables is occupied. Ahead:
   * one of its tables is likely still held by whoever sits there now.
   */
  blocked: boolean;
  /** One table per party carries its name on the map */
  labelled: boolean;
}

export interface FloorGroup {
  key: string;
  tableIds: string[];
  /** A booked party's kind; "linked" = tables linked while seated */
  kind: SpotKind | "linked";
}

export interface FloorOverlay {
  spots: Map<string, FloorSpot>;
  /** Time picked ahead: tables whoever sits there now likely still holds */
  busy: Set<string>;
  /** Pushed-together tables, for their common outline */
  groups: FloorGroup[];
}

export interface OverlayInput {
  tables: FloorTable[];
  /** The day's reservations (only booked ones with tables count) */
  reservations: Reservation[];
  links: TableLink[];
  rules: SeatRules;
  lateAfterMinutes: number;
  occupiedWarnMinutes: number;
  now: number;
  /** A time ahead to look at; null = now, over the live status */
  at: number | null;
}

const RANK: Record<SpotKind, number> = { overdue: 4, late: 3, seated: 2, soon: 1 };

/** Linked tables far apart (T22 with T10/Gino) get their 🔗 badge, no outline */
function connected(tables: FloorTable[], maxGap: number): boolean {
  if (tables.some((t) => !t.geom) || new Set(tables.map((t) => t.mapId)).size > 1) {
    return false;
  }
  const shapes = tables.map((t) => outline(t.geom!));
  const reached = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const i = queue.shift()!;
    for (let j = 0; j < shapes.length; j++) {
      if (!reached.has(j) && outlineGap(shapes[i], shapes[j]) <= maxGap) {
        reached.add(j);
        queue.push(j);
      }
    }
  }
  return reached.size === shapes.length;
}

export function floorOverlay(input: OverlayInput): FloorOverlay {
  const { tables, rules, now, at } = input;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const live = at === null;
  const when = at ?? now;
  const spots = new Map<string, FloorSpot>();
  const groups: FloorGroup[] = [];

  const booked = input.reservations
    .filter((r) => r.status === "booked" && r.table_ids.length > 0)
    .sort((a, b) => Date.parse(a.reserved_at) - Date.parse(b.reserved_at));

  const parties: { r: Reservation; kind: SpotKind }[] = [];
  for (const r of booked) {
    const start = Date.parse(r.reserved_at);
    let kind: SpotKind | null = null;
    let lateMinutes = 0;
    if (live) {
      if (start <= now) {
        lateMinutes = Math.floor((now - start) / MINUTE);
        kind = lateMinutes >= input.lateAfterMinutes ? "overdue" : "late";
      } else if (start - now <= UPCOMING_MINUTES * MINUTE) {
        kind = "soon";
      }
    } else if (start <= when && when < start + rules.mealMinutes * MINUTE) {
      kind = "seated";
    } else if (start > when && start - when <= UPCOMING_MINUTES * MINUTE) {
      kind = "soon";
    }
    if (!kind) continue;
    const blocked =
      live &&
      start - now <= input.occupiedWarnMinutes * MINUTE &&
      r.table_ids.some((id) => byId.get(id)?.status === "occupied");
    parties.push({ r, kind });
    for (const id of r.table_ids) {
      const cur = spots.get(id);
      // bookings come in time order: the earliest wins among equals
      if (cur && RANK[cur.kind] >= RANK[kind]) continue;
      spots.set(id, { kind, reservation: r, lateMinutes, blocked, labelled: false });
    }
  }

  for (const { r, kind } of parties) {
    const mine = r.table_ids
      .filter((id) => spots.get(id)?.reservation.id === r.id)
      .sort((a, b) => compareTableNames(byId.get(a)?.name ?? "", byId.get(b)?.name ?? ""));
    if (mine.length > 0) spots.get(mine[0])!.labelled = true;
    const drawn = r.table_ids.map((id) => byId.get(id)).filter((t): t is FloorTable => !!t);
    if (drawn.length > 1 && connected(drawn, rules.joinDistance * 2)) {
      groups.push({ key: r.id, tableIds: r.table_ids, kind });
    }
  }

  const busy = new Set<string>();
  if (!live) {
    for (const t of tables) {
      const hold = currentHold(t, now, rules);
      if (hold && when < hold.to) busy.add(t.id);
    }
    // whoever sits there now is likely still there when the party is due
    for (const { r } of parties) {
      if (!r.table_ids.some((id) => busy.has(id))) continue;
      for (const id of r.table_ids) {
        const spot = spots.get(id);
        if (spot?.reservation.id === r.id) spot.blocked = true;
      }
    }
  } else {
    // seated parties spread over several tables: their links
    const members = new Map<string, Set<string>>();
    for (const l of input.links) {
      const set = members.get(l.group_id) ?? new Set<string>();
      set.add(l.table_id);
      members.set(l.group_id, set);
    }
    members.forEach((ids, key) => {
      const drawn = Array.from(ids)
        .map((id) => byId.get(id))
        .filter((t): t is FloorTable => !!t);
      if (drawn.length > 1 && connected(drawn, rules.joinDistance * 2)) {
        groups.push({ key, tableIds: drawn.map((t) => t.id), kind: "linked" });
      }
    });
  }

  return { spots, busy, groups };
}
