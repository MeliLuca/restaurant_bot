"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  checkoutOrder,
  printPreReceipt,
  printProductionSlips,
  printReceipt,
  sendTakeawayToKitchen,
  sendToKitchen,
  setSentItemPrice,
  setSentItemQuantity,
  type OpenOrder,
  type PrintJobResult,
  type SentRound,
} from "@/lib/api";
import { warnOnSlipFailures } from "@/components/printing/print-warnings";
import { formatMoney } from "@/lib/constants";
import { fetchLinkedOpenBills, type LinkedBill } from "@/lib/floor/links";
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";
import {
  useDraftCovers,
  useTicketStore,
  type TicketMode,
} from "@/stores/ticket-store";

/**
 * What a checkout did, so each UI can choose its own follow-up. The hook
 * deliberately does not own the post-checkout prompt: the desktop panel opens
 * a Dialog, the phone opens a bottom sheet.
 */
export type CheckoutOutcome =
  | { kind: "failed" }
  | { kind: "nothing-to-checkout" }
  | { kind: "table-freed"; tableId: string; tableName: string }
  | { kind: "paid"; label: string; mode: TicketMode };

interface OrderActions {
  busy: boolean;
  hasTarget: boolean;
  targetLabel: string | null;
  /** Guests on this check: the order's count, or the answer given for a check
   * that has no order yet. Null means nobody has been asked. */
  covers: number | null;
  /** A dine-in target whose guest count is still unknown. The UI must ask
   * before it can send — see the guard in sendPendingLines. */
  needsCovers: boolean;
  send: () => Promise<boolean>;
  checkout: () => Promise<CheckoutOutcome>;
  /** Open bills on tables linked to this one — asked right before paying, so
   * the UI can warn. Empty for take-aways, unlinked tables, or on error. */
  linkedOpenBills: () => Promise<LinkedBill[]>;
  amendSentItem: (orderItemId: string, quantity: number) => Promise<void>;
  setSentPrice: (
    orderItemId: string,
    unitPrice: number,
    name: string,
  ) => Promise<void>;
  preReceipt: () => Promise<void>;
  /** Exposed because the phone prints a pre-receipt from its own bill screen */
  warnOnPrintFailure: (jobs: PromiseSettledResult<PrintJobResult[]>) => void;
}

/**
 * The order flow — send, checkout, amend, price override, pre-receipt —
 * shared by the desktop ticket panel and the phone UI.
 *
 * Shared rather than duplicated because the ordering here is load-bearing and
 * silent when wrong. In particular `checkout` flushes still-pending lines onto
 * the bill *before* charging: a second implementation that got that backwards
 * would drop a last-second round from the bill without any visible error.
 *
 * Reads the ticket-store singleton directly, so nothing needs prop threading.
 */
export function useOrderActions({
  openOrder,
  openOrderLoaded = true,
  onOrderChanged,
}: {
  openOrder: OpenOrder | null;
  /** False while `openOrder` is still being fetched for the current target
   * (useOpenOrder's `loaded`); screens that already hold the order omit it */
  openOrderLoaded?: boolean;
  onOrderChanged: () => Promise<void>;
}): OrderActions {
  const t = useT();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const mode = useTicketStore((s) => s.mode);
  const tableId = useTicketStore((s) => s.tableId);
  const tableName = useTicketStore((s) => s.tableName);
  const subtable = useTicketStore((s) => s.subtable);
  const takeawayOrderId = useTicketStore((s) => s.takeawayOrderId);
  const takeawayName = useTicketStore((s) => s.takeawayName);
  const lines = useTicketStore((s) => s.lines);
  const draftCovers = useDraftCovers();
  const setTakeaway = useTicketStore((s) => s.setTakeaway);
  const clearLines = useTicketStore((s) => s.clearLines);
  const dropDraftCovers = useTicketStore((s) => s.dropDraftCovers);
  const clearTicket = useTicketStore((s) => s.clearTicket);

  const [busy, setBusy] = useState(false);

  const hasTarget = mode === "table" ? !!tableId : !!takeawayName;
  // the order's own count wins; the draft answer covers a check not created yet
  const covers = openOrder?.order.covers ?? draftCovers;
  // Only the table's first order asks — once any order exists (even a
  // drinks-only one that skipped the cover charge), adding another round
  // never re-prompts, per house rule. And only once the order has loaded: a
  // null openOrder mid-fetch is "don't know yet", and asking then re-prompted
  // every time the waiter came back to an already open table.
  const needsCovers =
    mode === "table" &&
    hasTarget &&
    openOrderLoaded &&
    !openOrder &&
    covers == null;
  const targetLabel =
    mode === "table"
      ? subtable
        ? `${tableName}/${subtable}`
        : tableName
      : takeawayName;

  // Printing is best-effort: the order is already saved, so a dead printer
  // warns instead of failing the send.
  function warnOnPrintFailure(jobs: PromiseSettledResult<PrintJobResult[]>) {
    if (jobs.status === "rejected") {
      toast.warning(
        jobs.reason instanceof Error
          ? jobs.reason.message
          : t("pos.printingFailed"),
      );
      return;
    }
    warnOnSlipFailures(jobs.value, t);
  }

  async function printRound(round: SentRound) {
    const [jobs] = await Promise.allSettled([
      printProductionSlips(round.orderId, round.newItemIds),
    ]);
    warnOnPrintFailure(jobs);
  }

  async function sendPendingLines(): Promise<SentRound> {
    if (mode === "table") {
      // The one place a dine-in order comes into existence, so the one place
      // worth guarding: without a guest count the check would open with no
      // cover charge and nothing on the bill to show it was skipped. Both UIs
      // ask before getting here; this is the backstop that makes a missed
      // prompt a visible error rather than silently lost revenue.
      if (!openOrder && covers == null) throw new Error(t("pos.coversAsk"));
      return sendToKitchen(tableId!, lines, subtable, userId, covers);
    }
    const round = await sendTakeawayToKitchen(
      takeawayOrderId,
      takeawayName!,
      lines,
      userId,
    );
    // binds the freshly created order id so the next send appends to it
    setTakeaway(round.orderId, takeawayName!);
    return round;
  }

  async function send(): Promise<boolean> {
    if (!hasTarget) return false;
    setBusy(true);
    try {
      const round = await sendPendingLines();
      clearLines();
      await onOrderChanged();
      // Only now: until the refetch lands there is no order on screen, and
      // the draft is what keeps the covers prompt from re-opening meanwhile.
      dropDraftCovers();
      toast.success(t("pos.orderSent", { label: targetLabel ?? "" }));
      await printRound(round);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.couldNotSend"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function checkout(): Promise<CheckoutOutcome> {
    if (!hasTarget) return { kind: "failed" };
    setBusy(true);
    try {
      // anything still pending goes on the bill before payment
      let orderId = openOrder?.order.id ?? null;
      let round: SentRound | null = null;
      if (lines.length > 0) {
        round = await sendPendingLines();
        orderId = round.orderId;
        clearLines();
      }
      if (!orderId) {
        toast.error(t("pos.nothingToCheckout"));
        return { kind: "nothing-to-checkout" };
      }
      const tableClosed = await checkoutOrder(
        orderId,
        mode === "table" ? tableId : null,
      );
      const closedLabel = targetLabel;
      const closedTableId = tableId;
      const closedTableName = tableName ?? "";
      // before clearTicket moves the target away, or the answer would be
      // waiting for the next party at this table instead of asking them
      dropDraftCovers();
      clearTicket();
      await onOrderChanged();

      let outcome: CheckoutOutcome;
      if (mode === "table" && tableClosed && closedTableId) {
        // Whole table is free — the caller asks dirty vs. available.
        outcome = {
          kind: "table-freed",
          tableId: closedTableId,
          tableName: closedTableName,
        };
      } else {
        toast.success(
          mode === "takeaway"
            ? t("pos.takeawayPaid", { label: closedLabel ?? "" })
            : t("pos.splitPaidOthersOpen", { label: closedLabel ?? "" }),
        );
        outcome = { kind: "paid", label: closedLabel ?? "", mode };
      }

      // last-second items still reach the kitchen, then the bill prints
      if (round) await printRound(round);
      const [receipt] = await Promise.allSettled([printReceipt(orderId)]);
      warnOnPrintFailure(receipt);
      return outcome;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.checkoutFailed"));
      return { kind: "failed" };
    } finally {
      setBusy(false);
    }
  }

  async function linkedOpenBills(): Promise<LinkedBill[]> {
    if (mode !== "table" || !tableId) return [];
    try {
      return await fetchLinkedOpenBills(
        { tableId, subtable },
        openOrder?.order.id ?? null,
      );
    } catch {
      // the warning is advisory — never let it block a payment
      return [];
    }
  }

  async function amendSentItem(orderItemId: string, quantity: number) {
    if (!openOrder) return;
    setBusy(true);
    try {
      await setSentItemQuantity(openOrder.order.id, orderItemId, quantity);
      await onOrderChanged();
      if (quantity <= 0) toast.success(t("pos.itemRemoved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.couldNotUpdateOrder"));
    } finally {
      setBusy(false);
    }
  }

  /** Manual price override — current order only, never the menu. */
  async function setSentPrice(
    orderItemId: string,
    unitPrice: number,
    name: string,
  ) {
    if (!openOrder) return;
    setBusy(true);
    try {
      await setSentItemPrice(openOrder.order.id, orderItemId, unitPrice);
      await onOrderChanged();
      toast.success(
        t("pos.priceNow", { name, price: formatMoney(unitPrice) }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pos.couldNotUpdatePrice"));
    } finally {
      setBusy(false);
    }
  }

  /** Courtesy bill: print only — no payment, no order/table state change. */
  async function preReceipt() {
    if (!openOrder) return;
    setBusy(true);
    try {
      const [jobs] = await Promise.allSettled([
        printPreReceipt(openOrder.order.id),
      ]);
      warnOnPrintFailure(jobs);
      if (jobs.status === "fulfilled" && jobs.value.every((j) => j.ok)) {
        toast.success(t("pos.preReceiptPrinted"));
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    hasTarget,
    targetLabel,
    covers,
    needsCovers,
    send,
    checkout,
    linkedOpenBills,
    amendSentItem,
    setSentPrice,
    preReceipt,
    warnOnPrintFailure,
  };
}
