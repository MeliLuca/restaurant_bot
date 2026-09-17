"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/lib/constants";
import { formatTime } from "@/lib/takeaway/slots";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";

interface TakeawayPanelProps {
  takeaways: Order[];
}

export function TakeawayPanel({ takeaways }: TakeawayPanelProps) {
  const router = useRouter();
  const t = useT();
  const setTakeaway = useTicketStore((s) => s.setTakeaway);
  const canTakeOrders = usePermission("take_orders");

  // By promised time, not by when it was written down: the list is read to
  // answer "what goes out next". Orders with no promised time sink to the
  // bottom — they are the ones already being packed.
  const ordered = useMemo(
    () =>
      [...takeaways].sort((a, b) => {
        if (a.pickup_at === b.pickup_at) return 0;
        if (a.pickup_at === null) return 1;
        if (b.pickup_at === null) return -1;
        return a.pickup_at < b.pickup_at ? -1 : 1;
      }),
    [takeaways],
  );

  function openInPos(order: Order) {
    setTakeaway(order.id, order.customer_name ?? "");
    router.push("/pos");
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingBag className="h-5 w-5" /> {t("floor.openTakeaways")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {ordered.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            {t("floor.noOpenTakeaways")}
          </p>
        )}
        {ordered.map((o, i) => (
          <div key={o.id}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-center gap-3 py-2">
              <div className="w-16 shrink-0">
                <div
                  className={
                    o.pickup_at === null
                      ? "text-sm font-semibold text-muted-foreground"
                      : "text-sm font-semibold tabular-nums"
                  }
                >
                  {o.pickup_at === null
                    ? t("takeaway.noTimeShort")
                    : formatTime(o.pickup_at)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t("takeaway.openedAt", { time: formatTime(o.opened_at) })}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {o.delivery_number !== null && (
                    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                      #{o.delivery_number}
                    </span>
                  )}
                  <span className="truncate font-medium">{o.customer_name}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatMoney(o.total)} · {t("floor.openLower")}
                </div>
              </div>
              {canTakeOrders && (
                <Button
                  size="sm"
                  className="h-10 shrink-0"
                  onClick={() => openInPos(o)}
                >
                  <ReceiptText className="mr-1 h-4 w-4" /> {t("floor.openInPos")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
