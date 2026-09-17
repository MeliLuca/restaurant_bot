"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsNav } from "@/components/settings/settings-nav";
import { TakeawayManager } from "@/components/settings/takeaway-manager";
import { fetchCategories } from "@/lib/api";
import { fetchCategoryLimits, fetchSlotConfig } from "@/lib/takeaway/api";
import { DEFAULT_SLOT_CONFIG, type SlotConfig } from "@/lib/takeaway/slots";
import type { Category, TakeawayCategoryLimit } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

export default function TakeawaySettingsPage() {
  const t = useT();
  const canManage = usePermission("manage_menu");
  const [config, setConfig] = useState<SlotConfig>(DEFAULT_SLOT_CONFIG);
  const [categories, setCategories] = useState<Category[]>([]);
  const [limits, setLimits] = useState<TakeawayCategoryLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [c, cats, l] = await Promise.all([
        fetchSlotConfig(),
        fetchCategories(),
        fetchCategoryLimits(),
      ]);
      setConfig(c);
      setCategories(cats);
      setLimits(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.failedLoadTakeaway"));
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <SettingsNav />

      {!canManage ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("settings.needsPermission")}
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-5 text-sm">
            <TriangleAlert className="h-5 w-5 text-destructive" />
            <span className="flex-1">{error}</span>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <TakeawayManager
          config={config}
          categories={categories}
          limits={limits}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
