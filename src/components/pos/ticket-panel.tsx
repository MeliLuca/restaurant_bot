"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChefHat,
  CreditCard,
  Minus,
  Plus,
  ShoppingBag,
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  checkoutOrder,
  sendTakeawayToKitchen,
  sendToKitchen,
  type OpenOrder,
} from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { calcTotals } from "@/lib/money";
import type { Order, RestaurantTable } from "@/lib/database.types";
import { useTicketStore, type TicketMode } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";
import { TakeawayPicker } from "./takeaway-picker";

interface TicketPanelProps {
  tables: RestaurantTable[];
  openOrder: OpenOrder | null;
  openTakeaways: Order[];
  onOrderChanged: () => Promise<void>;
}

export function TicketPanel({
  tables,
  openOrder,
  openTakeaways,
  onOrderChanged,
}: TicketPanelProps) {
  const {
    mode,
    tableId,
    tableName,
    takeawayOrderId,
    takeawayName,
    lines,
    setMode,
    setTable,
    setTakeaway,
    removeItem,
    setQuantity,
    clearLines,
    clearTicket,
  } = useTicketStore();
  const canCheckout = usePermission("checkout_orders");
  const [busy, setBusy] = useState(false);

  const hasTarget = mode === "table" ? !!tableId : !!takeawayName;
  const targetLabel = mode === "table" ? tableName : takeawayName;

  const sentLines =
    openOrder?.items.map((i) => ({
      unitPrice: i.unit_price,
      quantity: i.quantity,
    })) ?? [];
  const totals = calcTotals([...sentLines, ...lines]);

  async function handleSend() {
    if (!hasTarget) return;
    setBusy(true);
    try {
      if (mode === "table") {
        await sendToKitchen(tableId!, lines);
      } else {
        const orderId = await sendTakeawayToKitchen(
          takeawayOrderId,
          takeawayName!,
          lines,
        );
        setTakeaway(orderId, takeawayName!);
      }
      clearLines();
      await onOrderChanged();
      toast.success(`Order sent to kitchen for ${targetLabel}`);
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
      if (lines.length > 0) {
        orderId =
          mode === "table"
            ? await sendToKitchen(tableId!, lines)
            : await sendTakeawayToKitchen(takeawayOrderId, takeawayName!, lines);
        clearLines();
      }
      if (!orderId) {
        toast.error("Nothing to check out");
        return;
      }
      await checkoutOrder(orderId, mode === "table" ? tableId : null);
      const closedLabel = targetLabel;
      clearTicket();
      await onOrderChanged();
      toast.success(
        mode === "table"
          ? `${closedLabel} paid — table flagged for cleaning`
          : `Take-away for ${closedLabel} paid`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
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
        ) : takeawayName ? (
          <div className="flex h-12 items-center gap-2 rounded-md border px-3">
            <ShoppingBag className="h-5 w-5 shrink-0 text-muted-foreground" />
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
            onPickExisting={(o) => setTakeaway(o.id, o.customer_name ?? "")}
            onStartNew={(name) => setTakeaway(null, name)}
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
              Sent to kitchen
            </h3>
            <div className="flex flex-col gap-1.5">
              {openOrder.items.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between text-sm text-muted-foreground"
                >
                  <span>
                    {i.quantity} × {i.menu_items?.name ?? "Item"}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(i.unit_price * i.quantity)}
                  </span>
                </div>
              ))}
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
            <div key={l.menuItemId} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatMoney(l.unitPrice)} each
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  aria-label={`Decrease ${l.name}`}
                  onClick={() => setQuantity(l.menuItemId, l.quantity - 1)}
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
                  onClick={() => setQuantity(l.menuItemId, l.quantity + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <span className="w-16 text-right font-medium tabular-nums">
                {formatMoney(l.unitPrice * l.quantity)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-muted-foreground"
                aria-label={`Remove ${l.name}`}
                onClick={() => removeItem(l.menuItemId)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
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
          {canCheckout && (
            <Button
              size="lg"
              variant="secondary"
              className="h-14 text-base"
              disabled={busy || !hasTarget || (!openOrder && lines.length === 0)}
              onClick={handleCheckout}
            >
              <CreditCard className="mr-2 h-5 w-5" /> Checkout · {formatMoney(totals.total)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
