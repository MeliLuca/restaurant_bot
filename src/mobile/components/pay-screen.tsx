"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Divide,
  Link2,
  Minus,
  Plus,
  TriangleAlert,
} from "lucide-react";
import {
  payEvenShare,
  payForItems,
  printPartialReceipt,
  splitCopertoPerGuest,
  splitItemIntoFractions,
  updateTableStatus,
  type OpenOrder,
  type PaymentResult,
} from "@/lib/api";
import { useOrderActions } from "@/hooks/use-order-actions";
import { formatMoney } from "@/lib/constants";
import { fetchLinkedOpenBills, type LinkedBill } from "@/lib/floor/links";
import { menuLabelText, orderItemLabel } from "@/lib/menu-display";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import { remainingBalanceCents } from "@/lib/money";
import {
  evenSharesLeft,
  evenSharesPaid,
  previewEvenShareCents,
  previewItemsPaymentCents,
} from "@/lib/pos/bill-preview";
import type { TableStatus } from "@/lib/database.types";
import { useAuthStore, usePermission } from "@/stores/auth-store";
import { useTicketStore } from "@/stores/ticket-store";
import { cn } from "@/lib/utils";
import { mRoutes } from "@/mobile/lib/routes";
import { useBill } from "@/mobile/hooks/use-bill";
import { useBillTarget } from "@/mobile/hooks/use-bill-target";
import { CleanupSheet } from "./cleanup-sheet";
import { MHeader } from "./m-header";

type PayMode = "all" | "even" | "items";

function itemDisplayName(item: OpenOrder["items"][number], t: TFn): string {
  // one line, so a code-named item carries its toppings inline — "1202" alone
  // would leave the picker unable to tell two pizzas apart
  const base = menuLabelText(orderItemLabel(item.menu_items, t("floor.itemFallback"), item.custom_name));
  return item.fraction_of ? `${base} (1/${item.fraction_of})` : base;
}

/**
 * Settle a bill: all of it, alla romana, or by item.
 *
 * A route rather than a dialog — the OS back gesture becomes "cancel", and
 * nothing has to fight the on-screen keyboard for a focus trap. Every amount
 * shown comes from @/lib/pos/bill-preview, the same functions the writers in
 * api.ts use, so a button can never promise a different number than it charges.
 */
export function PayScreen({ orderId }: { orderId: string }) {
  const t = useT();
  const router = useRouter();
  const canCheckout = usePermission("checkout_orders");
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const { bill, tableName, label, closed, loading, error, refresh } =
    useBill(orderId);
  useBillTarget(bill, tableName);
  const lines = useTicketStore((s) => s.lines);

  const { checkout, busy: actionsBusy } = useOrderActions({
    openOrder: bill,
    onOrderChanged: refresh,
  });
  const [payBusy, setPayBusy] = useState(false);
  const busy = actionsBusy || payBusy;

  const [mode, setMode] = useState<PayMode>("all");
  const [people, setPeople] = useState(2);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splittingItemId, setSplittingItemId] = useState<string | null>(null);
  // orders whose coperto this screen has already expanded — the call is
  // idempotent, this only spares the round trip on every mode switch
  const copertoSplit = useRef<string | null>(null);
  const [cleanup, setCleanup] = useState<{
    tableId: string;
    tableName: string;
  } | null>(null);

  // Open bills on linked tables: a banner while paying, and a confirm before
  // "pay all" settles this one (the phone mirror of the desktop dialog).
  const [linked, setLinked] = useState<LinkedBill[]>([]);
  const [confirmLinked, setConfirmLinked] = useState(false);
  const billTableId = bill?.order.table_id ?? null;
  const billSubtable = bill?.order.subtable ?? null;
  useEffect(() => {
    if (!billTableId) {
      setLinked([]);
      return;
    }
    fetchLinkedOpenBills(
      { tableId: billTableId, subtable: billSubtable },
      orderId,
    )
      .then(setLinked)
      .catch(() => setLinked([]));
  }, [billTableId, billSubtable, orderId]);

  const backHref = mRoutes.bill(orderId);

  /** Where to go once this bill is settled. Never back to the bill: the order
   *  no longer resolves, so that URL renders the "already closed" screen. */
  function leaveSettled() {
    router.replace(
      bill?.order.table_id
        ? mRoutes.table(bill.order.table_id)
        : mRoutes.bills(),
    );
  }

  async function applyCleanup(status: TableStatus) {
    if (!cleanup) return;
    setPayBusy(true);
    try {
      await updateTableStatus(cleanup.tableId, status);
      toast.success(
        status === "dirty"
          ? t("pos.tableFlaggedCleaning", { name: cleanup.tableName })
          : t("pos.tableIsFree", { name: cleanup.tableName }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.updateFailed"));
    } finally {
      setPayBusy(false);
      setCleanup(null);
      router.replace(mRoutes.tables());
    }
  }

  async function payAll() {
    if (linked.length > 0 && !confirmLinked) {
      setConfirmLinked(true);
      return;
    }
    setConfirmLinked(false);
    const outcome = await checkout();
    if (outcome.kind === "table-freed") {
      setCleanup({ tableId: outcome.tableId, tableName: outcome.tableName });
    } else if (outcome.kind === "paid") {
      leaveSettled();
    }
  }

  /** Shared tail of both split payments: closed bills leave, open ones stay. */
  async function afterPayment(result: PaymentResult) {
    if (!result.orderClosed) {
      await refresh();
      toast.success(
        t("pos.paidToGo", {
          paid: formatMoney(result.paidAmount),
          remaining: formatMoney(result.remainingCents / 100),
        }),
      );
      return;
    }
    if (result.tableClosed && bill?.order.table_id) {
      setCleanup({
        tableId: bill.order.table_id,
        tableName: tableName ?? "",
      });
      return;
    }
    toast.success(t("pos.splitFullyPaidOthersOpen", { label }));
    leaveSettled();
  }

  async function chargeEvenShare(sharesLeft: number) {
    setPayBusy(true);
    try {
      await afterPayment(await payEvenShare(orderId, sharesLeft, userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.paymentFailed"));
    } finally {
      setPayBusy(false);
    }
  }

  async function chargeSelectedItems() {
    setPayBusy(true);
    try {
      const result = await payForItems(orderId, Array.from(selected), userId);
      setSelected(new Set());
      // a partial receipt holds only the lines just paid — best-effort
      const [print] = await Promise.allSettled([
        printPartialReceipt(orderId, result.paidItemIds, result.paidAmount),
      ]);
      if (print.status === "rejected") {
        toast.warning(
          print.reason instanceof Error
            ? print.reason.message
            : t("pos.partialReceiptFailed"),
        );
      } else {
        const offline = print.value.filter((j) => !j.ok);
        if (offline.length > 0) {
          toast.warning(
            t("pos.printerOffline", {
              printers: offline.map((j) => j.printerName).join(", "),
            }),
          );
        }
      }
      await afterPayment(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.paymentFailed"));
    } finally {
      setPayBusy(false);
    }
  }

  /**
   * Switching to by-item turns the cover charge into one line per guest, so
   * each customer can pick up their own coperto with their own dishes instead
   * of the whole table's landing on whoever pays first.
   */
  async function ensureCopertoSplit() {
    if (copertoSplit.current === orderId) return;
    copertoSplit.current = orderId;
    setPayBusy(true);
    try {
      if (await splitCopertoPerGuest(orderId)) await refresh();
    } catch (e) {
      copertoSplit.current = null;
      toast.error(e instanceof Error ? e.message : t("pos.couldNotSplit"));
    } finally {
      setPayBusy(false);
    }
  }

  async function divideItem(itemId: string, parts: number) {
    setPayBusy(true);
    try {
      await splitItemIntoFractions(orderId, itemId, parts);
      setSplittingItemId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      await refresh();
      toast.success(t("pos.itemSplit", { count: parts }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.couldNotSplit"));
    } finally {
      setPayBusy(false);
    }
  }

  if (!canCheckout) {
    return (
      <>
        {/* pos.noAccessBody names take_orders; this route gates on
            checkout_orders, so it needs its own wording */}
        <MHeader title={t("m.noCheckoutTitle")} backHref={backHref} />
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            {t("m.noCheckoutBody")}
          </p>
        </div>
      </>
    );
  }

  // The cleanup prompt outlives the order it came from: once the last split is
  // paid the refetch returns null, so it has to render before the closed check.
  if (cleanup) {
    return (
      <CleanupSheet
        tableName={cleanup.tableName}
        busy={busy}
        onChoose={(status) => void applyCleanup(status)}
      />
    );
  }

  if (loading || !bill) {
    // "Conto chiuso" must not flash while the first fetch is still in flight
    const settled = closed && !loading;
    return (
      <>
        <MHeader
          title={settled ? t("m.billClosed") : "…"}
          backHref={settled ? mRoutes.tables() : backHref}
        />
        <div className="p-4 text-muted-foreground">
          {error ? (
            <span className="text-destructive">{t("m.loadFailed")}</span>
          ) : settled ? (
            t("m.billClosedBody")
          ) : (
            t("common.loading")
          )}
        </div>
      </>
    );
  }

  const { order, items, payments } = bill;
  const balanceCents = remainingBalanceCents(order, payments);
  const unpaid = items.filter((i) => i.paid_by_payment_id === null);

  const evenPaid = evenSharesPaid(payments);
  const sharesLeft = evenSharesLeft(payments, people);
  const nextShareCents = previewEvenShareCents(order, payments, sharesLeft);
  // the function payForItems itself calls, so the label cannot lie
  const selectionCents = previewItemsPaymentCents(
    order,
    items,
    payments,
    Array.from(selected),
  );

  // Reachable only by typing the URL — the bill screen refuses to link here
  // while unsent lines exist, because they are in no total on this page.
  if (lines.length > 0) {
    return (
      <>
        <MHeader title={label} backHref={backHref} />
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            {t("m.sendBeforePaying")}
          </p>
          <Link
            href={backHref}
            className="flex min-h-12 items-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground"
          >
            {t("m.backToBill")}
          </Link>
        </div>
      </>
    );
  }

  const MODES: { id: PayMode; labelKey: Parameters<TFn>[0] }[] = [
    { id: "all", labelKey: "m.payAll" },
    { id: "even", labelKey: "pos.allaRomana" },
    { id: "items", labelKey: "pos.byItem" },
  ];

  return (
    <>
      <MHeader title={label} backHref={backHref} />

      <div className="flex shrink-0 items-baseline justify-between border-b bg-card px-4 pb-3">
        <span className="text-sm text-muted-foreground">
          {t("pos.balanceDue")}
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {formatMoney(balanceCents / 100)}
        </span>
      </div>

      <div className="flex shrink-0 gap-1 border-b bg-card p-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id);
              if (m.id === "items") void ensureCopertoSplit();
            }}
            className={cn(
              "min-h-11 flex-1 rounded-lg text-sm font-semibold transition-colors",
              mode === m.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground",
            )}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {linked.length > 0 && (
          <div className="mb-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Link2 className="h-4 w-4 text-amber-500" /> {t("links.banner")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {linked.map((b) => (
                <Link
                  key={b.orderId}
                  href={mRoutes.bill(b.orderId)}
                  className="flex min-h-10 items-center gap-2 rounded-lg border bg-background px-3 text-sm"
                >
                  <span className="font-semibold">{b.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(b.total)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {mode === "all" && (
          <p className="text-sm text-muted-foreground">{t("m.payAllHelp")}</p>
        )}

        {mode === "even" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-medium">{t("pos.people")}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={t("pos.fewerPeople")}
                  disabled={busy || people <= Math.max(2, evenPaid + 1)}
                  onClick={() => setPeople((p) => p - 1)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border disabled:opacity-40"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <span className="w-8 text-center text-xl font-bold tabular-nums">
                  {people}
                </span>
                <button
                  type="button"
                  aria-label={t("pos.morePeople")}
                  disabled={busy}
                  onClick={() => setPeople((p) => p + 1)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border disabled:opacity-40"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>
            {evenPaid > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("pos.sharesPaid", {
                  paid: evenPaid,
                  total: Math.max(people, evenPaid),
                })}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {t("pos.evenShareHelp")}
            </p>
          </div>
        )}

        {mode === "items" && (
          <div className="flex flex-col gap-2">
            {items.map((i) => {
              const paid = i.paid_by_payment_id !== null;
              const checked = selected.has(i.id);
              return (
                <div key={i.id} className="flex flex-col gap-1">
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      disabled={paid || busy}
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(i.id)) next.delete(i.id);
                          else next.add(i.id);
                          return next;
                        })
                      }
                      className={cn(
                        "flex min-h-14 flex-1 items-center gap-3 rounded-xl border px-3 text-left text-base",
                        paid
                          ? "border-transparent bg-muted text-muted-foreground line-through"
                          : checked
                            ? "border-primary bg-primary/10"
                            : "",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded border-2",
                          paid || checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40",
                        )}
                        aria-hidden
                      >
                        {(paid || checked) && <Check className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        {i.quantity > 1 ? `${i.quantity}× ` : ""}
                        {itemDisplayName(i, t)}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(i.unit_price * i.quantity)}
                      </span>
                    </button>
                    {!paid && (
                      <button
                        type="button"
                        aria-label={t("pos.splitItemAria", {
                          name: itemDisplayName(i, t),
                        })}
                        disabled={busy}
                        onClick={() =>
                          setSplittingItemId((cur) =>
                            cur === i.id ? null : i.id,
                          )
                        }
                        className="flex w-14 shrink-0 items-center justify-center rounded-xl border disabled:opacity-40"
                      >
                        <Divide className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                  {splittingItemId === i.id && (
                    <div className="flex items-center gap-2 rounded-xl bg-muted p-2">
                      <span className="px-1 text-xs text-muted-foreground">
                        {t("pos.divideBy")}
                      </span>
                      {[2, 3, 4, 5, 6].map((parts) => (
                        <button
                          key={parts}
                          type="button"
                          disabled={busy}
                          onClick={() => void divideItem(i.id, parts)}
                          className="h-12 flex-1 rounded-lg border bg-background text-base font-semibold disabled:opacity-40"
                        >
                          {parts}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmLinked && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50">
          <div className="rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Link2 className="h-5 w-5 text-amber-500" /> {t("links.warnTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("links.warnBody", { name: label })}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {linked.map((b) => (
                <li key={b.orderId}>
                  <Link
                    href={mRoutes.bill(b.orderId)}
                    className="flex min-h-12 items-center gap-2 rounded-xl border px-3"
                  >
                    <span className="font-semibold">
                      {t("links.openBill", { name: b.label })}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {formatMoney(b.total)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void payAll()}
                className="flex min-h-14 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
              >
                {t("links.payAnyway")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmLinked(false)}
                className="flex min-h-12 items-center justify-center rounded-xl text-base font-medium text-muted-foreground"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {mode === "all" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void payAll()}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("pos.checkoutBtn", { amount: formatMoney(balanceCents / 100) })}
          </button>
        )}
        {mode === "even" && (
          <button
            type="button"
            disabled={busy || balanceCents <= 0}
            onClick={() => void chargeEvenShare(sharesLeft)}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("pos.chargeShare", {
              count: sharesLeft,
              amount: formatMoney(nextShareCents / 100),
            })}
          </button>
        )}
        {mode === "items" && (
          <button
            type="button"
            disabled={busy || selected.size === 0 || unpaid.length === 0}
            onClick={() => void chargeSelectedItems()}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {selected.size === 1
              ? t("pos.payOneItem", {
                  amount: formatMoney(selectionCents / 100),
                })
              : t("pos.payManyItems", {
                  count: selected.size,
                  amount: formatMoney(selectionCents / 100),
                })}
          </button>
        )}
      </div>
    </>
  );
}
