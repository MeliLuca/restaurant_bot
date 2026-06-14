"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemSearch } from "@/components/pos/item-search";
import { MenuPanel } from "@/components/pos/menu-panel";
import { TicketPanel } from "@/components/pos/ticket-panel";
import {
  fetchCategories,
  fetchMenuItems,
  fetchMenuModifierGroups,
  fetchOpenOrder,
  fetchOpenOrderById,
  fetchOpenOrdersForTable,
  fetchOpenTakeaways,
  fetchTables,
  type ModifierGroupWithModifiers,
  type OpenOrder,
} from "@/lib/api";
import type {
  Category,
  MenuItem,
  Order,
  RestaurantTable,
} from "@/lib/database.types";
import { useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";

export default function PosPage() {
  const mode = useTicketStore((s) => s.mode);
  const tableId = useTicketStore((s) => s.tableId);
  const subtable = useTicketStore((s) => s.subtable);
  const takeawayOrderId = useTicketStore((s) => s.takeawayOrderId);
  const takeawayName = useTicketStore((s) => s.takeawayName);
  const addItem = useTicketStore((s) => s.addItem);
  const canTakeOrders = usePermission("take_orders");

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modifierGroups, setModifierGroups] = useState<
    Record<string, ModifierGroupWithModifiers[]>
  >({});
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [openOrder, setOpenOrder] = useState<OpenOrder | null>(null);
  const [openSplits, setOpenSplits] = useState<Order[]>([]);
  const [openTakeaways, setOpenTakeaways] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatic = useCallback(async () => {
    try {
      const [c, i, t, mg] = await Promise.all([
        fetchCategories(),
        fetchMenuItems(),
        fetchTables(),
        fetchMenuModifierGroups(),
      ]);
      setCategories(c);
      setItems(i);
      setTables(t);
      setModifierGroups(mg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshOrder = useCallback(async () => {
    try {
      if (mode === "table") {
        setOpenOrder(tableId ? await fetchOpenOrder(tableId, subtable) : null);
        setOpenSplits(tableId ? await fetchOpenOrdersForTable(tableId) : []);
      } else {
        setOpenOrder(
          takeawayOrderId ? await fetchOpenOrderById(takeawayOrderId) : null,
        );
        setOpenSplits([]);
      }
      setOpenTakeaways(await fetchOpenTakeaways());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load order");
    }
  }, [mode, tableId, subtable, takeawayOrderId]);

  useEffect(() => {
    void loadStatic();
  }, [loadStatic]);

  useEffect(() => {
    void refreshOrder();
  }, [refreshOrder]);

  function handleAdd(item: MenuItem): boolean {
    const hasTarget = mode === "table" ? !!tableId : !!takeawayName;
    if (!hasTarget) {
      toast.error(
        mode === "table"
          ? "Select a table first"
          : "Pick or start a take-away first",
      );
      return false;
    }
    // The dish goes straight onto the ticket at its base price. Ingredients are
    // added later, on demand, from the line itself (no forced selection).
    addItem(item);
    return true;
  }

  if (!canTakeOrders) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">No POS access</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your role doesn&apos;t include the &ldquo;Take orders&rdquo;
          permission. Ask a manager if you need it.
        </p>
      </div>
    );
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
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        {!loading && (
          <ItemSearch
            items={items}
            categories={categories}
            onAdd={handleAdd}
          />
        )}
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
          <div className="min-h-0 flex-1">
            <MenuPanel
              categories={categories}
              items={items}
              onAdd={handleAdd}
            />
          </div>
        )}
      </div>

      <div className="w-full max-w-[400px] shrink-0 border-l bg-card">
        <TicketPanel
          tables={tables}
          openOrder={openOrder}
          openSplits={openSplits}
          openTakeaways={openTakeaways}
          modifierGroups={modifierGroups}
          onOrderChanged={refreshOrder}
        />
      </div>
    </div>
  );
}
