"use client";

import { useState } from "react";
import { ChevronDown, ReceiptText, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/constants";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import type { StatsOrder } from "@/lib/stats-api";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function orderLabel(order: StatsOrder, t: TFn): string {
  if (order.order_type === "takeaway") {
    return order.customer_name ?? t("stats.takeawayFallback");
  }
  const table = order.tables?.name ?? t("stats.tableFallback");
  return order.subtable ? `${table} / ${order.subtable}` : table;
}

interface BillsListProps {
  orders: StatsOrder[];
}

/** Closed bills (paid + cancelled), newest first, expandable to line items */
export function BillsList({ orders }: BillsListProps) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const closed = orders
    .filter((o) => o.status !== "open")
    .sort(
      (a, b) =>
        new Date(b.closed_at ?? b.opened_at).getTime() -
        new Date(a.closed_at ?? a.opened_at).getTime(),
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ReceiptText className="h-5 w-5" /> {t("stats.checkoutBills")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        {closed.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            {t("stats.noBillsClosed")}
          </p>
        )}
        {closed.map((order, i) => {
          const expanded = expandedId === order.id;
          const itemCount = order.order_items.reduce(
            (sum, line) => sum + line.quantity,
            0,
          );
          return (
            <div key={order.id}>
              {i > 0 && <Separator />}
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : order.id)}
                className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
              >
                <div className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                  {TIME_FORMATTER.format(
                    new Date(order.closed_at ?? order.opened_at),
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {order.order_type === "takeaway" && (
                      <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">
                      {orderLabel(order, t)}
                    </span>
                    {order.status === "cancelled" && (
                      <Badge variant="destructive">{t("stats.cancelled")}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {itemCount === 1
                      ? t("stats.itemCountOne", { count: itemCount })
                      : t("stats.itemCountMany", { count: itemCount })}
                  </div>
                </div>
                <div className="shrink-0 font-semibold tabular-nums">
                  {formatMoney(order.total)}
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
              {expanded && (
                <div className="mb-3 ml-16 mr-7 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  {order.order_items.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-baseline justify-between gap-2 py-0.5"
                    >
                      <span className="min-w-0 truncate">
                        <span className="tabular-nums">{line.quantity}×</span>{" "}
                        {line.custom_name ?? line.menu_items?.name ?? t("stats.deletedItem")}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(line.unit_price * line.quantity)}
                      </span>
                    </div>
                  ))}
                  <Separator className="my-1.5" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("stats.subtotal")}</span>
                    <span className="tabular-nums">
                      {formatMoney(order.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("stats.tax")}</span>
                    <span className="tabular-nums">{formatMoney(order.tax)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>{t("stats.total")}</span>
                    <span className="tabular-nums">
                      {formatMoney(order.total)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
