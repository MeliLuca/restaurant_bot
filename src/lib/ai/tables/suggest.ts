// Assistente AI — tables: the choice itself, straight from the Gestione
// Sala Smart engine (lib/smart-floor), wired exactly like the Sala does it.
// No model here: every table, minute and reason is computed.
//
// * now (a party at the door): the "Trova posto" finder — free, to clean,
//   about to leave (pre-conto, dessert, seated longer than a meal) — with
//   the tables the waitlist claimed kept out, like the Sala's finder.
// * a later time: suggestTables with a probe booking, on the same timeline
//   the reservation form uses.
// The smart-floor settings are read even when the module is switched off.

import { fetchFloorMaps, compareTableNames } from "@/lib/floor/maps";
import { fetchTableLinks } from "@/lib/floor/links";
import { fetchTableTags } from "@/lib/settings-api";
import type { TableTag } from "@/lib/database.types";
import { suggestTables } from "@/lib/smart-floor/assign";
import { buildFloorContext, type FloorSnapshot } from "@/lib/smart-floor/context";
import { fetchFloorSnapshot, fetchOpenBills } from "@/lib/smart-floor/data";
import { UPCOMING_MINUTES } from "@/lib/smart-floor/overlay";
import { claimedTables, matchQueue } from "@/lib/smart-floor/queue";
import type {
  Booking,
  FloorContext,
  NoTableReason,
  TableOption,
} from "@/lib/smart-floor/types";
import { fetchWaitlist, toQueueParty } from "@/lib/smart-floor/waitlist-api";
import {
  findWalkInSeats,
  finishingSignalOf,
  finishingSignals,
  type FinishSignal,
  type WalkIn,
  type WalkInOption,
} from "@/lib/smart-floor/walk-in";
import type { TableSuggestion } from "@/lib/ai/contracts/tables";
import type { TablesVocabulary } from "./extract";

const MINUTE = 60_000;
/** Same as useWaitlist: a party still "waiting" after this long is stale */
const WAITLIST_STALE_HOURS = 12;
/** The id of the party being looked for (never a real reservation) */
export const PROBE_ID = "ai-probe";

export interface Computed {
  options: TableSuggestion[];
  reason: string | null;
  notes: string[];
}

/** Every table feature, and the rooms a party can ask for */
export async function loadVocabulary(): Promise<TablesVocabulary & { allMapIds: Set<string> }> {
  const [tags, maps] = await Promise.all([fetchTableTags(), fetchFloorMaps()]);
  return {
    tags,
    maps: maps.filter((m) => m.bookable),
    allMapIds: new Set(maps.map((m) => m.id)),
  };
}

// --- words -----------------------------------------------------------------

const clock = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
export const timeText = (ms: number) => clock.format(new Date(ms));

/** 12' · 1h50 · 3 giorni */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}'`;
  if (m < 24 * 60) {
    const rest = m % 60;
    return `${Math.floor(m / 60)}h${rest === 0 ? "" : String(rest).padStart(2, "0")}`;
  }
  const days = Math.floor(m / (24 * 60));
  return days === 1 ? "1 giorno" : `${days} giorni`;
}

const namesOf = (ctx: FloorContext, ids: string[]) =>
  ids.map((id) => ctx.tables.get(id)?.name ?? "?").sort(compareTableNames);

interface Words {
  ctx: FloorContext;
  tags: TableTag[];
  mapName: (id: string | null) => string | null;
}

/** What's less than perfect (same notes as the reservation form) */
function optionNotes(w: Words, booking: Booking, o: TableOption): string[] {
  const notes: string[] = [];
  if (o.tableIds.length > 1) notes.push(`${o.tableIds.length} tavoli uniti`);
  if (o.spare < 0) notes.push(`stretti: +${-o.spare} rispetto ai posti`);
  else if (o.spare > w.ctx.rules.maxSpareSeats) notes.push(`${o.spare} posti vuoti`);
  if (o.missingTagIds.length > 0) {
    const names = o.missingTagIds.map((id) => w.tags.find((t) => t.id === id)?.name ?? "?");
    notes.push(`senza ${names.join(", ")}`);
  }
  if (o.otherRoom) {
    const room = w.mapName(w.ctx.tables.get(o.tableIds[0])?.mapId ?? null) ?? "?";
    notes.push(`in ${room} (preferita: ${w.mapName(booking.mapId) ?? "?"})`);
  }
  return notes;
}

/** For "overtime" the signal's time is when the party (all its linked tables) sat */
function finishText(w: Words, s: FinishSignal, now: number): string {
  const since = (now - s.at) / MINUTE;
  switch (s.kind) {
    case "preconto":
      return `pre-conto da ${durationText(since)}`;
    case "dessert":
      return `al dolce da ${durationText(since)}`;
    default:
      return `seduti da ${durationText(since)}, oltre la durata media (${durationText(w.ctx.rules.mealMinutes)})`;
  }
}

/** Since when the party at these (taken) tables sits: the earliest of them */
function seatedSince(ctx: FloorContext, ids: string[]): number | null {
  const sat = ids
    .map((id) => ctx.tables.get(id)?.occupiedAt ?? null)
    .filter((x): x is number => x !== null);
  return sat.length > 0 ? Math.min(...sat) : null;
}

/** Engine's "why nothing" in words (like the finder and the form) */
export function noTableText(
  w: Words,
  reason: NoTableReason,
  booking: Booking,
  at: number | null,
): string {
  switch (reason) {
    case "too_big":
      return `Nessun tavolo, nemmeno unendoli, basta per ${booking.partySize} persone.`;
    case "missing_mandatory_tag": {
      const names = booking.tagIds
        .filter((id) => w.ctx.mandatoryTagIds.has(id))
        .map((id) => w.tags.find((t) => t.id === id)?.name ?? "?");
      return `Nessun tavolo abbastanza grande ha ${names.join(", ")}.`;
    }
    default: {
      if (at !== null) return `Alle ${timeText(at)} i tavoli adatti sono tutti presi.`;
      const room = booking.mapId ? w.mapName(booking.mapId) : null;
      return room
        ? `Adesso in ${room} nessun tavolo adatto è libero, da pulire o sta per liberarsi.`
        : "Adesso nessun tavolo adatto è libero, da pulire o sta per liberarsi.";
    }
  }
}

// --- now (walk-in) -----------------------------------------------------------

export interface NowFloor {
  snap: FloorSnapshot;
  ctx: FloorContext;
  finishing: Map<string, FinishSignal>;
  /** Tables the waitlist claimed → the party's name */
  claims: Map<string, string>;
}

/** The floor as the Sala's finder sees it at `now` */
export async function loadNowFloor(now: number): Promise<NowFloor> {
  const snap = await fetchFloorSnapshot(new Date(now));
  const ctx = buildFloorContext(snap, now);
  const [bills, links, waitlist] = await Promise.all([
    fetchOpenBills(snap.settings.finishing_category_ids),
    fetchTableLinks(),
    fetchWaitlist(new Date(now - WAITLIST_STALE_HOURS * 3_600_000)),
  ]);
  const finishing = finishingSignals(
    Array.from(ctx.tables.values()),
    bills,
    links,
    ctx.rules,
    ctx.now,
  );
  const matches = matchQueue(ctx, waitlist.map(toQueueParty), finishing);
  const names = new Map(waitlist.map((e) => [e.id, e.customer_name]));
  const claims = new Map<string, string>();
  claimedTables(matches).forEach((partyId, tableId) =>
    claims.set(tableId, names.get(partyId) ?? "?"),
  );
  return { snap, ctx, finishing, claims };
}

const KIND_OF = { free: "free", dirty: "dirty", finishing: "finishing" } as const;

function walkInSuggestion(w: Words, booking: Booking, o: WalkInOption): TableSuggestion {
  const { ctx } = w;
  const now = ctx.now;
  const parts: string[] = [];

  if (o.state === "free") parts.push(o.leaveBy === null ? "libero tutta la sera" : "libero");
  if (o.finishing.length > 0) {
    // tables linked together share one signal: say it once
    const byText = new Map<string, string[]>();
    for (const f of o.finishing) {
      const text = finishText(w, f.signal, now);
      byText.set(text, [...(byText.get(text) ?? []), f.tableId]);
    }
    byText.forEach((ids, text) => {
      const named = o.tableIds.length > 1 && ids.length < o.tableIds.length;
      parts.push(named ? `${namesOf(ctx, ids).join(" + ")}: ${text}` : text);
    });
  }
  if (o.dirtyIds.length > 0) {
    parts.push(
      o.dirtyIds.length === o.tableIds.length
        ? "da pulire"
        : `da pulire: ${namesOf(ctx, o.dirtyIds).join(" + ")}`,
    );
  }
  parts.push(...optionNotes(w, booking, o));
  if (o.leaveBy !== null && o.freeUntil !== null) {
    const who = o.nextBooking?.name ?? "?";
    parts.push(
      o.shortStay
        ? `solo fino alle ${timeText(o.leaveBy)}: alle ${timeText(o.freeUntil)} arriva ${who}`
        : `prenotato alle ${timeText(o.freeUntil)} (${who}): da lasciare entro le ${timeText(o.leaveBy)}`,
    );
  }

  const signal = finishingSignalOf(o);
  const sat =
    signal?.kind === "overtime"
      ? signal.at
      : seatedSince(ctx, o.finishing.map((f) => f.tableId));
  const mapId = ctx.tables.get(o.tableIds[0])?.mapId ?? null;
  return {
    tableIds: o.tableIds,
    tableNames: namesOf(ctx, o.tableIds),
    seats: o.seats,
    mapId,
    mapName: w.mapName(mapId),
    kind: KIND_OF[o.state],
    reason: parts.join(" · "),
    finishing: signal
      ? {
          kind: signal.kind,
          minutesSeated: Math.floor((now - (sat ?? signal.at)) / MINUTE),
          minutesSince: Math.floor((now - signal.at) / MINUTE),
        }
      : null,
    leaveBy: o.leaveBy === null ? null : new Date(o.leaveBy).toISOString(),
  };
}

const wordsFor = (snap: FloorSnapshot, ctx: FloorContext): Words => ({
  ctx,
  tags: snap.tags,
  mapName: (id) => (id === null ? null : snap.maps.find((m) => m.id === id)?.name ?? null),
});

/** Where a party walking in now can sit: free, then to clean, then finishing */
export function suggestNowFrom(floor: NowFloor, walkIn: WalkIn): Computed {
  const { ctx, snap, finishing, claims } = floor;
  const w = wordsFor(snap, ctx);
  const result = findWalkInSeats(ctx, walkIn, finishing, {
    exclude: new Set(Array.from(claims.keys())),
  });
  const booking: Booking = {
    id: PROBE_ID,
    name: "",
    partySize: walkIn.partySize,
    start: ctx.now,
    tagIds: walkIn.tagIds,
    mapId: walkIn.mapId,
    tableIds: [],
    locked: false,
  };
  const options = [...result.free, ...result.dirty, ...result.finishing].map((o) =>
    walkInSuggestion(w, booking, o),
  );

  const notes: string[] = [];
  // "Tenuti per la coda: Rossi: 12 · Bianchi: 8 + 9"
  const held = new Map<string, string[]>();
  claims.forEach((name, tableId) => held.set(name, [...(held.get(name) ?? []), tableId]));
  if (held.size > 0) {
    notes.push(
      `Tenuti per la coda: ${Array.from(held)
        .map(([name, ids]) => `${name}: ${namesOf(ctx, ids).join(" + ")}`)
        .join(" · ")}`,
    );
  }
  // bookings due soon with no table yet: seating walk-ins takes their room
  const unassigned = snap.reservations.filter((r) => {
    if (r.status !== "booked" || r.table_ids.length > 0) return false;
    const start = Date.parse(r.reserved_at);
    return start >= ctx.now - 30 * MINUTE && start - ctx.now <= UPCOMING_MINUTES * MINUTE;
  }).length;
  if (unassigned > 0) {
    notes.push(
      `Prenotazioni delle prossime 2 ore ancora senza tavolo: ${unassigned}. Lascia loro posto.`,
    );
  }

  return {
    options,
    reason: result.reason ? noTableText(w, result.reason, booking, null) : null,
    notes,
  };
}

// --- later (booking) ---------------------------------------------------------

export interface BookingFloor {
  snap: FloorSnapshot;
  ctx: FloorContext;
}

/** The floor of the day of `start`, as the reservation form builds it */
export async function loadBookingFloor(start: number, now: number): Promise<BookingFloor> {
  const snap = await fetchFloorSnapshot(new Date(start));
  return { snap, ctx: buildFloorContext(snap, now) };
}

export const probeBooking = (walkIn: WalkIn, start: number): Booking => ({
  id: PROBE_ID,
  name: "",
  partySize: walkIn.partySize,
  start,
  tagIds: walkIn.tagIds,
  mapId: walkIn.mapId,
  tableIds: [],
  locked: false,
});

/** The best tables to book for that party at `start` (the form's suggestions) */
export function suggestBookingFrom(floor: BookingFloor, walkIn: WalkIn, start: number): Computed {
  const { ctx, snap } = floor;
  const w = wordsFor(snap, ctx);
  const booking = probeBooking(walkIn, start);
  const { options, reason } = suggestTables(ctx, booking, { limit: 5 });
  const buffer = ctx.rules.bufferMinutes * MINUTE;
  return {
    options: options.map((o) => {
      const parts = [`prenotabile alle ${timeText(start)}`, ...optionNotes(w, booking, o)];
      if (o.freeUntil === null) parts.push("libero tutta la sera");
      else {
        const next = Array.from(ctx.bookings.values()).find(
          (b) => b.start === o.freeUntil && b.tableIds.some((id) => o.tableIds.includes(id)),
        );
        parts.push(
          `poi prenotato alle ${timeText(o.freeUntil)}${next ? ` (${next.name})` : ""}: da lasciare entro le ${timeText(o.freeUntil - buffer)}`,
        );
      }
      const mapId = ctx.tables.get(o.tableIds[0])?.mapId ?? null;
      return {
        tableIds: o.tableIds,
        tableNames: namesOf(ctx, o.tableIds),
        seats: o.seats,
        mapId,
        mapName: w.mapName(mapId),
        kind: "booking" as const,
        reason: parts.join(" · "),
        finishing: null,
        leaveBy: o.freeUntil === null ? null : new Date(o.freeUntil - buffer).toISOString(),
      };
    }),
    reason: reason ? noTableText(w, reason, booking, start) : null,
    notes: [],
  };
}
