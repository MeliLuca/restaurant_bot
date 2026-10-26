"use client";

// Settings → Moduli: the Assistente AI prototype's switch, knobs and model
// status. Rendered only in a build with NEXT_PUBLIC_AI_PROTOTYPE=1.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Gauge, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleSwitch, NumberField } from "@/components/settings/smart-floor-module";
import { aiFetch } from "@/lib/ai/client";
import type { AiHealthResponse } from "@/lib/ai/contracts/health";
import { AI_LIMITS, updateAiSettings } from "@/lib/ai/settings";
import type { AiSettings } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { useAiStore } from "@/stores/ai-store";

type Draft = { kitchen: string; bar: string; overlap: string };

const toDraft = (s: AiSettings): Draft => ({
  kitchen: String(s.kitchen_late_minutes),
  bar: String(s.bar_late_minutes),
  overlap: String(Math.round(s.custom_dish_min_overlap * 100)),
});

function wholeIn(text: string, [min, max]: readonly [number, number]): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export function AiModule({ settings }: { settings: AiSettings }) {
  const t = useT();
  const refresh = useAiStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [health, setHealth] = useState<AiHealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => setDraft(toDraft(settings)), [settings]);

  const check = useCallback(async (bench: boolean) => {
    setChecking(true);
    try {
      setHealth(await aiFetch<AiHealthResponse>(`/api/ai/health${bench ? "?bench=1" : ""}`));
      setHealthError(null);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check(false);
  }, [check]);

  const kitchen = wholeIn(draft.kitchen, AI_LIMITS.kitchen_late_minutes);
  const bar = wholeIn(draft.bar, AI_LIMITS.bar_late_minutes);
  const overlapPct = wholeIn(draft.overlap, [0, 100]);
  const valid = kitchen !== null && bar !== null && overlapPct !== null;
  const dirty =
    kitchen !== settings.kitchen_late_minutes ||
    bar !== settings.bar_late_minutes ||
    overlapPct !== Math.round(settings.custom_dish_min_overlap * 100);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  const o = health?.ollama;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start gap-4 space-y-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {t("ai.module.title")}
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                {t("ai.prototype")}
              </Badge>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("ai.module.description")}</p>
          </div>
          <ModuleSwitch
            checked={settings.enabled}
            disabled={busy}
            label={t("ai.module.title")}
            onLabel={t("smartFloor.on")}
            offLabel={t("smartFloor.off")}
            onChange={(on) =>
              void run(
                () => updateAiSettings({ enabled: on }),
                t(on ? "ai.module.enabled" : "ai.module.disabled"),
              )
            }
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              id="ai-kitchen"
              label={t("ai.module.kitchenLate")}
              suffix={t("smartFloor.minutes")}
              value={draft.kitchen}
              invalid={kitchen === null}
              bounds={AI_LIMITS.kitchen_late_minutes}
              onChange={(v) => setDraft((d) => ({ ...d, kitchen: v }))}
            />
            <NumberField
              id="ai-bar"
              label={t("ai.module.barLate")}
              suffix={t("smartFloor.minutes")}
              value={draft.bar}
              invalid={bar === null}
              bounds={AI_LIMITS.bar_late_minutes}
              onChange={(v) => setDraft((d) => ({ ...d, bar: v }))}
            />
            <NumberField
              id="ai-overlap"
              label={t("ai.module.overlap")}
              suffix="%"
              value={draft.overlap}
              invalid={overlapPct === null}
              bounds={[0, 100]}
              onChange={(v) => setDraft((d) => ({ ...d, overlap: v }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("ai.module.overlapHelp")}</p>
          {dirty && (
            <div className="flex gap-2">
              <Button
                disabled={!valid || busy}
                onClick={() =>
                  void run(
                    () =>
                      updateAiSettings({
                        kitchen_late_minutes: kitchen!,
                        bar_late_minutes: bar!,
                        custom_dish_min_overlap: overlapPct! / 100,
                      }),
                    t("ai.module.saved"),
                  )
                }
              >
                {t("common.save")}
              </Button>
              <Button variant="outline" onClick={() => setDraft(toDraft(settings))}>
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gauge className="h-5 w-5" /> {t("ai.module.status")}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={checking} onClick={() => void check(false)}>
              <RefreshCw className="mr-1 h-4 w-4" />
              {t("common.retry")}
            </Button>
            <Button size="sm" disabled={checking || !o?.installed} onClick={() => void check(true)}>
              {t("ai.module.speedTest")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          {checking && !health ? (
            <span className="text-muted-foreground">{t("ai.module.checking")}</span>
          ) : healthError ? (
            <span className="text-destructive">{healthError}</span>
          ) : health && o ? (
            <>
              <Row label={t("ai.module.host")}>
                {o.host} —{" "}
                <span className={o.reachable ? "text-emerald-600" : "text-destructive"}>
                  {t(o.reachable ? "ai.module.online" : "ai.module.offline")}
                </span>
                {o.version && ` (Ollama ${o.version})`}
              </Row>
              <Row label={t("ai.module.model")}>
                {o.model} —{" "}
                {!o.installed
                  ? t("ai.module.notInstalled")
                  : o.loaded
                    ? `${t("ai.module.loaded")}${o.sizeBytes ? ` (${(o.sizeBytes / 1e9).toFixed(1)} GB)` : ""}`
                    : t("ai.module.notLoaded")}
              </Row>
              <Row label={t("ai.module.profile")}>{health.profile.label}</Row>
              {health.bench && (
                <Row label={t("ai.module.speedTest")}>
                  {t("ai.module.speedResult", {
                    ms: health.bench.ms,
                    tps: health.bench.tokensPerSecond ?? "—",
                  })}
                </Row>
              )}
              {o.error && <span className="text-xs text-destructive">{o.error}</span>}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
