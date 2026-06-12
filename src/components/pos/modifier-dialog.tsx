"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/constants";
import { unitPriceWithModifiers } from "@/lib/money";
import type { ModifierGroupWithModifiers } from "@/lib/api";
import type { MenuItem, Modifier } from "@/lib/database.types";
import type { SelectedModifier } from "@/stores/ticket-store";
import { cn } from "@/lib/utils";

interface ModifierDialogProps {
  /** Item being configured; null = dialog closed */
  item: MenuItem | null;
  groups: ModifierGroupWithModifiers[];
  onClose: () => void;
  onConfirm: (item: MenuItem, modifiers: SelectedModifier[]) => void;
}

function adjustmentLabel(amount: number): string {
  if (amount === 0) return "";
  return `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}

function selectionRule(group: ModifierGroupWithModifiers): string {
  const { min_selections: min, max_selections: max } = group;
  if (min === max) return min === 1 ? "choose 1" : `choose ${min}`;
  if (min === 0) return max === 1 ? "optional" : `up to ${max}`;
  return `choose ${min}–${max}`;
}

/**
 * Pizzeria-style variations picker. Items linked to modifier groups never go
 * straight to the ticket: this dialog enforces each group's min/max before
 * "Add to Order" unlocks, and previews the price including adjustments.
 */
export function ModifierDialog({
  item,
  groups,
  onClose,
  onConfirm,
}: ModifierDialogProps) {
  // modifier ids picked per group id
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (item) setPicked({});
  }, [item]);

  function toggle(group: ModifierGroupWithModifiers, modifier: Modifier) {
    setPicked((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(modifier.id)) {
        return {
          ...prev,
          [group.id]: current.filter((id) => id !== modifier.id),
        };
      }
      // single-choice groups swap the selection; multi-choice respect the cap
      if (group.max_selections === 1) {
        return { ...prev, [group.id]: [modifier.id] };
      }
      if (current.length >= group.max_selections) return prev;
      return { ...prev, [group.id]: [...current, modifier.id] };
    });
  }

  const selected: SelectedModifier[] = useMemo(
    () =>
      groups.flatMap((g) =>
        g.modifiers
          .filter((m) => (picked[g.id] ?? []).includes(m.id))
          .map((m) => ({
            modifierId: m.id,
            name: m.name,
            priceAdjustment: m.price_adjustment,
          })),
      ),
    [groups, picked],
  );

  const unsatisfied = groups.filter(
    (g) => (picked[g.id] ?? []).length < g.min_selections,
  );
  const valid = item !== null && unsatisfied.length === 0;
  const total = item ? unitPriceWithModifiers(item.price, selected) : 0;

  function confirm() {
    if (!item || !valid) return;
    onConfirm(item, selected);
    onClose();
  }

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>
            Pick the variations for this item.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col gap-5 overflow-y-auto pr-1">
          {groups.map((g) => {
            const count = (picked[g.id] ?? []).length;
            const missing = count < g.min_selections;
            return (
              <div key={g.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{g.name}</span>
                  <span
                    className={cn(
                      "text-xs",
                      missing
                        ? "font-medium text-amber-600"
                        : "text-muted-foreground",
                    )}
                  >
                    {missing
                      ? `Choose at least ${g.min_selections}`
                      : selectionRule(g)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.modifiers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No options in this group yet.
                    </p>
                  )}
                  {g.modifiers.map((m) => {
                    const active = (picked[g.id] ?? []).includes(m.id);
                    const capped =
                      !active &&
                      g.max_selections > 1 &&
                      count >= g.max_selections;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={capped}
                        aria-pressed={active}
                        onClick={() => toggle(g, m)}
                        className={cn(
                          "min-h-11 rounded-full border px-4 py-1.5 text-sm transition-colors disabled:opacity-40",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {m.name}
                        {m.price_adjustment !== 0 && (
                          <span
                            className={cn(
                              "ml-1.5 text-xs tabular-nums",
                              active
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground",
                            )}
                          >
                            {adjustmentLabel(m.price_adjustment)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(total)}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-12 px-6"
              disabled={!valid}
              onClick={confirm}
            >
              Add to Order
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
