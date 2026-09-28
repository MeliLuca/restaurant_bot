"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FloorMapsManager } from "@/components/settings/floor-maps-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import type { FloorMap, TableTag } from "@/lib/database.types";
import { fetchFloorMaps } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import {
  fetchTablesWithTags,
  fetchTableTags,
  type TableWithTags,
} from "@/lib/settings-api";
import { usePermission } from "@/stores/auth-store";

export default function FloorMapsSettingsPage() {
  const t = useT();
  const canManage = usePermission("manage_floor");
  const [maps, setMaps] = useState<FloorMap[]>([]);
  const [tables, setTables] = useState<TableWithTags[]>([]);
  const [tags, setTags] = useState<TableTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [m, tb, g] = await Promise.all([
        fetchFloorMaps(),
        fetchTablesWithTags(),
        fetchTableTags(),
      ]);
      setMaps(m);
      setTables(tb);
      setTags(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("floorMapsMgr.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex max-w-7xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <SettingsNav />

      {!canManage ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {t("settings.floorRequiresPerm")}
          </CardContent>
        </Card>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => refresh()}>{t("common.retry")}</Button>
        </div>
      ) : loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <FloorMapsManager
          maps={maps}
          tables={tables}
          tags={tags}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
