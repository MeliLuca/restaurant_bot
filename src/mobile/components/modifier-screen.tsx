"use client";

import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import {
  isCapped,
  modifierPricePreview,
  pickedToModifiers,
  seedPicked,
  selectionRule,
  togglePick,
} from "@/lib/pos/modifier-selection";
import { cn } from "@/lib/utils";
import type { ModifierGroupWithModifiers } from "@/lib/api";
import type { SelectedModifier } from "@/stores/ticket-store";

/**
 * Ingredient picker as a full-height sheet rather than a centred dialog: on a
 * phone a Radix Dialog fights the on-screen keyboard, and there is no room for
 * a dialog's margins anyway.
 *
 * All the selection rules and pricing come from @/lib/pos/modifier-selection,
 * the same module the desktop dialog uses — only the chrome differs.
 */
export function ModifierScreen({
  itemName,
  basePrice,
  groups,
  initialModifiers = [],
  onClose,
  onConfirm,
}: {
  itemName: string;
  basePrice: number;
  groups: ModifierGroupWithModifiers[];
  initialModifiers?: SelectedModifier[];
  onClose: () => void;
  onConfirm: (modifiers: SelectedModifier[]) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    seedPicked(groups, initialModifiers),
  );

  const selected = pickedToModifiers(groups, picked);
  const { addedCount, linearExtras, surcharge, tapered, total } =
    modifierPricePreview(basePrice, selected);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-card px-2">
        <button
          type="button"
          aria-label={t("common.cancel")}
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground"
        >
          <X className="h-6 w-6" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {itemName}
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {groups.map((g) => {
          const count = (picked[g.id] ?? []).length;
          return (
            <section key={g.id} className="mb-5">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">{g.name}</h3>
                <span className="text-xs text-muted-foreground">
                  {selectionRule(g, t)}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {g.modifiers.map((m) => {
                  const active = (picked[g.id] ?? []).includes(m.id);
                  const capped = isCapped(g, count, active);
                  // positive adjustment = an addition (charged on the
                  // diminishing scale); anything else is a free removal
                  const isAdd = m.price_adjustment > 0;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={capped}
                      aria-pressed={active}
                      onClick={() =>
                        setPicked((prev) => {
                          const current = prev[g.id] ?? [];
                          const next = togglePick(g, current, m.id);
                          return next === current
                            ? prev
                            : { ...prev, [g.id]: next };
                        })
                      }
                      className={cn(
                        "flex min-h-14 items-center gap-2 rounded-xl border px-4 text-left text-base transition-colors disabled:opacity-40",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-foreground",
                      )}
                    >
                      {isAdd ? (
                        <Plus className="h-4 w-4 shrink-0" />
                      ) : (
                        <Minus className="h-4 w-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">{m.name}</span>
                      {isAdd && (
                        <span className="shrink-0 text-sm tabular-nums opacity-80">
                          +{formatMoney(m.price_adjustment)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="shrink-0 border-t bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex flex-col gap-0.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>{t("pos.base")}</span>
            <span className="tabular-nums">{formatMoney(basePrice)}</span>
          </div>
          {addedCount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>
                {t("pos.added", { count: addedCount })}
                {tapered && (
                  <span className="ml-1 text-xs opacity-70">
                    {t("pos.diminishing")}
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {tapered && (
                  <span className="mr-1.5 text-xs line-through opacity-60">
                    {formatMoney(linearExtras)}
                  </span>
                )}
                +{formatMoney(surcharge)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <span>{t("pos.total")}</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onConfirm(selected);
            onClose();
          }}
          className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground"
        >
          {t("common.save")}
        </button>
      </footer>
    </div>
  );
}
