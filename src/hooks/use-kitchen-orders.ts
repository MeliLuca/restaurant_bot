"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { parseModifiers } from "@/lib/printing/route-order";
import type { OrderType, PrinterType } from "@/lib/database.types";

/** Kitchen screens poll faster than chat when the websocket is down */
const POLL_INTERVAL_MS = 10_000;
const REFRESH_DEBOUNCE_MS = 400;

/** Which display column an item belongs to. Mirrors route-order: a CASSA
 * target still produces a production slip rendered in the CUCINA style, so it
 * shows under the kitchen station; items with no target print nowhere and are
 * receipt-only, so the display hides them. */
export type Station = "CUCINA" | "BAR";

export interface KitchenItem {
  id: string;
  quantity: number;
  /** Dish name with the "(1/3)" fraction suffix for split items */
  name: string;
  /** Display-ready variation rows: "+ Bufala", "- Acciughe", free-text notes */
  modifiers: string[];
  station: Station;
  readyAt: string | null;
  createdAt: string;
}

export interface KitchenOrder {
  id: string;
  ticketNumber: number;
  orderType: OrderType;
  tableName: string | null;
  subtable: string | null;
  customerName: string | null;
  deliveryNumber: number | null;
  openedAt: string;
  items: KitchenItem[];
}

interface KitchenData {
  orders: KitchenOrder[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Bump an item (ready=true) or send it back to prep (ready=false) */
  setItemReady: (itemId: string, ready: boolean) => Promise<void>;
  /** Bump every remaining item of an order at once */
  setOrderReady: (order: KitchenOrder) => Promise<void>;
}

type OrderRow = {
  id: string;
  ticket_number: number;
  order_type: OrderType;
  subtable: string | null;
  customer_name: string | null;
  delivery_number: number | null;
  opened_at: string;
  tables: { name: string } | null;
  order_items: {
    id: string;
    quantity: number;
    notes: string | null;
    fraction_of: number | null;
    ready_at: string | null;
    created_at: string;
    menu_items: { name: string; target_printer_id: string | null } | null;
    order_item_modifiers: {
      name: string;
      price_adjustment: number;
      is_removal: boolean;
    }[];
  }[];
};

/** Same signing convention as the production slips (route-order.ts): the
 * direction comes from is_removal, never from the amount. */
function modifierLabel(m: { name: string; is_removal: boolean }): string {
  return `${m.is_removal ? "-" : "+"} ${m.name}`;
}

export function useKitchenOrders(): KitchenData {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const sb = getSupabase();
      const [ordersResult, printersResult] = await Promise.all([
        sb
          .from("orders")
          .select(
            "id, ticket_number, order_type, subtable, customer_name, delivery_number, opened_at, tables(name), order_items(id, quantity, notes, fraction_of, ready_at, created_at, menu_items(name, target_printer_id), order_item_modifiers(name, price_adjustment, is_removal))",
          )
          .eq("status", "open")
          .order("opened_at")
          .returns<OrderRow[]>(),
        sb.from("printers").select("id, printer_type"),
      ]);
      if (ordersResult.error) throw new Error(ordersResult.error.message);
      if (printersResult.error) throw new Error(printersResult.error.message);

      const stationByPrinter = new Map<string, PrinterType>(
        printersResult.data.map((p) => [p.id, p.printer_type]),
      );

      setOrders(
        ordersResult.data.map((o) => ({
          id: o.id,
          ticketNumber: o.ticket_number,
          orderType: o.order_type,
          tableName: o.tables?.name ?? null,
          subtable: o.subtable,
          customerName: o.customer_name,
          deliveryNumber: o.delivery_number,
          openedAt: o.opened_at,
          items: o.order_items
            .filter((i) => {
              // receipt-only items (no production target) never reach a station
              const target = i.menu_items?.target_printer_id;
              return !!target && stationByPrinter.has(target);
            })
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((i) => ({
              id: i.id,
              quantity: i.quantity,
              name:
                (i.menu_items?.name ?? "Item") +
                (i.fraction_of ? ` (1/${i.fraction_of})` : ""),
              modifiers: [
                ...i.order_item_modifiers.map(modifierLabel),
                ...parseModifiers(i.notes),
              ],
              station:
                stationByPrinter.get(i.menu_items!.target_printer_id!) === "BAR"
                  ? "BAR"
                  : "CUCINA",
              readyAt: i.ready_at,
              createdAt: i.created_at,
            })),
        })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime push with poll fallback, same shape as use-floor-data/chat-store
  const realtimeUp = useRef(false);
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
    };

    const channel = getSupabase()
      .channel("kitchen-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        debouncedRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        debouncedRefresh,
      )
      .subscribe((status) => {
        realtimeUp.current = status === "SUBSCRIBED";
      });

    const pollTimer = setInterval(() => {
      if (!realtimeUp.current && document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void getSupabase().removeChannel(channel);
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const setItemReady = useCallback(
    async (itemId: string, ready: boolean) => {
      const ready_at = ready ? new Date().toISOString() : null;
      // optimistic flip; realtime/refresh reconciles
      setOrders((prev) =>
        prev.map((o) => ({
          ...o,
          items: o.items.map((i) =>
            i.id === itemId ? { ...i, readyAt: ready_at } : i,
          ),
        })),
      );
      const { error: updateError } = await getSupabase()
        .from("order_items")
        .update({ ready_at })
        .eq("id", itemId);
      if (updateError) {
        await refresh();
        throw new Error(updateError.message);
      }
    },
    [refresh],
  );

  const setOrderReady = useCallback(
    async (order: KitchenOrder) => {
      const pending = order.items.filter((i) => !i.readyAt);
      if (pending.length === 0) return;
      const ready_at = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                items: o.items.map((i) =>
                  i.readyAt ? i : { ...i, readyAt: ready_at },
                ),
              }
            : o,
        ),
      );
      const { error: updateError } = await getSupabase()
        .from("order_items")
        .update({ ready_at })
        .in(
          "id",
          pending.map((i) => i.id),
        );
      if (updateError) {
        await refresh();
        throw new Error(updateError.message);
      }
    },
    [refresh],
  );

  return { orders, loading, error, refresh, setItemReady, setOrderReady };
}
