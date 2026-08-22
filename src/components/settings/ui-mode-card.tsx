"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/use-translation";
import { MOBILE_ROOT } from "@/lib/mobile-route";
import { useUiModeStore, type UiMode } from "@/stores/ui-mode-store";

const OPTIONS: { mode: UiMode; labelKey: "m.uiModeAuto" | "m.desktopVersion" | "m.phoneVersion" }[] = [
  { mode: "auto", labelKey: "m.uiModeAuto" },
  { mode: "desktop", labelKey: "m.desktopVersion" },
  { mode: "mobile", labelKey: "m.phoneVersion" },
];

/**
 * Lets this device pin an interface instead of letting the redirect decide —
 * and is how you reach the phone UI from a laptop to work on it.
 */
export function UiModeCard() {
  const t = useT();
  const router = useRouter();
  const mode = useUiModeStore((s) => s.mode);
  const setMode = useUiModeStore((s) => s.setMode);

  // the store is persisted; render the real value only once it has rehydrated
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useUiModeStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useUiModeStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("m.uiMode")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {OPTIONS.map(({ mode: m, labelKey }) => (
          <Button
            key={m}
            variant={hydrated && mode === m ? "default" : "outline"}
            className="h-11"
            onClick={() => {
              setMode(m);
              if (m === "mobile") router.push(`${MOBILE_ROOT}/tables`);
            }}
          >
            {t(labelKey)}
          </Button>
        ))}
        <span className="text-sm text-muted-foreground">{t("m.uiModeHelp")}</span>
      </CardContent>
    </Card>
  );
}
