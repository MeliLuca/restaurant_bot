"use client";

import { TriangleAlert } from "lucide-react";
import type { SlotPressure } from "@/lib/takeaway/load";
import { formatDuration, formatTime, type Slot } from "@/lib/takeaway/slots";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * The slot is over its limit — said out loud, with somewhere to put the order.
 *
 * Yellow and never a block: the person holding the phone knows things the
 * kitchen's numbers don't (a regular, a half order, an oven that just freed
 * up), and a screen that refuses the time simply gets worked around on paper.
 * What it must do instead is make the alternative one tap away, so the honest
 * answer — "I can do 20:30" — is the easiest thing to say next.
 */
export function OverloadBanner({
  pressure,
  at,
  suggestions,
  onPickTime,
  className,
}: {
  pressure: SlotPressure;
  /** The time being warned about, ISO */
  at: string;
  suggestions: Slot[];
  onPickTime?: (iso: string) => void;
  className?: string;
}) {
  const t = useT();
  if (pressure.over.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        {t("takeaway.overloadTitle", { time: formatTime(at) })}
      </div>
      <ul className="flex flex-col gap-0.5 text-amber-900/90 dark:text-amber-200/90">
        {pressure.over.map((c) => (
          <li key={c.rule.categoryId}>
            {t("takeaway.overloadLine", {
              name: c.rule.categoryName,
              used: c.used,
              max: c.rule.maxItems,
              window: formatDuration(c.rule.windowMinutes),
            })}
          </li>
        ))}
      </ul>
      {suggestions.length === 0 ? (
        <span className="text-amber-900/80 dark:text-amber-200/80">
          {t("takeaway.noSuggestions")}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-amber-900/80 dark:text-amber-200/80">
            {t("takeaway.suggested")}
          </span>
          {suggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={!onPickTime}
              onClick={() => onPickTime?.(s.key)}
              className="h-9 rounded-full border border-amber-600/50 bg-background px-3 text-sm font-semibold tabular-nums hover:bg-accent disabled:cursor-default disabled:opacity-100"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
