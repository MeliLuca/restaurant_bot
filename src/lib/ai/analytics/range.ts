// Assistente AI — analytics: the request body of both routes, hand-checked.
// SERVER ONLY (the server's local clock is the venue's: service days are
// 6:00 → 6:00 local time, like /analytics).

import { SERVICE_DAY_START_HOUR } from "@/lib/stats-api";
import { rangeDays, type ServiceDateRange } from "@/lib/analytics/date-range";

export const MAX_ANALYTICS_DAYS = 366;

export interface ParsedRange {
  from: string;
  to: string;
  range: ServiceDateRange;
  weekday: number | null;
  categoryId: string | null;
  insights: boolean;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 6 AM of a "YYYY-MM-DD" day, or null when it isn't a real date */
function dayStart(day: unknown): Date | null {
  if (typeof day !== "string" || !DAY_RE.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d, SERVICE_DAY_START_HOUR);
  // 2026-02-30 rolls over to March: reject it
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : null;
}

export function parseRangeRequest(
  body: Record<string, unknown> | null,
): { ok: true; value: ParsedRange } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "A JSON body is required" };
  const start = dayStart(body.from);
  const toStart = dayStart(body.to);
  if (!start || !toStart) {
    return { ok: false, error: "from and to must be dates as YYYY-MM-DD" };
  }
  if (toStart < start) return { ok: false, error: "from must not be after to" };
  const end = new Date(toStart);
  end.setDate(end.getDate() + 1);
  const range = { start, end };
  if (rangeDays(range) > MAX_ANALYTICS_DAYS) {
    return { ok: false, error: `The range may span at most ${MAX_ANALYTICS_DAYS} days` };
  }

  let weekday: number | null = null;
  if (body.weekday !== undefined && body.weekday !== null) {
    if (!Number.isInteger(body.weekday) || (body.weekday as number) < 0 || (body.weekday as number) > 6) {
      return { ok: false, error: "weekday must be an integer 0 (Sunday) … 6 (Saturday)" };
    }
    weekday = body.weekday as number;
  }

  let categoryId: string | null = null;
  if (body.categoryId !== undefined && body.categoryId !== null) {
    if (typeof body.categoryId !== "string" || !body.categoryId.trim()) {
      return { ok: false, error: "categoryId must be a non-empty string" };
    }
    categoryId = body.categoryId;
  }

  if (body.insights !== undefined && typeof body.insights !== "boolean") {
    return { ok: false, error: "insights must be a boolean" };
  }

  return {
    ok: true,
    value: {
      from: body.from as string,
      to: body.to as string,
      range,
      weekday,
      categoryId,
      insights: body.insights !== false,
    },
  };
}
