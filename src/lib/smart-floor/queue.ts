// The waitlist ("coda"): parties waiting at the door, first come first
// served. Each one, in arrival order, gets the best table still unclaimed:
// free now, else one to clear, else one about to free up. A table the first
// party doesn't fit goes to the next one it fits. A party skipped for now
// ("not at the door") claims nothing until its skip runs out.

import type { FloorContext, NoTableReason } from "./types";
import {
  findWalkInSeats,
  type FinishSignal,
  type WalkInOption,
} from "./walk-in";

/** "Salta per ora": the party isn't at the door, the next one gets the table */
export const QUEUE_SKIP_MINUTES = 10;

export interface QueueParty {
  id: string;
  name: string;
  partySize: number;
  tagIds: string[];
  mapId: string | null;
  /** When it joined the queue (ms) */
  joinedAt: number;
  /** Skipped until then (ms), null = in line */
  skipUntil: number | null;
}

export interface QueueMatch {
  /** 1 = first in line */
  position: number;
  /** The table it gets now or next; null = nothing fits yet */
  option: WalkInOption | null;
  /** Skipped for now: claims nothing */
  skipped: boolean;
  /** Why nothing fits (too big, a must-have feature no table has…) */
  reason: NoTableReason | null;
}

/** Arrival order: who came first is served first */
export function queueOrder(parties: QueueParty[]): QueueParty[] {
  return [...parties].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

export function matchQueue(
  ctx: FloorContext,
  parties: QueueParty[],
  finishing: Map<string, FinishSignal>,
): Map<string, QueueMatch> {
  const claimed = new Set<string>();
  const out = new Map<string, QueueMatch>();
  queueOrder(parties).forEach((p, i) => {
    const position = i + 1;
    if (p.skipUntil !== null && p.skipUntil > ctx.now) {
      out.set(p.id, { position, option: null, skipped: true, reason: null });
      return;
    }
    const r = findWalkInSeats(
      ctx,
      { partySize: p.partySize, tagIds: p.tagIds, mapId: p.mapId },
      finishing,
      { limit: 1, exclude: claimed },
    );
    const option = r.free[0] ?? r.dirty[0] ?? r.finishing[0] ?? null;
    option?.tableIds.forEach((id) => claimed.add(id));
    out.set(p.id, { position, option, skipped: false, reason: option ? null : r.reason });
  });
  return out;
}

/** Tables the queue has claimed: not for walk-ins who just came in */
export function claimedTables(
  matches: Map<string, QueueMatch>,
): Map<string, string> {
  const byTable = new Map<string, string>();
  matches.forEach((m, partyId) => {
    m.option?.tableIds.forEach((id) => byTable.set(id, partyId));
  });
  return byTable;
}

/** Parties whose table is ready now (free, or just to clear): call them */
export function readyParties(
  parties: QueueParty[],
  matches: Map<string, QueueMatch>,
): { party: QueueParty; option: WalkInOption }[] {
  const out: { party: QueueParty; option: WalkInOption }[] = [];
  for (const p of queueOrder(parties)) {
    const option = matches.get(p.id)?.option;
    if (option && option.state !== "finishing") out.push({ party: p, option });
  }
  return out;
}
