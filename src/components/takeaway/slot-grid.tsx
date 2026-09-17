"use client";

import { useMemo } from "react";
import { Clock, Zap } from "lucide-react";
import {
  DEFAULT_SLOT_CONFIG,
  buildSlots,
  formatTime,
  type SlotConfig,
} from "@/lib/takeaway/slots";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

interface SlotGridProps {
  /** Chosen pickup time as ISO, or null for "no time given" */
  value: string | null;
  onChange: (iso: string | null) => void;
  config?: SlotConfig;
  /** Frozen by the caller so the grid doesn't reflow mid-tap */
  now?: Date;
  /** Offer the "no time" escape hatch (hidden when a time is mandatory) */
  allowNoTime?: boolean;
  className?: string;
}

/**
 * The pickup-time grid: tap a time, not a spinner.
 *
 * Taking an order is a phone call — the waiter is repeating times out loud and
 * needs the whole evening in front of them, not a field to type into. Past
 * slots stay on screen, greyed: their absence would shift every remaining chip
 * sideways as the night wears on, and muscle memory is worth more here than
 * the row of space it costs.
 *
 * A time outside the grid (a customer who insists on 20:45) is never thrown
 * away — it lights the "right away" chip and is reported verbatim above it.
 */
export function SlotGrid({
  value,
  onChange,
  config = DEFAULT_SLOT_CONFIG,
  now,
  allowNoTime = true,
  className,
}: SlotGridProps) {
  const t = useT();
  const slots = useMemo(() => buildSlots(config, now ?? new Date()), [config, now]);

  const onGrid = value !== null && slots.some((s) => s.key === value);
  const custom = value !== null && !onGrid;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(new Date().toISOString())}
          className={cn(
            "flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
            custom
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Zap className="h-4 w-4" />
          {custom ? formatTime(value) : t("takeaway.rightAway")}
        </button>
        {allowNoTime && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
              value === null
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Clock className="h-4 w-4" />
            {t("takeaway.noTime")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {slots.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            className={cn(
              "flex h-12 items-center justify-center rounded-lg border text-base font-semibold tabular-nums transition-colors",
              value === s.key
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent",
              s.isPast && value !== s.key && "text-muted-foreground/50",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {slots.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("takeaway.noSlots")}</p>
      )}
    </div>
  );
}
