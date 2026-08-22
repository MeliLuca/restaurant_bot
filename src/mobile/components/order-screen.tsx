"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText, TriangleAlert } from "lucide-react";
import { useMenuData } from "@/hooks/use-menu-data";
import { useOpenOrder } from "@/hooks/use-open-order";
import { useOrderActions } from "@/hooks/use-order-actions";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { calcTotals } from "@/lib/money";
import type { MenuItem } from "@/lib/database.types";
import { usePermission } from "@/stores/auth-store";
import {
  lineUnitPrice,
  useTicketStore,
  type TicketLine,
} from "@/stores/ticket-store";
import { mRoutes } from "@/mobile/lib/routes";
import { useTicketTarget } from "@/mobile/hooks/use-ticket-target";
import { MHeader } from "./m-header";
import { MenuBrowser } from "./menu-browser";
import { ModifierScreen } from "./modifier-screen";
import { TicketLinesSheet } from "./ticket-lines";

/**
 * Order taking for one (table, subtable). The flow underneath — send, and the
 * price snapshot it writes — is the shared useOrderActions, so a round sent
 * from here is identical to one sent from the desktop till.
 */
export function OrderScreen({
  tableId,
  subtable,
}: {
  tableId: string;
  subtable: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const canTakeOrders = usePermission("take_orders");

  const { categories, items, modifierGroups, tables, loading, error } =
    useMenuData();
  const table = tables.find((x) => x.id === tableId);
  useTicketTarget(tableId, table?.name, subtable);

  const { openOrder, refresh } = useOpenOrder();
  const { send, busy } = useOrderActions({
    openOrder,
    onOrderChanged: refresh,
  });

  const lines = useTicketStore((s) => s.lines);
  const addItem = useTicketStore((s) => s.addItem);
  const setLineModifiers = useTicketStore((s) => s.setLineModifiers);

  const [ticketOpen, setTicketOpen] = useState(false);
  const [editLine, setEditLine] = useState<TicketLine | null>(null);

  const pendingCount = lines.reduce((n, l) => n + l.quantity, 0);
  const pendingTotal = calcTotals(
    lines.map((l) => ({ unitPrice: lineUnitPrice(l), quantity: l.quantity })),
    openOrder?.order.tax_rate ?? undefined,
  ).total;

  const hasModifiers = (menuItemId: string) =>
    (modifierGroups[menuItemId] ?? []).length > 0;

  if (!canTakeOrders) {
    return (
      <>
        <MHeader title={t("pos.noAccessTitle")} backHref={mRoutes.table(tableId)} />
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">{t("pos.noAccessBody")}</p>
        </div>
      </>
    );
  }

  function handleAdd(item: MenuItem) {
    // straight onto the ticket at base price; ingredients are added after, on
    // demand, from the line itself — same rule as the desktop till
    addItem(item);
  }

  async function handleSend() {
    const ok = await send();
    if (ok) {
      setTicketOpen(false);
      // back to the table, where the new round is now on the bill
      router.push(mRoutes.table(tableId));
    }
  }

  return (
    <>
      <MHeader
        title={subtable ? `${table?.name ?? ""}/${subtable}` : (table?.name ?? "…")}
        backHref={mRoutes.table(tableId)}
      />

      {error && (
        <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>
      )}
      {loading ? (
        <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <MenuBrowser categories={categories} items={items} onAdd={handleAdd} />
      )}

      {/* Persistent cart bar — always visible while browsing, so the waiter
          never loses track of what is about to be sent. */}
      {pendingCount > 0 && (
        <div className="shrink-0 border-t bg-card p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
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

      {ticketOpen && (
        <TicketLinesSheet
          onClose={() => setTicketOpen(false)}
          onEditModifiers={setEditLine}
          hasModifiers={hasModifiers}
          total={pendingTotal}
          busy={busy}
          onSend={() => void handleSend()}
        />
      )}

      {editLine && (
        <ModifierScreen
          itemName={editLine.name}
          basePrice={editLine.unitPrice}
          groups={modifierGroups[editLine.menuItemId] ?? []}
          initialModifiers={editLine.modifiers}
          onClose={() => setEditLine(null)}
          onConfirm={(mods) => setLineModifiers(editLine.lineId, mods)}
        />
      )}
    </>
  );
}
