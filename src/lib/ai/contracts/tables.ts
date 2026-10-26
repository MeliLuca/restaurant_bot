// Assistente AI — contract of the TABLES task (owned by the tables task).
//   POST /api/ai/tables/suggest   party size (+ time) → best tables
// The choice comes from the Gestione Sala Smart engine (lib/smart-floor):
// free now / to clean / about to leave (pre-conto, dessert, seated longer than
// a meal) for "now", suggestTables for a later time. The model only reads the
// request text and explains the pick.
import type { AiMeta } from "./common";

/** Biggest party the endpoint accepts */
export const TABLES_MAX_PARTY = 60;
/** A time this close to now (either side) is "now": a walk-in */
export const TABLES_NOW_MINUTES = 15;

export interface TableSuggestRequest {
  /** free text ("4 persone alle 21, una carrozzina")… */
  text?: string;
  /** …or the pieces directly (they win over the text) */
  partySize?: number;
  /** "HH:MM" (today, or tomorrow when already past) or an ISO datetime;
   * absent = from the text, else now (walk-in) */
  time?: string;
  /** table_tags ids */
  tagIds?: string[];
  /** floor_maps id; null = anywhere */
  mapId?: string | null;
}

/** now = a party at the door (walk-in finder); booking = a later time */
export type TableSuggestMode = "now" | "booking";

export type TableSuggestionKind = "free" | "dirty" | "finishing" | "booking";

export interface TableSuggestion {
  /** sorted by table name */
  tableIds: string[];
  tableNames: string[];
  /** seats of the group, join bonus included */
  seats: number;
  mapId: string | null;
  mapName: string | null;
  kind: TableSuggestionKind;
  /** deterministic Italian one-liner ("libero tutta la sera", "pre-conto da 12'",
   * "seduti da 1h50, oltre la durata media (1h45)") */
  reason: string;
  /** finishing only: why it should free up soon (the weakest of its tables) */
  finishing: {
    kind: "preconto" | "dessert" | "overtime";
    /** since the party sat down */
    minutesSeated: number;
    /** since the signal (pre-conto printed / first dessert / sat down) */
    minutesSince: number;
  } | null;
  /** must leave by (next booking − buffer), ISO; null = no limit */
  leaveBy: string | null;
}

export interface TableSuggestResponse {
  /** what was understood (explicit fields, else the text) */
  request: {
    partySize: number;
    /** ISO start for a booking; null = now */
    time: string | null;
    tagIds: string[];
    mapId: string | null;
    mode: TableSuggestMode;
  };
  /** best first: free, then to clean, then finishing (now); engine order (booking) */
  options: TableSuggestion[];
  /** engine's reason when nothing fits (Italian) */
  reason: string | null;
  /** deterministic Italian side notes: tables held for the waitlist, bookings
   * due soon still without a table */
  notes: string[];
  /** model's short explanation of the best option (null when unavailable) */
  explanation: string | null;
  /** the model calls of this answer, summed; null = none succeeded */
  ai: AiMeta | null;
}
