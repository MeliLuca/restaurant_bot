"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChefHat,
  CreditCard,
  Minus,
  Pencil,
  Plus,
  ReceiptText,
  ShoppingBag,
  Split,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  checkoutOrder,
  createDeliveryOrder,
  fetchDeliveryLabels,
  printPreReceipt,
  printProductionSlips,
  printReceipt,
  sendTakeawayToKitchen,
  sendToKitchen,
  setSentItemPrice,
  setSentItemQuantity,
  updateTableStatus,
  type ModifierGroupWithModifiers,
  type OpenOrder,
  type PrintJobResult,
  type SentRound,
} from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { calcTotals, toCents } from "@/lib/money";
import type { Order, RestaurantTable, TableStatus } from "@/lib/database.types";
import {
  lineUnitPrice,
  useTicketStore,
  type TicketLine,
  type TicketMode,
} from "@/stores/ticket-store";
import { useAuthStore, usePermission } from "@/stores/auth-store";
import { ModifierDialog } from "./modifier-dialog";
import { PriceEditDialog, type PriceEditTarget } from "./price-edit-dialog";
import { SplitBillDialog } from "./split-bill-dialog";
import { SplitPicker } from "./split-picker";
import { TakeawayPicker } from "./takeaway-picker";

/** Selected modifiers, indented right under their parent line. Additions show
 * their list price as detail (the line price carries the diminishing-scaled
 * surcharge); removals never deduct, so they show no amount. */
function ModifierRows({
  modifiers,
  muted,
}: {
  modifiers: Array<{ key: string; name: string; priceAdjustment: number }>;
  muted?: boolean;
}) {
  if (modifiers.length === 0) return null;
  return (
    <ul
      className={
        muted
          ? "flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground/60"
          : "flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground"
      }
    >
      {modifiers.map((m) => (
        <li key={m.key} className="flex justify-between gap-2">
          <span className="min-w-0 truncate">› {m.name}</span>
          {m.priceAdjustment > 0 && (
            <span className="shrink-0 tabular-nums">
              +{formatMoney(m.priceAdjustment)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface TicketPanelProps {
  tables: RestaurantTable[];
  openOrder: OpenOrder | null;
  openSplits: Order[];
  openTakeaways: Order[];
  /** Modifier groups offered per menu item id — drives the ingredient editor */
  modifierGroups: Record<string, ModifierGroupWithModifiers[]>;
  onOrderChanged: () => Promise<void>;
}

export function TicketPanel({
  tables,
  openOrder,
  openSplits,
  openTakeaways,
  modifierGroups,
  onOrderChanged,
}: TicketPanelProps) {
  const {
    mode,
    tableId,
    tableName,
    subtable,
    takeawayOrderId,
    takeawayName,
    lines,
    setMode,
    setTable,
    setSubtable,
    setTakeaway,
    removeItem,
    setQuantity,
    setLinePrice,
    setLineModifiers,
    clearLines,
    clearTicket,
  } = useTicketStore();
  const canCheckout = usePermission("checkout_orders");
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [priceEdit, setPriceEdit] = useState<PriceEditTarget | null>(null);
  const [editLine, setEditLine] = useState<TicketLine | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  // Reusable customer-name labels, shown as quick-picks when starting a
  // take-away (same saved-labels list as the floor-plan New Delivery flow).
  const [savedLabels, setSavedLabels] = useState<string[]>([]);

  useEffect(() => {
    fetchDeliveryLabels()
      .then(setSavedLabels)
      .catch(() => {
        // labels are a convenience; the picker still works without them
      });
  }, []);
  // Set when a checkout frees a whole table, prompting dirty-vs-available.
  const [cleanup, setCleanup] = useState<{
    tableId: string;
    tableName: string;
  } | null>(null);

  const hasTarget = mode === "table" ? !!tableId : !!takeawayName;
  const targetLabel =
    mode === "table"
      ? subtable
        ? `${tableName}/${subtable}`
        : tableName
      : takeawayName;

  // sent unit_price already includes modifier adjustments (snapshot at send);
  // pending lines add them here
  const sentLines =
    openOrder?.items.map((i) => ({
      unitPrice: i.unit_price,
      quantity: i.quantity,
    })) ?? [];
  const totals = calcTotals([
    ...sentLines,
    ...lines.map((l) => ({
      unitPrice: lineUnitPrice(l),
      quantity: l.quantity,
    })),
  ]);

  // Split-bill payments already taken reduce what the checkout collects
  const payments = openOrder?.payments ?? [];
  const paidCents = payments.reduce((sum, p) => sum + toCents(p.amount), 0);
  const balanceCents = toCents(totals.total) - paidCents;

  // Printing is best-effort: the order is already saved, so a dead printer
  // warns instead of failing the send.
  function warnOnPrintFailure(jobs: PromiseSettledResult<PrintJobResult[]>) {
    if (jobs.status === "rejected") {
      toast.warning(
        jobs.reason instanceof Error ? jobs.reason.message : "Printing failed",
      );
      return;
    }
    const failed = jobs.value.filter((j) => !j.ok);
    if (failed.length > 0) {
      toast.warning(
        `Printer offline: ${failed.map((f) => f.printerName).join(", ")}`,
      );
    }
  }

  async function printRound(round: SentRound) {
    const [jobs] = await Promise.allSettled([
      printProductionSlips(round.orderId, round.newItemIds),
    ]);
    warnOnPrintFailure(jobs);
  }

  async function sendPendingLines(): Promise<SentRound> {
    if (mode === "table") {
      return sendToKitchen(tableId!, lines, subtable, userId);
    }
    const round = await sendTakeawayToKitchen(
      takeawayOrderId,
      takeawayName!,
      lines,
      userId,
    );
    setTakeaway(round.orderId, takeawayName!);
    return round;
  }

  async function handleSend() {
    if (!hasTarget) return;
    setBusy(true);
    try {
      const round = await sendPendingLines();
      clearLines();
      await onOrderChanged();
      toast.success(`Order sent to kitchen for ${targetLabel}`);
      await printRound(round);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send order");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout() {
    if (!hasTarget) return;
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
        toast.error("Nothing to check out");
        return;
      }
      const tableClosed = await checkoutOrder(
        orderId,
        mode === "table" ? tableId : null,
      );
      const closedLabel = targetLabel;
      const closedTableId = tableId;
      const closedTableName = tableName ?? "";
      clearTicket();
      await onOrderChanged();
      if (mode === "table" && tableClosed && closedTableId) {
        // Whole table is free — let the user decide dirty vs. available.
        setCleanup({ tableId: closedTableId, tableName: closedTableName });
      } else {
        toast.success(
          mode === "takeaway"
            ? `Take-away for ${closedLabel} paid`
            : `${closedLabel} paid — other splits still open`,
        );
      }
      // last-second items still reach the kitchen, then the bill prints
      if (round) await printRound(round);
      const [receipt] = await Promise.allSettled([printReceipt(orderId)]);
      warnOnPrintFailure(receipt);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function amendSentItem(orderItemId: string, quantity: number) {
    if (!openOrder) return;
    setBusy(true);
    try {
      await setSentItemQuantity(openOrder.order.id, orderItemId, quantity);
      await onOrderChanged();
      if (quantity <= 0) toast.success("Item removed from order");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update order");
    } finally {
      setBusy(false);
    }
  }

  // Manual price override — current ticket/order only, never the menu.
  async function applyPriceEdit(target: PriceEditTarget, unitPrice: number) {
    if (target.kind === "pending") {
      setLinePrice(target.id, unitPrice);
      return;
    }
    if (!openOrder) return;
    setBusy(true);
    try {
      await setSentItemPrice(openOrder.order.id, target.id, unitPrice);
      await onOrderChanged();
      toast.success(`${target.name} now ${formatMoney(unitPrice)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update price");
    } finally {
      setBusy(false);
    }
  }

  // Courtesy bill: print only — no payment, no order/table state change.
  async function handlePreReceipt() {
    if (!openOrder) return;
    setBusy(true);
    try {
      const [jobs] = await Promise.allSettled([
        printPreReceipt(openOrder.order.id),
      ]);
      warnOnPrintFailure(jobs);
      if (jobs.status === "fulfilled" && jobs.value.every((j) => j.ok)) {
        toast.success("Pre-receipt printed");
      }
    } finally {
      setBusy(false);
    }
  }

  // Start a new take-away from the POS using the same logic as the floor-plan
  // New Delivery: create the order eagerly so it gets tonight's counter number,
  // save the name as a reusable label, then load it as the active ticket.
  async function startNewTakeaway(name: string) {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const { orderId, deliveryNumber } = await createDeliveryOrder(
        trimmed,
        userId,
      );
      setTakeaway(orderId, trimmed);
      await onOrderChanged();
      setSavedLabels(await fetchDeliveryLabels());
      toast.success(`Take-away #${deliveryNumber} started for ${trimmed}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start take-away");
    } finally {
      setBusy(false);
    }
  }

  async function handleSplitOrderClosed(tableClosed: boolean) {
    const closedLabel = targetLabel;
    const closedTableId = tableId;
    const closedTableName = tableName ?? "";
    clearTicket();
    await onOrderChanged();
    if (mode === "table" && tableClosed && closedTableId) {
      setCleanup({ tableId: closedTableId, tableName: closedTableName });
    } else {
      toast.success(
        mode === "takeaway"
          ? `Take-away for ${closedLabel} fully paid`
          : `${closedLabel} fully paid — other splits still open`,
      );
    }
  }

  // Apply the dirty/available choice from the post-checkout cleanup prompt.
  async function applyCleanup(status: TableStatus) {
    if (!cleanup) return;
    setBusy(true);
    try {
      await updateTableStatus(cleanup.tableId, status);
      await onOrderChanged();
      toast.success(
        status === "dirty"
          ? `Table ${cleanup.tableName} flagged for cleaning`
          : `Table ${cleanup.tableName} is free`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
      setCleanup(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b p-4">
        <Tabs value={mode} onValueChange={(m) => setMode(m as TicketMode)}>
          <TabsList className="grid h-12 w-full grid-cols-2">
            <TabsTrigger value="table" className="h-10 text-base">
              Dine-in
            </TabsTrigger>
            <TabsTrigger value="takeaway" className="h-10 text-base">
              Take-away
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "table" ? (
          <>
            <Select
              value={tableId ?? ""}
              onValueChange={(id) => {
                const t = tables.find((x) => x.id === id);
                if (t) setTable(t.id, t.name);
              }}
            >
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder="Select a table" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    Table {t.name} · seats {t.capacity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tableId && (
              <SplitPicker
                tableName={tableName ?? ""}
                openSplits={openSplits}
                subtable={subtable}
                onSelect={setSubtable}
              />
            )}
          </>
        ) : takeawayName ? (
          <div className="flex h-12 items-center gap-2 rounded-md border px-3">
            <ShoppingBag className="h-5 w-5 shrink-0 text-muted-foreground" />
            {openOrder?.order.delivery_number != null && (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                #{openOrder.order.delivery_number}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium">{takeawayName}</span>
              <span className="block text-xs text-muted-foreground">
                {takeawayOrderId ? "open take-away order" : "new take-away"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              aria-label="Clear take-away customer"
              onClick={clearTicket}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <TakeawayPicker
            openOrders={openTakeaways}
            savedLabels={savedLabels}
            onPickExisting={(o) => setTakeaway(o.id, o.customer_name ?? "")}
            onStartNew={(name) => void startNewTakeaway(name)}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!hasTarget && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {mode === "table"
              ? "Pick a table to start a ticket."
              : "Find an open take-away or type a customer name to start one."}
          </p>
        )}

        {openOrder && openOrder.items.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sent to kitchen — tap to amend
            </h3>
            <div className="flex flex-col gap-1.5">
              {openOrder.items.map((i) => {
                const name =
                  (i.menu_items?.name ?? "Item") +
                  (i.fraction_of ? ` (1/${i.fraction_of})` : "");
                const modifierRows = (i.order_item_modifiers ?? []).map(
                  (m) => ({
                    key: m.id,
                    name: m.name,
                    priceAdjustment: m.price_adjustment,
                  }),
                );
                if (i.paid_by_payment_id) {
                  // settled by a split payment — immutable from here on
                  return (
                    <div key={i.id}>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 flex-1 truncate line-through">
                          {i.quantity > 1 ? `${i.quantity}× ` : ""}
                          {name}
                        </span>
                        <span className="text-xs font-medium uppercase">
                          Paid
                        </span>
                        <span className="w-14 text-right tabular-nums line-through">
                          {formatMoney(i.unit_price * i.quantity)}
                        </span>
                      </div>
                      <ModifierRows modifiers={modifierRows} muted />
                    </div>
                  );
                }
                return (
                  <div key={i.id}>
                  <div
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Decrease sent ${name}`}
                        disabled={busy}
                        onClick={() => amendSentItem(i.id, i.quantity - 1)}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-6 text-center font-semibold tabular-nums">
                        {i.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Increase sent ${name}`}
                        disabled={busy}
                        onClick={() => amendSentItem(i.id, i.quantity + 1)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className="w-14 text-right tabular-nums">
                      {formatMoney(i.unit_price * i.quantity)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Adjust price of ${name}`}
                      disabled={busy}
                      onClick={() =>
                        setPriceEdit({
                          kind: "sent",
                          id: i.id,
                          name,
                          unitPrice: i.unit_price,
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Remove sent ${name}`}
                      disabled={busy}
                      onClick={() => amendSentItem(i.id, 0)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ModifierRows modifiers={modifierRows} />
                  </div>
                );
              })}
            </div>
            <Separator className="mt-3" />
          </div>
        )}

        {hasTarget && lines.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {openOrder
              ? "Tap menu items to add another round."
              : "Tap menu items to build the order."}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {lines.map((l) => (
            <div key={l.lineId}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatMoney(lineUnitPrice(l))} each
                    {l.priceOverridden && (
                      <span className="ml-1 font-medium text-amber-600">
                        · adjusted
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground"
                  aria-label={`Adjust price of ${l.name}`}
                  onClick={() =>
                    setPriceEdit({
                      kind: "pending",
                      id: l.lineId,
                      name: l.name,
                      unitPrice: l.unitPrice,
                    })
                  }
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={`Decrease ${l.name}`}
                    onClick={() => setQuantity(l.lineId, l.quantity - 1)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center font-semibold tabular-nums">
                    {l.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={`Increase ${l.name}`}
                    onClick={() => setQuantity(l.lineId, l.quantity + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <span className="w-16 text-right font-medium tabular-nums">
                  {formatMoney(lineUnitPrice(l) * l.quantity)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => removeItem(l.lineId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <ModifierRows
                modifiers={l.modifiers.map((m) => ({
                  key: m.modifierId,
                  name: m.name,
                  priceAdjustment: m.priceAdjustment,
                }))}
              />
              {(modifierGroups[l.menuItemId] ?? []).length > 0 && (
                <button
                  type="button"
                  onClick={() => setEditLine(l)}
                  className="ml-5 mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  {l.modifiers.length ? "Edit ingredients" : "Add ingredients"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mb-4 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax (8%)</span>
            <span className="tabular-nums">{formatMoney(totals.tax)}</span>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(totals.total)}</span>
          </div>
          {paidCents > 0 && (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>
                  Paid ({payments.length} payment
                  {payments.length === 1 ? "" : "s"})
                </span>
                <span className="tabular-nums">
                  -{formatMoney(paidCents / 100)}
                </span>
              </div>
              <div className="flex justify-between text-lg font-semibold">
                <span>Balance due</span>
                <span className="tabular-nums">
                  {formatMoney(balanceCents / 100)}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="h-14 text-base"
            disabled={busy || !hasTarget || lines.length === 0}
            onClick={handleSend}
          >
            <ChefHat className="mr-2 h-5 w-5" /> Send to Kitchen
          </Button>
          {openOrder && (
            <div className="flex gap-2">
              <Button
                size="lg"
                variant="outline"
                className="h-12 flex-1 text-sm"
                disabled={busy}
                onClick={handlePreReceipt}
              >
                <ReceiptText className="mr-2 h-4 w-4" /> Pre-Receipt
              </Button>
              {canCheckout && (
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 flex-1 text-sm"
                  disabled={busy}
                  onClick={() => setSplitOpen(true)}
                >
                  <Split className="mr-2 h-4 w-4" /> Split Bill
                </Button>
              )}
            </div>
          )}
          {canCheckout && (
            <Button
              size="lg"
              variant="secondary"
              className="h-14 text-base"
              disabled={busy || !hasTarget || (!openOrder && lines.length === 0)}
              onClick={handleCheckout}
            >
              <CreditCard className="mr-2 h-5 w-5" /> Checkout ·{" "}
              {formatMoney(balanceCents / 100)}
            </Button>
          )}
        </div>
      </div>

      <PriceEditDialog
        target={priceEdit}
        onClose={() => setPriceEdit(null)}
        onSubmit={applyPriceEdit}
      />
      <ModifierDialog
        open={editLine !== null}
        itemName={editLine?.name ?? ""}
        basePrice={editLine?.unitPrice ?? 0}
        groups={editLine ? (modifierGroups[editLine.menuItemId] ?? []) : []}
        initialModifiers={editLine?.modifiers ?? []}
        onClose={() => setEditLine(null)}
        onConfirm={(modifiers) => {
          if (editLine) setLineModifiers(editLine.lineId, modifiers);
        }}
      />
      {openOrder && (
        <SplitBillDialog
          open={splitOpen}
          onOpenChange={setSplitOpen}
          openOrder={openOrder}
          targetLabel={targetLabel ?? ""}
          onPaymentsChanged={onOrderChanged}
          onOrderClosed={handleSplitOrderClosed}
        />
      )}

      {/* Post-checkout: how should the freed table be left? */}
      <Dialog open={!!cleanup} onOpenChange={(o) => !o && setCleanup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Table {cleanup?.tableName} paid</DialogTitle>
            <DialogDescription>
              How do you want to leave this table?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              variant="secondary"
              className="h-14 text-base"
              disabled={busy}
              onClick={() => applyCleanup("dirty")}
            >
              <Trash2 className="mr-2 h-5 w-5" /> Mark dirty
            </Button>
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy}
              onClick={() => applyCleanup("available")}
            >
              <Check className="mr-2 h-5 w-5" /> Mark available
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
