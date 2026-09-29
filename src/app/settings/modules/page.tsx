"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SmartFloorModule } from "@/components/settings/smart-floor-module";
import { fetchCategories } from "@/lib/api";
import { fetchTableTags } from "@/lib/settings-api";
import type { Category, TableTag } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor, useSmartFloorStore } from "@/stores/smart-floor-store";

export default function ModulesSettingsPage() {
  const t = useT();
  const canManage = usePermission("manage_floor");
  const { settings, error: settingsError } = useSmartFloor();
  const refreshSettings = useSmartFloorStore((s) => s.refresh);
  const [tags, setTags] = useState<TableTag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [tg, cats] = await Promise.all([
        fetchTableTags(),
        fetchCategories(),
        refreshSettings(),
      ]);
      setTags(tg);
      setCategories(cats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("smartFloor.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [canManage, refreshSettings, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shownError = error ?? (settings ? null : settingsError);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <SettingsNav />

      {!canManage ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("smartFloor.needsPermission")}
          </CardContent>
        </Card>
      ) : shownError ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-5 text-sm">
            <TriangleAlert className="h-5 w-5 text-destructive" />
            <span className="flex-1">{shownError}</span>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : loading || !settings ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <SmartFloorModule
          settings={settings}
          tags={tags}
          categories={categories}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
