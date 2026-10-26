"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  ChefHat,
  Plus,
  Printer,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { CoversChip, CoversPrompt } from "@/components/order/covers-prompt";
import { useOrderActions } from "@/hooks/use-order-actions";
import { type OrderItemWithName, updateOrderCovers } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { orderItemLabel } from "@/lib/menu-display";
import { useT } from "@/lib/i18n/use-translation";
import { remainingBalanceCents } from "@/lib/money";
import { collapseCoperto } from "@/lib/pos/coperto";
import { parseModifiers } from "@/lib/printing/route-order";
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
 * Bill order: the cover charge first (it's the guest count, not a dish),
 * then grouped by the menu's own category order, alphabetically within
 * each category — a conto a waiter can scan by section instead of by
 * whatever order the items were rung in.
 */
function sortedForBill(items: OrderItemWithName[]): OrderItemWithName[] {
  const key = (i: OrderItemWithName) => {
    if (i.menu_items?.is_coperto) return { group: -1, name: "" };
    return {
      group: i.menu_items?.categories?.sort_order ?? Number.MAX_SAFE_INTEGER,
      name: orderItemLabel(i.menu_items, "").title,
    };
  };
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (
      ka.group - kb.group ||
      ka.name.localeCompare(kb.name, undefined, { numeric: true })
    );
  });
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

  const { send, preReceipt, busy, covers } = useOrderActions({
    openOrder: bill,
    onOrderChanged: refresh,
  });
  const [coversOpen, setCoversOpen] = useState(false);

  async function handleCovers(next: number) {
    if (!bill) return;
    try {
      await updateOrderCovers(bill.order.id, next);
      await refresh();
      toast.success(t("pos.coversUpdated", { count: next }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.coversUpdateFailed"));
      return;
    }
    setCoversOpen(false);
  }

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
    : order.order_type === "takeaway"
      ? mRoutes.takeaway()
      : mRoutes.bills();
  // Paying a bill that has unsent items would settle the wrong amount, so the
  // send is offered first rather than folded silently into the charge.
  const blockedByPending = lines.length > 0;

  return (
    <>
      <MHeader
        title={label || "…"}
        backHref={backHref}
        action={
          order.order_type === "dine_in" && (
            <CoversChip
              covers={covers}
              onClick={() => setCoversOpen(true)}
              className="mr-2"
            />
          )
        }
      />

      {/* The bill is where a wrong guest count actually gets noticed, so the
          correction is available right here rather than back at the order
          screen. */}
      {coversOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-center bg-black/50 p-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <CoversPrompt
            initial={covers ?? 2}
            busy={busy}
            onConfirm={(n) => void handleCovers(n)}
            onCancel={() => setCoversOpen(false)}
          />
        </div>
      )}

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
          {sortedForBill(collapseCoperto(items)).map((i) => {
            // labelled the same way the menu labelled it: pizze and bruschette
            // by codice, with the toppings on the line underneath
            const label = orderItemLabel(i.menu_items, t("floor.itemFallback"));
            const name =
              label.title + (i.fraction_of ? ` (1/${i.fraction_of})` : "");
            const paid = i.paid_by_payment_id !== null;
            const isCoperto = i.menu_items?.is_coperto ?? false;
            // The bill carries no per-line controls, so there is nothing here
            // to lock down — but a waiter who spots a wrong cover charge will
            // reach for this row first. An unpaid one opens the count that
            // produced it; a paid one is settled and stays put.
            const Row = isCoperto && !paid ? "button" : "div";
            return (
              <li key={i.id}>
                <Row
                  {...(isCoperto && !paid
                    ? {
                        type: "button" as const,
                        onClick: () => setCoversOpen(true),
                        "aria-label": t("pos.coversEditAria"),
                      }
                    : {})}
                  className={cn(
                    "flex w-full items-baseline gap-2 text-left text-base",
                    paid && "text-muted-foreground line-through",
                  )}
                >
                  <span className="w-7 shrink-0 font-semibold tabular-nums">
                    {i.quantity}×
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-1.5">
                      {isCoperto && (
                        <Users className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
                      )}
                      {name}
                    </span>
                    {label.ingredients && (
                      <span className="text-sm leading-snug text-muted-foreground">
                        {label.ingredients}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(i.unit_price * i.quantity)}
                  </span>
                </Row>
                {(i.order_item_modifiers ?? []).map((m) => (
                  <div
                    key={m.id}
                    className="pl-9 text-sm text-muted-foreground"
                  >
                    {m.is_removal ? "−" : "+"} {m.name}
                  </div>
                ))}
                {parseModifiers(i.notes).map((n) => (
                  <div
                    key={`note:${n}`}
                    className="pl-9 text-sm italic text-muted-foreground"
                  >
                    {n}
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

        {canTakeOrders && order.order_type === "dine_in" && order.table_id && (
          <Link
            href={mRoutes.move(orderId)}
            className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl border text-base font-semibold"
          >
            <ArrowRightLeft className="h-5 w-5" />
            {t("move.button")}
          </Link>
        )}
      </div>

      {/* The "+" sits in a column of its own between the two actions, with a
          gap either side, so a thumb aiming for it never lands on Pre-conto
          or Paga (it used to float over the seam between them). */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-t bg-card p-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void preReceipt()}
          className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 text-center text-sm font-semibold leading-tight disabled:opacity-50"
        >
          <Printer className="h-5 w-5 shrink-0" />
          {t("pos.preReceiptBtn")}
        </button>
        {canTakeOrders && (order.table_id || order.order_type === "takeaway") ? (
          <Link
            href={
              order.table_id
                ? mRoutes.order(order.table_id, order.subtable)
                : mRoutes.takeawayOrder(orderId)
            }
            aria-label={t("m.addOrder")}
            className="flex aspect-square h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          >
            <Plus className="h-7 w-7" />
          </Link>
        ) : (
          <span aria-hidden className="w-0" />
        )}
        {canCheckout ? (
          // Unsent lines are not in this total, so paying now would settle the
          // wrong amount: the link becomes an inert button until they are sent.
          blockedByPending ? (
            <button
              type="button"
              disabled
              className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary px-2 text-center text-sm font-semibold leading-tight text-primary-foreground opacity-50"
            >
              <Wallet className="h-5 w-5 shrink-0" />
              {t("pos.checkoutBtn", { amount: formatMoney(balanceCents / 100) })}
            </button>
          ) : (
            <Link
              href={mRoutes.pay(orderId)}
              className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary px-2 text-center text-sm font-semibold leading-tight text-primary-foreground"
            >
              <Wallet className="h-5 w-5 shrink-0" />
              {t("pos.checkoutBtn", { amount: formatMoney(balanceCents / 100) })}
            </Link>
          )
        ) : (
          <span aria-hidden />
        )}
      </div>
    </>
  );
}
