"use client";

import { useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import {
  addablePantry,
  seedVariations,
  toggleAddition,
  toggleRemoval,
  variationPricePreview,
  variationsToModifiers,
  type VariationOption,
  type VariationState,
} from "@/lib/pos/variation-selection";
import { cn } from "@/lib/utils";
import { useKeyboardInset } from "@/mobile/hooks/use-keyboard-inset";
import type { SelectedModifier } from "@/stores/ticket-store";

/** The pantry is long; show a screenful and let the search box reach the rest. */
const MAX_PANTRY_ROWS = 30;

/**
 * Ingredient picker as a full-height sheet rather than a centred dialog: on a
 * phone a Radix Dialog fights the on-screen keyboard, and there is no room for
 * a dialog's margins anyway.
 *
 * Two sections — take OFF the dish's own ingredients (always free), put ON
 * anything from the pantry (charged on the diminishing scale). All the
 * selection rules and pricing come from @/lib/pos/variation-selection, the same
 * module the desktop dialog uses — only the chrome differs.
 */
export function VariationScreen({
  itemName,
  basePrice,
  dishIngredients,
  pantry,
  variationsAllowed,
  canEditPrice = false,
  initialModifiers = [],
  onClose,
  onConfirm,
}: {
  itemName: string;
  basePrice: number;
  dishIngredients: VariationOption[];
  pantry: VariationOption[];
  /** `allows_variations` on the dish; false makes this a price-only sheet */
  variationsAllowed: boolean;
  /** `override_price` permission — same gate as the desktop dialog */
  canEditPrice?: boolean;
  initialModifiers?: SelectedModifier[];
  onClose: () => void;
  onConfirm: (modifiers: SelectedModifier[], basePrice: number | null) => void;
}) {
  const t = useT();
  const [state, setState] = useState<VariationState>(() =>
    seedVariations(initialModifiers),
  );
  const [query, setQuery] = useState("");
  const [priceText, setPriceText] = useState(() => basePrice.toFixed(2));
  // this screen has a text input, so the footer has to stay above the keyboard
  const keyboardInset = useKeyboardInset();

  const parsedPrice = Number.parseFloat(priceText);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0;
  const effectiveBase =
    canEditPrice && priceValid ? Math.round(parsedPrice * 100) / 100 : basePrice;
  const priceChanged = canEditPrice && effectiveBase !== basePrice;

  const selected = variationsToModifiers(dishIngredients, pantry, state);
  const { picked, matches, hiddenCount } = addablePantry(
    pantry,
    dishIngredients,
    state,
    query,
    MAX_PANTRY_ROWS,
  );
  const { addedCount, linearExtras, surcharge, tapered, total } =
    variationPricePreview(effectiveBase, selected);

  const rowClass = (active: boolean, strike: boolean) =>
    cn(
      "flex min-h-14 items-center gap-2 rounded-xl border px-4 text-left text-base transition-colors",
      active
        ? strike
          ? "border-destructive bg-destructive/10 text-destructive line-through"
          : "border-primary bg-primary text-primary-foreground"
        : "text-foreground",
    );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]"
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
    >
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
        {!variationsAllowed && (
          <p className="mb-4 text-sm text-muted-foreground">
            {t("pos.variationsOff")} {t("pos.variationsOffHint")}
          </p>
        )}
        {variationsAllowed && dishIngredients.length > 0 && (
          <section className="mb-5">
            <h3 className="mb-2 font-semibold">{t("pos.removeSection")}</h3>
            <div className="flex flex-col gap-2">
              {dishIngredients.map((i) => {
                const active = state.removedIds.includes(i.id);
                return (
                  <button
                    key={i.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setState((s) => toggleRemoval(s, i.id))}
                    className={rowClass(active, true)}
                  >
                    <Minus className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{i.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {variationsAllowed && (
        <section>
          <h3 className="mb-2 font-semibold">{t("pos.addSection")}</h3>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pos.searchIngredients")}
              aria-label={t("pos.searchIngredientsAria")}
              className="h-12 w-full rounded-xl border bg-card pl-9 pr-3 text-base outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-2">
            {/* picked first, so a search can never hide what is selected */}
            {[...picked, ...matches].map((i) => {
              const active = state.addedIds.includes(i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setState((s) => toggleAddition(s, i.id))}
                  className={rowClass(active, false)}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{i.name}</span>
                  {i.price > 0 && (
                    <span className="shrink-0 text-sm tabular-nums opacity-80">
                      +{formatMoney(i.price)}
                    </span>
                  )}
                </button>
              );
            })}
            {picked.length + matches.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("pos.noIngredientsMatch", { query: query.trim() })}
              </p>
            )}
            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("menu.moreIngredients", { count: hiddenCount })}
              </p>
            )}
          </div>
        </section>
        )}
      </div>

      <footer className="shrink-0 border-t bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex flex-col gap-0.5 text-sm">
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <label htmlFor={canEditPrice ? "m-base-price" : undefined}>
              {t("pos.base")}
            </label>
            {canEditPrice ? (
              <input
                id="m-base-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                aria-label={t("pos.unitPrice")}
                aria-invalid={!priceValid}
                className="h-11 w-28 rounded-xl border bg-card px-3 text-right text-base tabular-nums text-foreground outline-none focus:border-primary"
              />
            ) : (
              <span className="tabular-nums">{formatMoney(basePrice)}</span>
            )}
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
          disabled={canEditPrice && !priceValid}
          onClick={() => {
            onConfirm(selected, priceChanged ? effectiveBase : null);
            onClose();
          }}
          className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      </footer>
    </div>
  );
}
