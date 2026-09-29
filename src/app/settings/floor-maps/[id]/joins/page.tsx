"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { JoinPairsEditor } from "@/components/settings/join-pairs-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { FloorMap, FloorZone, TableJoinRule } from "@/lib/database.types";
import { fetchFloorMaps } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import { fetchTablesWithTags, type TableWithTags } from "@/lib/settings-api";
import { fetchJoinRules, fetchZones } from "@/lib/smart-floor/data";
import { usePermission } from "@/stores/auth-store";
import { useSmartFloor } from "@/stores/smart-floor-store";

export default function JoinPairsPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const canManage = usePermission("manage_floor");
  const { settings, enabled } = useSmartFloor();
  const [map, setMap] = useState<FloorMap | null>(null);
  const [tables, setTables] = useState<TableWithTags[]>([]);
  const [rules, setRules] = useState<TableJoinRule[]>([]);
  const [zones, setZones] = useState<FloorZone[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const [maps, tb, jr, zn] = await Promise.all([
        fetchFloorMaps(),
        fetchTablesWithTags(),
        fetchJoinRules(),
        fetchZones(),
      ]);
      const found = maps.find((m) => m.id === id);
      if (!found) throw new Error(t("floorMapsMgr.notFound"));
      setMap(found);
      setTables(tb);
      setRules(jr);
      setZones(zn.filter((z) => z.map_id === id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("floorMapsMgr.failedLoad"));
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
          <Link href="/settings/floor-maps">{t("joinPairs.back")}</Link>
        </Button>
      </div>
    );
  }
  if (!map || !settings) {
    return <div className="m-6 h-96 animate-pulse rounded-xl bg-muted" />;
  }
  return (
    <div className="h-[calc(100dvh-3.5rem)] sm:h-dvh">
      <JoinPairsEditor
        map={map}
        tables={tables}
        rules={rules}
        zones={zones}
        joinDistance={settings.join_distance}
        moduleOn={enabled}
        onChanged={load}
      />
    </div>
  );
}
