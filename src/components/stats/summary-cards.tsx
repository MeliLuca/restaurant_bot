"use client";

import {
  Banknote,
  CookingPot,
  ReceiptText,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import type { NightSummary } from "@/lib/stats-api";

interface SummaryCardsProps {
  summary: NightSummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const t = useT();
  const cards = [
    {
      icon: Banknote,
      label: t("stats.revenuePaid"),
      value: formatMoney(summary.paidTotal),
      detail: t("stats.revenueDetail", {
        subtotal: formatMoney(summary.paidSubtotal),
        tax: formatMoney(summary.paidTax),
      }),
    },
    {
      icon: ReceiptText,
      label: t("stats.billsClosed"),
      value: String(summary.paidCount),
      detail:
        summary.paidCount > 0
          ? t("stats.avgPerBill", { amount: formatMoney(summary.avgBill) })
          : t("stats.noCheckouts"),
    },
    {
      icon: CookingPot,
      label: t("stats.stillOpen"),
      value: formatMoney(summary.openTotal),
      detail:
        summary.openCount === 1
          ? t("stats.openOrdersOne", { count: summary.openCount })
          : t("stats.openOrdersMany", { count: summary.openCount }),
    },
    {
      icon: UtensilsCrossed,
      label: t("stats.itemsOrdered"),
      value: String(summary.itemsOrdered),
      detail:
        summary.cancelledCount > 0
          ? summary.cancelledCount === 1
            ? t("stats.ordersCancelledOne", { count: summary.cancelledCount })
            : t("stats.ordersCancelledMany", { count: summary.cancelledCount })
          : t("stats.acrossPaidOpen"),
    },
    {
      icon: ShoppingBag,
      label: t("stats.dineInTakeaway"),
      value: formatMoney(summary.dineInPaidTotal),
      detail: t("stats.takeawayDetail", {
        amount: formatMoney(summary.takeawayPaidTotal),
      }),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
      {cards.map(({ icon: Icon, label, value, detail }) => (
        <Card key={label}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon className="h-4 w-4" /> {label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <p className="text-xs text-muted-foreground">{detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
