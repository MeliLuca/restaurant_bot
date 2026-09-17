/**
 * How full a take-away slot is.
 *
 * The rule being enforced is the kitchen's, not the till's: an oven fits so
 * many pizzas per half hour. So load is counted in PIECES of a category inside
 * a window of wall-clock time, never in orders or in money — ten orders of one
 * pizza and one order of ten pizzas are the same load on the oven.
 *
 * Windows are anchored to midnight, not to the service start: "50 pizze ogni
 * mezz'ora" means each half hour on the clock, which is how it was asked for
 * and the only reading where two people looking at 20:00 count the same set.
 */

import type { Slot, SlotConfig } from "@/lib/takeaway/slots";
import { buildSlots } from "@/lib/takeaway/slots";

const MINUTE = 60_000;
/** Below this share of the limit a slot reads as comfortable */
const WARN_RATIO = 0.7;

export interface CategoryRule {
  categoryId: string;
  categoryName: string;
  maxItems: number;
  windowMinutes: number;
}

/** One promised piece, flattened: which order, when, which category */
export interface LoadRow {
  orderId: string;
  pickupAtMs: number;
  categoryId: string;
  quantity: number;
}

export interface CategoryPressure {
  rule: CategoryRule;
  /** Pieces already promised in this window, including anything previewed */
  used: number;
}

export interface SlotPressure {
  /** Worst category's share of its limit: 1 means exactly at it */
  ratio: number;
  level: "ok" | "warn" | "full";
  /** Every rule that applies here, fullest first */
  categories: CategoryPressure[];
  /** The ones that have reached or passed their limit */
  over: CategoryPressure[];
}

export interface PressureOptions {
  /** Pieces about to be added, by category — an unsent ticket, typically */
  extraByCategory?: Map<string, number>;
  /**
   * Treat this order's pieces as if they were promised at the time being
   * asked about. Without it, previewing a move to 21:00 would still count the
   * order's own pizzas at 20:00 and report a slot emptier than it would be.
   */
  moveOrderId?: string | null;
}

/** Start of the window of width `windowMinutes` that contains `atMs` */
export function windowStartMs(atMs: number, windowMinutes: number): number {
  const midnight = new Date(atMs);
  midnight.setHours(0, 0, 0, 0);
  const since = (atMs - midnight.getTime()) / MINUTE;
  return midnight.getTime() + Math.floor(since / windowMinutes) * windowMinutes * MINUTE;
}

export const EMPTY_PRESSURE: SlotPressure = {
  ratio: 0,
  level: "ok",
  categories: [],
  over: [],
};

/**
 * The evening's promises, ready to be asked "how full is this time".
 *
 * Holds the rows rather than a precomputed grid: an evening is tens of orders,
 * and every question asked of it carries a different hypothetical ticket, so
 * there is nothing stable to precompute.
 */
export class TakeawayLoad {
  constructor(
    readonly rules: CategoryRule[],
    readonly rows: LoadRow[],
  ) {}

  /** No rule anywhere means nothing to warn about — the whole feature is off */
  get hasRules(): boolean {
    return this.rules.length > 0;
  }

  pressureAt(
    at: string | Date | number,
    options: PressureOptions = {},
  ): SlotPressure {
    const atMs =
      typeof at === "number"
        ? at
        : (typeof at === "string" ? new Date(at) : at).getTime();
    if (Number.isNaN(atMs) || this.rules.length === 0) return EMPTY_PRESSURE;

    const { extraByCategory, moveOrderId = null } = options;

    // Pieces the moved order brings with it, counted at the asked-about time.
    const moved = new Map<string, number>();
    if (moveOrderId !== null) {
      for (const row of this.rows) {
        if (row.orderId !== moveOrderId) continue;
        moved.set(
          row.categoryId,
          (moved.get(row.categoryId) ?? 0) + row.quantity,
        );
      }
    }

    const categories: CategoryPressure[] = this.rules.map((rule) => {
      const from = windowStartMs(atMs, rule.windowMinutes);
      const to = from + rule.windowMinutes * MINUTE;
      let used = 0;
      for (const row of this.rows) {
        if (row.categoryId !== rule.categoryId) continue;
        if (moveOrderId !== null && row.orderId === moveOrderId) continue;
        if (row.pickupAtMs < from || row.pickupAtMs >= to) continue;
        used += row.quantity;
      }
      used += moved.get(rule.categoryId) ?? 0;
      used += extraByCategory?.get(rule.categoryId) ?? 0;
      return { rule, used };
    });

    categories.sort(
      (a, b) => b.used / b.rule.maxItems - a.used / a.rule.maxItems,
    );
    const ratio = categories.reduce(
      (worst, c) => Math.max(worst, c.used / c.rule.maxItems),
      0,
    );

    return {
      ratio,
      level: ratio >= 1 ? "full" : ratio >= WARN_RATIO ? "warn" : "ok",
      categories,
      // Reaching the limit is the warning, not passing it: the order being
      // written is the one that fills the oven, and saying so after the fact
      // helps nobody.
      over: categories.filter((c) => c.used >= c.rule.maxItems),
    };
  }

  /**
   * Times that would take this ticket without going over, soonest first.
   *
   * Only ever looks forward from the slot being refused: offering an earlier
   * time the customer has already gone past is not an alternative, it is a
   * second thing for the waiter to rule out mid-call.
   */
  suggest(
    at: string | Date | number,
    config: SlotConfig,
    options: PressureOptions = {},
    limit = 3,
    now: Date = new Date(),
  ): Slot[] {
    const atMs =
      typeof at === "number"
        ? at
        : (typeof at === "string" ? new Date(at) : at).getTime();
    if (Number.isNaN(atMs)) return [];

    const out: Slot[] = [];
    for (const slot of buildSlots(config, now)) {
      if (slot.at.getTime() <= atMs || slot.isPast) continue;
      if (this.pressureAt(slot.at, options).level === "full") continue;
      out.push(slot);
      if (out.length === limit) break;
    }
    return out;
  }
}
