"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrintTemplateEditor } from "@/components/settings/print-template-editor";
import {
  fetchPrinters,
  fetchPrintTemplate,
  fetchRestaurantSettings,
} from "@/lib/settings-api";
import type {
  Printer,
  PrintTemplateRow,
  RestaurantSettings,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

export default function PrintTemplateEditorPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const canManage = usePermission("manage_printers");
  const [row, setRow] = useState<PrintTemplateRow | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [tpl, p, s] = await Promise.all([
        fetchPrintTemplate(id),
        fetchPrinters(),
        fetchRestaurantSettings(),
      ]);
      if (!tpl) throw new Error(t("printTemplates.notFound"));
      setRow(tpl);
      setPrinters(p);
      setSettings(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("printTemplates.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [canManage, id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManage) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {t("printTemplates.requiresPerm")}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 py-12 text-center">
        <TriangleAlert className="h-8 w-8 text-amber-500" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild variant="outline">
          <Link href="/settings/print-templates">{t("printTemplates.back")}</Link>
        </Button>
      </div>
    );
  }
  if (loading || !row || !settings) {
    return <div className="m-6 h-96 animate-pulse rounded-xl bg-muted" />;
  }
  return (
    <PrintTemplateEditor
      // a fresh editor per template: its draft state is seeded from the row
      key={row.id}
      row={row}
      printers={printers}
      company={settings}
    />
  );
}
