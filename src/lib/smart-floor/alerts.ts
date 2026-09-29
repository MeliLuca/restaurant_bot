// The alerts Gestione Sala Smart raises about booked parties (for whoever has
// floor_alerts): late beyond "prenotazione in ritardo dopo", or due soon while
// a table of theirs is still occupied. Nothing is ever released on its own.

import type { Reservation, TableStatus } from "@/lib/database.types";

const MINUTE = 60_000;

/** "Aspetta" on a late party: ask again after this long */
export const LATE_SNOOZE_MINUTES = 10;

export type FloorAlertKind = "late" | "occupied";

export interface FloorAlert {
  kind: FloorAlertKind;
  reservation: Reservation;
  /** Minutes past the booking time; negative = due in that many */
  lateMinutes: number;
  /** Its tables occupied right now (by someone else: it isn't seated) */
  occupiedTableIds: string[];
}

export function floorAlerts(
  reservations: Reservation[],
  tableStatus: Map<string, TableStatus>,
  settings: { late_after_minutes: number; occupied_warn_minutes: number },
  now: number,
): FloorAlert[] {
  const alerts: FloorAlert[] = [];
  for (const r of reservations) {
    if (r.status !== "booked" || r.table_ids.length === 0) continue;
    if (r.alert_snoozed_until && Date.parse(r.alert_snoozed_until) > now) continue;
    const start = Date.parse(r.reserved_at);
    const lateMinutes = Math.floor((now - start) / MINUTE);
    const occupiedTableIds = r.table_ids.filter(
      (id) => tableStatus.get(id) === "occupied",
    );
    if (lateMinutes >= settings.late_after_minutes) {
      alerts.push({ kind: "late", reservation: r, lateMinutes, occupiedTableIds });
    } else if (
      occupiedTableIds.length > 0 &&
      start - now <= settings.occupied_warn_minutes * MINUTE
    ) {
      alerts.push({ kind: "occupied", reservation: r, lateMinutes, occupiedTableIds });
    }
  }
  return alerts.sort(
    (a, b) => Date.parse(a.reservation.reserved_at) - Date.parse(b.reservation.reserved_at),
  );
}

/**
 * Until when "Aspetta" silences an alert: a late party is asked about again
 * in a few minutes; an occupied table is left alone until the party is due.
 */
export function snoozeUntil(alert: FloorAlert, now: number): Date {
  if (alert.kind === "occupied") {
    const due = Date.parse(alert.reservation.reserved_at);
    if (due > now) return new Date(due);
  }
  return new Date(now + LATE_SNOOZE_MINUTES * MINUTE);
}
