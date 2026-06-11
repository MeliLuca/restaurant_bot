"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MenuManager } from "@/components/settings/menu-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { fetchCategories } from "@/lib/api";
import {
  fetchIngredients,
  fetchMenuItemsWithIngredients,
  type MenuItemWithIngredients,
} from "@/lib/settings-api";
import type { Category, Ingredient } from "@/lib/database.types";
import { usePermission } from "@/stores/auth-store";

export default function MenuSettingsPage() {
  const canManage = usePermission("manage_menu");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItemWithIngredients[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [c, i, g] = await Promise.all([
        fetchCategories(),
        fetchMenuItemsWithIngredients(),
        fetchIngredients(),
      ]);
      setCategories(c);
      setItems(i);
      setIngredients(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the menu");
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
            Menu configuration requires the &ldquo;Manage menu&rdquo;
            permission.
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
        <MenuManager
          categories={categories}
          items={items}
          ingredients={ingredients}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
