"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ReceiptText, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ItemSearch } from "@/components/pos/item-search";
import { MenuPanel } from "@/components/pos/menu-panel";
import { TicketPanel } from "@/components/pos/ticket-panel";
import { useMenuData } from "@/hooks/use-menu-data";
import { useOpenOrder } from "@/hooks/use-open-order";
import type { MenuItem } from "@/lib/database.types";
import { formatMoney } from "@/lib/constants";
import { calcTotals } from "@/lib/money";
import { useT } from "@/lib/i18n/use-translation";
import { lineUnitPrice, useTicketStore } from "@/stores/ticket-store";
import { usePermission } from "@/stores/auth-store";

export default function PosPage() {
  const t = useT();
  const mode = useTicketStore((s) => s.mode);
  const tableId = useTicketStore((s) => s.tableId);
  const takeawayName = useTicketStore((s) => s.takeawayName);
  const addItem = useTicketStore((s) => s.addItem);
  const lines = useTicketStore((s) => s.lines);
  const canTakeOrders = usePermission("take_orders");

  const {
    categories,
    items,
    modifierGroups,
    tables,
    loading,
    error,
    reload: loadStatic,
  } = useMenuData();
  const {
    openOrder,
    openSplits,
    openTakeaways,
    refresh: refreshOrder,
  } = useOpenOrder();
  // Phone layout: the ticket lives in a bottom sheet instead of the sidebar
  const [ticketOpen, setTicketOpen] = useState(false);

  // Auto-close the mobile ticket sheet when the pending lines empty out —
  // i.e. right after a successful "send to kitchen" clears the ticket.
  const prevLineCount = useRef(0);
  useEffect(() => {
    if (prevLineCount.current > 0 && lines.length === 0) setTicketOpen(false);
    prevLineCount.current = lines.length;
  }, [lines.length]);

  function handleAdd(item: MenuItem): boolean {
    const hasTarget = mode === "table" ? !!tableId : !!takeawayName;
    if (!hasTarget) {
      toast.error(
        mode === "table"
          ? t("pos.selectTableFirst")
          : t("pos.pickTakeawayFirst"),
      );
      return false;
    }
    // The dish goes straight onto the ticket at its base price. Ingredients are
    // added later, on demand, from the line itself (no forced selection).
    addItem(item);
    return true;
  }

  // Mobile ticket-bar badge: pending (unsent) lines plus the unpaid part of
  // the open order, so the bar shows the table's real balance at a glance.
  const unpaidOpenItems =
    openOrder?.items.filter((i) => i.paid_by_payment_id === null) ?? [];
  const badgeCount =
    lines.reduce((n, l) => n + l.quantity, 0) +
    unpaidOpenItems.reduce((n, i) => n + i.quantity, 0);
  const badgeTotal = calcTotals(
    [
      ...lines.map((l) => ({
        unitPrice: lineUnitPrice(l),
        quantity: l.quantity,
      })),
      ...unpaidOpenItems.map((i) => ({
        unitPrice: i.unit_price,
        quantity: i.quantity,
      })),
    ],
    openOrder?.order.tax_rate ?? undefined,
  ).total;

  if (!canTakeOrders) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("pos.noAccessTitle")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("pos.noAccessBody")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">{t("floor.cantReachDb")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => loadStatic()}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        {!loading && (
          <ItemSearch
            items={items}
            categories={categories}
            onAdd={handleAdd}
          />
        )}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="min-h-24 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <MenuPanel
              categories={categories}
              items={items}
              onAdd={handleAdd}
            />
          </div>
        )}
      </div>

      {/* Phone / small tablet: in-flow summary bar opening the ticket sheet */}
      <div className="shrink-0 border-t bg-card p-2 lg:hidden">
        <Button
          className="h-12 w-full justify-between text-base"
          onClick={() => setTicketOpen(true)}
        >
          <span className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            {t("pos.viewTicket")}
          </span>
          <span className="tabular-nums">
            {t("pos.ticketItemsCount", { count: badgeCount })} ·{" "}
            {formatMoney(badgeTotal)}
          </span>
        </Button>
      </div>

      <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
        <SheetContent className="lg:hidden">
          <SheetTitle className="sr-only">{t("pos.viewTicket")}</SheetTitle>
          <TicketPanel
            tables={tables}
            openOrder={openOrder}
            openSplits={openSplits}
            openTakeaways={openTakeaways}
            modifierGroups={modifierGroups}
            onOrderChanged={refreshOrder}
          />
        </SheetContent>
      </Sheet>

      {/* Desktop: the classic fixed ticket sidebar */}
      <div className="hidden w-full max-w-[400px] shrink-0 border-l bg-card lg:block">
        <TicketPanel
          tables={tables}
          openOrder={openOrder}
          openSplits={openSplits}
          openTakeaways={openTakeaways}
          modifierGroups={modifierGroups}
          onOrderChanged={refreshOrder}
        />
      </div>
    </div>
  );
}
