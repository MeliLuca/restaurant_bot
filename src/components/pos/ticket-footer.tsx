"use client";

import { ChefHat, CreditCard, ReceiptText, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpenOrder } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";

/** Totals and the bill actions (send, pre-conto, split, pay). Every action is
 * a callback: the flows (linked-table guard, cleanup prompt, dialogs) stay in
 * TicketPanel. */
export interface TicketFooterProps {
  totals: { subtotal: number; tax: number; total: number };
  payments: OpenOrder["payments"];
  /** Already paid through split payments, in cents */
  paidCents: number;
  /** What a checkout still collects, in cents */
  balanceCents: number;
  /** Number of pending (unsent) lines */
  pendingCount: number;
  hasTarget: boolean;
  hasOpenOrder: boolean;
  busy: boolean;
  canCheckout: boolean;
  onSend: () => void;
  onPreReceipt: () => void;
  onSplit: () => void;
  onCheckout: () => void;
}

export function TicketFooter({
  totals,
  payments,
  paidCents,
  balanceCents,
  pendingCount,
  hasTarget,
  hasOpenOrder,
  busy,
  canCheckout,
  onSend,
  onPreReceipt,
  onSplit,
  onCheckout,
}: TicketFooterProps) {
  const t = useT();

  const hasPayments = paidCents > 0;
  const payLabel = t("pos.checkoutBtn", {
    amount: formatMoney(balanceCents / 100),
  });
  // One primary action at a time: send what is pending, else collect.
  const primary: "send" | "pay" | null =
    pendingCount > 0
      ? "send"
      : hasOpenOrder && canCheckout
        ? "pay"
        : null;
  // While "send" is primary, payment stays one tap away (checkout sends the
  // pending lines first, as before).
  const secondaryPay = primary === "send" && canCheckout;
  const blocked = busy || !hasTarget;

  // Table actions (collega, cambio tavolo) live in the header's ⋯ menu.
  const showSecondaryRow =
    hasOpenOrder || secondaryPay;

  return (
    <div className="flex flex-col gap-3 border-t p-4">
      {/* Totals: one prominent figure, the breakdown in small print */}
      <div className="flex flex-col gap-0.5">
        <div
          className={
            hasPayments
              ? "flex items-baseline justify-between text-base font-medium"
              : "flex items-baseline justify-between text-xl font-semibold"
          }
        >
          <span>{t("pos.total")}</span>
          <span className="tabular-nums">{formatMoney(totals.total)}</span>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          {t("pos.subtotal")} {formatMoney(totals.subtotal)} · {t("pos.tax")}{" "}
          {formatMoney(totals.tax)}
        </p>
        {hasPayments && (
          <>
            <div className="mt-1 flex items-baseline justify-between text-sm text-muted-foreground">
              <span>
                {payments.length === 1
                  ? t("pos.paidPaymentsOne")
                  : t("pos.paidPaymentsMany", { count: payments.length })}
              </span>
              <span className="tabular-nums">
                −{formatMoney(paidCents / 100)}
              </span>
            </div>
            <div className="flex items-baseline justify-between text-xl font-semibold">
              <span>{t("pos.balanceDue")}</span>
              <span className="tabular-nums">
                {formatMoney(balanceCents / 100)}
              </span>
            </div>
          </>
        )}
      </div>

      {primary === "send" && (
        <Button
          size="lg"
          className="h-14 text-base"
          disabled={blocked}
          onClick={onSend}
        >
          <ChefHat className="mr-2 h-5 w-5" />
          {t("cassa.footer.sendCount", { count: pendingCount })}
        </Button>
      )}
      {primary === "pay" && (
        <Button
          size="lg"
          className="h-14 text-base"
          disabled={blocked}
          onClick={onCheckout}
        >
          <CreditCard className="mr-2 h-5 w-5" />
          {payLabel}
        </Button>
      )}

      {showSecondaryRow && (
        <div className="flex gap-2">
          {hasOpenOrder && (
            <Button
              variant="outline"
              className="h-12 min-w-0 flex-1 px-2 text-sm"
              disabled={busy}
              onClick={onPreReceipt}
            >
              <ReceiptText className="mr-1.5 hidden h-4 w-4 shrink-0 sm:block" />
              <span className="truncate">{t("pos.preReceiptBtn")}</span>
            </Button>
          )}
          {hasOpenOrder && canCheckout && (
            <Button
              variant="outline"
              className="h-12 min-w-0 flex-1 px-2 text-sm"
              disabled={busy}
              onClick={onSplit}
            >
              <Split className="mr-1.5 hidden h-4 w-4 shrink-0 sm:block" />
              <span className="truncate">{t("cassa.footer.split")}</span>
            </Button>
          )}
          {secondaryPay && (
            <Button
              variant="outline"
              className="h-12 min-w-0 flex-1 px-2 text-sm"
              disabled={blocked}
              onClick={onCheckout}
            >
              <CreditCard className="mr-1.5 hidden h-4 w-4 shrink-0 sm:block" />
              <span className="truncate tabular-nums">{payLabel}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
