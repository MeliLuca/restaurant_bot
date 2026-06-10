"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuPanel } from "@/components/pos/menu-panel";
import { TicketPanel } from "@/components/pos/ticket-panel";
import {
  fetchCategories,
  fetchMenuItems,
  fetchOpenOrder,
  fetchTables,
  type OpenOrder,
} from "@/lib/api";
import type {
  Category,
  MenuItem,
  RestaurantTable,
} from "@/lib/database.types";
import { useTicketStore } from "@/stores/ticket-store";

export default function PosPage() {
  const tableId = useTicketStore((s) => s.tableId);
  const addItem = useTicketStore((s) => s.addItem);

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [openOrder, setOpenOrder] = useState<OpenOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatic = useCallback(async () => {
    try {
      const [c, i, t] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
        fetchTables(),
      ]);
      setCategories(c);
      setItems(i);
      setTables(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshOrder = useCallback(async () => {
    try {
      setOpenOrder(tableId ? await fetchOpenOrder(tableId) : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load order");
    }
  }, [tableId]);

  useEffect(() => {
    void loadStatic();
  }, [loadStatic]);

  useEffect(() => {
    void refreshOrder();
  }, [refreshOrder]);

  function handleAdd(item: MenuItem) {
    if (!tableId) {
      toast.error("Select a table first");
      return;
    }
    addItem(item);
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">Can&apos;t reach the database</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => loadStatic()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 p-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="min-h-24 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <MenuPanel categories={categories} items={items} onAdd={handleAdd} />
        )}
      </div>

      <div className="w-full max-w-[400px] shrink-0 border-l bg-card">
        <TicketPanel
          tables={tables}
          openOrder={openOrder}
          onOrderChanged={refreshOrder}
        />
      </div>
    </div>
  );
}
