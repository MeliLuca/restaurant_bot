"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import {
  fetchOpenOrdersWithItems,
  fetchTables,
  type OrderWithItems,
} from "@/lib/api";
import { useT } from "@/lib/i18n/use-translation";
import { STATUS_CONFIG, displayStatus } from "@/lib/floor/status";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/database.types";
import { menuLabelText, orderItemLabel } from "@/lib/menu-display";
import { mRoutes } from "@/mobile/lib/routes";
import { MHeader } from "./m-header";

/**
 * One table: its open splits and what is on each. The two actions a waiter
 * standing at the table actually needs are full-width and unmissable.
 *
 * Deliberately does NOT mount useFloorData — see the channel-collision note in
 * table-list.tsx. It fetches just this table's orders instead.
 */
export function TableDetail({ tableId }: { tableId: string }) {
  const t = useT();
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, open] = await Promise.all([
        fetchTables(),
        fetchOpenOrdersWithItems(tableId),
      ]);
      setTable(all.find((x) => x.id === tableId) ?? null);
      setOrders(open);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load table");
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    void load();
  }, [load]);

  // a waiter's phone suspends constantly, and another device may have added a
  // round in the meantime
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const status = table
    ? STATUS_CONFIG[displayStatus(table.status, orders.length > 0)]
    : null;

  return (
    <>
      <MHeader
        title={table?.name ?? "…"}
        backHref={mRoutes.tables()}
        action={
          status && (
            <span
              className={cn(
                "mr-2 rounded-full px-2.5 py-1 text-xs font-semibold",
                status.badge,
              )}
            >
              {t(status.labelKey)}
            </span>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>
        )}
        {loading && (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        )}

        <div className="flex flex-col gap-3 p-3">
        <Link
          href={mRoutes.order(tableId)}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
        >
          <Plus className="h-5 w-5" />
          {t("m.addOrder")}
        </Link>

        {orders.map((o) => (
          <Link
            key={o.id}
            href={mRoutes.bill(o.id)}
            className="flex flex-col gap-2 rounded-xl border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold">
                <ReceiptText className="h-4 w-4 text-muted-foreground" />
                {o.subtable ?? t("pos.wholeTable")}
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {o.total.toFixed(2)}
              </span>
            </div>
            <ul className="text-sm text-muted-foreground">
              {o.order_items.slice(0, 4).map((it) => (
                <li key={it.id} className="truncate">
                  {it.quantity}× {menuLabelText(orderItemLabel(it.menu_items, "—"))}
                </li>
              ))}
              {o.order_items.length > 4 && (
                <li>+{o.order_items.length - 4}</li>
              )}
            </ul>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
