"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrintersManager } from "@/components/settings/printers-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  fetchPrinters,
  fetchRestaurantSettings,
} from "@/lib/settings-api";
import type { Printer, RestaurantSettings } from "@/lib/database.types";
import { usePermission } from "@/stores/auth-store";

export default function PrintersSettingsPage() {
  const canManage = usePermission("manage_printers");
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [p, s] = await Promise.all([
        fetchPrinters(),
        fetchRestaurantSettings(),
      ]);
      setPrinters(p);
      setSettings(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load printers");
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsNav />

      {!canManage ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Printer configuration requires the &ldquo;Manage printers&rdquo;
            permission.
          </CardContent>
        </Card>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => refresh()}>Retry</Button>
        </div>
      ) : loading || !settings ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <PrintersManager
          printers={printers}
          settings={settings}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
