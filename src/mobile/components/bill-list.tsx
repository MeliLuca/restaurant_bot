"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { fetchOpenDineInOrders, fetchTables } from "@/lib/api";
import type { Order, RestaurantTable } from "@/lib/database.types";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { mRoutes } from "@/mobile/lib/routes";
import { MHeader, DesktopSwitch } from "./m-header";

/**
 * Every open bill on the floor, so a waiter can answer "how much is table 7 at?"
 * without walking to a till.
 *
 * Take-away and delivery are deliberately absent: they are settled at the till,
 * and their orders reach /m/o/[orderId] perfectly well by URL if that ever
 * changes.
 *
 * Fetched, not subscribed. useFloorData owns the single "floor-data" realtime
 * channel and is mounted by the tables tab; a second subscriber to the same
 * topic shares one channel object and tears the other down on unmount.
 */
export function BillList() {
  const t = useT();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [open, all] = await Promise.all([
        fetchOpenDineInOrders(),
        fetchTables(),
      ]);
      setOrders(open);
      setTables(all);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const tableName = (id: string | null) =>
    tables.find((x) => x.id === id)?.name ?? "—";

  return (
    <>
      <MHeader title={t("m.tabBills")} action={<DesktopSwitch />} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>
        )}
        {loading && (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        )}
        {/* !error too: "no open bills" next to "could not load" reads as a
            fact about the floor, when nothing is actually known about it */}
        {!loading && !error && orders.length === 0 && (
          <p className="p-4 text-muted-foreground">{t("m.noOpenBills")}</p>
        )}

        <div className="flex flex-col gap-2 p-3">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={mRoutes.bill(o.id)}
              className="flex min-h-16 items-center gap-3 rounded-xl border bg-card px-3 py-2"
            >
              <ReceiptText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">
                  {tableName(o.table_id)}
                  {o.subtable && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {o.subtable}
                    </span>
                  )}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {new Date(o.opened_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(o.total)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
