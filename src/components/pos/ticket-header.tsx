"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Plus,
  ShoppingBag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { CoversChip } from "@/components/order/covers-prompt";
import type { OpenOrder } from "@/lib/api";
import type { Order, RestaurantTable } from "@/lib/database.types";
import { useTicketStore } from "@/stores/ticket-store";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { TakeawayCaption } from "@/components/takeaway/takeaway-caption";
import { PickupTimeControl } from "@/components/takeaway/pickup-time-control";
import { SplitPicker, type SplitMenuState } from "./split-picker";
import { TablePicker } from "./table-picker";

/** Who the ticket is for: dine-in table (+ sub-bill) or take-away, plus the
 * table-level chips (covers, links, cambio tavolo). Reads and sets the target
 * through useTicketStore; everything that opens a dialog goes through a
 * callback, because the dialogs live in TicketPanel. */
export interface TicketHeaderProps {
  tables: RestaurantTable[];
  openOrder: OpenOrder | null;
  openSplits: Order[];
  openTakeaways: Order[];
  /** Guest count of the current target, null when not answered yet */
  covers: number | null;
  /** Labels of the tables linked to this one (empty when not linked) */
  linkNames: string[];
  busy: boolean;
  canTakeOrders: boolean;
  /** Saved customer-name labels for a new take-away */
  savedLabels: string[];
  onOpenCovers: () => void;
  onOpenLink: () => void;
  onOpenMove: () => void;
  onStartNewTakeaway: (name: string) => void;
  onAddToExistingTakeaway: (parent: Order) => void;
  onOrderChanged: () => Promise<void>;
}

/** One compact row: [target ▾] [sub-bill ▾] [covers] [🔗] … [⋯]. The target
 * button opens TablePicker (tables grid + take-away); rare table actions
 * live in the ⋯ menu. */
export function TicketHeader({
  tables,
  openOrder,
  openSplits,
  openTakeaways,
  covers,
  linkNames,
  busy,
  canTakeOrders,
  savedLabels,
  onOpenCovers,
  onOpenLink,
  onOpenMove,
  onStartNewTakeaway,
  onAddToExistingTakeaway,
  onOrderChanged,
}: TicketHeaderProps) {
  const t = useT();
  const {
    mode,
    tableId,
    tableName,
    subtable,
    takeawayOrderId,
    takeawayName,
    setTable,
    setSubtable,
    setTakeaway,
    clearTicket,
  } = useTicketStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [splitMenu, setSplitMenu] = useState<SplitMenuState>("closed");

  const isTable = mode === "table" && tableId !== null;
  const isTakeaway = mode === "takeaway" && takeawayName !== null;
  const hasTarget = isTable || isTakeaway;
  // The sub-bill chip only earns its place once the table is split (or the
  // ⋯ menu asked for a new split); otherwise it is just "Tutto il tavolo".
  const hasSplits =
    subtable !== null || openSplits.some((o) => o.subtable !== null);
  const deliveryNumber = openOrder?.order.delivery_number ?? null;

  const actions: ActionMenuItem[] = isTable
    ? [
        {
          key: "link",
          label: t("cassa.header.linkTables"),
          icon: <Link2 className="h-4 w-4" />,
          onSelect: onOpenLink,
        },
        ...(openOrder && canTakeOrders
          ? [
              {
                key: "move",
                label: t("cassa.header.moveTable"),
                icon: <ArrowRightLeft className="h-4 w-4" />,
                onSelect: onOpenMove,
                disabled: busy,
              },
            ]
          : []),
        {
          key: "split",
          label: t("cassa.header.newSplit"),
          icon: <Plus className="h-4 w-4" />,
          onSelect: () => setSplitMenu("add"),
        },
      ]
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      {/* Target: the way in to every table and take-away */}
      {!hasTarget ? (
        <Button
          type="button"
          className="h-11 flex-1 justify-between text-base"
          onClick={() => setPickerOpen(true)}
        >
          {mode === "takeaway"
            ? t("cassa.header.chooseTakeaway")
            : t("cassa.header.chooseTable")}
          <ChevronDown className="h-5 w-5" />
        </Button>
      ) : (
        <button
          type="button"
          aria-label={t("cassa.header.changeTargetAria")}
          onClick={() => setPickerOpen(true)}
          className={cn(
            "flex h-11 min-w-0 items-center gap-2 rounded-md border px-3 text-left hover:bg-accent",
            isTakeaway && "max-w-[16rem] flex-1 sm:flex-none",
          )}
        >
          {isTakeaway ? (
            <>
              <ShoppingBag className="h-5 w-5 shrink-0 text-muted-foreground" />
              {deliveryNumber != null && (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
                  #{deliveryNumber}
                </span>
              )}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold">
                  {takeawayName}
                </span>
                <TakeawayCaption
                  order={openOrder?.order ?? null}
                  bound={takeawayOrderId !== null}
                />
              </span>
            </>
          ) : (
            <span className="truncate text-lg font-semibold">
              {t("cassa.header.tableLabel", { name: tableName ?? "" })}
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      )}

      {isTable && (hasSplits || splitMenu !== "closed") && (
        <SplitPicker
          tableName={tableName ?? ""}
          openSplits={openSplits}
          subtable={subtable}
          onSelect={setSubtable}
          menu={splitMenu}
          onMenuChange={setSplitMenu}
        />
      )}

      {isTable && (
        <CoversChip covers={covers} onClick={onOpenCovers} className="h-11" />
      )}

      {isTable && linkNames.length > 0 && (
        <button
          type="button"
          onClick={onOpenLink}
          aria-label={`${t("links.badgeAria")}: ${linkNames.join(", ")}`}
          className="flex h-11 min-w-0 max-w-[10rem] items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 text-sm font-medium text-primary hover:bg-primary/20"
        >
          <Link2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{linkNames.join(", ")}</span>
        </button>
      )}

      {isTakeaway && (
        <>
          <PickupTimeControl
            orderId={openOrder?.order.id ?? null}
            pickupAt={openOrder?.order.pickup_at ?? null}
            onChanged={onOrderChanged}
            className="h-11"
          />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-11 w-11 shrink-0"
            aria-label={t("pos.clearTakeawayAria")}
            onClick={clearTicket}
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      )}

      {actions.length > 0 && (
        <div className="ml-auto">
          <ActionMenu
            trigger={<MoreHorizontal className="h-5 w-5" />}
            label={t("cassa.header.tableActions")}
            items={actions}
            side="bottom"
            align="end"
          />
        </div>
      )}

      <TablePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialTab={mode}
        tables={tables}
        currentTableId={mode === "table" ? tableId : null}
        // setTable / setTakeaway switch the mode themselves and stash the
        // outgoing target's pending lines as its draft
        onPickTable={(tb) => setTable(tb.id, tb.name)}
        openTakeaways={openTakeaways}
        savedLabels={savedLabels}
        onPickTakeaway={(o) => setTakeaway(o.id, o.customer_name ?? "")}
        onStartNewTakeaway={onStartNewTakeaway}
        onAddToExistingTakeaway={onAddToExistingTakeaway}
      />
    </div>
  );
}
