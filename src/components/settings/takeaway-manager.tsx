"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Clock, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  deleteCategoryLimit,
  saveCategoryLimit,
  updateSlotConfig,
} from "@/lib/takeaway/api";
import { formatDuration, parseHHmm, type SlotConfig } from "@/lib/takeaway/slots";
import type { Category, TakeawayCategoryLimit } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Slot widths worth offering: anything finer is noise on a phone-order pad */
const SLOT_CHOICES = [15, 20, 30, 60];
/** How many slot-widths a capacity window may span */
const WINDOW_MULTIPLES = [1, 2, 3, 4];

interface TakeawayManagerProps {
  config: SlotConfig;
  categories: Category[];
  limits: TakeawayCategoryLimit[];
  onChanged: () => Promise<void>;
}

export function TakeawayManager({
  config,
  categories,
  limits,
  onChanged,
}: TakeawayManagerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SlotConfig>(config);

  useEffect(() => setDraft(config), [config]);

  const byCategory = useMemo(() => {
    const map = new Map<string, TakeawayCategoryLimit>();
    for (const l of limits) map.set(l.category_id, l);
    return map;
  }, [limits]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  const startMin = parseHHmm(draft.serviceStart);
  const endMin = parseHHmm(draft.serviceEnd);
  const windowInvalid = startMin === null || endMin === null;
  const configDirty =
    draft.slotMinutes !== config.slotMinutes ||
    draft.serviceStart !== config.serviceStart ||
    draft.serviceEnd !== config.serviceEnd;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" /> {t("settings.takeawaySlotsTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("settings.takeawaySlotsBody")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("settings.slotLength")}
              <Select
                value={String(draft.slotMinutes)}
                onValueChange={(v) =>
                  setDraft({ ...draft, slotMinutes: Number(v) })
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLOT_CHOICES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {formatDuration(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("settings.serviceStart")}
              <Input
                type="time"
                value={draft.serviceStart}
                onChange={(e) =>
                  setDraft({ ...draft, serviceStart: e.target.value })
                }
                className="h-11"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("settings.serviceEnd")}
              <Input
                type="time"
                value={draft.serviceEnd}
                onChange={(e) =>
                  setDraft({ ...draft, serviceEnd: e.target.value })
                }
                className="h-11"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button
              className="h-11"
              disabled={busy || windowInvalid || !configDirty}
              onClick={() =>
                void run(
                  () => updateSlotConfig(draft),
                  t("settings.takeawaySlotsSaved"),
                )
              }
            >
              {t("common.save")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {windowInvalid
                ? t("settings.serviceWindowInvalid")
                : t("settings.slotPreview", {
                    start: draft.serviceStart,
                    end: draft.serviceEnd,
                    length: formatDuration(draft.slotMinutes),
                  })}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gauge className="h-5 w-5" /> {t("settings.takeawayLimitsTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("settings.takeawayLimitsBody")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col p-0">
          {categories.length === 0 && (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {t("settings.noCategoriesYet")}
            </p>
          )}
          {categories.map((c, i) => (
            <div key={c.id}>
              {i > 0 && <Separator />}
              <LimitRow
                category={c}
                limit={byCategory.get(c.id) ?? null}
                slotMinutes={config.slotMinutes}
                busy={busy}
                onSave={(next) =>
                  run(
                    () => saveCategoryLimit(next),
                    t("settings.limitSaved", { name: c.name }),
                  )
                }
                onClear={() =>
                  run(
                    () => deleteCategoryLimit(c.id),
                    t("settings.limitCleared", { name: c.name }),
                  )
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One category's rule.
 *
 * The row is its own little form so a manager can tune pizze without the other
 * forty categories going dirty behind a single Save — the numbers are set once
 * and rarely, but they are set one at a time.
 */
function LimitRow({
  category,
  limit,
  slotMinutes,
  busy,
  onSave,
  onClear,
}: {
  category: Category;
  limit: TakeawayCategoryLimit | null;
  slotMinutes: number;
  busy: boolean;
  onSave: (limit: Omit<TakeawayCategoryLimit, "updated_at">) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const t = useT();
  const [max, setMax] = useState(limit === null ? "" : String(limit.max_items));
  const [window, setWindow] = useState(
    limit?.window_minutes ?? slotMinutes,
  );
  const [active, setActive] = useState(limit?.is_active ?? true);

  // Re-seed when the saved rule changes underneath (another device, a reload).
  useEffect(() => {
    setMax(limit === null ? "" : String(limit.max_items));
    setWindow(limit?.window_minutes ?? slotMinutes);
    setActive(limit?.is_active ?? true);
  }, [limit, slotMinutes]);

  const parsed = Number(max);
  const valid = max.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const dirty =
    limit === null
      ? valid
      : !(
          String(limit.max_items) === max.trim() &&
          limit.window_minutes === window &&
          limit.is_active === active
        );

  const windowChoices = WINDOW_MULTIPLES.map((n) => slotMinutes * n).filter(
    (m) => m <= 240,
  );
  // Keep a saved window that no longer lines up with the slot length visible,
  // rather than silently snapping the rule to a different one.
  if (!windowChoices.includes(window)) windowChoices.unshift(window);

  const perHour = valid && window > 0 ? Math.round((parsed * 60) / window) : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-4">
      <div className="min-w-32 flex-1">
        <div className="font-medium">{category.name}</div>
        {limit !== null && valid && (
          <div
            className={cn(
              "text-xs",
              active ? "text-muted-foreground" : "text-muted-foreground/60",
            )}
          >
            {active
              ? t("settings.limitPreview", {
                  count: parsed,
                  name: category.name.toLowerCase(),
                  window: formatDuration(window),
                  perHour,
                })
              : t("settings.limitOff")}
          </div>
        )}
      </div>

      <Input
        value={max}
        inputMode="numeric"
        onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder={t("settings.noLimit")}
        aria-label={t("settings.limitForAria", { name: category.name })}
        className="h-11 w-24 tabular-nums"
      />

      <Select
        value={String(window)}
        onValueChange={(v) => setWindow(Number(v))}
      >
        <SelectTrigger className="h-11 w-32" aria-label={t("settings.window")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {windowChoices.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {formatDuration(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => setActive((a) => !a)}
        disabled={!valid}
        aria-pressed={active}
        className={cn(
          "h-11 rounded-lg border px-3 text-sm font-medium disabled:opacity-40",
          active ? "border-primary bg-primary text-primary-foreground" : "",
        )}
      >
        {active ? t("settings.limitActive") : t("settings.limitInactive")}
      </button>

      <Button
        className="h-11"
        disabled={busy || !valid || !dirty}
        onClick={() =>
          void onSave({
            category_id: category.id,
            max_items: parsed,
            window_minutes: window,
            is_active: active,
          })
        }
      >
        {t("common.save")}
      </Button>
      {limit !== null && (
        <Button
          variant="ghost"
          className="h-11"
          disabled={busy}
          onClick={() => void onClear()}
        >
          {t("settings.removeLimit")}
        </Button>
      )}
    </div>
  );
}
