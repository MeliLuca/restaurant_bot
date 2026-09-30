import type { Reservation } from "@/lib/database.types";

/**
 * Minutes a booked party is past its time (0 on the minute itself), or null
 * when it isn't due yet or is no longer waited for (seated, cancelled…).
 * Shared by the reservations list and the nav badge.
 */
export function minutesLate(
  r: Pick<Reservation, "status" | "reserved_at">,
  now: number,
): number | null {
  if (r.status !== "booked") return null;
  const start = Date.parse(r.reserved_at);
  return start <= now ? Math.floor((now - start) / 60_000) : null;
}
