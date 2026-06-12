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
import type { NightSummary } from "@/lib/stats-api";

interface SummaryCardsProps {
  summary: NightSummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const cards = [
    {
      icon: Banknote,
      label: "Revenue (paid)",
      value: formatMoney(summary.paidTotal),
      detail: `${formatMoney(summary.paidSubtotal)} + ${formatMoney(summary.paidTax)} tax`,
    },
    {
      icon: ReceiptText,
      label: "Bills closed",
      value: String(summary.paidCount),
      detail:
        summary.paidCount > 0
          ? `${formatMoney(summary.avgBill)} avg per bill`
          : "No checkouts yet",
    },
    {
      icon: CookingPot,
      label: "Still open",
      value: formatMoney(summary.openTotal),
      detail: `${summary.openCount} open order${summary.openCount === 1 ? "" : "s"}`,
    },
    {
      icon: UtensilsCrossed,
      label: "Items ordered",
      value: String(summary.itemsOrdered),
      detail:
        summary.cancelledCount > 0
          ? `${summary.cancelledCount} order${summary.cancelledCount === 1 ? "" : "s"} cancelled`
          : "Across paid & open orders",
    },
    {
      icon: ShoppingBag,
      label: "Dine-in / Take-away",
      value: formatMoney(summary.dineInPaidTotal),
      detail: `${formatMoney(summary.takeawayPaidTotal)} take-away`,
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
