/**
 * Take-away time slots: the grid of pickup times offered everywhere a
 * take-away is created, listed or re-timed.
 *
 * One module because the grid has to be identical in all three places. If the
 * new-order dialog offered 19:45 and the list bucketed by half hours, the
 * kitchen load shown next to a time would not be the load of the time you
 * picked, and every capacity number built on top would be quietly wrong.
 *
 * Times are formatted 24h by hand rather than through Intl: the service runs on
 * a wall clock, "8:00 PM" is not how anyone here says it, and the two existing
 * hard-coded `en-US` formatters are the bug this avoids repeating.
 */

export interface SlotConfig {
  /** Width of one slot in minutes — the grid's step */
  slotMinutes: number;
  /** First pickup offered, "HH:mm" */
  serviceStart: string;
  /** End of service, "HH:mm", exclusive: the last slot starts before it */
  serviceEnd: string;
}

/**
 * Used until Settings → Take-away can override it (phase 3). Deliberately a
 * plain evening service rather than something clever: a wrong-but-obvious
 * default is edited on day one, a wrong-but-subtle one survives for months.
 */
export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  slotMinutes: 30,
  serviceStart: "18:30",
  serviceEnd: "23:00",
};

export interface Slot {
  /** Stable identity for lists and comparisons: the slot start as ISO */
  key: string;
  at: Date;
  /** "20:30" */
  label: string;
  /** Already gone — still rendered, so the grid doesn't reflow through service */
  isPast: boolean;
}

const MINUTE = 60_000;

/** "18:30" → 1110 minutes past midnight; null when unparseable */
export function parseHHmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 1110 → "18:30" */
export function formatHHmm(minutesPastMidnight: number): string {
  const wrapped = ((minutesPastMidnight % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A timestamp as wall-clock "20:30" */
export function formatTime(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function atMinutesOfDay(base: Date, minutes: number): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + minutes * MINUTE);
}

/**
 * Tonight's grid.
 *
 * `now` only decides which slots read as past — never which ones exist. A grid
 * that shrinks as the evening goes on would move the chip under the waiter's
 * thumb between the moment they look and the moment they tap.
 */
export function buildSlots(
  config: SlotConfig = DEFAULT_SLOT_CONFIG,
  now: Date = new Date(),
): Slot[] {
  const step = Math.max(5, Math.round(config.slotMinutes));
  const start = parseHHmm(config.serviceStart);
  const rawEnd = parseHHmm(config.serviceEnd);
  if (start === null || rawEnd === null) return [];
  // A service ending "at 01:00" ends after midnight, not fourteen hours ago.
  const end = rawEnd > start ? rawEnd : rawEnd + 1440;

  const slots: Slot[] = [];
  for (let m = start; m < end; m += step) {
    const at = atMinutesOfDay(now, m);
    slots.push({
      key: at.toISOString(),
      at,
      label: formatHHmm(m),
      isPast: at.getTime() + step * MINUTE <= now.getTime(),
    });
  }
  return slots;
}

/** The grid slot a timestamp belongs to, or null when it falls outside service */
export function slotFor(
  at: Date | string,
  config: SlotConfig = DEFAULT_SLOT_CONFIG,
  slots?: Slot[],
): Slot | null {
  const time = (typeof at === "string" ? new Date(at) : at).getTime();
  if (Number.isNaN(time)) return null;
  const grid = slots ?? buildSlots(config, typeof at === "string" ? new Date(at) : at);
  const step = Math.max(5, Math.round(config.slotMinutes)) * MINUTE;
  for (const s of grid) {
    const from = s.at.getTime();
    if (time >= from && time < from + step) return s;
  }
  return null;
}

/** First slot not yet gone — what a new order should start on */
export function defaultSlot(
  config: SlotConfig = DEFAULT_SLOT_CONFIG,
  now: Date = new Date(),
): Slot | null {
  return buildSlots(config, now).find((s) => !s.isPast) ?? null;
}
