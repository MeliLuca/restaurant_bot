"use client";

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_RANGE_DAYS, type RangePreset } from "@/lib/analytics/date-range";
import { useT } from "@/lib/i18n/use-translation";

const PRESETS: RangePreset[] = ["last7", "last30", "last90", "thisMonth", "custom"];

export function DateRangePicker({
  preset,
  customStart,
  customEnd,
  onPresetChange,
  onCustomChange,
}: {
  preset: RangePreset;
  customStart: string; // YYYY-MM-DD
  customEnd: string;
  onPresetChange: (p: RangePreset) => void;
  onCustomChange: (start: string, end: string) => void;
}) {
  const t = useT();

  function changeCustom(start: string, end: string) {
    if (start && end) {
      const days =
        (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1;
      if (days > MAX_RANGE_DAYS) {
        toast.warning(t("analytics.range.maxDays", { days: MAX_RANGE_DAYS }));
      }
    }
    onCustomChange(start, end);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onValueChange={(v) => onPresetChange(v as RangePreset)}>
        <SelectTrigger className="h-11 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p} value={p}>
              {t(`analytics.range.${p}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" ? (
        <>
          <label className="text-sm text-muted-foreground">
            {t("analytics.range.from")}
          </label>
          <Input
            type="date"
            className="h-11 w-40"
            value={customStart}
            max={customEnd || undefined}
            onChange={(e) => changeCustom(e.target.value, customEnd)}
          />
          <label className="text-sm text-muted-foreground">
            {t("analytics.range.to")}
          </label>
          <Input
            type="date"
            className="h-11 w-40"
            value={customEnd}
            min={customStart || undefined}
            onChange={(e) => changeCustom(customStart, e.target.value)}
          />
        </>
      ) : null}
    </div>
  );
}
