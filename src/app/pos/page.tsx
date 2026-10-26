"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ReceiptText, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CategoryJump } from "@/components/menu/category-jump";
import { MenuList } from "@/components/menu/menu-list";
import { MenuSearchBar } from "@/components/menu/menu-search-bar";
import { TicketPanel } from "@/components/pos/ticket-panel";
import { useMenuData } from "@/hooks/use-menu-data";
import { useMenuSearch, useOrderedCounts } from "@/hooks/use-menu-search";
import { useOpenOrder } from "@/hooks/use-open-order";
import { useTableLinks } from "@/hooks/use-table-links";
import { makeMenuLabeller, type MenuItemView } from "@/lib/menu-display";
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
    variations,
    tables,
    loading,
    error,
    reload: loadStatic,
  } = useMenuData();
  const {
    openOrder,
    loaded: openOrderLoaded,
    openSplits,
    openTakeaways,
    refresh: refreshOrder,
  } = useOpenOrder();
  const {
    query,
    setQuery,
    results,
    categoryCounts,
    jumpOpen,
    setJumpOpen,
    scrollToCategoryId,
    jumpTo,
    onScrolledToCategory,
  } = useMenuSearch(items, categories);
  const orderedCounts = useOrderedCounts();
  const { links, refresh: refreshLinks } = useTableLinks();

  // Phone layout: the ticket lives in a bottom sheet instead of the sidebar
  const [ticketOpen, setTicketOpen] = useState(false);

  // Auto-close the mobile ticket sheet when the pending lines empty out —
  // i.e. right after a successful "send to kitchen" clears the ticket.
  const prevLineCount = useRef(0);
  useEffect(() => {
    if (prevLineCount.current > 0 && lines.length === 0) setTicketOpen(false);
    prevLineCount.current = lines.length;
  }, [lines.length]);

  const labelOf = makeMenuLabeller(categories);
  // what the covers prompt puts on the ticket; null when the house has none
  const copertoItem = items.find((i) => i.is_coperto) ?? null;

  function handleAdd(item: MenuItemView): boolean {
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
    // It carries the label it had in the menu, so a pizza tapped as "1202"
    // does not reappear on the ticket as its topping list.
    const label = labelOf(item);
    addItem({ ...item, name: label.title, ingredients: label.ingredients });
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
      {/* Menu column: the list takes the height, the search bar pins to the
          bottom of it — under the hand, and next to the ticket rather than a
          screen away from it. */}
      {/* min-h-0: without it this column's automatic minimum is its content
          height, so below lg it outgrows the page and the search bar scrolls
          away with the menu instead of staying pinned to the bottom. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {loading ? (
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-4 md:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="min-h-24 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <MenuList
            categories={categories}
            items={results}
            counts={orderedCounts}
            query={query}
            variant="grid"
            onAdd={handleAdd}
            scrollToCategoryId={scrollToCategoryId}
            onScrolledToCategory={onScrolledToCategory}
          />
        )}
        {!loading && (
          <MenuSearchBar
            query={query}
            onQueryChange={setQuery}
            resultCount={results.length}
            onBrowse={() => setJumpOpen(true)}
          />
        )}
      </div>

      <CategoryJump
        open={jumpOpen}
        onOpenChange={setJumpOpen}
        categories={categories}
        counts={categoryCounts}
        onPick={jumpTo}
        variant="dialog"
      />

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
            openOrderLoaded={openOrderLoaded}
            copertoItem={copertoItem}
            openSplits={openSplits}
            openTakeaways={openTakeaways}
            variations={variations}
            onOrderChanged={refreshOrder}
            links={links}
            onLinksChanged={refreshLinks}
          />
        </SheetContent>
      </Sheet>

      {/* Desktop: the classic fixed ticket sidebar */}
      <div className="hidden w-full max-w-[400px] shrink-0 border-l bg-card lg:block">
        <TicketPanel
          tables={tables}
          openOrder={openOrder}
          openOrderLoaded={openOrderLoaded}
          copertoItem={copertoItem}
          openSplits={openSplits}
          openTakeaways={openTakeaways}
          variations={variations}
          onOrderChanged={refreshOrder}
          links={links}
          onLinksChanged={refreshLinks}
        />
      </div>
    </div>
  );
}
