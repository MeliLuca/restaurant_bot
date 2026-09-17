"use client";

import { Minus, Plus, Trash2, X } from "lucide-react";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import {
  lineUnitPrice,
  useTicketStore,
  type TicketLine,
} from "@/stores/ticket-store";

/**
 * The pending (unsent) lines, as a sheet over the menu.
 *
 * Deliberately NOT the desktop TicketPanel: importing that would drag five
 * desktop dialogs into the phone bundle and make src/mobile un-extractable.
 * The shared part is the flow underneath (use-order-actions), not the chrome.
 */
export function TicketLinesSheet({
  onClose,
  onEditModifiers,
  canEditLine,
  total,
  busy,
  onSend,
}: {
  onClose: () => void;
  onEditModifiers: (line: TicketLine) => void;
  /** True when this user can change something on the line — its ingredients,
   * its price, or both. Mirrors the pencil's gate on the POS. */
  canEditLine: (menuItemId: string) => boolean;
  total: number;
  busy: boolean;
  onSend: () => void;
}) {
  const t = useT();
  const lines = useTicketStore((s) => s.lines);
  const setQuantity = useTicketStore((s) => s.setQuantity);
  const removeItem = useTicketStore((s) => s.removeItem);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-card px-2">
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground"
        >
          <X className="h-6 w-6" />
        </button>
        <h2 className="flex-1 text-lg font-semibold">{t("pos.viewTicket")}</h2>
      </header>

      <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
        {lines.length === 0 && (
          <li className="p-4 text-muted-foreground">{t("m.emptyTicket")}</li>
        )}
        {lines.map((l) => (
          <li key={l.lineId} className="flex flex-col gap-2 p-3">
            <div className="flex items-start gap-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-base leading-snug">{l.name}</span>
                {l.ingredients && (
                  <span className="text-sm leading-snug text-muted-foreground">
                    {l.ingredients}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-base font-semibold tabular-nums">
                {formatMoney(lineUnitPrice(l) * l.quantity)}
              </span>
            </div>

            {l.modifiers.length > 0 && (
              <ul className="pl-3 text-xs text-muted-foreground">
                {l.modifiers.map((m) => (
                  <li
                    key={`${m.ingredientId}:${m.isRemoval}`}
                    className="flex justify-between gap-2"
                  >
                    <span className="min-w-0 truncate">
                      {m.isRemoval ? "− " : "+ "}
                      {m.name}
                    </span>
                    {m.priceAdjustment > 0 && (
                      <span className="shrink-0 tabular-nums">
                        +{formatMoney(m.priceAdjustment)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("pos.decrease", { name: l.name })}
                onClick={() => setQuantity(l.lineId, l.quantity - 1)}
                className="flex h-11 w-11 items-center justify-center rounded-lg border"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-base font-semibold tabular-nums">
                {l.quantity}
              </span>
              <button
                type="button"
                aria-label={t("pos.increase", { name: l.name })}
                onClick={() => setQuantity(l.lineId, l.quantity + 1)}
                className="flex h-11 w-11 items-center justify-center rounded-lg border"
              >
                <Plus className="h-4 w-4" />
              </button>

              {canEditLine(l.menuItemId) && (
                <button
                  type="button"
                  onClick={() => onEditModifiers(l)}
                  className="ml-1 min-h-11 rounded-lg border px-3 text-sm font-medium text-primary"
                >
                  {t("m.ingredients")}
                </button>
              )}

              <button
                type="button"
                aria-label={t("pos.remove", { name: l.name })}
                onClick={() => removeItem(l.lineId)}
                className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {lines.length > 0 && (
        <footer className="shrink-0 border-t bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mb-2 flex justify-between text-base font-semibold">
            <span>{t("pos.total")}</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onSend}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("pos.sendToKitchenBtn")}
          </button>
        </footer>
      )}
    </div>
  );
}
