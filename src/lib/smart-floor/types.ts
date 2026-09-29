// The assignment engine's own view of the floor. Plain numbers and ids, no
// Supabase rows: build it with buildFloorContext (context.ts) and every
// function in the engine stays pure and testable against a snapshot.

import type { Geom } from "@/lib/floor/geometry";
import type { SmartFloorSettings, TableStatus } from "@/lib/database.types";

/** The module's knobs the engine reads (see smart_floor_settings) */
export interface SeatRules {
  mealMinutes: number;
  bufferMinutes: number;
  /** Guests beyond the seat count still accepted (9 on an 8) */
  overfillSeats: number;
  /** Empty seats that are fine; more makes a table a last resort */
  maxSpareSeats: number;
  /** Seats gained at each join of pushed-together tables */
  joinBonusSeats: number;
  /** Outline gap (map units) under which two tables can be joined */
  joinDistance: number;
  maxJoinTables: number;
}

export function rulesFrom(s: SmartFloorSettings): SeatRules {
  return {
    mealMinutes: s.meal_minutes,
    bufferMinutes: s.buffer_minutes,
    overfillSeats: s.overfill_seats,
    maxSpareSeats: s.max_spare_seats,
    joinBonusSeats: s.join_bonus_seats,
    joinDistance: s.join_distance,
    maxJoinTables: s.max_join_tables,
  };
}

export interface FloorTable {
  id: string;
  name: string;
  capacity: number;
  status: TableStatus;
  /** Room it is drawn in; null = not on any map (can't be joined) */
  mapId: string | null;
  geom: Geom | null;
  /** Zone inside its room; tables of different zones never join */
  zoneId: string | null;
  tagIds: string[];
  /** When it was sat (ms), if occupied */
  occupiedAt: number | null;
}

/** A party that holds (or wants) tables: a reservation or a walk-in */
export interface Booking {
  id: string;
  name: string;
  partySize: number;
  /** When the party sits down (ms) */
  start: number;
  /** Requested features; mandatory ones are hard constraints */
  tagIds: string[];
  /** Preferred room, null = anywhere */
  mapId: string | null;
  /** Tables it holds now ([] = not assigned) */
  tableIds: string[];
  /** Never moved to make room for another booking */
  locked: boolean;
}

export interface FloorContext {
  now: number;
  rules: SeatRules;
  tables: Map<string, FloorTable>;
  mandatoryTagIds: Set<string>;
  /** table id → tables it can be pushed together with */
  adjacency: Map<string, Set<string>>;
  /** Upcoming reservations still to be seated ("booked") */
  bookings: Map<string, Booking>;
}

/** Why a party could not be placed */
export type NoTableReason =
  /** no table or joinable group is big enough, whatever the time */
  | "too_big"
  /** big enough ones exist, but none has a requested mandatory feature */
  | "missing_mandatory_tag"
  /** fitting tables exist, all taken at that time */
  | "all_taken";

/** One way of seating a party */
export interface TableOption {
  /** Sorted by table name */
  tableIds: string[];
  /** Seats including the join bonus */
  seats: number;
  /** seats − party: negative = squeezed in, above maxSpareSeats = last resort */
  spare: number;
  /** Requested preferences no table of the group has */
  missingTagIds: string[];
  /** Not in the room the booking prefers */
  otherRoom: boolean;
  /** Lower is better */
  score: number;
  /** When the next party is due on any of these tables (ms), null = free all night */
  freeUntil: number | null;
}
