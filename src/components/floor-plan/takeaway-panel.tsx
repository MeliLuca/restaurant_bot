"use client";

import { useRouter } from "next/navigation";
import { ReceiptText, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/lib/constants";
import type { Order } from "@/lib/database.types";
import { useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

interface TakeawayPanelProps {
  takeaways: Order[];
}

export function TakeawayPanel({ takeaways }: TakeawayPanelProps) {
  const router = useRouter();
  const setTakeaway = useTicketStore((s) => s.setTakeaway);
  const canTakeOrders = usePermission("take_orders");

  function openInPos(order: Order) {
    setTakeaway(order.id, order.customer_name ?? "");
    router.push("/pos");
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingBag className="h-5 w-5" /> Open take-aways
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {takeaways.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            No open take-away orders.
          </p>
        )}
        {takeaways.map((o, i) => (
          <div key={o.id}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-center gap-3 py-2">
              <div className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                {TIME_FORMATTER.format(new Date(o.opened_at))}
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
                  {formatMoney(o.total)} · open
                </div>
              </div>
              {canTakeOrders && (
                <Button
                  size="sm"
                  className="h-10 shrink-0"
                  onClick={() => openInPos(o)}
                >
                  <ReceiptText className="mr-1 h-4 w-4" /> Open in POS
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
