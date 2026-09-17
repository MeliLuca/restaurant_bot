"use client";

import type { SlotPressure } from "@/lib/takeaway/load";
import { cn } from "@/lib/utils";

/**
 * How full a slot is, in one glyph.
 *
 * Colour alone would fail the colour-blind and the sun-lit counter screen, so
 * the same three states also differ in fill: hollow when there is room, solid
 * once the limit is in sight.
 */
export function LoadDot({
  pressure,
  className,
}: {
  pressure: SlotPressure | null;
  className?: string;
}) {
  if (pressure === null || pressure.categories.length === 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 rounded-full border",
        pressure.level === "full"
          ? "border-red-500 bg-red-500"
          : pressure.level === "warn"
            ? "border-amber-500 bg-amber-500"
            : "border-emerald-500 bg-transparent",
        className,
      )}
    />
  );
}

/** "Pizze 48/50 · Club Sandwich 12/20" — the detail behind the dot */
export function pressureDetail(pressure: SlotPressure | null): string {
  if (pressure === null) return "";
  return pressure.categories
    .map((c) => `${c.rule.categoryName} ${c.used}/${c.rule.maxItems}`)
    .join(" · ");
}
