import { geomOf } from "@/lib/floor/maps";
import type {
  FloorMap,
  Reservation,
  SmartFloorSettings,
  TableJoinRule,
  TableTag,
} from "@/lib/database.types";
import type { TableWithTags } from "@/lib/settings-api";
import { buildAdjacency } from "./adjacency";
import { mapBarriers } from "./barriers";
import {
  rulesFrom,
  type Booking,
  type FloorContext,
  type FloorTable,
} from "./types";

export interface FloorSnapshot {
  settings: SmartFloorSettings;
  tables: TableWithTags[];
  /** Every table feature, for which ones are mandatory */
  tags: TableTag[];
  /** The service's reservations; only "booked" ones hold tables */
  reservations: Reservation[];
  joinRules: TableJoinRule[];
  /** The rooms, for the lines and dividers that keep tables apart */
  maps: FloorMap[];
}

export function reservationToBooking(r: Reservation): Booking {
  return {
    id: r.id,
    name: r.customer_name,
    partySize: r.party_size,
    start: Date.parse(r.reserved_at),
    tagIds: r.tag_ids,
    mapId: r.map_id,
    tableIds: r.table_ids,
    locked: r.locked,
  };
}

export function toFloorTable(t: TableWithTags): FloorTable {
  return {
    id: t.id,
    name: t.name,
    capacity: t.capacity,
    status: t.status,
    mapId: t.map_id,
    geom: t.map_id && t.x !== null ? geomOf(t) : null,
    zoneId: t.zone_id,
    tagIds: t.table_tags.map((tag) => tag.id),
    occupiedAt: t.occupied_at ? Date.parse(t.occupied_at) : null,
    closed: false,
  };
}

/** The engine's view of the floor at `now` */
export function buildFloorContext(
  snap: FloorSnapshot,
  now: number = Date.now(),
): FloorContext {
  const rules = rulesFrom(snap.settings);
  // tables of a room closed to bookings stay known (bookings already on
  // them keep their hold) but are never offered
  const closedMaps = new Set(snap.maps.filter((m) => !m.bookable).map((m) => m.id));
  const tables = snap.tables.map((t) => ({
    ...toFloorTable(t),
    closed: t.map_id !== null && closedMaps.has(t.map_id),
  }));
  return {
    now,
    rules,
    tables: new Map(tables.map((t) => [t.id, t])),
    mandatoryTagIds: new Set(snap.tags.filter((t) => t.is_mandatory).map((t) => t.id)),
    adjacency: buildAdjacency(
      tables,
      rules.joinDistance,
      snap.joinRules,
      mapBarriers(snap.maps),
    ),
    bookings: new Map(
      snap.reservations
        .filter((r) => r.status === "booked")
        .map((r) => [r.id, reservationToBooking(r)]),
    ),
  };
}
