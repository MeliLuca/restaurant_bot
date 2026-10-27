"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Users } from "lucide-react";
import type { OpenOrder, OrderItemWithName, VariationData } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { orderItemLabel } from "@/lib/menu-display";
import {
  buildBillSections,
  planQuantityChange,
  type MergedRow,
} from "@/lib/pos/ticket-sections";
import { parseModifiers } from "@/lib/printing/route-order";
import { cn } from "@/lib/utils";
import {
  lineUnitPrice,
  useTicketStore,
  type TicketLine,
} from "@/stores/ticket-store";
import { useT } from "@/lib/i18n/use-translation";
import { TakeawayCapacityBanner } from "@/components/takeaway/capacity-banner";
import type { PriceEditLine, PriceEditTarget } from "./price-edit-dialog";
import { SelectionToolbar } from "./line-action-bar";

interface ModifierRow {
  key: string;
  name: string;
  priceAdjustment: number;
  isRemoval: boolean;
}

/** Ingredients caption, selected variations and note rapide under a line, in
 * full (wrapped, never truncated). Additions show their list price as detail
 * (the line price carries the diminishing-scaled surcharge); removals never
 * deduct, so they show no amount. Notes are instructions: italics, no sign.
 * Spans only, since the whole line is a button. */
function LineDetails({
  ingredients,
  modifiers,
  notes,
}: {
  ingredients?: string | null;
  modifiers: ModifierRow[];
  notes: string[];
}) {
  if (!ingredients && modifiers.length === 0 && notes.length === 0) {
    return null;
  }
  return (
    <span className="mt-0.5 block space-y-0.5 text-xs leading-snug text-muted-foreground">
      {ingredients && <span className="block">{ingredients}</span>}
      {modifiers.map((m) => (
        <span key={m.key} className="flex justify-between gap-2 pl-3">
          <span className="min-w-0 break-words">
            {m.isRemoval ? "− " : "+ "}
            {m.name}
          </span>
          {m.priceAdjustment > 0 && (
            <span className="shrink-0 tabular-nums">
              +{formatMoney(m.priceAdjustment)}
            </span>
          )}
        </span>
      ))}
      {notes.map((n) => (
        <span key={`note:${n}`} className="block pl-3 italic">
          {n}
        </span>
      ))}
    </span>
  );
}

/** One bill line: `4× 1204` and the price, details underneath. The whole row
 * is the tap target: it toggles the line in the selection the toolbar acts on. */
function BillRow({
  quantity,
  title,
  icon,
  badge,
  ingredients,
  modifiers,
  notes,
  price,
  selected,
  removing,
  onSelect,
}: {
  quantity: number;
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  ingredients?: string | null;
  modifiers: ModifierRow[];
  notes: string[];
  price: number;
  selected?: boolean;
  /** Waiting out the undo toast */
  removing?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onSelect}
      aria-pressed={onSelect ? !!selected : undefined}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
        onSelect && "hover:bg-muted/60",
        selected && "bg-primary/10 hover:bg-primary/15",
        removing && "text-muted-foreground/60 line-through",
      )}
    >
      {onSelect && (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40",
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      )}
      <span className="w-8 shrink-0 font-semibold tabular-nums">
        {quantity}×
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 font-medium">
          {icon}
          <span className="break-words">{title}</span>
          {badge}
        </span>
        <LineDetails
          ingredients={ingredients}
          modifiers={modifiers}
          notes={notes}
        />
      </span>
      <span className="shrink-0 text-right font-medium tabular-nums">
        {formatMoney(price)}
      </span>
    </button>
  );
}

/** A section header ("Da inviare", "Inviato 20:14"); tapping it selects all
 * of the section's lines at once. */
function GroupTitle({
  children,
  onToggle,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onToggle?: () => void;
  "aria-label"?: string;
}) {
  const cls =
    "mb-1 flex min-h-8 w-full items-center px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  if (!onToggle) return <h3 className={cls}>{children}</h3>;
  return (
    <h3>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onToggle}
        className={cn(cls, "rounded-md hover:bg-muted/60 hover:text-foreground")}
      >
        {children}
      </button>
    </h3>
  );
}

function sentModifierRows(i: OrderItemWithName): ModifierRow[] {
  return (i.order_item_modifiers ?? []).map((m) => ({
    key: m.id,
    name: m.name,
    priceAdjustment: m.price_adjustment,
    isRemoval: m.is_removal,
  }));
}


/** A sent-line change waiting out its undo toast before it is written. */
interface PendingChange {
  /** The merged row it applies to */
  key: string;
  target: number;
  state: "waiting" | "writing" | "cancelled";
  write: () => Promise<void>;
  batch: UndoBatch;
}

/** The changes of one toolbar tap: one toast, one "Annulla" for all of them. */
interface UndoBatch {
  toastId: string;
  changes: PendingChange[];
}

const UNDO_MS = 5000;

type SentRow = MergedRow<OrderItemWithName>;

/** A selected line, whichever section it sits in. */
type Picked =
  | { kind: "pending"; key: string; line: TicketLine }
  | { kind: "sent"; key: string; row: SentRow; name: string; qty: number };

/** The bill itself: an always-visible toolbar acting on the selected lines,
 * then the lines still to send (from useTicketStore), the sent ones grouped by
 * send, and the paid ones folded away. Every change goes through a callback or
 * the store; the dialogs it opens live in TicketPanel. */
export interface TicketLinesProps {
  openOrder: OpenOrder | null;
  /** A table or take-away is selected */
  hasTarget: boolean;
  variations: VariationData;
  canOverridePrice: boolean;
  busy: boolean;
  /** Covers already settled by split payments (the coperto row shows the rest) */
  paidCovers: number;
  /** Set the guest count (the coperto row's quantity goes through this) */
  onSetCovers: (next: number) => void | Promise<void>;
  /** Change a sent line's quantity; 0 removes it */
  onAmendSent: (orderItemId: string, quantity: number) => void | Promise<void>;
  /** Open the price editor on one or more lines */
  onEditPrice: (target: PriceEditTarget) => void;
  /** Open the ingredients / notes / price editor of a pending line */
  onEditLine: (line: TicketLine) => void;
  /** Open the cambio tavolo dialog, starting with these order_items */
  onOpenMove: (orderItemIds?: string[]) => void;
  onOrderChanged: () => Promise<void>;
}

export function TicketLines({
  openOrder,
  hasTarget,
  variations,
  canOverridePrice,
  busy,
  paidCovers,
  onSetCovers,
  onAmendSent,
  onEditPrice,
  onEditLine,
  onOpenMove,
  onOrderChanged,
}: TicketLinesProps) {
  const t = useT();
  const { mode, lines, setQuantity, removeItem } = useTicketStore();
  const hasNotes = variations.quickNotes.length > 0;
  const fallbackName = t("floor.itemFallback");

  const sections = useMemo(
    () => buildBillSections(openOrder?.items ?? []),
    [openOrder?.items],
  );

  /** Same label rule as the menu: a pizza tapped as "1202" reads as 1202
   * here too, with its toppings underneath. */
  function sentLabel(row: SentRow) {
    const i = row.rows[0];
    const label = orderItemLabel(i.menu_items, fallbackName, i.custom_name);
    return {
      ...label,
      name: label.title + (i.fraction_of ? ` (1/${i.fraction_of})` : ""),
    };
  }

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [paidOpen, setPaidOpen] = useState(false);
  const toggle = (key: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /** A section header selects all of its lines, or clears them if all are in */
  const toggleGroup = (keys: string[]) =>
    setSelected((cur) => {
      const next = new Set(cur);
      const all = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // ---- sent-line changes with undo -------------------------------------
  // Removing or lowering sent lines is held for UNDO_MS behind one "Annulla"
  // toast per tap; the rows show their target meanwhile. Writes use the
  // callbacks of the render that scheduled them, which are bound to that order.
  const [pending, setPending] = useState<Record<string, number>>({});
  const changesRef = useRef(new Map<string, PendingChange>());

  const forget = useCallback((change: PendingChange) => {
    if (changesRef.current.get(change.key) !== change) return;
    changesRef.current.delete(change.key);
    setPending((p) => {
      const next = { ...p };
      delete next[change.key];
      return next;
    });
  }, []);

  /** Write what is still waiting in a batch, one row after another. */
  const commitBatch = useCallback(
    (batch: UndoBatch) => {
      const due = batch.changes.filter((c) => c.state === "waiting");
      for (const c of due) c.state = "writing";
      void (async () => {
        for (const c of due) {
          try {
            await c.write();
          } finally {
            forget(c);
          }
        }
      })();
    },
    [forget],
  );

  /** Commit every change still waiting: on unmount and when the order on
   * screen changes, so nothing is lost or applied to the wrong bill. */
  const flushAll = useCallback(() => {
    const batches = new Set<UndoBatch>();
    for (const c of Array.from(changesRef.current.values())) {
      if (c.state === "waiting") batches.add(c.batch);
    }
    for (const b of Array.from(batches)) {
      commitBatch(b);
      toast.dismiss(b.toastId);
    }
  }, [commitBatch]);
  const orderId = openOrder?.order.id ?? null;
  useEffect(() => () => flushAll(), [orderId, flushAll]);

  function changeSent(entries: { row: SentRow; target: number; name: string }[]) {
    const amend = onAmendSent;
    const setCovers = onSetCovers;
    const coversPaid = paidCovers;
    const batch: UndoBatch = { toastId: `undo:${Date.now()}`, changes: [] };
    const immediate: Array<() => Promise<void>> = [];

    for (const { row, target } of entries) {
      // a newer tap on a row replaces its change still waiting
      const prior = changesRef.current.get(row.key);
      if (prior?.state === "waiting") {
        prior.state = "cancelled";
        forget(prior);
        if (!prior.batch.changes.some((c) => c.state === "waiting")) {
          toast.dismiss(prior.batch.toastId);
        }
      }
      const clamped = Math.max(0, target);
      const write = async () => {
        if (row.isCoperto) {
          await setCovers(coversPaid + clamped);
          return;
        }
        for (const w of planQuantityChange(row.rows, clamped)) {
          await amend(w.id, w.quantity);
        }
      };
      // back to what the DB has: nothing to do; more: no undo needed
      if (clamped >= row.quantity) {
        if (clamped > row.quantity) immediate.push(write);
        continue;
      }
      const change: PendingChange = {
        key: row.key,
        target: clamped,
        state: "waiting",
        write,
        batch,
      };
      batch.changes.push(change);
      changesRef.current.set(row.key, change);
    }

    if (immediate.length > 0) {
      void (async () => {
        for (const w of immediate) await w();
      })();
    }
    if (batch.changes.length === 0) return;

    setPending((p) => {
      const next = { ...p };
      for (const c of batch.changes) next[c.key] = c.target;
      return next;
    });
    // rows on their way out leave the selection
    const gone = batch.changes.filter((c) => c.target === 0).map((c) => `s:${c.key}`);
    if (gone.length > 0) {
      setSelected((cur) => {
        const next = new Set(cur);
        for (const k of gone) next.delete(k);
        return next;
      });
    }

    const first = batch.changes[0];
    const firstEntry = entries.find((e) => e.row.key === first.key)!;
    const count = batch.changes.length;
    const message =
      count === 1
        ? first.target === 0
          ? t("cassa.lines.removedToast", { name: firstEntry.name })
          : t("cassa.lines.quantityToast", {
              name: firstEntry.name,
              from: firstEntry.row.quantity,
              to: first.target,
            })
        : batch.changes.every((c) => c.target === 0)
          ? t("cassa.lines.removedManyToast", { count })
          : t("cassa.lines.changedManyToast", { count });

    toast(message, {
      id: batch.toastId,
      duration: UNDO_MS,
      action: {
        label: t("cassa.lines.undo"),
        onClick: () => {
          for (const c of batch.changes) {
            if (c.state !== "waiting") continue;
            c.state = "cancelled";
            forget(c);
          }
        },
      },
      onAutoClose: () => commitBatch(batch),
      onDismiss: () => commitBatch(batch),
    });
  }

  // ---- selection --------------------------------------------------------
  const selectable = new Set<string>();
  for (const l of lines) selectable.add(`p:${l.lineId}`);
  for (const r of sections.rounds) {
    for (const row of r.rows) {
      if (pending[row.key] !== 0) selectable.add(`s:${row.key}`);
    }
  }
  const selectableKey = Array.from(selectable).sort().join(",");
  useEffect(() => {
    // selected lines that went away (sent, removed, paid, other table)
    const still = new Set(selectableKey.split(","));
    setSelected((cur) => {
      const kept = Array.from(cur).filter((k) => still.has(k));
      return kept.length === cur.size ? cur : new Set(kept);
    });
  }, [selectableKey]);

  // the selection in screen order, with what each action needs
  const picked: Picked[] = [];
  for (const l of lines) {
    const key = `p:${l.lineId}`;
    if (selected.has(key)) picked.push({ kind: "pending", key, line: l });
  }
  for (const r of sections.rounds) {
    for (const row of r.rows) {
      const key = `s:${row.key}`;
      if (!selected.has(key) || pending[row.key] === 0) continue;
      picked.push({
        kind: "sent",
        key,
        row,
        name: sentLabel(row).name,
        qty: pending[row.key] ?? row.quantity,
      });
    }
  }

  function step(delta: 1 | -1) {
    const sent: { row: SentRow; target: number; name: string }[] = [];
    for (const p of picked) {
      if (p.kind === "pending") setQuantity(p.line.lineId, p.line.quantity + delta);
      else sent.push({ row: p.row, target: p.qty + delta, name: p.name });
    }
    if (sent.length > 0) changeSent(sent);
  }

  function removeSelected() {
    const sent: { row: SentRow; target: number; name: string }[] = [];
    for (const p of picked) {
      if (p.kind === "pending") removeItem(p.line.lineId);
      else sent.push({ row: p.row, target: 0, name: p.name });
    }
    if (sent.length > 0) changeSent(sent);
  }

  // Price: every selected line but the coperto (its price is the menu's).
  // A merged sent row re-prices each of its DB rows; a line waiting on its
  // undo is left alone until it is written. Pending lines carry their BASE
  // price (the variations add on top), like the line editor.
  const priceable = picked.filter((p) => p.kind === "pending" || !p.row.isCoperto);
  const priceBlocked = picked.some(
    (p) => p.kind === "sent" && pending[p.row.key] !== undefined,
  );
  function openPrice() {
    const target: PriceEditTarget = {
      name:
        priceable.length === 1
          ? priceable[0].kind === "pending"
            ? priceable[0].line.name
            : priceable[0].name
          : t("cassa.lines.rowsCount", { count: priceable.length }),
      lines: priceable.flatMap((p): PriceEditLine[] =>
        p.kind === "pending"
          ? [{ kind: "pending" as const, id: p.line.lineId, unitPrice: p.line.unitPrice }]
          : p.row.rows.map((i) => ({
              kind: "sent" as const,
              id: i.id,
              unitPrice: i.unit_price,
            })),
      ),
    };
    onEditPrice(target);
  }

  // Variations re-compose one unsent dish (the kitchen has the sent ones)
  const onlyPending =
    picked.length === 1 && picked[0].kind === "pending" ? picked[0].line : null;
  const canEditOnly =
    onlyPending !== null &&
    (onlyPending.menuItemId in variations.byItem || hasNotes || canOverridePrice);

  // Move: the sent, non-coperto lines picked (unsent ones must go first)
  const moveIds = picked.flatMap((p) =>
    p.kind === "sent" && !p.row.isCoperto ? p.row.rows.map((i) => i.id) : [],
  );

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [],
  );

  const hasSent = sections.rounds.length > 0;
  const emptyHint = hasTarget && lines.length === 0 && (
    <p className="py-4 text-center text-sm text-muted-foreground">
      {openOrder ? t("pos.tapAnotherRound") : t("pos.tapToBuild")}
    </p>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {hasTarget && (
        <SelectionToolbar
          count={picked.length}
          busy={busy}
          onClear={clearSelection}
          onDecrease={() => step(-1)}
          onIncrease={() => step(1)}
          onEditLine={
            canEditOnly && onlyPending ? () => onEditLine(onlyPending) : undefined
          }
          editLineHint={t("cassa.lines.variationsOnlyOne")}
          onEditPrice={
            canOverridePrice && priceable.length > 0 && !priceBlocked
              ? openPrice
              : undefined
          }
          onMove={
            mode === "table" && moveIds.length > 0
              ? () => onOpenMove(moveIds)
              : undefined
          }
          onRemove={removeSelected}
        />
      )}

      <TakeawayCapacityBanner openOrder={openOrder} onChanged={onOrderChanged} />

      {!hasTarget && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {mode === "table"
            ? t("pos.pickTableToStart")
            : t("pos.findOpenTakeaway")}
        </p>
      )}

      {/* Da inviare: always on top, so a tapped dish is seen landing */}
      {lines.length > 0 && (
        <section className="mb-4 rounded-lg bg-primary/5 py-2">
          <GroupTitle
            onToggle={() => toggleGroup(lines.map((l) => `p:${l.lineId}`))}
          >
            {t("cassa.lines.toSend", { count: lines.length })}
          </GroupTitle>
          <div className="flex flex-col">
            {lines.map((l) => {
              const key = `p:${l.lineId}`;
              return (
                <BillRow
                  key={l.lineId}
                  quantity={l.quantity}
                  title={l.name}
                  ingredients={l.ingredients}
                  modifiers={l.modifiers.map((m) => ({
                    key: `${m.ingredientId}:${m.isRemoval}`,
                    name: m.name,
                    priceAdjustment: m.priceAdjustment,
                    isRemoval: m.isRemoval,
                  }))}
                  notes={l.notes ?? []}
                  price={lineUnitPrice(l) * l.quantity}
                  badge={
                    l.priceOverridden && (
                      <span className="text-xs font-medium text-amber-600">
                        {t("pos.adjusted")}
                      </span>
                    )
                  }
                  selected={selected.has(key)}
                  onSelect={() => toggle(key)}
                />
              );
            })}
          </div>
        </section>
      )}

      {!hasSent && emptyHint}

      {/* Giri inviati, oldest first */}
      {sections.rounds.map((round) => {
        const time = timeFormat.format(new Date(round.sentAt));
        const roundKeys = round.rows
          .filter((row) => pending[row.key] !== 0)
          .map((row) => `s:${row.key}`);
        return (
          <section key={round.key} className="mb-3">
            <GroupTitle
              aria-label={t("cassa.lines.selectRound", { time })}
              onToggle={
                roundKeys.length > 0 ? () => toggleGroup(roundKeys) : undefined
              }
            >
              {t("cassa.lines.sentAt", { time })}
            </GroupTitle>
            <div className="flex flex-col">
              {round.rows.map((row) => {
                const i = row.rows[0];
                const label = sentLabel(row);
                const shownQty = pending[row.key] ?? row.quantity;
                const removing = pending[row.key] === 0;
                const key = `s:${row.key}`;
                return (
                  <BillRow
                    key={row.key}
                    quantity={removing ? row.quantity : shownQty}
                    title={label.name}
                    icon={row.isCoperto && <Users className="h-3.5 w-3.5 shrink-0" />}
                    badge={
                      removing && (
                        <span className="inline-block text-xs font-medium">
                          {t("cassa.lines.removing")}
                        </span>
                      )
                    }
                    ingredients={label.ingredients}
                    modifiers={sentModifierRows(i)}
                    notes={parseModifiers(i.notes)}
                    price={i.unit_price * (removing ? row.quantity : shownQty)}
                    selected={selected.has(key) && !removing}
                    removing={removing}
                    onSelect={removing ? undefined : () => toggle(key)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {hasSent && emptyHint}

      {/* Pagati: settled by split payments, immutable, folded away */}
      {sections.paid.length > 0 && (
        <section className="mt-2">
          <button
            type="button"
            aria-expanded={paidOpen}
            onClick={() => setPaidOpen((o) => !o)}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="flex-1">
              {sections.paid.length === 1
                ? t("cassa.lines.paidSummaryOne", {
                    amount: formatMoney(sections.paidTotal),
                  })
                : t("cassa.lines.paidSummary", {
                    count: sections.paid.length,
                    amount: formatMoney(sections.paidTotal),
                  })}
            </span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", paidOpen && "rotate-180")}
            />
          </button>
          {paidOpen && (
            <div className="flex flex-col text-muted-foreground/60 line-through">
              {sections.paid.map((i) => {
                const label = orderItemLabel(i.menu_items, fallbackName, i.custom_name);
                return (
                  <BillRow
                    key={i.id}
                    quantity={i.quantity}
                    title={
                      label.title + (i.fraction_of ? ` (1/${i.fraction_of})` : "")
                    }
                    ingredients={label.ingredients}
                    modifiers={sentModifierRows(i)}
                    notes={parseModifiers(i.notes)}
                    price={i.unit_price * i.quantity}
                  />
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
