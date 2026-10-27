"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoversPrompt } from "@/components/order/covers-prompt";
import { MoveBillForm, type MoveDone } from "@/components/order/move-bill-form";
import {
  createDeliveryOrder,
  fetchDeliveryLabels,
  updateOrderCovers,
  updateTableStatus,
  type OpenOrder,
  type VariationData,
} from "@/lib/api";
import { calcTotals, toCents } from "@/lib/money";
import type {
  MenuItem,
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
} from "@/stores/ticket-store";
import { useT } from "@/lib/i18n/use-translation";
import { useOrderActions } from "@/hooks/use-order-actions";
import { useAuthStore, usePermission } from "@/stores/auth-store";
import { VariationDialog } from "./variation-dialog";
import { PriceEditDialog, type PriceEditTarget } from "./price-edit-dialog";
import { SplitBillDialog } from "./split-bill-dialog";
import { LinkTablesDialog } from "./link-tables-dialog";
import { LinkedBillsDialog } from "./linked-bills-dialog";
import { createFollowUpOrder } from "@/lib/takeaway/api";
import { TicketHeader } from "./ticket-header";
import { TicketLines } from "./ticket-lines";
import { TicketFooter } from "./ticket-footer";

// The ticket is split in three parts with their own files — TicketHeader
// (who it is for), TicketLines (the bill) and TicketFooter (totals and
// actions). This container keeps the state, the order actions and every dialog.

interface TicketPanelProps {
  tables: RestaurantTable[];
  openOrder: OpenOrder | null;
  /** Whether `openOrder` is loaded for the current target (see useOpenOrder) */
  openOrderLoaded: boolean;
  /** The menu's coperto product, which the covers prompt puts on the ticket;
   * null when the house charges none */
  copertoItem: Pick<MenuItem, "id" | "name" | "price"> | null;
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
  openOrderLoaded,
  copertoItem,
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
    lines,
    setTable,
    setSubtable,
    setTakeaway,
    setLinePrice,
    setLineModifiers,
    setDraftCovers,
    setCopertoLine,
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
    /** Emptied by a cambio tavolo rather than a checkout */
    moved?: boolean;
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
  } = useOrderActions({ openOrder, openOrderLoaded, onOrderChanged });

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
      // the answer becomes the order's first line, sent and printed with it
      if (copertoItem) setCopertoLine(copertoItem, next);
    }
    setCoversOpen(false);
  }

  // covers already settled by a split payment; the unpaid coperto row on
  // screen is the rest of the count
  const paidCovers = (openOrder?.items ?? [])
    .filter((i) => i.menu_items?.is_coperto && i.paid_by_payment_id !== null)
    .reduce((n, i) => n + i.quantity, 0);

  // Take-away creation and the cleanup prompt stay panel-local (the phone has
  // its own flows for both), so they carry their own busy flag.
  const [panelBusy, setPanelBusy] = useState(false);
  const busy = actionsBusy || panelBusy;

  const [linkOpen, setLinkOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // order_items picked on the bill before "Sposta"; null = start with all
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const openMove = (ids?: string[]) => {
    setMoveIds(ids ?? null);
    setMoveOpen(true);
  };
  const canTakeOrders = usePermission("take_orders");

  // After a cambio tavolo: follow the bill when it left this target entirely,
  // and ask dirty-vs-available when its table is now empty.
  async function handleMoved(done: MoveDone) {
    setMoveOpen(false);
    const fromTableId = tableId;
    const fromTableName = tableName;
    if (done.result.sourceClosed) {
      setTable(done.tableId, done.tableName);
      setSubtable(done.subtable);
    }
    await onOrderChanged();
    if (done.result.tableFreed && fromTableId) {
      setCleanup({ tableId: fromTableId, tableName: fromTableName ?? "", moved: true });
    }
  }
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

  // Manual price override, on one line or a multi-selection — pending lines
  // are pure store state; only sent ones hit the DB, one row after another.
  async function applyPriceEdit(target: PriceEditTarget, prices: number[]) {
    for (let n = 0; n < target.lines.length; n++) {
      const line = target.lines[n];
      if (line.kind === "pending") setLinePrice(line.id, prices[n]);
      else await setSentPrice(line.id, prices[n], target.name);
    }
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
      <TicketHeader
        tables={tables}
        openOrder={openOrder}
        openSplits={openSplits}
        openTakeaways={openTakeaways}
        covers={covers}
        linkNames={linkNames}
        busy={busy}
        canTakeOrders={canTakeOrders}
        savedLabels={savedLabels}
        onOpenCovers={() => setCoversOpen(true)}
        onOpenLink={() => setLinkOpen(true)}
        onOpenMove={openMove}
        onStartNewTakeaway={(name) => void startNewTakeaway(name)}
        onAddToExistingTakeaway={(o) => void addToExistingTakeaway(o)}
        onOrderChanged={onOrderChanged}
      />

      <TicketLines
        openOrder={openOrder}
        hasTarget={hasTarget}
        variations={variations}
        canOverridePrice={canOverridePrice}
        busy={busy}
        paidCovers={paidCovers}
        onSetCovers={handleCovers}
        onAmendSent={amendSentItem}
        onEditPrice={setPriceEdit}
        onEditLine={setEditLine}
        onOpenMove={openMove}
        onOrderChanged={onOrderChanged}
      />

      <TicketFooter
        totals={totals}
        payments={payments}
        paidCents={paidCents}
        balanceCents={balanceCents}
        pendingCount={lines.length}
        hasTarget={hasTarget}
        hasOpenOrder={!!openOrder}
        busy={busy}
        canCheckout={canCheckout}
        onSend={() => void handleSend()}
        onPreReceipt={() => void handlePreReceipt()}
        onSplit={() => void guardLinked("split")}
        onCheckout={() => void guardLinked("checkout")}
      />

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

      {openOrder && mode === "table" && (
        <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
          <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
            <DialogHeader>
              <DialogTitle>
                {t("move.title", { name: targetLabel ?? "" })}
              </DialogTitle>
              <DialogDescription>{t("move.desc")}</DialogDescription>
            </DialogHeader>
            {moveOpen && (
              <MoveBillForm
                bill={openOrder}
                tableName={tableName ?? ""}
                tables={tables}
                pendingCount={lines.length}
                initialIds={moveIds ?? undefined}
                onDone={(d) => void handleMoved(d)}
                onCancel={() => setMoveOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>
      )}

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
        quickNotes={variations.quickNotes}
        initialNotes={editLine?.notes ?? []}
        onClose={() => setEditLine(null)}
        onConfirm={(modifiers, basePrice, notes) => {
          if (!editLine) return;
          setLineModifiers(editLine.lineId, modifiers, notes);
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
              {t(cleanup?.moved ? "move.tableEmpty" : "pos.tablePaid", {
                name: cleanup?.tableName ?? "",
              })}
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
