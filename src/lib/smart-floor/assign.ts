// Gestione Sala Smart's table assignment: which table (or tables pushed
// together) a party should get, one at a time or a whole list at once.
//
// 1. fittingGroups: every table, or connected group of joinable tables, big
//    enough for the party (soft capacity: overfill + join bonus).
// 2. evaluate: drop groups missing a requested MANDATORY feature, score the
//    rest (empty seats, joins, missing preferences, other room…).
// 3. keep those free for the party's whole stay (Timeline), best score first.
// planAssignments does that for many parties, hardest first, and — when
// allowed — moves unlocked bookings out of the way of one that doesn't fit.

import { compareTableNames } from "@/lib/floor/maps";
import { holdSpan, Timeline } from "./availability";
import type {
  Booking,
  FloorContext,
  NoTableReason,
  TableOption,
} from "./types";

/** Score weights: lower total = better seat. Tuned on the real Sala map. */
const W = {
  perSpareSeat: 2,
  perSqueezedSeat: 4,
  /** more empty seats than maxSpareSeats: only if nothing else is free */
  lastResort: 50,
  perLastResortSeat: 5,
  perExtraTable: 6,
  perMissingTag: 8,
  /** joined tables: one having the feature is enough, all having it is nicer */
  perTableWithoutTag: 2,
  otherRoom: 10,
  /** a table with a mandatory feature the party didn't ask for: keep it for who needs it */
  perScarceTable: 1,
  /** already its tables: don't shuffle a plan for nothing */
  keepCurrent: -3,
};

/** How many options repair() tries before giving up on a party */
const REPAIR_TRIES = 40;

interface Group {
  tableIds: string[];
  seats: number;
  mapId: string | null;
}

const byName = (ctx: FloorContext) => (a: string, b: string) =>
  compareTableNames(ctx.tables.get(a)?.name ?? "", ctx.tables.get(b)?.name ?? "");

/** Seats of tables pushed together: their seats plus a bonus at each join */
export function seatsOf(ctx: FloorContext, tableIds: string[]): number {
  let seats = 0;
  for (const id of tableIds) seats += ctx.tables.get(id)?.capacity ?? 0;
  return seats + ctx.rules.joinBonusSeats * Math.max(0, tableIds.length - 1);
}

const groupCache = new WeakMap<FloorContext, Map<number, Group[]>>();

/**
 * Every single table or connected group of joinable tables (up to
 * maxJoinTables) that seats `party`, counting the overfill. A group that
 * already fits is not grown further: a bigger one only adds empty seats.
 */
export function fittingGroups(ctx: FloorContext, party: number): Group[] {
  let perParty = groupCache.get(ctx);
  if (!perParty) groupCache.set(ctx, (perParty = new Map()));
  const cached = perParty.get(party);
  if (cached) return cached;

  const need = party - ctx.rules.overfillSeats;
  const seen = new Set<string>();
  const out: Group[] = [];
  for (const t of Array.from(ctx.tables.values())) {
    const stack: string[][] = [[t.id]];
    while (stack.length > 0) {
      const set = stack.pop()!;
      const key = [...set].sort().join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const seats = seatsOf(ctx, set);
      if (seats >= need) {
        out.push({ tableIds: [...set].sort(byName(ctx)), seats, mapId: t.mapId });
        continue;
      }
      if (set.length >= ctx.rules.maxJoinTables) continue;
      const members = new Set(set);
      const next = new Set<string>();
      for (const id of set) {
        ctx.adjacency.get(id)?.forEach((n) => {
          if (!members.has(n)) next.add(n);
        });
      }
      next.forEach((n) => stack.push([...set, n]));
    }
  }
  perParty.set(party, out);
  return out;
}

/**
 * Score a group for a party; null = it lacks a requested mandatory feature
 * (with `strict` off such a feature is just reported missing, for tables a
 * locked booking keeps whatever they lack).
 */
function evaluate(
  ctx: FloorContext,
  booking: Booking,
  group: Group,
  strict = true,
): Omit<TableOption, "freeUntil"> | null {
  const has = new Set<string>();
  for (const id of group.tableIds) {
    for (const tag of ctx.tables.get(id)?.tagIds ?? []) has.add(tag);
  }
  const missingTagIds: string[] = [];
  for (const tag of booking.tagIds) {
    if (has.has(tag)) continue;
    if (strict && ctx.mandatoryTagIds.has(tag)) return null;
    missingTagIds.push(tag);
  }

  const { rules } = ctx;
  const spare = group.seats - booking.partySize;
  let score = 0;
  if (spare < 0) score += W.perSqueezedSeat * -spare;
  else if (spare <= rules.maxSpareSeats) score += W.perSpareSeat * spare;
  else {
    score +=
      W.perSpareSeat * rules.maxSpareSeats +
      W.lastResort +
      W.perLastResortSeat * (spare - rules.maxSpareSeats);
  }
  score += W.perExtraTable * (group.tableIds.length - 1);
  score += W.perMissingTag * missingTagIds.length;
  if (group.tableIds.length > 1) {
    for (const tag of booking.tagIds) {
      if (missingTagIds.includes(tag)) continue;
      for (const id of group.tableIds) {
        if (!ctx.tables.get(id)?.tagIds.includes(tag)) score += W.perTableWithoutTag;
      }
    }
  }
  const otherRoom = booking.mapId !== null && group.mapId !== booking.mapId;
  if (otherRoom) score += W.otherRoom;
  for (const id of group.tableIds) {
    const scarce = (ctx.tables.get(id)?.tagIds ?? []).some(
      (tag) => ctx.mandatoryTagIds.has(tag) && !booking.tagIds.includes(tag),
    );
    if (scarce) score += W.perScarceTable;
  }
  if (
    booking.tableIds.length === group.tableIds.length &&
    group.tableIds.every((id) => booking.tableIds.includes(id))
  ) {
    score += W.keepCurrent;
  }
  return {
    tableIds: group.tableIds,
    seats: group.seats,
    spare,
    missingTagIds,
    otherRoom,
    score,
  };
}

/** Options that fit the party's size and mandatory needs, whatever the time */
function feasibleOptions(
  ctx: FloorContext,
  booking: Booking,
): { options: Omit<TableOption, "freeUntil">[]; reason: NoTableReason | null } {
  const groups = fittingGroups(ctx, booking.partySize);
  if (groups.length === 0) return { options: [], reason: "too_big" };
  const options = groups
    .map((g) => evaluate(ctx, booking, g))
    .filter((o): o is Omit<TableOption, "freeUntil"> => o !== null);
  if (options.length === 0) return { options, reason: "missing_mandatory_tag" };
  const cmp = byName(ctx);
  options.sort((a, b) => a.score - b.score || cmp(a.tableIds[0], b.tableIds[0]));
  return { options, reason: null };
}

/** Every booking's tables but `except`'s, on top of the tables' current state */
export function timelineFor(ctx: FloorContext, except: Set<string>): Timeline {
  const holders = new Map<string, string[]>();
  for (const b of Array.from(ctx.bookings.values())) {
    if (!except.has(b.id) && b.tableIds.length > 0) holders.set(b.id, b.tableIds);
  }
  return new Timeline(ctx, holders);
}

/**
 * The best ways to seat one party at `booking.start`, best first. Tables the
 * booking holds right now don't count as taken (it is being re-seated).
 */
export function suggestTables(
  ctx: FloorContext,
  booking: Booking,
  opts: { timeline?: Timeline; limit?: number } = {},
): { options: TableOption[]; reason: NoTableReason | null } {
  const timeline = opts.timeline ?? timelineFor(ctx, new Set([booking.id]));
  const feasible = feasibleOptions(ctx, booking);
  if (feasible.reason) return { options: [], reason: feasible.reason };

  const [from, to] = holdSpan(booking.start, ctx.rules);
  const limit = opts.limit ?? 5;
  const options: TableOption[] = [];
  for (const o of feasible.options) {
    if (!timeline.isFree(o.tableIds, from, to)) continue;
    options.push({ ...o, freeUntil: timeline.nextStart(o.tableIds, from) });
    if (options.length >= limit) break;
  }
  return { options, reason: options.length > 0 ? null : "all_taken" };
}

export interface Placement {
  bookingId: string;
  option: TableOption;
  /** Tables it held before the plan */
  previousTableIds: string[];
}

export interface Plan {
  /** The bookings asked for, with their tables */
  placed: Placement[];
  /** Other bookings the plan moves to make room (never locked ones) */
  moved: Placement[];
  unplaced: Unplaced[];
}

export interface Unplaced {
  bookingId: string;
  reason: NoTableReason;
  /** Tables it held before the plan */
  previousTableIds: string[];
  /** Still free for it: it simply keeps them. Otherwise the plan gave them away. */
  keepsPrevious: boolean;
}

/** Hardest parties first: big ones, then those with must-have features */
function difficulty(ctx: FloorContext) {
  const mandatory = (b: Booking) =>
    b.tagIds.filter((t) => ctx.mandatoryTagIds.has(t)).length;
  return (a: Booking, b: Booking) =>
    b.partySize - a.partySize ||
    mandatory(b) - mandatory(a) ||
    a.start - b.start ||
    a.name.localeCompare(b.name);
}

/**
 * Tables for every booking in `bookingIds`. Bookings not asked for keep
 * their tables, unless `allowMoves` and one of the asked ones fits nowhere
 * else: then unlocked bookings in its way may be moved to other tables.
 * A locked booking that already has tables keeps them.
 */
export function planAssignments(
  ctx: FloorContext,
  bookingIds: string[],
  opts: { allowMoves: boolean },
): Plan {
  const targets = new Set(bookingIds.filter((id) => ctx.bookings.has(id)));
  // current plan: booking id → tables (targets start without any, unless locked)
  const current = new Map<string, string[]>();
  for (const b of Array.from(ctx.bookings.values())) {
    const keeps = !targets.has(b.id) || (b.locked && b.tableIds.length > 0);
    if (keeps && b.tableIds.length > 0) current.set(b.id, b.tableIds);
  }
  const timeline = new Timeline(ctx, current);
  const chosen = new Map<string, TableOption>();
  const unplaced: Unplaced[] = [];

  const order = Array.from(targets)
    .map((id) => ctx.bookings.get(id)!)
    .sort(difficulty(ctx));

  const place = (id: string, option: TableOption) => {
    timeline.hold(id, option.tableIds);
    current.set(id, option.tableIds);
    chosen.set(id, option);
  };

  const movable = (id: string | null) =>
    id !== null && !(ctx.bookings.get(id)?.locked ?? true);

  // Seat `b` on one of its options by moving the bookings in the way.
  const repair = (b: Booking): boolean => {
    const [from, to] = holdSpan(b.start, ctx.rules);
    const { options } = feasibleOptions(ctx, b);
    for (const o of options.slice(0, REPAIR_TRIES)) {
      const conflicts = timeline.conflicts(o.tableIds, from, to);
      if (!conflicts.every((c) => movable(c.bookingId))) continue;
      const blockers = Array.from(new Set(conflicts.map((c) => c.bookingId!)))
        .map((id) => ctx.bookings.get(id)!)
        .sort(difficulty(ctx));

      for (const x of blockers) timeline.release(x.id);
      timeline.hold(b.id, o.tableIds, b.start);
      const moves = new Map<string, TableOption>();
      for (const x of blockers) {
        const { options: alt } = suggestTables(
          ctx,
          { ...x, tableIds: current.get(x.id) ?? [] },
          { timeline, limit: 1 },
        );
        if (alt.length === 0) break;
        timeline.hold(x.id, alt[0].tableIds);
        moves.set(x.id, alt[0]);
      }
      if (moves.size === blockers.length) {
        timeline.release(b.id);
        place(b.id, { ...o, freeUntil: timeline.nextStart(o.tableIds, from) });
        for (const [id, alt] of Array.from(moves)) {
          current.set(id, alt.tableIds);
          chosen.set(id, alt);
        }
        return true;
      }
      // undo and try the next option
      timeline.release(b.id);
      moves.forEach((_, id) => timeline.release(id));
      for (const x of blockers) timeline.hold(x.id, current.get(x.id)!);
    }
    return false;
  };

  for (const b of order) {
    if (b.locked && b.tableIds.length > 0) {
      // its hold is already on the timeline (it's in `current`)
      const kept = evaluate(
        ctx,
        b,
        {
          tableIds: [...b.tableIds].sort(byName(ctx)),
          seats: seatsOf(ctx, b.tableIds),
          mapId: ctx.tables.get(b.tableIds[0])?.mapId ?? null,
        },
        false,
      )!;
      const [, to] = holdSpan(b.start, ctx.rules);
      chosen.set(b.id, { ...kept, freeUntil: timeline.nextStart(b.tableIds, to) });
      continue;
    }
    const { options, reason } = suggestTables(ctx, b, { timeline, limit: 1 });
    if (options.length > 0) {
      place(b.id, options[0]);
      continue;
    }
    if (reason === "all_taken" && opts.allowMoves && repair(b)) continue;
    // no better seat: it keeps what it had, unless a harder party got there first
    const keepsPrevious =
      b.tableIds.length > 0 &&
      timeline.isFree(b.tableIds, ...holdSpan(b.start, ctx.rules));
    if (keepsPrevious) timeline.hold(b.id, b.tableIds);
    unplaced.push({
      bookingId: b.id,
      reason: reason ?? "all_taken",
      previousTableIds: b.tableIds,
      keepsPrevious,
    });
  }

  const placed: Placement[] = [];
  const moved: Placement[] = [];
  for (const [id, option] of Array.from(chosen)) {
    const previousTableIds = ctx.bookings.get(id)?.tableIds ?? [];
    const entry = { bookingId: id, option, previousTableIds };
    if (targets.has(id)) placed.push(entry);
    else moved.push(entry);
  }
  return { placed, moved, unplaced };
}

/**
 * Who keeps each table from a party sitting at `start`: the booking holding
 * it (null = someone sitting there now, or it's being cleaned). Tables not
 * listed are free for the whole stay. `except`'s own tables don't count.
 */
export function tablesTakenAt(
  ctx: FloorContext,
  start: number,
  except: string | null = null,
): Map<string, string | null> {
  const timeline = timelineFor(ctx, new Set(except ? [except] : []));
  const [from, to] = holdSpan(start, ctx.rules);
  const taken = new Map<string, string | null>();
  ctx.tables.forEach((_, id) => {
    const c = timeline.conflicts([id], from, to);
    if (c.length > 0) taken.set(id, c.find((b) => b.bookingId)?.bookingId ?? null);
  });
  return taken;
}
