"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrintTextsEditor } from "@/components/settings/print-texts-editor";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  fetchPrinters,
  fetchPrintTemplates,
  fetchRestaurantSettings,
} from "@/lib/settings-api";
import type {
  Printer,
  PrintTemplateRow,
  RestaurantSettings,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

export default function PrintTextsPage() {
  const t = useT();
  const canManage = usePermission("manage_printers");
  const canEditTexts = usePermission("edit_print_texts");
  const allowed = canEditTexts || canManage;
  const [templates, setTemplates] = useState<PrintTemplateRow[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    try {
      const [tpl, p, s] = await Promise.all([
        fetchPrintTemplates(),
        fetchPrinters(),
        fetchRestaurantSettings(),
      ]);
      setTemplates(tpl);
      setPrinters(p);
      setSettings(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("printTexts.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [allowed, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex max-w-6xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <SettingsNav />

      {!allowed ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {t("printTexts.requiresPerm")}
          </CardContent>
        </Card>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => refresh()}>{t("common.retry")}</Button>
        </div>
      ) : loading || !settings ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <PrintTextsEditor
          templates={templates}
          printers={printers}
          company={settings}
          canManageTemplates={canManage}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
