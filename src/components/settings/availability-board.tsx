"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Check, CircleSlash, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  setIngredientAvailability,
  updateMenuItem,
  type MenuItemWithIngredients,
} from "@/lib/settings-api";
import type { Ingredient } from "@/lib/database.types";
import { cn } from "@/lib/utils";

interface AvailabilityBoardProps {
  ingredients: Ingredient[];
  items: MenuItemWithIngredients[];
  onChanged: () => Promise<void>;
}

export function AvailabilityBoard({
  ingredients,
  items,
  onChanged,
}: AvailabilityBoardProps) {
  const [busy, setBusy] = useState(false);

  const itemsUsing = (ingredientId: string) =>
    items.filter((i) => i.ingredients.some((g) => g.id === ingredientId));

  /** Items pulled from the POS because an ingredient is out of stock */
  const blockedItems = items.filter(
    (i) => i.is_available && i.ingredients.some((g) => !g.is_available),
  );
  const manuallyOff = items.filter((i) => !i.is_available);
  const outCount = ingredients.filter((g) => !g.is_available).length;

  async function toggle(g: Ingredient) {
    setBusy(true);
    try {
      await setIngredientAvailability(g.id, !g.is_available);
      await onChanged();
      const affected = itemsUsing(g.id).length;
      toast.success(
        g.is_available
          ? `${g.name} marked out of stock — ${affected} item${affected === 1 ? "" : "s"} pulled from the menu`
          : `${g.name} back in stock`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function restoreItem(item: MenuItemWithIngredients) {
    setBusy(true);
    try {
      await updateMenuItem(item.id, { is_available: true });
      await onChanged();
      toast.success(`${item.name} back on the menu`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CircleSlash className="h-5 w-5" /> Out of stock tonight
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Tap an ingredient you&apos;ve run out of — every menu item using it
            is hidden from the POS until you mark it back in stock.
          </p>
          <div className="flex flex-wrap gap-2">
            {ingredients.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No ingredients defined — add them in Menu settings first.
              </p>
            )}
            {ingredients.map((g) => (
              <button
                key={g.id}
                type="button"
                disabled={busy}
                onClick={() => toggle(g)}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50",
                  g.is_available
                    ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700"
                    : "border-red-600/30 bg-red-500/10 text-red-700 line-through",
                )}
              >
                {g.is_available ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                {g.name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Unavailable items{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({blockedItems.length + manuallyOff.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {blockedItems.length === 0 && manuallyOff.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {outCount > 0
                ? "No menu items are affected."
                : "Everything is available — full menu tonight."}
            </p>
          )}

          {blockedItems.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="text-xs text-muted-foreground">
                  Out of{" "}
                  {item.ingredients
                    .filter((g) => !g.is_available)
                    .map((g) => g.name)
                    .join(", ")}
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-red-600/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                86&apos;d
              </span>
            </div>
          ))}

          {manuallyOff.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="text-xs text-muted-foreground">
                  Taken off the menu manually
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-10 shrink-0"
                disabled={busy}
                onClick={() => restoreItem(item)}
              >
                <RotateCcw className="mr-1 h-4 w-4" /> Restore
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
