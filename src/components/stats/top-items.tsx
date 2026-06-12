"use client";

import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/constants";
import type { Category } from "@/lib/database.types";
import type { CategoryStat, ItemStat } from "@/lib/stats-api";

interface TopItemsProps {
  items: ItemStat[];
  categories: CategoryStat[];
  categoryNames: Map<string, Category>;
}

export function TopItems({ items, categories, categoryNames }: TopItemsProps) {
  const maxQuantity = items[0]?.quantity ?? 0;
  const maxRevenue = categories[0]?.revenue ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5" /> Items ordered
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Nothing ordered yet.
            </p>
          )}
          {items.map((item, rank) => (
            <div key={item.menuItemId} className="flex items-center gap-3">
              <div className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                {rank + 1}.
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatMoney(item.revenue)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{
                      width: `${maxQuantity ? (item.quantity / maxQuantity) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                ×{item.quantity}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Sales by category</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {categories.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              No sales yet.
            </p>
          )}
          {categories.map((c) => (
            <div key={c.categoryId ?? "uncategorized"}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {(c.categoryId && categoryNames.get(c.categoryId)?.name) ??
                    "Uncategorized"}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.quantity} items · {formatMoney(c.revenue)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary"
                  style={{
                    width: `${maxRevenue ? (c.revenue / maxRevenue) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
