"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, Minus, Plus, Search, TriangleAlert } from "lucide-react";
import {
  fetchOpenDineInOrders,
  moveOrderItems,
  printTransferSlips,
  type MoveResult,
  type OpenOrder,
} from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import type { Order, RestaurantTable } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { orderItemLabel } from "@/lib/menu-display";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

export interface MoveDone {
  result: MoveResult;
  tableId: string;
  tableName: string;
  subtable: string | null;
  label: string;
}

const billLabel = (tableName: string, subtable: string | null) =>
  subtable ? `${tableName}/${subtable}` : tableName;

/**
 * "Cambio tavolo": pick the dishes (all by default) and the destination bill,
 * then move them in one DB transaction and fire the kitchen's notice.
 *
 * Shared by the desktop POS dialog and the phone's move screen; the container
 * decides the frame, this owns the rules. They mirror move_order_items so the
 * button explains itself instead of bouncing off a DB error:
 *   - paid lines and the coperto never move (hidden here);
 *   - a bill with partial payments only moves whole, onto a bill-less target;
 *   - unsent lines must go to the kitchen first.
 */
export function MoveBillForm({
  bill,
  tableName,
  tables,
  pendingCount,
  onDone,
  onCancel,
}: {
  bill: OpenOrder;
  tableName: string;
  tables: RestaurantTable[];
  /** Unsent lines on the source target — the move is blocked while any */
  pendingCount: number;
  onDone: (done: MoveDone) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { order, items, payments } = bill;
  const sourceLabel = billLabel(tableName, order.subtable);

  const isCoperto = (i: (typeof items)[number]) => i.menu_items?.is_coperto ?? false;
  const movable = items.filter((i) => !isCoperto(i) && i.paid_by_payment_id === null);
  const hasPaidLines = items.some((i) => !isCoperto(i) && i.paid_by_payment_id !== null);

  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(movable.map((i) => [i.id, i.quantity])),
  );
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [destTableId, setDestTableId] = useState<string | null>(null);
  // undefined = no bill picked yet; null = the whole-table bill
  const [destSub, setDestSub] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchOpenDineInOrders()
      .then(setOpenOrders)
      .catch(() => {
        // bill totals are a convenience; every table can still be picked
      });
  }, []);

  const selected = movable
    .map((i) => ({ id: i.id, quantity: qty[i.id] ?? 0 }))
    .filter((s) => s.quantity > 0);
  const selectedCount = selected.reduce((n, s) => n + s.quantity, 0);
  const whole =
    !hasPaidLines &&
    movable.length > 0 &&
    movable.every((i) => (qty[i.id] ?? 0) === i.quantity);

  const destTable = tables.find((tb) => tb.id === destTableId) ?? null;
  const destBills = openOrders.filter(
    (o) => o.table_id === destTableId && o.id !== order.id,
  );
  const destBill =
    destSub === undefined
      ? null
      : destBills.find((o) => (o.subtable ?? null) === destSub) ?? null;
  const isSource = (tableId: string, sub: string | null) =>
    tableId === order.table_id && sub === (order.subtable ?? null);

  const q = query.trim().toLowerCase();
  const candidates = useMemo(
    () => tables.filter((tb) => q === "" || tb.name.toLowerCase().includes(q)),
    [tables, q],
  );

  const blockPending = pendingCount > 0;
  const blockPayments =
    payments.length > 0 && destSub !== undefined && (!whole || destBill !== null);
  const destLabel =
    destTable && destSub !== undefined ? billLabel(destTable.name, destSub) : null;
  const canSubmit =
    !busy &&
    !blockPending &&
    !blockPayments &&
    selectedCount > 0 &&
    destTable !== null &&
    destSub !== undefined &&
    !isSource(destTable.id, destSub);

  function pickTable(id: string) {
    setDestTableId(id);
    setAddingNew(false);
    setNewName("");
    const bills = openOrders.filter((o) => o.table_id === id && o.id !== order.id);
    // a table with no bill (or just its whole-table one) needs no second tap
    if (bills.length === 0 && !isSource(id, null)) setDestSub(null);
    else if (bills.length === 1 && bills[0].subtable === null) setDestSub(null);
    else setDestSub(undefined);
  }

  async function submit() {
    if (!canSubmit || !destTable || destSub === undefined || !destLabel) return;
    setBusy(true);
    try {
      const result = await moveOrderItems(
        order.id,
        selected,
        destTable.id,
        destSub,
        userId,
      );
      if (result.movedItemIds.length > 0) {
        const [jobs] = await Promise.allSettled([
          printTransferSlips(
            result.orderId,
            result.movedItemIds,
            `TAVOLO ${sourceLabel}`,
          ),
        ]);
        if (jobs.status === "rejected") {
          toast.warning(
            jobs.reason instanceof Error ? jobs.reason.message : t("pos.printingFailed"),
          );
        } else {
          const failed = jobs.value.filter((j) => !j.ok);
          if (failed.length > 0) {
            toast.warning(
              t("pos.printerOffline", {
                printers: failed.map((f) => f.printerName).join(", "),
              }),
            );
          }
        }
      }
      toast.success(t("move.moved", { count: selectedCount, name: destLabel }));
      onDone({
        result,
        tableId: destTable.id,
        tableName: destTable.name,
        subtable: destSub,
        label: destLabel,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("move.failed"));
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean, disabled = false) =>
    cn(
      "flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "hover:bg-accent",
      disabled && "pointer-events-none opacity-40",
    );

  const tableBills = (id: string) =>
    openOrders.filter((o) => o.table_id === id && o.id !== order.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overflow-x-hidden p-1 md:grid-cols-2 md:overflow-y-hidden">
        {/* ---- dishes ---- */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">
              {t("move.items")}
            </h3>
            <div className="flex gap-1">
              <button
                type="button"
                className={chip(whole)}
                onClick={() =>
                  setQty(Object.fromEntries(movable.map((i) => [i.id, i.quantity])))
                }
              >
                {t("move.all")}
              </button>
              <button
                type="button"
                className={chip(selectedCount === 0)}
                onClick={() => setQty({})}
              >
                {t("move.none")}
              </button>
            </div>
          </div>
          {movable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("move.nothingToMove")}</p>
          ) : (
            <ul className="flex min-h-0 flex-col gap-1.5 md:overflow-y-auto md:pr-1">
              {movable.map((i) => {
                const label = orderItemLabel(i.menu_items, t("floor.itemFallback"));
                const n = qty[i.id] ?? 0;
                return (
                  <li
                    key={i.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2",
                      n > 0 ? "border-primary/60 bg-primary/5" : "opacity-70",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-col text-left"
                      onClick={() =>
                        setQty((s) => ({ ...s, [i.id]: n > 0 ? 0 : i.quantity }))
                      }
                    >
                      <span className="truncate font-medium">
                        {label.title}
                        {i.fraction_of ? ` (1/${i.fraction_of})` : ""}
                      </span>
                      {(i.order_item_modifiers ?? []).length > 0 && (
                        <span className="truncate text-xs text-muted-foreground">
                          {(i.order_item_modifiers ?? [])
                            .map((m) => `${m.is_removal ? "−" : "+"} ${m.name}`)
                            .join(", ")}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatMoney(i.unit_price)}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="-1"
                        disabled={n === 0}
                        className="flex h-11 w-11 items-center justify-center rounded-md border disabled:opacity-30"
                        onClick={() => setQty((s) => ({ ...s, [i.id]: n - 1 }))}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-12 text-center font-semibold tabular-nums">
                        {n}/{i.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="+1"
                        disabled={n >= i.quantity}
                        className="flex h-11 w-11 items-center justify-center rounded-md border disabled:opacity-30"
                        onClick={() => setQty((s) => ({ ...s, [i.id]: n + 1 }))}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t("move.paidHidden")}</p>
        </section>

        {/* ---- destination ---- */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase text-muted-foreground">
            {t("move.destination")}
          </h3>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("move.search")}
              className="h-11 w-full rounded-md border bg-background pl-9 pr-3 text-base"
            />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] content-start gap-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
            {candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("move.noResults")}</p>
            )}
            {candidates.map((tb) => {
              const bills = tableBills(tb.id);
              const onlySelf =
                tb.id === order.table_id && order.subtable === null && bills.length === 0;
              return (
                <button
                  key={tb.id}
                  type="button"
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center rounded-lg border px-2 py-1",
                    destTableId === tb.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                    onlySelf && "pointer-events-none opacity-40",
                  )}
                  onClick={() => pickTable(tb.id)}
                >
                  <span className="font-semibold">{tb.name}</span>
                  <span className="text-[11px] opacity-80">
                    {bills.length === 0
                      ? t("move.free")
                      : bills.length === 1
                        ? formatMoney(bills[0].total)
                        : t("move.openBills", { count: bills.length })}
                  </span>
                </button>
              );
            })}
          </div>

          {destTable && (
            <div className="flex flex-col gap-2 rounded-lg border p-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                {t("move.billOn")} {destTable.name}
              </span>
              <div className="flex flex-wrap gap-2">
                {[null, ...Array.from(new Set(destBills.map((o) => o.subtable).filter((s): s is string => s !== null)))].map(
                  (sub) => {
                    const b = destBills.find((o) => (o.subtable ?? null) === sub);
                    const self = isSource(destTable.id, sub);
                    return (
                      <button
                        key={sub ?? "__whole"}
                        type="button"
                        disabled={self}
                        className={chip(!addingNew && destSub === sub, self)}
                        onClick={() => {
                          setAddingNew(false);
                          setDestSub(sub);
                        }}
                      >
                        {sub === null ? t("move.wholeTable") : billLabel(destTable.name, sub)}
                        {b && (
                          <span className="tabular-nums opacity-80">
                            · {formatMoney(b.total)}
                          </span>
                        )}
                        {self && <span className="opacity-80">({t("move.current")})</span>}
                      </button>
                    );
                  },
                )}
                {addingNew ? (
                  <input
                    autoFocus
                    value={newName}
                    placeholder={t("move.newBillPlaceholder")}
                    className="h-11 w-36 rounded-md border bg-background px-3 text-base"
                    onChange={(e) => {
                      setNewName(e.target.value);
                      const name = e.target.value.trim();
                      setDestSub(name === "" ? undefined : name);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={chip(false)}
                    onClick={() => {
                      setAddingNew(true);
                      setDestSub(newName.trim() || undefined);
                    }}
                  >
                    <Plus className="h-4 w-4" /> {t("move.newBill")}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ---- notes + actions ---- */}
      <div className="mt-3 flex shrink-0 flex-col gap-2 border-t pt-3">
        {blockPending && (
          <Note>{t("move.pendingBlock")}</Note>
        )}
        {blockPayments && <Note>{t("move.paymentsBlock")}</Note>}
        {!blockPayments && destBill && selectedCount > 0 && (
          <p className="text-sm text-muted-foreground">{t("move.mergeNote")}</p>
        )}
        {selectedCount > 0 && (order.covers ?? 0) > 0 && (
          <p className="text-sm text-muted-foreground">
            {whole
              ? t("move.coversMove", { count: order.covers ?? 0 })
              : t("move.coversStay", { name: sourceLabel })}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex min-h-12 flex-1 items-center justify-center rounded-lg border text-base font-medium"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="flex min-h-12 flex-[2] items-center justify-center gap-2 rounded-lg bg-primary px-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            <ArrowRightLeft className="h-5 w-5 shrink-0" />
            <span className="truncate">
              {selectedCount === 0
                ? t("move.pickItems")
                : !destLabel
                  ? t("move.pickTarget")
                  : t("move.confirm", { count: selectedCount, name: destLabel })}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-2 text-sm">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <span>{children}</span>
    </p>
  );
}
