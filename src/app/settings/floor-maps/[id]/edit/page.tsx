"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FloorMapEditor } from "@/components/settings/floor-map-editor";
import type { FloorMap, TableTag } from "@/lib/database.types";
import { fetchFloorMaps } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import {
  fetchTablesWithTags,
  fetchTableTags,
  type TableWithTags,
} from "@/lib/settings-api";
import { usePermission } from "@/stores/auth-store";

export default function FloorMapEditorPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const canManage = usePermission("manage_floor");
  const [map, setMap] = useState<FloorMap | null>(null);
  const [tables, setTables] = useState<TableWithTags[]>([]);
  const [tags, setTags] = useState<TableTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The map row seeds the editor once; later refreshes only bring fresh
  // table names/seats/tags (the layout draft lives in the editor).
  const refreshTables = useCallback(async () => {
    const [tb, g] = await Promise.all([fetchTablesWithTags(), fetchTableTags()]);
    setTables(tb);
    setTags(g);
  }, []);

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const maps = await fetchFloorMaps();
      const found = maps.find((m) => m.id === id);
      if (!found) throw new Error(t("floorMapsMgr.notFound"));
      await refreshTables();
      setMap(found);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("floorMapsMgr.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [canManage, id, t, refreshTables]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManage) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {t("settings.floorRequiresPerm")}
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
          <Link href="/settings/floor-maps">{t("floorMapEditor.back")}</Link>
        </Button>
      </div>
    );
  }
  if (loading || !map) {
    return <div className="m-6 h-96 animate-pulse rounded-xl bg-muted" />;
  }
  return (
    <div className="h-[calc(100dvh-3.5rem)] sm:h-dvh">
      <FloorMapEditor
        key={map.id}
        map={map}
        tables={tables}
        tags={tags}
        onChanged={refreshTables}
      />
    </div>
  );
}
