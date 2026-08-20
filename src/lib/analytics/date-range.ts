import {
  SERVICE_DAY_START_HOUR,
  currentServiceDayStart,
  serviceDayEnd,
} from "@/lib/stats-api";

export type RangePreset = "last7" | "last30" | "last90" | "thisMonth" | "custom";

/** Both boundaries are 6 AM service-day starts; `end` is exclusive. */
export interface ServiceDateRange {
  start: Date;
  end: Date;
}

export const MAX_RANGE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the service day containing `d` (6 AM rule). */
export function serviceDayOf(d: Date): Date {
  return currentServiceDayStart(d);
}

export function rangeFromPreset(
  preset: Exclude<RangePreset, "custom">,
  now: Date = new Date(),
): ServiceDateRange {
  const todayStart = currentServiceDayStart(now);
  const end = serviceDayEnd(todayStart);
  if (preset === "thisMonth") {
    const start = new Date(todayStart);
    start.setDate(1);
    start.setHours(SERVICE_DAY_START_HOUR, 0, 0, 0);
    return { start, end };
  }
  const days = preset === "last7" ? 7 : preset === "last30" ? 30 : 90;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start, end };
}

/**
 * Range from two calendar dates picked in <input type="date"> (YYYY-MM-DD).
 * Snaps both to 6 AM; the end day is inclusive, so its exclusive boundary is
 * the next service-day start. Clamped to MAX_RANGE_DAYS.
 */
export function customRange(startDay: string, endDay: string): ServiceDateRange {
  const start = new Date(`${startDay}T00:00:00`);
  start.setHours(SERVICE_DAY_START_HOUR, 0, 0, 0);
  const endStart = new Date(`${endDay}T00:00:00`);
  endStart.setHours(SERVICE_DAY_START_HOUR, 0, 0, 0);
  let end = serviceDayEnd(endStart);
  if (end <= start) end = serviceDayEnd(start);
  if (rangeDays({ start, end }) > MAX_RANGE_DAYS) {
    end = new Date(start.getTime() + MAX_RANGE_DAYS * DAY_MS);
  }
  return { start, end };
}

/** Same-length window immediately before `range`, for period comparison. */
export function previousPeriod(range: ServiceDateRange): ServiceDateRange {
  const days = rangeDays(range);
  const start = new Date(range.start);
  start.setDate(start.getDate() - days);
  return { start, end: range.start };
}

export function rangeDays(range: ServiceDateRange): number {
  return Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS));
}
