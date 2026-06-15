"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/constants";
import {
  addedIngredientsLinearSum,
  addedIngredientsSurcharge,
} from "@/lib/money";
import type { ModifierGroupWithModifiers } from "@/lib/api";
import type { Modifier } from "@/lib/database.types";
import type { SelectedModifier } from "@/stores/ticket-store";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

interface ModifierDialogProps {
  /** Whether the editor is open */
  open: boolean;
  /** Name of the ticket line being customized (dialog title) */
  itemName: string;
  /** Base price of the line, for the live total preview */
  basePrice: number;
  groups: ModifierGroupWithModifiers[];
  /** The line's current ingredients — the picker opens pre-filled with these */
  initialModifiers?: SelectedModifier[];
  onClose: () => void;
  onConfirm: (modifiers: SelectedModifier[]) => void;
}

function selectionRule(group: ModifierGroupWithModifiers, t: TFn): string {
  const { min_selections: min, max_selections: max } = group;
  if (min === max)
    return min === 1 ? t("pos.ruleChoose1") : t("pos.ruleChooseN", { count: min });
  if (min === 0)
    return max === 1 ? t("pos.ruleOptional") : t("pos.ruleUpToN", { count: max });
  return t("pos.ruleChooseRange", { min, max });
}

/** Map the line's existing modifiers back to picked ids, per group. */
function seedPicked(
  groups: ModifierGroupWithModifiers[],
  initial: SelectedModifier[],
): Record<string, string[]> {
  const chosen = new Set(initial.map((m) => m.modifierId));
  const picked: Record<string, string[]> = {};
  for (const g of groups) {
    const ids = g.modifiers.filter((m) => chosen.has(m.id)).map((m) => m.id);
    if (ids.length) picked[g.id] = ids;
  }
  return picked;
}

/**
 * Ingredient editor for a line that's already on the ticket. Adding a dish
 * drops it straight onto the table at its base price; this dialog is opened
 * on demand to add (+) or remove (−) ingredients afterwards — nothing is
 * forced. Added ingredients are charged on the diminishing scale (removals
 * never deduct), previewed live.
 */
export function ModifierDialog({
  open,
  itemName,
  basePrice,
  groups,
  initialModifiers = [],
  onClose,
  onConfirm,
}: ModifierDialogProps) {
  const t = useT();
  // modifier ids picked per group id
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  // free-text filter over ingredient names
  const [query, setQuery] = useState("");

  // Seed from the line's current ingredients on each open, not on every render
  // (so editing doesn't reset selections when the parent re-renders).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setPicked(seedPicked(groups, initialModifiers));
      setQuery("");
    }
    wasOpen.current = open;
  }, [open, groups, initialModifiers]);

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

  // Search only filters what's shown — picks and the running total below always
  // read the full `selected` set, so a filtered-out ingredient stays selected.
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      q
        ? groups
            .map((g) => ({
              ...g,
              modifiers: g.modifiers.filter((m) =>
                m.name.toLowerCase().includes(q),
              ),
            }))
            .filter((g) => g.modifiers.length > 0)
        : groups,
    [groups, q],
  );

  // Live diminishing-scale preview: the linear sum of the added ingredients
  // (S) tapers to `surcharge` (P_total); removals never deduct.
  const addedCount = selected.filter((m) => m.priceAdjustment > 0).length;
  const linearExtras = addedIngredientsLinearSum(selected);
  const surcharge = addedIngredientsSurcharge(selected);
  const tapered = surcharge < linearExtras; // n ≥ 2 → the scale has kicked in
  const total = basePrice + surcharge;

  function confirm() {
    onConfirm(selected);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-lg"
        // don't grab focus into the search box on open — keeps the on-screen
        // keyboard from popping when staff just want to tap ingredient pills
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{itemName}</DialogTitle>
          <DialogDescription>{t("pos.addRemoveIngredients")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("pos.searchIngredients")}
            className="h-11 pl-9"
            aria-label={t("pos.searchIngredientsAria")}
          />
        </div>

        <div className="flex max-h-[55vh] flex-col gap-5 overflow-y-auto pr-1">
          {visibleGroups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("pos.noIngredientsMatch", { query: query.trim() })}
            </p>
          )}
          {visibleGroups.map((g) => {
            const count = (picked[g.id] ?? []).length;
            return (
              <div key={g.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{g.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectionRule(g, t)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.modifiers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("pos.noOptionsInGroup")}
                    </p>
                  )}
                  {g.modifiers.map((m) => {
                    const active = (picked[g.id] ?? []).includes(m.id);
                    const capped =
                      !active &&
                      g.max_selections > 1 &&
                      count >= g.max_selections;
                    // Positive adjustment = an addition (+, charged on the
                    // diminishing scale); anything else = a removal (−, free).
                    const isAdd = m.price_adjustment > 0;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={capped}
                        aria-pressed={active}
                        onClick={() => toggle(g, m)}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors disabled:opacity-40",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {isAdd ? (
                          <Plus className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Minus className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{m.name}</span>
                        {isAdd && (
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              active
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground/80",
                            )}
                          >
                            +{formatMoney(m.price_adjustment)}
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

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-[13rem] flex-col gap-0.5 text-sm">
            <div className="flex items-center justify-between gap-6 text-muted-foreground">
              <span>{t("pos.base")}</span>
              <span className="tabular-nums">{formatMoney(basePrice)}</span>
            </div>
            {addedCount > 0 && (
              <div className="flex items-center justify-between gap-6 text-muted-foreground">
                <span>
                  {t("pos.added", { count: addedCount })}
                  {tapered && (
                    <span className="ml-1 text-xs text-muted-foreground/70">
                      {t("pos.diminishing")}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  {tapered && (
                    <span className="mr-1.5 text-xs text-muted-foreground/60 line-through">
                      {formatMoney(linearExtras)}
                    </span>
                  )}
                  +{formatMoney(surcharge)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-6 text-base font-semibold text-foreground">
              <span>{t("pos.total")}</span>
              <span className="tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" className="h-12 px-6" onClick={confirm}>
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
