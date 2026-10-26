"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReceiptText, TriangleAlert } from "lucide-react";
import { CoversChip, CoversPrompt } from "@/components/order/covers-prompt";
import { CategoryJump } from "@/components/menu/category-jump";
import { MenuList } from "@/components/menu/menu-list";
import { MenuSearchBar } from "@/components/menu/menu-search-bar";
import { updateOrderCovers } from "@/lib/api";
import { useMenuData } from "@/hooks/use-menu-data";
import { useMenuSearch, useOrderedCounts } from "@/hooks/use-menu-search";
import { useOpenOrder } from "@/hooks/use-open-order";
import { useOrderActions } from "@/hooks/use-order-actions";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { calcTotals } from "@/lib/money";
import { makeMenuLabeller, type MenuItemView } from "@/lib/menu-display";
import { usePermission } from "@/stores/auth-store";
import {
  lineUnitPrice,
  useTicketStore,
  type TicketLine,
} from "@/stores/ticket-store";
import { mRoutes } from "@/mobile/lib/routes";
import { useKeyboardInset } from "@/mobile/hooks/use-keyboard-inset";
import {
  useTakeawayTicketTarget,
  useTicketTarget,
} from "@/mobile/hooks/use-ticket-target";
import { PickupTimeControl } from "@/components/takeaway/pickup-time-control";
import { TakeawayCapacityBanner } from "@/components/takeaway/capacity-banner";
import { MHeader } from "./m-header";
import { VariationScreen } from "./variation-screen";
import { TicketLinesSheet } from "./ticket-lines";

/** What this screen is adding items to */
export type OrderTarget =
  | { kind: "table"; tableId: string; subtable: string | null }
  | { kind: "takeaway"; orderId: string; name: string };

/**
 * Order taking for one target — a (table, subtable), or a take-away. The flow
 * underneath — send, and the price snapshot it writes — is the shared
 * useOrderActions, so a round sent from here is identical to one sent from the
 * desktop till.
 *
 * The two targets share the whole screen because a waiter browsing the menu is
 * doing the same job either way; what differs is the header (guests vs pickup
 * time), and where "send" takes you afterwards.
 */
export function OrderScreen({ target }: { target: OrderTarget }) {
  const t = useT();
  const router = useRouter();
  const canTakeOrders = usePermission("take_orders");
  const canOverridePrice = usePermission("override_price");

  const takeaway = target.kind === "takeaway";
  const tableId = target.kind === "table" ? target.tableId : "";
  const subtable = target.kind === "table" ? target.subtable : null;

  const { categories, items, variations, tables, loading, error } =
    useMenuData();
  const table = tables.find((x) => x.id === tableId);
  // Both hooks are always called — a conditional hook is not an option — but
  // each is inert for the target it does not own.
  useTicketTarget(tableId, takeaway ? undefined : table?.name, subtable);
  useTakeawayTicketTarget(
    target.kind === "takeaway" ? target.orderId : null,
    target.kind === "takeaway" ? target.name : "",
  );

  const backHref =
    target.kind === "takeaway"
      ? mRoutes.bill(target.orderId)
      : mRoutes.table(tableId);

  const { openOrder, loaded, refresh } = useOpenOrder();
  const { send, busy, covers, needsCovers } = useOrderActions({
    openOrder,
    openOrderLoaded: loaded,
    onOrderChanged: refresh,
  });

  const lines = useTicketStore((s) => s.lines);
  const addItem = useTicketStore((s) => s.addItem);
  const setLineModifiers = useTicketStore((s) => s.setLineModifiers);
  const setLinePrice = useTicketStore((s) => s.setLinePrice);
  const setDraftCovers = useTicketStore((s) => s.setDraftCovers);
  const setCopertoLine = useTicketStore((s) => s.setCopertoLine);

  const [ticketOpen, setTicketOpen] = useState(false);
  const [editLine, setEditLine] = useState<TicketLine | null>(null);
  const [coversOpen, setCoversOpen] = useState(false);

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
  const keyboardInset = useKeyboardInset();

  const pendingCount = lines.reduce((n, l) => n + l.quantity, 0);
  const pendingTotal = calcTotals(
    lines.map((l) => ({ unitPrice: lineUnitPrice(l), quantity: l.quantity })),
    openOrder?.order.tax_rate ?? undefined,
  ).total;

  // Key presence, not a non-empty list: a dish can allow variations and still
  // have no ingredients of its own (chips, a dessert) — it offers nothing to
  // remove but the whole pantry to add.
  const hasVariations = (menuItemId: string) => menuItemId in variations.byItem;
  // Same rule as the POS: the editor is offered when the user can change
  // something here — ingredients, notes, the price.
  const canEditLine = (menuItemId: string) =>
    hasVariations(menuItemId) ||
    variations.quickNotes.length > 0 ||
    canOverridePrice;

  if (!canTakeOrders) {
    return (
      <>
        <MHeader title={t("pos.noAccessTitle")} backHref={backHref} />
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">{t("pos.noAccessBody")}</p>
        </div>
      </>
    );
  }

  async function handleCovers(next: number) {
    // Before the first send there is no order to write to, so the answer waits
    // in the ticket store; afterwards the order owns it.
    if (openOrder) {
      try {
        await updateOrderCovers(openOrder.order.id, next);
        await refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : t("pos.coversUpdateFailed"),
        );
        return;
      }
    } else {
      setDraftCovers(next);
      // the answer becomes the order's first line, sent and printed with it
      const coperto = items.find((i) => i.is_coperto);
      if (coperto) setCopertoLine(coperto, next);
    }
    setCoversOpen(false);
  }

  const labelOf = makeMenuLabeller(categories);

  function handleAdd(item: MenuItemView) {
    // straight onto the ticket at base price; ingredients are added after, on
    // demand, from the line itself — same rule as the desktop till. The menu
    // label rides along so a pizza stays "1202" once it is on the ticket.
    const label = labelOf(item);
    addItem({ ...item, name: label.title, ingredients: label.ingredients });
  }

  async function handleSend() {
    const ok = await send();
    if (ok) {
      setTicketOpen(false);
      // back where the new round is now on the bill
      router.push(backHref);
    }
  }

  return (
    <>
      {/* The keyboard inset shrinks this column rather than scrolling it, which
          is what keeps the bottom search bar above an open keyboard. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
      >
        <MHeader
          title={
            target.kind === "takeaway"
              ? target.name
              : subtable
                ? `${table?.name ?? ""}/${subtable}`
                : (table?.name ?? "…")
          }
          backHref={backHref}
          action={
            takeaway ? (
              <PickupTimeControl
                orderId={openOrder?.order.id ?? null}
                pickupAt={openOrder?.order.pickup_at ?? null}
                onChanged={refresh}
                className="mr-2"
              />
            ) : (
              <CoversChip
                covers={covers}
                onClick={() => setCoversOpen(true)}
                className="mr-2"
              />
            )
          }
        />

        {takeaway && (
          <div className="px-3 pt-3">
            <TakeawayCapacityBanner
              openOrder={openOrder}
              onChanged={refresh}
            />
          </div>
        )}

        {error && (
          <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>
        )}
        {loading ? (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <MenuList
            categories={categories}
            items={results}
            counts={orderedCounts}
            query={query}
            variant="rows"
            onAdd={handleAdd}
            scrollToCategoryId={scrollToCategoryId}
            onScrolledToCategory={onScrolledToCategory}
          />
        )}

        {/* Persistent cart bar — always visible while browsing, so the waiter
            never loses track of what is about to be sent. The search bar below
            is the bottom-most thing on the screen, so it owns the safe area. */}
        {pendingCount > 0 && (
          <div className="shrink-0 border-t bg-card p-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTicketOpen(true)}
                className="flex min-h-14 flex-1 items-center justify-between gap-2 rounded-xl border px-4"
              >
                <span className="flex items-center gap-2 text-base font-medium">
                  <ReceiptText className="h-5 w-5" />
                  {t("m.itemsPending", { count: pendingCount })}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {formatMoney(pendingTotal)}
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSend()}
                className="min-h-14 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground disabled:opacity-50"
              >
                {t("m.sendRound")}
              </button>
            </div>
          </div>
        )}

        <MenuSearchBar
          query={query}
          onQueryChange={setQuery}
          resultCount={results.length}
          onBrowse={() => setJumpOpen(true)}
          className="pb-[env(safe-area-inset-bottom)]"
        />
      </div>

      <CategoryJump
        open={jumpOpen}
        onOpenChange={setJumpOpen}
        categories={categories}
        counts={categoryCounts}
        onPick={jumpTo}
        variant="sheet"
      />

      {ticketOpen && (
        <TicketLinesSheet
          onClose={() => setTicketOpen(false)}
          onEditModifiers={setEditLine}
          canEditLine={canEditLine}
          total={pendingTotal}
          busy={busy}
          onSend={() => void handleSend()}
        />
      )}

      {/* Asked on arrival for a check nobody has answered for yet, and on
          demand from the chip. Cancel goes back to the table rather than
          trapping the waiter here: you can always leave, you just cannot send
          a round without saying how many people are sitting down. */}
      {(coversOpen || needsCovers) && (
        <div className="fixed inset-0 z-50 flex flex-col justify-center bg-black/50 p-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <CoversPrompt
            initial={covers ?? table?.capacity ?? 2}
            busy={busy}
            onConfirm={(n) => void handleCovers(n)}
            onCancel={
              coversOpen
                ? () => setCoversOpen(false)
                : () => router.push(mRoutes.table(tableId))
            }
          />
        </div>
      )}

      {editLine && (
        <VariationScreen
          itemName={editLine.name}
          basePrice={editLine.unitPrice}
          dishIngredients={variations.byItem[editLine.menuItemId] ?? []}
          pantry={variations.pantry}
          variationsAllowed={hasVariations(editLine.menuItemId)}
          canEditPrice={canOverridePrice}
          initialModifiers={editLine.modifiers}
          quickNotes={variations.quickNotes}
          initialNotes={editLine.notes ?? []}
          onClose={() => setEditLine(null)}
          onConfirm={(mods, basePrice, notes) => {
            setLineModifiers(editLine.lineId, mods, notes);
            if (basePrice !== null) setLinePrice(editLine.lineId, basePrice);
          }}
        />
      )}
    </>
  );
}
