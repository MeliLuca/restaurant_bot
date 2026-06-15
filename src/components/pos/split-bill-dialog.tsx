"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Banknote, Check, Divide, Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  payEvenShare,
  payForItems,
  printPartialReceipt,
  remainingBalanceCents,
  splitItemIntoFractions,
  type OpenOrder,
  type PaymentResult,
} from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { calcTotals, splitCents, toCents } from "@/lib/money";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

interface SplitBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openOrder: OpenOrder;
  targetLabel: string;
  /** Refetch the open order after a payment / fraction split */
  onPaymentsChanged: () => Promise<void>;
  /** The last payment settled the bill — order is closed. The flag is true when
   * the whole table is now free (caller asks dirty vs. available). */
  onOrderClosed: (tableClosed: boolean) => void;
}

function itemDisplayName(item: OpenOrder["items"][number], t: TFn): string {
  const base = item.menu_items?.name ?? t("floor.itemFallback");
  return item.fraction_of ? `${base} (1/${item.fraction_of})` : base;
}

export function SplitBillDialog({
  open,
  onOpenChange,
  openOrder,
  targetLabel,
  onPaymentsChanged,
  onOrderClosed,
}: SplitBillDialogProps) {
  const t = useT();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(2);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splittingItemId, setSplittingItemId] = useState<string | null>(null);

  const { order, items, payments } = openOrder;
  const remainingCents = remainingBalanceCents(order, payments);
  const unpaid = items.filter((i) => i.paid_by_payment_id === null);

  // Shares already taken count against the chosen head-count; the math always
  // works off the live remaining balance, so changing N mid-way stays exact.
  const evenPaid = payments.filter((p) => p.kind === "even").length;
  const sharesLeft = Math.max(1, people - evenPaid);
  const nextShareCents = Math.min(
    splitCents(Math.max(remainingCents, 0), sharesLeft)[0],
    Math.max(remainingCents, 0),
  );

  const selectedItems = useMemo(
    () => unpaid.filter((i) => selected.has(i.id)),
    [unpaid, selected],
  );
  // Mirror of payForItems: the last selection pays exactly the balance.
  const selectionCents =
    selectedItems.length === 0
      ? 0
      : selectedItems.length === unpaid.length
        ? remainingCents
        : Math.min(
            toCents(
              calcTotals(
                selectedItems.map((i) => ({
                  unitPrice: i.unit_price,
                  quantity: i.quantity,
                })),
                order.tax_rate,
              ).total,
            ),
            remainingCents,
          );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function afterPayment(result: PaymentResult) {
    await onPaymentsChanged();
    if (result.orderClosed) {
      onOpenChange(false);
      onOrderClosed(result.tableClosed);
    } else {
      toast.success(
        t("pos.paidToGo", {
          paid: formatMoney(result.paidAmount),
          remaining: formatMoney(result.remainingCents / 100),
        }),
      );
    }
  }

  async function handleEvenShare() {
    setBusy(true);
    try {
      const result = await payEvenShare(order.id, sharesLeft, userId);
      await afterPayment(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.paymentFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handlePaySelected() {
    if (selectedItems.length === 0) return;
    setBusy(true);
    try {
      const result = await payForItems(
        order.id,
        selectedItems.map((i) => i.id),
        userId,
      );
      setSelected(new Set());
      // Partial receipt with ONLY the items just paid — best-effort print
      const [print] = await Promise.allSettled([
        printPartialReceipt(order.id, result.paidItemIds, result.paidAmount),
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
      setBusy(false);
    }
  }

  async function handleFraction(itemId: string, parts: number) {
    setBusy(true);
    try {
      await splitItemIntoFractions(order.id, itemId, parts);
      setSplittingItemId(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      await onPaymentsChanged();
      toast.success(t("pos.itemSplit", { count: parts }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.couldNotSplit"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pos.splitBill", { label: targetLabel })}</DialogTitle>
          <DialogDescription>{t("pos.splitBillDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-baseline justify-between rounded-md bg-muted px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {t("pos.balanceDue")}
          </span>
          <span className="text-xl font-semibold tabular-nums">
            {formatMoney(remainingCents / 100)}
          </span>
        </div>

        <Tabs defaultValue="even" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid h-12 w-full grid-cols-2">
            <TabsTrigger value="even" className="h-10">
              <Users className="mr-2 h-4 w-4" /> {t("pos.allaRomana")}
            </TabsTrigger>
            <TabsTrigger value="items" className="h-10">
              <Banknote className="mr-2 h-4 w-4" /> {t("pos.byItem")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="even" className="flex flex-col gap-4 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("pos.people")}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  aria-label={t("pos.fewerPeople")}
                  disabled={busy || people <= Math.max(2, evenPaid + 1)}
                  onClick={() => setPeople((p) => p - 1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-lg font-semibold tabular-nums">
                  {people}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  aria-label={t("pos.morePeople")}
                  disabled={busy}
                  onClick={() => setPeople((p) => p + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
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
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy || remainingCents <= 0}
              onClick={handleEvenShare}
            >
              {t("pos.chargeShare", {
                count: sharesLeft,
                amount: formatMoney(nextShareCents / 100),
              })}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("pos.evenShareHelp")}
            </p>
          </TabsContent>

          <TabsContent
            value="items"
            className="flex min-h-0 flex-1 flex-col gap-3 pt-2"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-1.5">
                {items.map((i) => {
                  const paid = i.paid_by_payment_id !== null;
                  const checked = selected.has(i.id);
                  return (
                    <div key={i.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={paid || busy}
                          onClick={() => toggleSelected(i.id)}
                          className={cn(
                            "flex min-h-12 flex-1 items-center gap-3 rounded-md border px-3 text-left text-sm transition-colors",
                            paid
                              ? "border-transparent bg-muted text-muted-foreground line-through"
                              : checked
                                ? "border-primary bg-primary/10"
                                : "hover:bg-accent",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                              paid || checked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-muted-foreground/40",
                            )}
                            aria-hidden
                          >
                            {(paid || checked) && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {i.quantity > 1 ? `${i.quantity}× ` : ""}
                            {itemDisplayName(i, t)}
                          </span>
                          <span className="tabular-nums">
                            {formatMoney(i.unit_price * i.quantity)}
                          </span>
                        </button>
                        {!paid && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-12 w-12 shrink-0"
                            aria-label={t("pos.splitItemAria", {
                            name: itemDisplayName(i, t),
                          })}
                            disabled={busy}
                            onClick={() =>
                              setSplittingItemId((cur) =>
                                cur === i.id ? null : i.id,
                              )
                            }
                          >
                            <Divide className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {splittingItemId === i.id && (
                        <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
                          <span className="px-1 text-xs text-muted-foreground">
                            {t("pos.divideBy")}
                          </span>
                          {[2, 3, 4, 5, 6].map((parts) => (
                            <Button
                              key={parts}
                              variant="outline"
                              className="h-10 w-10 p-0"
                              disabled={busy}
                              onClick={() => handleFraction(i.id, parts)}
                            >
                              {parts}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy || selectedItems.length === 0}
              onClick={handlePaySelected}
            >
              {selectedItems.length === 1
                ? t("pos.payOneItem", {
                    amount: formatMoney(selectionCents / 100),
                  })
                : t("pos.payManyItems", {
                    count: selectedItems.length,
                    amount: formatMoney(selectionCents / 100),
                  })}
            </Button>
          </TabsContent>
        </Tabs>

        {payments.length > 0 && (
          <>
            <Separator />
            <div className="flex max-h-28 flex-col gap-1 overflow-y-auto text-sm">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between text-muted-foreground"
                >
                  <span>
                    {p.kind === "even"
                      ? t("pos.allaRomanaShare")
                      : t("pos.itemsPayment")}
                  </span>
                  <span className="tabular-nums">{formatMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
