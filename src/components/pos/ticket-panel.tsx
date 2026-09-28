"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChefHat,
  CreditCard,
  Link2,
  Minus,
  Pencil,
  Plus,
  ReceiptText,
  ShoppingBag,
  Split,
  Trash2,
  Users,
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
import { CoversChip, CoversPrompt } from "@/components/order/covers-prompt";
import {
  createDeliveryOrder,
  fetchDeliveryLabels,
  updateOrderCovers,
  updateTableStatus,
  type OpenOrder,
  type VariationData,
} from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { orderItemLabel } from "@/lib/menu-display";
import { calcTotals, toCents } from "@/lib/money";
import { collapseCoperto } from "@/lib/pos/coperto";
import type {
  Order,
  RestaurantTable,
  TableLink,
  TableStatus,
} from "@/lib/database.types";
import {
  linkPartners,
  targetLabel as linkLabel,
  type LinkedBill,
} from "@/lib/floor/links";
import {
  lineUnitPrice,
  useTicketStore,
  type TicketLine,
  type TicketMode,
} from "@/stores/ticket-store";
import { useT } from "@/lib/i18n/use-translation";
import { useOrderActions } from "@/hooks/use-order-actions";
import { useAuthStore, usePermission } from "@/stores/auth-store";
import { VariationDialog } from "./variation-dialog";
import { PriceEditDialog, type PriceEditTarget } from "./price-edit-dialog";
import { SplitBillDialog } from "./split-bill-dialog";
import { SplitPicker } from "./split-picker";
import { LinkTablesDialog } from "./link-tables-dialog";
import { LinkedBillsDialog } from "./linked-bills-dialog";
import { createFollowUpOrder } from "@/lib/takeaway/api";
import { TakeawayCapacityBanner } from "@/components/takeaway/capacity-banner";
import { TakeawayCaption } from "@/components/takeaway/takeaway-caption";
import { PickupTimeControl } from "@/components/takeaway/pickup-time-control";
import { TakeawayPicker } from "./takeaway-picker";

/** Selected variations, indented right under their parent line. Additions show
 * their list price as detail (the line price carries the diminishing-scaled
 * surcharge); removals never deduct, so they show no amount. */
function ModifierRows({
  modifiers,
  muted,
}: {
  modifiers: Array<{
    key: string;
    name: string;
    priceAdjustment: number;
    isRemoval: boolean;
  }>;
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
  );
}

interface TicketPanelProps {
  tables: RestaurantTable[];
  openOrder: OpenOrder | null;
  openSplits: Order[];
  openTakeaways: Order[];
  /** Pantry + per-dish ingredients; key presence in `byItem` gates the editor */
  variations: VariationData;
  onOrderChanged: () => Promise<void>;
  /** Linked-table members (live), for the 🔗 chip and link dialog */
  links: TableLink[];
  onLinksChanged: () => Promise<void>;
}

export function TicketPanel({
  tables,
  openOrder,
  openSplits,
  openTakeaways,
  variations,
  onOrderChanged,
  links,
  onLinksChanged,
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
    setDraftCovers,
    clearTicket,
  } = useTicketStore();
  const t = useT();
  const canCheckout = usePermission("checkout_orders");
  // Ingredient edits are open to anyone taking orders; re-pricing a line is not.
  const canOverridePrice = usePermission("override_price");
  const userId = useAuthStore((s) => s.user?.id ?? null);
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

  // Send / checkout / amend / price-override / pre-receipt are shared with the
  // phone UI — see src/hooks/use-order-actions.ts.
  const {
    busy: actionsBusy,
    hasTarget,
    targetLabel,
    send: handleSend,
    checkout: runCheckout,
    linkedOpenBills,
    amendSentItem,
    setSentPrice,
    preReceipt: handlePreReceipt,
    covers,
    needsCovers,
  } = useOrderActions({ openOrder, onOrderChanged });

  const [coversOpen, setCoversOpen] = useState(false);

  async function handleCovers(next: number) {
    // No order yet on a table being opened, so the answer waits in the ticket
    // store until the first send creates one.
    if (openOrder) {
      try {
        await updateOrderCovers(openOrder.order.id, next);
        await onOrderChanged();
        toast.success(t("pos.coversUpdated", { count: next }));
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : t("pos.coversUpdateFailed"),
        );
        return;
      }
    } else {
      setDraftCovers(next);
    }
    setCoversOpen(false);
  }

  // Take-away creation and the cleanup prompt stay panel-local (the phone has
  // its own flows for both), so they carry their own busy flag.
  const [panelBusy, setPanelBusy] = useState(false);
  const busy = actionsBusy || panelBusy;

  const [linkOpen, setLinkOpen] = useState(false);
  // Open bills on linked tables, found right before a checkout / split:
  // the cashier confirms (or jumps to one of them) before `action` runs.
  const [linkWarning, setLinkWarning] = useState<{
    bills: LinkedBill[];
    action: "checkout" | "split";
  } | null>(null);
  const linkNames =
    mode === "table" && tableId
      ? linkPartners(links, { tableId, subtable }).map((m) =>
          linkLabel(
            tables.find((tb) => tb.id === m.table_id)?.name ?? "?",
            m.subtable,
          ),
        )
      : [];

  async function guardLinked(action: "checkout" | "split") {
    const bills = await linkedOpenBills();
    if (bills.length > 0) {
      setLinkWarning({ bills, action });
      return;
    }
    if (action === "split") setSplitOpen(true);
    else await handleCheckout();
  }

  function confirmLinked() {
    const action = linkWarning?.action;
    setLinkWarning(null);
    if (action === "split") setSplitOpen(true);
    else if (action === "checkout") void handleCheckout();
  }

  function openLinkedBill(bill: LinkedBill) {
    setLinkWarning(null);
    const tbl = tables.find((tb) => tb.id === bill.tableId);
    setTable(bill.tableId, tbl?.name ?? bill.label);
    setSubtable(bill.subtable);
  }

  async function handleCheckout() {
    const outcome = await runCheckout();
    // Whole table is free — let the user decide dirty vs. available.
    if (outcome.kind === "table-freed") {
      setCleanup({ tableId: outcome.tableId, tableName: outcome.tableName });
    }
  }

  // Manual price override — the pending branch is pure store state, so it
  // stays here; only the sent branch hits the DB.
  async function applyPriceEdit(target: PriceEditTarget, unitPrice: number) {
    if (target.kind === "pending") {
      setLinePrice(target.id, unitPrice);
      return;
    }
    await setSentPrice(target.id, unitPrice, target.name);
  }

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

  // Start a new take-away from the POS using the same logic as the floor-plan
  // New Delivery: create the order eagerly so it gets tonight's counter number,
  // save the name as a reusable label, then load it as the active ticket.
  async function startNewTakeaway(name: string) {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setPanelBusy(true);
    try {
      const { orderId, deliveryNumber } = await createDeliveryOrder(
        trimmed,
        userId,
      );
      setTakeaway(orderId, trimmed);
      await onOrderChanged();
      setSavedLabels(await fetchDeliveryLabels());
      toast.success(
        t("pos.takeawayStarted", { number: deliveryNumber, name: trimmed }),
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("pos.couldNotStartTakeaway"),
      );
    } finally {
      setPanelBusy(false);
    }
  }

  // The same customer ringing back: a second order, not a second "Rossi".
  async function addToExistingTakeaway(parent: Order) {
    if (busy) return;
    setPanelBusy(true);
    try {
      const { orderId, deliveryNumber } = await createFollowUpOrder(
        parent,
        userId,
      );
      setTakeaway(orderId, parent.customer_name ?? "");
      await onOrderChanged();
      toast.success(
        t("takeaway.followUpStarted", {
          number: deliveryNumber,
          name: parent.customer_name ?? "",
        }),
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("pos.couldNotStartTakeaway"),
      );
    } finally {
      setPanelBusy(false);
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
          ? t("pos.takeawayFullyPaid", { label: closedLabel ?? "" })
          : t("pos.splitFullyPaidOthersOpen", { label: closedLabel ?? "" }),
      );
    }
  }

  // Apply the dirty/available choice from the post-checkout cleanup prompt.
  async function applyCleanup(status: TableStatus) {
    if (!cleanup) return;
    setPanelBusy(true);
    try {
      await updateTableStatus(cleanup.tableId, status);
      await onOrderChanged();
      toast.success(
        status === "dirty"
          ? t("pos.tableFlaggedCleaning", { name: cleanup.tableName })
          : t("pos.tableIsFree", { name: cleanup.tableName }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.updateFailed"));
    } finally {
      setPanelBusy(false);
      setCleanup(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b p-4">
        <Tabs value={mode} onValueChange={(m) => setMode(m as TicketMode)}>
          <TabsList className="grid h-12 w-full grid-cols-2">
            <TabsTrigger value="table" className="h-10 text-base">
              {t("pos.dineIn")}
            </TabsTrigger>
            <TabsTrigger value="takeaway" className="h-10 text-base">
              {t("pos.takeaway")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "table" ? (
          <>
            <Select
              value={tableId ?? ""}
              onValueChange={(id) => {
                const tbl = tables.find((x) => x.id === id);
                if (tbl) setTable(tbl.id, tbl.name);
              }}
            >
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder={t("pos.selectTable")} />
              </SelectTrigger>
              <SelectContent>
                {tables.map((tbl) => (
                  <SelectItem key={tbl.id} value={tbl.id}>
                    {t("pos.tableOption", {
                      name: tbl.name,
                      count: tbl.capacity,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tableId && (
              <>
                <SplitPicker
                  tableName={tableName ?? ""}
                  openSplits={openSplits}
                  subtable={subtable}
                  onSelect={setSubtable}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <CoversChip
                    covers={covers}
                    onClick={() => setCoversOpen(true)}
                  />
                  <button
                    type="button"
                    onClick={() => setLinkOpen(true)}
                    className={
                      linkNames.length > 0
                        ? "flex h-9 max-w-full items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary/20"
                        : "flex h-9 items-center gap-1.5 rounded-full border border-dashed px-3 text-sm font-medium text-muted-foreground hover:bg-accent"
                    }
                  >
                    <Link2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {linkNames.length > 0
                        ? linkNames.join(", ")
                        : t("links.link")}
                    </span>
                  </button>
                </div>
              </>
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
              <TakeawayCaption
                order={openOrder?.order ?? null}
                bound={takeawayOrderId !== null}
              />
            </div>
            <PickupTimeControl
              orderId={openOrder?.order.id ?? null}
              pickupAt={openOrder?.order.pickup_at ?? null}
              onChanged={onOrderChanged}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              aria-label={t("pos.clearTakeawayAria")}
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
            onAddToExisting={(o) => void addToExistingTakeaway(o)}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <TakeawayCapacityBanner
          openOrder={openOrder}
          onChanged={onOrderChanged}
        />

        {!hasTarget && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {mode === "table"
              ? t("pos.pickTableToStart")
              : t("pos.findOpenTakeaway")}
          </p>
        )}

        {openOrder && openOrder.items.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("pos.sentToKitchen")}
            </h3>
            <div className="flex flex-col gap-1.5">
              {collapseCoperto(openOrder.items).map((i) => {
                // Same label rule as the menu: a pizza that was tapped as
                // "1202" reads as 1202 here too, with its toppings underneath.
                const label = orderItemLabel(
                  i.menu_items,
                  t("floor.itemFallback"),
                );
                const name =
                  label.title + (i.fraction_of ? ` (1/${i.fraction_of})` : "");
                const modifierRows = (i.order_item_modifiers ?? []).map(
                  (m) => ({
                    key: m.id,
                    name: m.name,
                    priceAdjustment: m.price_adjustment,
                    isRemoval: m.is_removal,
                  }),
                );
                if (i.paid_by_payment_id) {
                  // settled by a split payment — immutable from here on
                  return (
                    <div key={i.id}>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 flex-1 line-through">
                          <span className="block truncate">
                            {i.quantity > 1 ? `${i.quantity}× ` : ""}
                            {name}
                          </span>
                          {label.ingredients && (
                            <span className="block truncate text-xs">
                              {label.ingredients}
                            </span>
                          )}
                        </span>
                        <span className="text-xs font-medium uppercase">
                          {t("pos.paid")}
                        </span>
                        <span className="w-14 text-right tabular-nums line-through">
                          {formatMoney(i.unit_price * i.quantity)}
                        </span>
                      </div>
                      <ModifierRows modifiers={modifierRows} muted />
                    </div>
                  );
                }
                if (i.menu_items?.is_coperto) {
                  // The cover charge is derived from the guest count, so it
                  // carries none of the per-line controls: a trash button here
                  // would drop the charge outright, and a stepper would let the
                  // quantity drift away from covers — which is the hand-managed
                  // cover charge this feature exists to replace. The pencil goes
                  // to the count instead, the one number that owns this line.
                  // The empty span holds the column where the trash sits on
                  // every other row, so the prices stay in one line.
                  return (
                    <div
                      key={i.id}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {i.quantity > 1 ? `${i.quantity}× ` : ""}
                        {name}
                      </span>
                      <span className="w-14 text-right tabular-nums">
                        {formatMoney(i.unit_price * i.quantity)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={t("pos.coversEditAria")}
                        disabled={busy}
                        onClick={() => setCoversOpen(true)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-8" aria-hidden />
                    </div>
                  );
                }
                return (
                  <div key={i.id}>
                  <div
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{name}</span>
                      {label.ingredients && (
                        <span className="block truncate text-xs leading-snug">
                          {label.ingredients}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={t("pos.decreaseSent", { name })}
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
                        aria-label={t("pos.increaseSent", { name })}
                        disabled={busy}
                        onClick={() => amendSentItem(i.id, i.quantity + 1)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className="w-14 text-right tabular-nums">
                      {formatMoney(i.unit_price * i.quantity)}
                    </span>
                    {/* Sent lines are re-priced, not re-composed: the kitchen
                        already has the slip. The spacer keeps the totals
                        column aligned for staff who may not re-price. */}
                    {canOverridePrice ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={t("pos.adjustPriceOf", { name })}
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
                    ) : (
                      <span className="w-8" aria-hidden />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t("pos.removeSent", { name })}
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
            {openOrder ? t("pos.tapAnotherRound") : t("pos.tapToBuild")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {lines.map((l) => (
            <div key={l.lineId}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.name}</div>
                  {l.ingredients && (
                    <div className="text-xs leading-snug text-muted-foreground line-clamp-2">
                      {l.ingredients}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {t("pos.each", { amount: formatMoney(lineUnitPrice(l)) })}
                    {l.priceOverridden && (
                      <span className="ml-1 font-medium text-amber-600">
                        {" "}
                        {t("pos.adjusted")}
                      </span>
                    )}
                  </div>
                </div>
                {/* One door for the whole line: ingredients for everyone,
                    price for those allowed. Hidden only when the user may do
                    neither, so it never opens onto an empty dialog. */}
                {(l.menuItemId in variations.byItem || canOverridePrice) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground"
                    // name what this user can actually change, so the label
                    // never promises a price field they will not be shown
                    aria-label={t(
                      l.menuItemId in variations.byItem
                        ? canOverridePrice
                          ? "pos.editLineAria"
                          : "pos.editLineIngredientsAria"
                        : "pos.editLinePriceAria",
                      { name: l.name },
                    )}
                    onClick={() => setEditLine(l)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={t("pos.decrease", { name: l.name })}
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
                    aria-label={t("pos.increase", { name: l.name })}
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
                  aria-label={t("pos.remove", { name: l.name })}
                  onClick={() => removeItem(l.lineId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <ModifierRows
                modifiers={l.modifiers.map((m) => ({
                  key: `${m.ingredientId}:${m.isRemoval}`,
                  name: m.name,
                  priceAdjustment: m.priceAdjustment,
                  isRemoval: m.isRemoval,
                }))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mb-4 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>{t("pos.subtotal")}</span>
            <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>{t("pos.tax")}</span>
            <span className="tabular-nums">{formatMoney(totals.tax)}</span>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <span>{t("pos.total")}</span>
            <span className="tabular-nums">{formatMoney(totals.total)}</span>
          </div>
          {paidCents > 0 && (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>
                  {payments.length === 1
                    ? t("pos.paidPaymentsOne")
                    : t("pos.paidPaymentsMany", { count: payments.length })}
                </span>
                <span className="tabular-nums">
                  -{formatMoney(paidCents / 100)}
                </span>
              </div>
              <div className="flex justify-between text-lg font-semibold">
                <span>{t("pos.balanceDue")}</span>
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
            <ChefHat className="mr-2 h-5 w-5" /> {t("pos.sendToKitchenBtn")}
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
                <ReceiptText className="mr-2 h-4 w-4" /> {t("pos.preReceiptBtn")}
              </Button>
              {canCheckout && (
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 flex-1 text-sm"
                  disabled={busy}
                  onClick={() => void guardLinked("split")}
                >
                  <Split className="mr-2 h-4 w-4" /> {t("pos.splitBillBtn")}
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
              onClick={() => void guardLinked("checkout")}
            >
              <CreditCard className="mr-2 h-5 w-5" />{" "}
              {t("pos.checkoutBtn", { amount: formatMoney(balanceCents / 100) })}
            </Button>
          )}
        </div>
      </div>

      {/* Asked as soon as a table is targeted and nobody has answered yet, and
          on demand from the chip. Closing it leaves the table unanswered
          rather than trapping the till — the send is what actually requires a
          count, and it says so. */}
      <Dialog
        open={coversOpen || needsCovers}
        onOpenChange={(o) => {
          if (!o) setCoversOpen(false);
        }}
      >
        <DialogContent className="max-w-sm gap-0 border-0 bg-transparent p-0 shadow-none">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("pos.coversTitle")}</DialogTitle>
            <DialogDescription>{t("pos.coversBody")}</DialogDescription>
          </DialogHeader>
          <CoversPrompt
            initial={
              covers ??
              tables.find((x) => x.id === tableId)?.capacity ??
              2
            }
            busy={busy}
            onConfirm={(n) => void handleCovers(n)}
            onCancel={() => setCoversOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <PriceEditDialog
        target={priceEdit}
        onClose={() => setPriceEdit(null)}
        onSubmit={applyPriceEdit}
      />
      <VariationDialog
        open={editLine !== null}
        itemName={editLine?.name ?? ""}
        basePrice={editLine?.unitPrice ?? 0}
        dishIngredients={
          editLine ? (variations.byItem[editLine.menuItemId] ?? []) : []
        }
        pantry={variations.pantry}
        variationsAllowed={
          editLine !== null && editLine.menuItemId in variations.byItem
        }
        canEditPrice={canOverridePrice}
        initialModifiers={editLine?.modifiers ?? []}
        onClose={() => setEditLine(null)}
        onConfirm={(modifiers, basePrice) => {
          if (!editLine) return;
          setLineModifiers(editLine.lineId, modifiers);
          // null means the base was left alone — don't flag the line as
          // manually priced just because the editor was opened.
          if (basePrice !== null) setLinePrice(editLine.lineId, basePrice);
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

      {mode === "table" && tableId && (
        <LinkTablesDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          target={{ tableId, subtable }}
          label={linkLabel(tableName ?? "", subtable)}
          tables={tables}
          links={links}
          onChanged={onLinksChanged}
        />
      )}
      <LinkedBillsDialog
        bills={linkWarning?.bills ?? null}
        label={targetLabel ?? ""}
        confirmLabel={
          linkWarning?.action === "split"
            ? t("links.splitAnyway")
            : t("links.payAnyway")
        }
        onConfirm={confirmLinked}
        onOpenBill={openLinkedBill}
        onCancel={() => setLinkWarning(null)}
      />

      {/* Post-checkout: how should the freed table be left? */}
      <Dialog open={!!cleanup} onOpenChange={(o) => !o && setCleanup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("pos.tablePaid", { name: cleanup?.tableName ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("pos.howLeaveTable")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              variant="secondary"
              className="h-14 text-base"
              disabled={busy}
              onClick={() => applyCleanup("dirty")}
            >
              <Trash2 className="mr-2 h-5 w-5" /> {t("pos.markDirty")}
            </Button>
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy}
              onClick={() => applyCleanup("available")}
            >
              <Check className="mr-2 h-5 w-5" /> {t("pos.markAvailable")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
