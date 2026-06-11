"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  TablesManager,
  TagsManager,
} from "@/components/settings/tables-manager";
import {
  fetchTablesWithTags,
  fetchTableTags,
  type TableWithTags,
} from "@/lib/settings-api";
import type { TableTag } from "@/lib/database.types";
import { usePermission } from "@/stores/auth-store";

export default function TablesSettingsPage() {
  const canManage = usePermission("manage_floor");
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
      const [t, g] = await Promise.all([
        fetchTablesWithTags(),
        fetchTableTags(),
      ]);
      setTables(t);
      setTags(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tables");
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
            Floor layout configuration requires the &ldquo;Manage floor
            layout&rdquo; permission.
          </CardContent>
        </Card>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => refresh()}>Retry</Button>
        </div>
      ) : loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <TablesManager tables={tables} tags={tags} onChanged={refresh} />
          <TagsManager tags={tags} tables={tables} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
