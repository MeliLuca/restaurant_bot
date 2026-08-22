"use client";

import Link from "next/link";
import { ChefHat, Printer, TriangleAlert, Wallet } from "lucide-react";
import { useOrderActions } from "@/hooks/use-order-actions";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { remainingBalanceCents } from "@/lib/money";
import { calcTotals, lineUnitPrice, useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { mRoutes } from "@/mobile/lib/routes";
import { useBill } from "@/mobile/hooks/use-bill";
import { useBillTarget } from "@/mobile/hooks/use-bill-target";
import { MHeader } from "./m-header";

/** A settled bill, a cancelled one, and a bad id all look the same from here:
 *  the order id no longer resolves. Say so — a back gesture off a checkout
 *  lands on exactly this. */
function ClosedBill() {
  const t = useT();
  return (
    <>
      <MHeader title={t("m.billClosed")} backHref={mRoutes.tables()} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{t("m.billClosedBody")}</p>
        <Link
          href={mRoutes.tables()}
          className="flex min-h-12 items-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground"
        >
          {t("m.backToTables")}
        </Link>
      </div>
    </>
  );
}

/**
 * One bill: what is on it, what has already been paid, what is left.
 *
 * Payment lives one route further on (/pay) rather than in a sheet, so the OS
 * back gesture is the cancel affordance and no focus trap fights the keyboard.
 */
export function BillView({ orderId }: { orderId: string }) {
  const t = useT();
  const canCheckout = usePermission("checkout_orders");
  const canTakeOrders = usePermission("take_orders");
  const { bill, tableName, label, closed, loading, error, refresh } =
    useBill(orderId);
  useBillTarget(bill, tableName);

  // Unsent lines for *this* bill's target — the binding above is what makes
  // that true. They are not on the bill yet, so they are not in any total here.
  const lines = useTicketStore((s) => s.lines);
  const pendingCount = lines.reduce((n, l) => n + l.quantity, 0);
  const pendingTotal = calcTotals(
    lines.map((l) => ({ unitPrice: lineUnitPrice(l), quantity: l.quantity })),
    bill?.order.tax_rate ?? undefined,
  ).total;

  const { send, preReceipt, busy } = useOrderActions({
    openOrder: bill,
    onOrderChanged: refresh,
  });

  if (closed) return <ClosedBill />;

  if (!bill) {
    return (
      <>
        <MHeader title="…" backHref={mRoutes.tables()} />
        <div className="p-4 text-muted-foreground">
          {error ? (
            <span className="text-destructive">{t("m.loadFailed")}</span>
          ) : loading ? (
            t("common.loading")
          ) : null}
        </div>
      </>
    );
  }

  const { order, items, payments } = bill;
  const balanceCents = remainingBalanceCents(order, payments);
  const backHref = order.table_id
    ? mRoutes.table(order.table_id)
    : mRoutes.bills();
  // Paying a bill that has unsent items would settle the wrong amount, so the
  // send is offered first rather than folded silently into the charge.
  const blockedByPending = lines.length > 0;

  return (
    <>
      <MHeader title={label || "…"} backHref={backHref} />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {blockedByPending && (
          <div className="mb-3 flex flex-col gap-3 rounded-xl border border-amber-500/60 bg-amber-500/10 p-3">
            <p className="flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <span>
                {t(
                  pendingCount === 1
                    ? "m.pendingNotOnBillOne"
                    : "m.pendingNotOnBill",
                  { count: pendingCount, amount: formatMoney(pendingTotal) },
                )}
              </span>
            </p>
            {canTakeOrders && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
              >
                <ChefHat className="h-5 w-5" />
                {t("pos.sendToKitchenBtn")}
              </button>
            )}
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {items.map((i) => {
            const name =
              (i.menu_items?.name ?? t("floor.itemFallback")) +
              (i.fraction_of ? ` (1/${i.fraction_of})` : "");
            const paid = i.paid_by_payment_id !== null;
            return (
              <li key={i.id}>
                <div
                  className={cn(
                    "flex items-baseline gap-2 text-base",
                    paid && "text-muted-foreground line-through",
                  )}
                >
                  <span className="w-7 shrink-0 font-semibold tabular-nums">
                    {i.quantity}×
                  </span>
                  <span className="min-w-0 flex-1">{name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(i.unit_price * i.quantity)}
                  </span>
                </div>
                {(i.order_item_modifiers ?? []).map((m) => (
                  <div
                    key={m.id}
                    className="pl-9 text-sm text-muted-foreground"
                  >
                    {m.price_adjustment > 0 ? "+" : "−"} {m.name}
                  </div>
                ))}
                {paid && (
                  <div className="pl-9 text-xs font-medium uppercase text-emerald-600">
                    {t("pos.paid")}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex flex-col gap-1 border-t pt-3 text-base">
          <div className="flex justify-between text-muted-foreground">
            <span>{t("pos.subtotal")}</span>
            <span className="tabular-nums">{formatMoney(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>{t("pos.tax")}</span>
            <span className="tabular-nums">{formatMoney(order.tax)}</span>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <span>{t("pos.total")}</span>
            <span className="tabular-nums">{formatMoney(order.total)}</span>
          </div>

          {payments.map((p) => (
            <div
              key={p.id}
              className="flex justify-between text-sm text-emerald-600"
            >
              <span>
                {p.kind === "even"
                  ? t("pos.allaRomanaShare")
                  : t("pos.itemsPayment")}
              </span>
              <span className="tabular-nums">−{formatMoney(p.amount)}</span>
            </div>
          ))}

          {payments.length > 0 && (
            <div className="mt-1 flex justify-between border-t pt-2 text-lg font-semibold">
              <span>{t("pos.balanceDue")}</span>
              <span className="tabular-nums">
                {formatMoney(balanceCents / 100)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t bg-card p-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void preReceipt()}
          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border text-base font-semibold disabled:opacity-50"
        >
          <Printer className="h-5 w-5" />
          {t("pos.preReceiptBtn")}
        </button>
        {canCheckout &&
          // Unsent lines are not in this total, so paying now would settle the
          // wrong amount: the link becomes an inert button until they are sent.
          (blockedByPending ? (
            <button
              type="button"
              disabled
              className="flex min-h-14 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground opacity-50"
            >
              <Wallet className="h-5 w-5" />
              {t("pos.checkoutBtn", { amount: formatMoney(balanceCents / 100) })}
            </button>
          ) : (
            <Link
              href={mRoutes.pay(orderId)}
              className="flex min-h-14 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
            >
              <Wallet className="h-5 w-5" />
              {t("pos.checkoutBtn", { amount: formatMoney(balanceCents / 100) })}
            </Link>
          ))}
      </div>
    </>
  );
}
