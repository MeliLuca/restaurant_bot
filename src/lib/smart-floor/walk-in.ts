// "Trova posto": where a party walking in right now can sit. Three kinds of
// tables, each its own list:
// - free: available now;
// - dirty: free once someone clears it;
// - finishing: still taken, but the party there is about to leave (they
//   asked for the pre-conto, ordered from a "finishing" category like Dolci,
//   or have sat longer than a meal).
// A table booked later can still be offered while there is time before the
// booking: the party then has to be up by the booking time minus the buffer.

import { feasibleOptions, timelineFor } from "./assign";
import type {
  Booking,
  FloorContext,
  FloorTable,
  NoTableReason,
  SeatRules,
  TableOption,
} from "./types";

const MINUTE = 60_000;

/** A table booked later is offered only with at least this long before it */
export const MIN_STAY_MINUTES = 45;
/**
 * A whole meal fits before a later booking, but with less spare time than
 * this: the table ranks a bit lower (a party lingering would block it)
 */
const TIGHT_SLACK_MINUTES = 120;

/** Why a seated party is likely leaving soon, strongest first */
export type FinishKind = "preconto" | "dessert" | "overtime";

export interface FinishSignal {
  kind: FinishKind;
  /** When: pre-conto printed / first "finishing" item ordered / sat down */
  at: number;
}

/** What the engine needs of one open dine-in bill */
export interface OpenBill {
  tableId: string;
  precontoAt: number | null;
  /** First item ordered from a finishing category, null = none */
  finishingAt: number | null;
}

const STRENGTH: Record<FinishKind, number> = { preconto: 0, dessert: 1, overtime: 2 };

/**
 * Occupied tables whose party is likely leaving soon. Tables linked
 * together are one party: all of its bills must have reached the end (every
 * one printed its pre-conto, or has at least dessert), or it must have sat
 * longer than the meal.
 */
export function finishingSignals(
  tables: FloorTable[],
  bills: OpenBill[],
  links: { group_id: string; table_id: string }[],
  rules: Pick<SeatRules, "mealMinutes">,
  now: number,
): Map<string, FinishSignal> {
  const groupOf = new Map(links.map((l) => [l.table_id, l.group_id]));
  const unitOf = (id: string) => groupOf.get(id) ?? `table:${id}`;

  const units = new Map<string, FloorTable[]>();
  for (const t of tables) {
    if (t.status !== "occupied") continue;
    const key = unitOf(t.id);
    units.set(key, [...(units.get(key) ?? []), t]);
  }
  const billsOf = new Map<string, OpenBill[]>();
  for (const b of bills) {
    const key = unitOf(b.tableId);
    billsOf.set(key, [...(billsOf.get(key) ?? []), b]);
  }

  const out = new Map<string, FinishSignal>();
  units.forEach((members, key) => {
    const unitBills = billsOf.get(key) ?? [];
    let signal: FinishSignal | null = null;
    if (unitBills.length > 0 && unitBills.every((b) => b.precontoAt !== null)) {
      signal = {
        kind: "preconto",
        at: Math.max(...unitBills.map((b) => b.precontoAt!)),
      };
    } else if (
      unitBills.length > 0 &&
      unitBills.every((b) => b.precontoAt !== null || b.finishingAt !== null)
    ) {
      signal = {
        kind: "dessert",
        at: Math.max(...unitBills.map((b) => (b.finishingAt ?? b.precontoAt)!)),
      };
    } else {
      const sat = members
        .map((t) => t.occupiedAt)
        .filter((x): x is number => x !== null);
      const since = sat.length > 0 ? Math.min(...sat) : null;
      if (since !== null && now - since >= rules.mealMinutes * MINUTE) {
        signal = { kind: "overtime", at: since };
      }
    }
    if (signal) for (const t of members) out.set(t.id, signal);
  });
  return out;
}

export interface WalkIn {
  partySize: number;
  tagIds: string[];
  /** Only tables in this room, null = anywhere */
  mapId: string | null;
}

export type WalkInState = "free" | "dirty" | "finishing";

export interface WalkInOption extends TableOption {
  state: WalkInState;
  /** Its tables that need clearing first */
  dirtyIds: string[];
  /** Its tables still taken, with why they should free up soon */
  finishing: { tableId: string; signal: FinishSignal }[];
  /** The party must be up by then (next booking − buffer); null = all evening */
  leaveBy: number | null;
  /** The booking due next on these tables, if any */
  nextBooking: Booking | null;
  /** Less than a meal before the next booking */
  shortStay: boolean;
}

export interface WalkInResult {
  free: WalkInOption[];
  dirty: WalkInOption[];
  finishing: WalkInOption[];
  /** Set when all three lists are empty */
  reason: NoTableReason | null;
}

const WALK_IN_ID = "__walk_in__";

/** Where a party walking in now can sit, best first in each list */
export function findWalkInSeats(
  ctx: FloorContext,
  walkIn: WalkIn,
  finishing: Map<string, FinishSignal>,
  opts: { limit?: number } = {},
): WalkInResult {
  const limit = opts.limit ?? 4;
  const { now, rules } = ctx;
  const booking: Booking = {
    id: WALK_IN_ID,
    name: "",
    partySize: walkIn.partySize,
    start: now,
    tagIds: walkIn.tagIds,
    mapId: walkIn.mapId,
    tableIds: [],
    locked: false,
  };
  const empty: WalkInResult = { free: [], dirty: [], finishing: [], reason: null };
  const feasible = feasibleOptions(ctx, booking);
  if (feasible.reason) return { ...empty, reason: feasible.reason };

  // a dirty table, or one whose party is leaving, counts as free from now:
  // only the bookings on it still hold it
  const relaxed: FloorContext = {
    ...ctx,
    tables: new Map(
      Array.from(ctx.tables.values()).map((t): [string, FloorTable] => [
        t.id,
        t.status === "dirty" || (t.status === "occupied" && finishing.has(t.id))
          ? { ...t, status: "available" }
          : t,
      ]),
    ),
  };
  const timeline = timelineFor(relaxed, new Set());
  const fullStay = (rules.mealMinutes + rules.bufferMinutes) * MINUTE;
  const minStay = (MIN_STAY_MINUTES + rules.bufferMinutes) * MINUTE;

  const lists: Record<WalkInState, WalkInOption[]> = { free: [], dirty: [], finishing: [] };
  for (const o of feasible.options) {
    // asked at the door for that room: the others aren't an answer
    if (o.otherRoom) continue;
    if (!timeline.isFree(o.tableIds, now, now + minStay)) continue;
    const tables = o.tableIds.map((id) => ctx.tables.get(id)!);
    const dirtyIds = tables.filter((t) => t.status === "dirty").map((t) => t.id);
    const leaving = tables
      .filter((t) => t.status === "occupied")
      .map((t) => ({ tableId: t.id, signal: finishing.get(t.id)! }));
    const next = timeline.nextStart(o.tableIds, now);
    const nextBooking =
      next === null
        ? null
        : Array.from(ctx.bookings.values()).find(
            (b) => b.start === next && b.tableIds.some((id) => o.tableIds.includes(id)),
          ) ?? null;
    const state: WalkInState =
      leaving.length > 0 ? "finishing" : dirtyIds.length > 0 ? "dirty" : "free";
    lists[state].push({
      ...o,
      freeUntil: next,
      state,
      dirtyIds,
      finishing: leaving,
      leaveBy: next === null ? null : next - rules.bufferMinutes * MINUTE,
      nextBooking,
      shortStay: next !== null && next - now < fullStay,
    });
  }

  // a whole meal first, the longest stay among the short ones; then the
  // engine's score, worse the closer a later booking follows the meal; then
  // the table free the longest
  const stay = (o: WalkInOption) => (o.leaveBy === null ? Infinity : o.leaveBy - now);
  const tightness = (o: WalkInOption) => {
    if (o.leaveBy === null || o.shortStay) return 0;
    const slack = (o.leaveBy - now) / MINUTE - rules.mealMinutes;
    return slack >= TIGHT_SLACK_MINUTES ? 0 : Math.ceil((TIGHT_SLACK_MINUTES - slack) / 15);
  };
  const byStayThenScore = (a: WalkInOption, b: WalkInOption) =>
    Number(a.shortStay) - Number(b.shortStay) ||
    (a.shortStay ? stay(b) - stay(a) : 0) ||
    a.score + tightness(a) - (b.score + tightness(b)) ||
    (stay(a) === stay(b) ? 0 : stay(a) > stay(b) ? -1 : 1);
  // pre-conto before dessert before "been here long"; then who got there first
  const bySoonestFree = (a: WalkInOption, b: WalkInOption) => {
    const wa = finishingSignalOf(a)!;
    const wb = finishingSignalOf(b)!;
    return (
      STRENGTH[wa.kind] - STRENGTH[wb.kind] || wa.at - wb.at || byStayThenScore(a, b)
    );
  };

  const result: WalkInResult = {
    free: lists.free.sort(byStayThenScore).slice(0, limit),
    dirty: lists.dirty.sort(byStayThenScore).slice(0, limit),
    finishing: lists.finishing.sort(bySoonestFree).slice(0, limit),
    reason: null,
  };
  if (result.free.length + result.dirty.length + result.finishing.length === 0) {
    result.reason = "all_taken";
  }
  return result;
}

/**
 * What to wait for on a finishing option: of its tables' reasons, the one
 * that frees up last (weakest kind, then latest).
 */
export function finishingSignalOf(o: WalkInOption): FinishSignal | null {
  let w: FinishSignal | null = null;
  for (const { signal } of o.finishing) {
    if (
      !w ||
      STRENGTH[signal.kind] > STRENGTH[w.kind] ||
      (signal.kind === w.kind && signal.at > w.at)
    ) {
      w = signal;
    }
  }
  return w;
}
