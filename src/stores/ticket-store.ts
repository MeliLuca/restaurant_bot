import { create } from "zustand";
import { calcTotals, unitPriceWithModifiers } from "@/lib/money";
import type { MenuItem } from "@/lib/database.types";

/** One variation on a cart line — name/price snapshotted from the pantry */
export interface SelectedModifier {
  ingredientId: string;
  name: string;
  /** List price as an addition; always 0 on a removal, which never deducts */
  priceAdjustment: number;
  isRemoval: boolean;
  /** Removals only: the ingredient's listino price, which offsets an added
   * ingredient (swap). Pricing-only, never written to the DB. */
  creditPrice?: number;
}

export interface TicketLine {
  /** Ticket-local identity: the same item with different modifiers makes
   * separate lines, so menuItemId alone can't address one */
  lineId: string;
  menuItemId: string;
  /** What the menu called it when it was tapped: the dish name, or the codice
   * for the categories the listino numbers instead of naming (pizze,
   * bruschette). Display only — nothing written to the DB reads it, so the
   * kitchen slip and the receipt still print the full name from menu_items. */
  name: string;
  /** Ingredient caption shown under `name`; set only where the name alone
   * would not identify the dish, i.e. when `name` is a bare codice */
  ingredients?: string | null;
  /** Base menu price; the charged price adds the modifier adjustments */
  unitPrice: number;
  quantity: number;
  modifiers: SelectedModifier[];
  /** Note rapide for the kitchen ("Ben cotta", "Prima"); free, printed under
   * the line. Absent and [] both mean none. */
  notes?: string[];
  /** Price manually overridden for this ticket only (never the menu) */
  priceOverridden?: boolean;
}

/** Price charged per unit of a line: base price + modifier adjustments */
export function lineUnitPrice(line: TicketLine): number {
  return unitPriceWithModifiers(line.unitPrice, line.modifiers);
}

let lineSeq = 0;
const nextLineId = () => `line-${Date.now()}-${++lineSeq}`;

/** Two selections are mergeable when they picked exactly the same variations.
 * The direction is part of the key: added and removed are disjoint by
 * construction, but merging "no mozzarella" into "extra mozzarella" because
 * they name the same ingredient would be a silent, expensive mistake. */
function sameModifiers(a: SelectedModifier[], b: SelectedModifier[]): boolean {
  if (a.length !== b.length) return false;
  const key = (m: SelectedModifier) => `${m.ingredientId}:${m.isRemoval}`;
  const sortedB = [...b].map(key).sort();
  return [...a]
    .map(key)
    .sort()
    .every((k, i) => k === sortedB[i]);
}

export { calcTotals };
export type { TicketTotals } from "@/lib/money";

export type TicketMode = "table" | "takeaway";

interface TicketState {
  mode: TicketMode;
  /** Table the ticket belongs to (table mode); null = no table selected yet */
  tableId: string | null;
  tableName: string | null;
  /** Split label within the table (e.g. "1", "Gino"); null = whole table */
  subtable: string | null;
  /** Open take-away order being amended; null = new take-away not yet sent */
  takeawayOrderId: string | null;
  takeawayName: string | null;
  lines: TicketLine[];
  /** Unsent lines stashed per target (draftKey) — switching away from a
   * table/split/take-away preserves its pending items; switching back
   * restores them instantly. */
  drafts: Record<string, TicketLine[]>;
  /** Guest count answered for a check that does not exist in the database
   * yet, stashed per target like the lines are. A dine-in order is created
   * lazily on the first send, so the number has to live somewhere until then. */
  draftCovers: Record<string, number>;

  /** Switch dine-in / take-away; the in-progress ticket is stashed as a draft */
  setMode: (mode: TicketMode) => void;
  /** Select a table; the previous target's pending lines become its draft */
  setTable: (tableId: string, tableName: string) => void;
  /** Switch split within the current table; pending lines are stashed per split */
  setSubtable: (subtable: string | null) => void;
  /** Target a take-away: an existing open order, or a new customer name */
  setTakeaway: (orderId: string | null, name: string) => void;
  /** A fresh tap never carries notes, so it only merges into a line that
   * has none — "ben cotta" must not quietly apply to the next pizza too. */
  addItem: (
    item: Pick<MenuItem, "id" | "name" | "price"> & {
      ingredients?: string | null;
    },
    modifiers?: SelectedModifier[],
  ) => void;
  /** The covers prompt's answer, as a ticket line: the pending coperto line
   * becomes `quantity` — added at the top so it reads (and prints) first,
   * removed at 0. Only the plain line is touched, never one carrying notes. */
  setCopertoLine: (
    item: Pick<MenuItem, "id" | "name" | "price">,
    quantity: number,
  ) => void;
  removeItem: (lineId: string) => void;
  /** Quantities below 1 remove the line */
  setQuantity: (lineId: string, quantity: number) => void;
  /** Override a pending line's BASE price for this ticket only */
  setLinePrice: (lineId: string, unitPrice: number) => void;
  /** Replace a pending line's ingredients (add/remove after it's on the
   * ticket) and its notes; the charged price re-derives from the new
   * modifier set */
  setLineModifiers: (
    lineId: string,
    modifiers: SelectedModifier[],
    notes: string[],
  ) => void;
  /** Record how many guests the current target is for, before its order
   * exists. Once it does, orders.covers is the truth and this is dropped. */
  setDraftCovers: (covers: number) => void;
  /** Drop pending lines AND their draft (after Send to Kitchen). The draft
   * guest count survives: until the new order has been re-fetched it is the
   * only answer on record, and dropping it here re-opened the covers prompt
   * the moment the first round went out. */
  clearLines: () => void;
  /** Forget the current target's draft guest count, once its order exists
   * and owns the number (orders.covers) */
  dropDraftCovers: () => void;
  clearTicket: () => void;
}

const EMPTY_TARGET = {
  tableId: null,
  tableName: null,
  subtable: null,
  takeawayOrderId: null,
  takeawayName: null,
  lines: [] as TicketLine[],
};

type TargetFields = Pick<
  TicketState,
  "mode" | "tableId" | "subtable" | "takeawayOrderId" | "takeawayName"
>;

/** Stable identity of the current ticket target; null = nothing selected */
function draftKey(s: TargetFields): string | null {
  if (s.mode === "table") {
    return s.tableId ? `t:${s.tableId}:${s.subtable ?? ""}` : null;
  }
  if (s.takeawayOrderId) return `ta:${s.takeawayOrderId}`;
  return s.takeawayName ? `ta-new:${s.takeawayName}` : null;
}

/** Stash the outgoing target's pending lines, then restore the draft (if
 * any) of the target described by `patch`. */
function stashAndRestore(
  state: TicketState,
  patch: Partial<TicketState>,
): Partial<TicketState> {
  const drafts = { ...state.drafts };
  const prevKey = draftKey(state);
  if (prevKey) {
    if (state.lines.length > 0) drafts[prevKey] = state.lines;
    else delete drafts[prevKey];
  }
  const nextKey = draftKey({ ...state, ...patch });
  return {
    ...patch,
    drafts,
    lines: nextKey ? (drafts[nextKey] ?? []) : [],
  };
}

export const useTicketStore = create<TicketState>((set) => ({
  mode: "table",
  ...EMPTY_TARGET,
  drafts: {},
  draftCovers: {},

  setMode: (mode) =>
    set((state) =>
      state.mode === mode
        ? {}
        : stashAndRestore(state, { mode, ...EMPTY_TARGET }),
    ),

  setTable: (tableId, tableName) =>
    set((state) =>
      state.mode === "table" && state.tableId === tableId
        ? { tableName }
        : stashAndRestore(state, {
            mode: "table",
            ...EMPTY_TARGET,
            tableId,
            tableName,
          }),
    ),

  setSubtable: (subtable) =>
    set((state) =>
      state.subtable === subtable ? {} : stashAndRestore(state, { subtable }),
    ),

  setTakeaway: (orderId, name) =>
    set((state) => {
      if (
        state.mode === "takeaway" &&
        state.takeawayOrderId === orderId &&
        state.takeawayName === name
      ) {
        return {};
      }
      // First send promotes a new-customer ticket to its created order:
      // same target, keep the lines and retire the "new" draft key.
      if (
        state.mode === "takeaway" &&
        state.takeawayOrderId === null &&
        orderId !== null &&
        state.takeawayName === name
      ) {
        const drafts = { ...state.drafts };
        delete drafts[`ta-new:${name}`];
        return { takeawayOrderId: orderId, drafts };
      }
      return stashAndRestore(state, {
        mode: "takeaway",
        ...EMPTY_TARGET,
        takeawayOrderId: orderId,
        takeawayName: name,
      });
    }),

  addItem: (item, modifiers = []) =>
    set((state) => {
      const existing = state.lines.find(
        (l) =>
          l.menuItemId === item.id &&
          !l.notes?.length &&
          sameModifiers(l.modifiers, modifiers),
      );
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.lineId === existing.lineId
              ? { ...l, quantity: l.quantity + 1 }
              : l,
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          {
            lineId: nextLineId(),
            menuItemId: item.id,
            name: item.name,
            ingredients: item.ingredients ?? null,
            unitPrice: item.price,
            quantity: 1,
            modifiers,
          },
        ],
      };
    }),

  setCopertoLine: (item, quantity) =>
    set((state) => {
      const existing = state.lines.find(
        (l) =>
          l.menuItemId === item.id &&
          l.modifiers.length === 0 &&
          !l.notes?.length,
      );
      if (quantity <= 0) {
        return existing
          ? { lines: state.lines.filter((l) => l.lineId !== existing.lineId) }
          : {};
      }
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.lineId === existing.lineId ? { ...l, quantity } : l,
          ),
        };
      }
      return {
        lines: [
          {
            lineId: nextLineId(),
            menuItemId: item.id,
            name: item.name,
            ingredients: null,
            unitPrice: item.price,
            quantity,
            modifiers: [],
          },
          ...state.lines,
        ],
      };
    }),

  removeItem: (lineId) =>
    set((state) => ({
      lines: state.lines.filter((l) => l.lineId !== lineId),
    })),

  setQuantity: (lineId, quantity) =>
    set((state) => ({
      lines:
        quantity < 1
          ? state.lines.filter((l) => l.lineId !== lineId)
          : state.lines.map((l) =>
              l.lineId === lineId ? { ...l, quantity } : l,
            ),
    })),

  setLinePrice: (lineId, unitPrice) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.lineId === lineId ? { ...l, unitPrice, priceOverridden: true } : l,
      ),
    })),

  setLineModifiers: (lineId, modifiers, notes) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.lineId === lineId ? { ...l, modifiers, notes } : l,
      ),
    })),

  setDraftCovers: (covers) =>
    set((state) => {
      const key = draftKey(state);
      if (!key) return {};
      return { draftCovers: { ...state.draftCovers, [key]: covers } };
    }),

  clearLines: () =>
    set((state) => {
      const drafts = { ...state.drafts };
      const key = draftKey(state);
      if (key) delete drafts[key];
      return { lines: [], drafts };
    }),

  dropDraftCovers: () =>
    set((state) => {
      const key = draftKey(state);
      if (!key || !(key in state.draftCovers)) return {};
      // the order now exists and owns its covers; a stale draft here would
      // shadow a number the waiter has since corrected on the bill
      const draftCovers = { ...state.draftCovers };
      delete draftCovers[key];
      return { draftCovers };
    }),

  clearTicket: () =>
    set((state) => stashAndRestore(state, { ...EMPTY_TARGET })),
}));

/**
 * Guest count answered for the current target but not yet persisted, or null
 * when nobody has been asked. Exported as a hook because draftKey is internal:
 * callers should never have to rebuild the target's identity themselves.
 */
export function useDraftCovers(): number | null {
  return useTicketStore((s) => {
    const key = draftKey(s);
    return key ? (s.draftCovers[key] ?? null) : null;
  });
}
