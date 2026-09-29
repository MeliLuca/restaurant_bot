// When each table is taken. A party holds its tables for the meal plus the
// buffer before the next one; a table sat right now is taken until its party
// should be done (never earlier than now), a dirty one until it's cleaned.

import type { Booking, FloorContext, FloorTable, SeatRules } from "./types";

const MINUTE = 60_000;

export interface Busy {
  from: number;
  to: number;
  /** The booking holding it; null = the party sitting there now / cleaning */
  bookingId: string | null;
}

/** [start, end) a party starting at `start` keeps its tables from others */
export function holdSpan(start: number, rules: SeatRules): [number, number] {
  return [start, start + (rules.mealMinutes + rules.bufferMinutes) * MINUTE];
}

/** What the table's current state blocks, if anything */
export function currentHold(
  table: FloorTable,
  now: number,
  rules: SeatRules,
): Busy | null {
  if (table.status === "occupied") {
    const due = (table.occupiedAt ?? now) + rules.mealMinutes * MINUTE;
    return {
      from: -Infinity,
      to: Math.max(due, now) + rules.bufferMinutes * MINUTE,
      bookingId: null,
    };
  }
  if (table.status === "dirty") {
    return { from: -Infinity, to: now + rules.bufferMinutes * MINUTE, bookingId: null };
  }
  return null;
}

/**
 * Everything that keeps a table from a new party: its current state and the
 * bookings in `holders` (booking id → the tables it holds).
 */
export class Timeline {
  private busy = new Map<string, Busy[]>();

  constructor(
    private ctx: FloorContext,
    holders: Map<string, string[]>,
  ) {
    for (const t of Array.from(ctx.tables.values())) {
      const hold = currentHold(t, ctx.now, ctx.rules);
      this.busy.set(t.id, hold ? [hold] : []);
    }
    holders.forEach((tableIds, bookingId) => this.hold(bookingId, tableIds));
  }

  private booking(id: string): Booking | undefined {
    return this.ctx.bookings.get(id);
  }

  hold(bookingId: string, tableIds: string[], start?: number) {
    const b = this.booking(bookingId);
    const s = start ?? b?.start;
    if (s === undefined) return;
    const [from, to] = holdSpan(s, this.ctx.rules);
    for (const id of tableIds) this.busy.get(id)?.push({ from, to, bookingId });
  }

  release(bookingId: string) {
    this.busy.forEach((list, id) => {
      this.busy.set(
        id,
        list.filter((b) => b.bookingId !== bookingId),
      );
    });
  }

  /** What blocks these tables during [from, to) */
  conflicts(tableIds: string[], from: number, to: number): Busy[] {
    const out: Busy[] = [];
    for (const id of tableIds) {
      for (const b of this.busy.get(id) ?? []) {
        if (b.from < to && from < b.to) out.push(b);
      }
    }
    return out;
  }

  isFree(tableIds: string[], from: number, to: number): boolean {
    return this.conflicts(tableIds, from, to).length === 0;
  }

  /** When the next party is due on any of these tables after `after`, null = none */
  nextStart(tableIds: string[], after: number): number | null {
    let next: number | null = null;
    for (const id of tableIds) {
      for (const b of this.busy.get(id) ?? []) {
        if (b.from >= after && (next === null || b.from < next)) next = b.from;
      }
    }
    return next;
  }
}
