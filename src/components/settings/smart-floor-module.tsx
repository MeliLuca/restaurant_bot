"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Armchair, Clock, Phone, Sparkles, Tag, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  Category,
  SmartFloorSettings,
  TableTag,
} from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import {
  SMART_FLOOR_LIMITS,
  setTagMandatory,
  updateSmartFloorSettings,
  type SmartFloorNumberKey,
} from "@/lib/smart-floor/settings";
import { formatDuration } from "@/lib/takeaway/slots";
import { cn } from "@/lib/utils";

/** The part of the settings edited as one draft ("Salva" / "Annulla") */
type Draft = Pick<
  SmartFloorSettings,
  SmartFloorNumberKey | "phone_required" | "finishing_category_ids"
>;
/** Number fields are edited as text so a half-typed value is allowed */
type DraftText = Record<SmartFloorNumberKey, string>;

const NUMBER_KEYS = Object.keys(SMART_FLOOR_LIMITS) as SmartFloorNumberKey[];

function toDraft(s: SmartFloorSettings): Draft {
  return {
    ...(Object.fromEntries(NUMBER_KEYS.map((k) => [k, s[k]])) as Record<
      SmartFloorNumberKey,
      number
    >),
    phone_required: s.phone_required,
    finishing_category_ids: s.finishing_category_ids,
  };
}

function toText(d: Draft): DraftText {
  return Object.fromEntries(
    NUMBER_KEYS.map((k) => [k, String(d[k])]),
  ) as DraftText;
}

/** The value, or null when it isn't a whole number inside the bounds */
function parseField(key: SmartFloorNumberKey, text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  const [min, max] = SMART_FLOOR_LIMITS[key];
  return n >= min && n <= max ? n : null;
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

interface SmartFloorModuleProps {
  settings: SmartFloorSettings;
  tags: TableTag[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

export function SmartFloorModule({
  settings,
  tags,
  categories,
  onChanged,
}: SmartFloorModuleProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const saved = toDraft(settings);
  const [text, setText] = useState<DraftText>(() => toText(saved));
  const [phoneRequired, setPhoneRequired] = useState(settings.phone_required);
  const [finishing, setFinishing] = useState(settings.finishing_category_ids);

  // another device (or this one) saved: start over from what is stored
  useEffect(() => {
    const d = toDraft(settings);
    setText(toText(d));
    setPhoneRequired(d.phone_required);
    setFinishing(d.finishing_category_ids);
  }, [settings]);

  const parsed = Object.fromEntries(
    NUMBER_KEYS.map((k) => [k, parseField(k, text[k])]),
  ) as Record<SmartFloorNumberKey, number | null>;
  const invalid = NUMBER_KEYS.filter((k) => parsed[k] === null);
  const dirty =
    NUMBER_KEYS.some((k) => parsed[k] !== saved[k]) ||
    phoneRequired !== saved.phone_required ||
    !sameIds(finishing, saved.finishing_category_ids);

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

  function save() {
    if (invalid.length > 0) return;
    const numbers = parsed as Record<SmartFloorNumberKey, number>;
    void run(
      () =>
        updateSmartFloorSettings({
          ...numbers,
          phone_required: phoneRequired,
          finishing_category_ids: finishing,
        }),
      t("smartFloor.saved"),
    );
  }

  function discard() {
    setText(toText(saved));
    setPhoneRequired(saved.phone_required);
    setFinishing(saved.finishing_category_ids);
  }

  const field = (key: SmartFloorNumberKey, labelKey: TranslationKey, suffixKey: TranslationKey) => (
    <NumberField
      key={key}
      id={`sf-${key}`}
      label={t(labelKey)}
      suffix={t(suffixKey)}
      value={text[key]}
      invalid={parsed[key] === null}
      bounds={SMART_FLOOR_LIMITS[key]}
      onChange={(v) => setText((prev) => ({ ...prev, [key]: v }))}
    />
  );

  // live example of the seat rules, so the numbers mean something
  const spare = parsed.max_spare_seats ?? saved.max_spare_seats;
  const over = parsed.overfill_seats ?? saved.overfill_seats;
  const bonus = parsed.join_bonus_seats ?? saved.join_bonus_seats;
  const meal = parsed.meal_minutes ?? saved.meal_minutes;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start gap-4 space-y-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg">{t("smartFloor.moduleName")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("smartFloor.moduleDescription")}
            </p>
          </div>
          <ModuleSwitch
            checked={settings.enabled}
            disabled={busy}
            label={t("smartFloor.moduleName")}
            onLabel={t("smartFloor.on")}
            offLabel={t("smartFloor.off")}
            onChange={(on) =>
              void run(
                () => updateSmartFloorSettings({ enabled: on }),
                t(on ? "smartFloor.turnedOn" : "smartFloor.turnedOff"),
              )
            }
          />
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t(settings.enabled ? "smartFloor.onNote" : "smartFloor.offNote")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" /> {t("smartFloor.timesTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("smartFloor.timesBody", { duration: formatDuration(meal) })}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("meal_minutes", "smartFloor.mealMinutes", "smartFloor.minutes")}
          {field("buffer_minutes", "smartFloor.bufferMinutes", "smartFloor.minutes")}
          {field("late_after_minutes", "smartFloor.lateAfterMinutes", "smartFloor.minutesLate")}
          {field("occupied_warn_minutes", "smartFloor.occupiedWarnMinutes", "smartFloor.minutesBefore")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Armchair className="h-5 w-5" /> {t("smartFloor.seatsTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("smartFloor.seatsBody")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("overfill_seats", "smartFloor.overfillSeats", "smartFloor.people")}
            {field("max_spare_seats", "smartFloor.maxSpareSeats", "smartFloor.seats")}
            {field("join_bonus_seats", "smartFloor.joinBonusSeats", "smartFloor.seats")}
            {field("max_join_tables", "smartFloor.maxJoinTables", "smartFloor.tables")}
            {field("join_distance", "smartFloor.joinDistance", "smartFloor.mapUnits")}
          </div>
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            {t("smartFloor.seatsExample", {
              min: Math.max(1, 4 - spare),
              max: 4 + over,
              joined: 6 + 10 + bonus,
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("smartFloor.pairsHint")}{" "}
            <Link href="/settings/floor-maps" className="font-medium text-foreground underline underline-offset-2">
              {t("smartFloor.pairsLink")}
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5" /> {t("smartFloor.bookingsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={phoneRequired}
              onChange={(e) => setPhoneRequired(e.target.checked)}
            />
            <span>
              {t("smartFloor.phoneRequired")}
              <span className="block text-xs text-muted-foreground">
                {t("smartFloor.phoneRequiredHint")}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Tag className="h-5 w-5" /> {t("smartFloor.featuresTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("smartFloor.featuresBody")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {tags.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("smartFloor.noTags")}</p>
          )}
          {tags.map((tag) => (
            <label
              key={tag.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                className="h-5 w-5 accent-primary"
                checked={tag.is_mandatory}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  void run(
                    () => setTagMandatory(tag.id, on),
                    t(on ? "smartFloor.tagNowMandatory" : "smartFloor.tagNowPreference", {
                      name: tag.name,
                    }),
                  );
                }}
              />
              <span className="font-medium">{tag.name}</span>
              <span className="text-muted-foreground">
                {tag.is_mandatory ? t("smartFloor.mandatory") : t("smartFloor.preference")}
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UtensilsCrossed className="h-5 w-5" /> {t("smartFloor.finishingTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("smartFloor.finishingBody", { duration: formatDuration(meal) })}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = finishing.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setFinishing((prev) =>
                    on ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                  )
                }
                className={cn(
                  "flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* One save for the draft; the switch and the tags above save at once */}
      <div
        className={cn(
          "sticky bottom-16 z-10 flex items-center gap-3 rounded-xl border bg-background p-3 shadow-lg sm:bottom-4",
          !dirty && "invisible",
        )}
      >
        <span className="flex-1 text-sm">
          {invalid.length > 0
            ? t("smartFloor.fixFields")
            : t("smartFloor.unsaved")}
        </span>
        <Button variant="outline" className="h-11" disabled={busy} onClick={discard}>
          {t("common.cancel")}
        </Button>
        <Button
          className="h-11"
          disabled={busy || invalid.length > 0}
          onClick={save}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  id,
  label,
  suffix,
  value,
  invalid,
  bounds,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  invalid: boolean;
  bounds: readonly [number, number];
  onChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={bounds[0]}
          max={bounds[1]}
          value={value}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-11 w-24", invalid && "border-destructive")}
        />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
      {invalid && (
        <span className="text-xs text-destructive">
          {t("smartFloor.between", { min: bounds[0], max: bounds[1] })}
        </span>
      )}
    </div>
  );
}

function ModuleSwitch({
  checked,
  disabled,
  label,
  onLabel,
  offLabel,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onLabel: string;
  offLabel: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full px-1 text-sm font-medium disabled:opacity-50"
    >
      <span
        className={cn(
          "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
      <span className="w-12 text-left">{checked ? onLabel : offLabel}</span>
    </button>
  );
}
