"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
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
  addablePantry,
  EMPTY_VARIATIONS,
  seedVariations,
  toggleAddition,
  toggleNote,
  toggleRemoval,
  variationPricePreview,
  variationsToModifiers,
  type VariationOption,
  type VariationState,
} from "@/lib/pos/variation-selection";
import type { SelectedModifier } from "@/stores/ticket-store";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Suggestions under the search box; typing more narrows past the rest. */
const MAX_SUGGESTIONS = 8;

interface VariationDialogProps {
  /** Whether the editor is open */
  open: boolean;
  /** Name of the ticket line being customized (dialog title) */
  itemName: string;
  /** Base price of the line, for the live total preview */
  basePrice: number;
  /** The dish's own ingredients — the "remove" side */
  dishIngredients: VariationOption[];
  /** Everything in stock — the "add" side */
  pantry: VariationOption[];
  /** Whether this dish has `allows_variations` on; when false the editor is
   * price-only and says so rather than showing two empty sections */
  variationsAllowed: boolean;
  /** `override_price` permission: turns the Base row into an input. Ingredient
   * edits stay open to everyone, so this gates the price alone. */
  canEditPrice?: boolean;
  /** The line's current variations — the picker opens pre-filled with these */
  initialModifiers?: SelectedModifier[];
  /** Note rapide on offer, in display order; shown for every dish */
  quickNotes?: string[];
  /** The line's current notes */
  initialNotes?: string[];
  onClose: () => void;
  /** `basePrice` is null unless an authorized user actually changed it, so an
   * untouched line never gets flagged as manually priced. */
  onConfirm: (
    modifiers: SelectedModifier[],
    basePrice: number | null,
    notes: string[],
  ) => void;
}

function Chip({
  active,
  onClick,
  icon,
  label,
  price,
  strike,
  removable,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  price?: number;
  strike?: boolean;
  /** Trailing ×, for a pill whose tap takes it off */
  removable?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors",
        active
          ? strike
            ? "border-destructive bg-destructive/10 text-destructive line-through"
            : "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {icon}
      <span>{label}</span>
      {price !== undefined && price > 0 && (
        <span
          className={cn(
            "text-xs tabular-nums",
            active ? "text-primary-foreground/80" : "text-muted-foreground/80",
          )}
        >
          +{formatMoney(price)}
        </span>
      )}
      {removable && <X className="h-3.5 w-3.5 shrink-0 opacity-80" />}
    </button>
  );
}

/**
 * Ingredient editor for a line that's already on the ticket. Adding a dish
 * drops it straight onto the table at its base price; this dialog is opened on
 * demand afterwards — nothing is forced.
 *
 * Two sections, because they are two different questions: what to take OFF this
 * dish (its own ingredients, always free) and what to put ON it (anything in
 * the pantry, found by typing, charged on the diminishing scale). Previewed
 * live. Below them the note rapide — free kitchen instructions offered on any
 * dish, even one with variations off.
 */
export function VariationDialog({
  open,
  itemName,
  basePrice,
  dishIngredients,
  pantry,
  variationsAllowed,
  canEditPrice = false,
  initialModifiers = [],
  quickNotes = [],
  initialNotes = [],
  onClose,
  onConfirm,
}: VariationDialogProps) {
  const t = useT();
  const [state, setState] = useState<VariationState>(EMPTY_VARIATIONS);
  const [notes, setNotes] = useState<string[]>([]);
  // search over the pantry, for the "add" section only
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Base price as typed. Kept as text so a half-finished "12." doesn't fight
  // the user by snapping back to a number mid-keystroke.
  const [priceText, setPriceText] = useState("");

  // Seed from the line's current variations on each open, not on every render
  // (so editing doesn't reset selections when the parent re-renders).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setState(seedVariations(initialModifiers));
      setNotes(initialNotes);
      setQuery("");
      setPriceText(basePrice.toFixed(2));
    }
    wasOpen.current = open;
  }, [open, initialModifiers, initialNotes, basePrice]);

  const parsedPrice = Number.parseFloat(priceText);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0;
  // Preview (and save) on the edited base when it parses; while it does not,
  // hold the original so the totals stay readable instead of going blank.
  const effectiveBase =
    canEditPrice && priceValid ? Math.round(parsedPrice * 100) / 100 : basePrice;
  const priceChanged = canEditPrice && effectiveBase !== basePrice;

  const selected: SelectedModifier[] = useMemo(
    () => variationsToModifiers(dishIngredients, pantry, state),
    [dishIngredients, pantry, state],
  );

  const { picked, matches, hiddenCount } = useMemo(
    () => addablePantry(pantry, dishIngredients, state, query, MAX_SUGGESTIONS),
    [pantry, dishIngredients, state, query],
  );

  // Live diminishing-scale preview: the linear sum of the added ingredients
  // (S) tapers to `surcharge` (P_total); removals never deduct.
  const { addedCount, linearExtras, surcharge, tapered, swapped, total } =
    variationPricePreview(effectiveBase, selected);

  // Picking a suggestion clears the box and keeps focus there, so the next
  // ingredient is just more typing.
  function addSuggestion(id: string) {
    setState((s) => toggleAddition(s, id));
    setQuery("");
    searchRef.current?.focus();
  }

  function confirm() {
    if (canEditPrice && !priceValid) return;
    onConfirm(selected, priceChanged ? effectiveBase : null, notes);
    onClose();
  }

  const notesSection = quickNotes.length > 0 && (
    <div className="flex flex-col gap-2">
      <span className="font-semibold">{t("pos.notesSection")}</span>
      <div className="flex flex-wrap gap-2">
        {quickNotes.map((n) => (
          <Chip
            key={n}
            active={notes.includes(n)}
            onClick={() => setNotes((ns) => toggleNote(ns, n, quickNotes))}
            icon={null}
            label={n}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-lg"
        // don't grab focus into the search box on open — keeps the on-screen
        // keyboard from popping when staff just want to tap a removal or a note
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{itemName}</DialogTitle>
          <DialogDescription>
            {variationsAllowed
              ? canEditPrice
                ? t("pos.editIngredientsAndPrice")
                : t("pos.addRemoveIngredients")
              : t("pos.variationsOff")}
          </DialogDescription>
        </DialogHeader>

        {variationsAllowed ? (
          <div className="flex max-h-[55vh] flex-col gap-5 overflow-y-auto pr-1">
            {dishIngredients.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="font-semibold">{t("pos.removeSection")}</span>
                <div className="flex flex-wrap gap-2">
                  {dishIngredients.map((i) => (
                    <Chip
                      key={i.id}
                      active={state.removedIds.includes(i.id)}
                      strike
                      onClick={() => setState((s) => toggleRemoval(s, i.id))}
                      icon={<Minus className="h-3.5 w-3.5 shrink-0" />}
                      label={i.name}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="font-semibold">{t("pos.addSection")}</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter takes the top suggestion, the one the eye is on
                    if (e.key === "Enter" && matches.length > 0) {
                      e.preventDefault();
                      addSuggestion(matches[0].id);
                    }
                  }}
                  placeholder={t("pos.searchIngredients")}
                  className="h-11 pl-9"
                  aria-label={t("pos.searchIngredientsAria")}
                  autoComplete="off"
                />
              </div>
              {query.trim() && (
                <ul className="flex flex-col divide-y overflow-hidden rounded-md border">
                  {matches.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => addSuggestion(i.id)}
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{i.name}</span>
                        {i.price > 0 && (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            +{formatMoney(i.price)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                  {matches.length === 0 && (
                    <li className="px-3 py-2.5 text-sm text-muted-foreground">
                      {t("pos.noIngredientsMatch", { query: query.trim() })}
                    </li>
                  )}
                  {hiddenCount > 0 && (
                    <li className="px-3 py-1.5 text-xs text-muted-foreground">
                      {t("pos.moreMatches", { count: hiddenCount })}
                    </li>
                  )}
                </ul>
              )}
              {/* what is added so far — tap one to take it off again */}
              {picked.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {picked.map((i) => (
                    <Chip
                      key={i.id}
                      active
                      removable
                      onClick={() => setState((s) => toggleAddition(s, i.id))}
                      icon={<Plus className="h-3.5 w-3.5 shrink-0" />}
                      label={i.name}
                      price={i.price}
                    />
                  ))}
                </div>
              )}
            </div>

            {notesSection}
          </div>
        ) : (
          // No ingredients to edit. Saying why beats showing two empty
          // sections: the switch lives in Settings → Menu, one click away.
          <div className="flex max-h-[55vh] flex-col gap-5 overflow-y-auto pr-1">
            {notesSection}
            <p className="text-sm text-muted-foreground">
              {t("pos.variationsOffHint")}
            </p>
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-[13rem] flex-col gap-0.5 text-sm">
            <div className="flex items-center justify-between gap-6 text-muted-foreground">
              <label
                htmlFor={canEditPrice ? "variation-base-price" : undefined}
              >
                {t("pos.base")}
              </label>
              {canEditPrice ? (
                <Input
                  id="variation-base-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirm();
                    }
                  }}
                  aria-label={t("pos.unitPrice")}
                  aria-invalid={!priceValid}
                  className="h-9 w-28 text-right tabular-nums"
                />
              ) : (
                <span className="tabular-nums">{formatMoney(basePrice)}</span>
              )}
            </div>
            {canEditPrice && (
              <p className="text-xs text-muted-foreground/70">
                {t("pos.appliesThisTicket")}
              </p>
            )}
            {addedCount > 0 && (
              <div className="flex items-center justify-between gap-6 text-muted-foreground">
                <span>
                  {t("pos.added", { count: addedCount })}
                  {(tapered || swapped) && (
                    <span className="ml-1 text-xs text-muted-foreground/70">
                      {[
                        swapped && t("pos.swap"),
                        tapered && t("pos.diminishing"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  {(tapered || swapped) && (
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
            <Button
              type="button"
              className="h-12 px-6"
              disabled={canEditPrice && !priceValid}
              onClick={confirm}
            >
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
