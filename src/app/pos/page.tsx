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
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";

export default function PosPage() {
  const t = useT();
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
      setError(e instanceof Error ? e.message : t("pos.failedLoadMenu"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      toast.error(e instanceof Error ? e.message : t("pos.failedLoadOrder"));
    }
  }, [mode, tableId, subtable, takeawayOrderId, t]);

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
          ? t("pos.selectTableFirst")
          : t("pos.pickTakeawayFirst"),
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
        <h1 className="text-xl font-semibold">{t("pos.noAccessTitle")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("pos.noAccessBody")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("floor.cantReachDb")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => loadStatic()}>{t("common.retry")}</Button>
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
