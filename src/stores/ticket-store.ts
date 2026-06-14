import { create } from "zustand";
import { calcTotals, unitPriceWithModifiers } from "@/lib/money";
import type { MenuItem } from "@/lib/database.types";

/** One modifier picked for a cart line — name/price snapshotted from the menu */
export interface SelectedModifier {
  modifierId: string;
  name: string;
  priceAdjustment: number;
}

export interface TicketLine {
  /** Ticket-local identity: the same item with different modifiers makes
   * separate lines, so menuItemId alone can't address one */
  lineId: string;
  menuItemId: string;
  name: string;
  /** Base menu price; the charged price adds the modifier adjustments */
  unitPrice: number;
  quantity: number;
  modifiers: SelectedModifier[];
  /** Price manually overridden for this ticket only (never the menu) */
  priceOverridden?: boolean;
}

/** Price charged per unit of a line: base price + modifier adjustments */
export function lineUnitPrice(line: TicketLine): number {
  return unitPriceWithModifiers(line.unitPrice, line.modifiers);
}

let lineSeq = 0;
const nextLineId = () => `line-${Date.now()}-${++lineSeq}`;

/** Two selections are mergeable when they picked exactly the same modifiers */
function sameModifiers(a: SelectedModifier[], b: SelectedModifier[]): boolean {
  if (a.length !== b.length) return false;
  const key = (m: SelectedModifier) => m.modifierId;
  const sortedB = [...b].sort((x, y) => key(x).localeCompare(key(y)));
  return [...a]
    .sort((x, y) => key(x).localeCompare(key(y)))
    .every((m, i) => m.modifierId === sortedB[i].modifierId);
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

  /** Switch dine-in / take-away; the in-progress ticket is stashed as a draft */
  setMode: (mode: TicketMode) => void;
  /** Select a table; the previous target's pending lines become its draft */
  setTable: (tableId: string, tableName: string) => void;
  /** Switch split within the current table; pending lines are stashed per split */
  setSubtable: (subtable: string | null) => void;
  /** Target a take-away: an existing open order, or a new customer name */
  setTakeaway: (orderId: string | null, name: string) => void;
  addItem: (
    item: Pick<MenuItem, "id" | "name" | "price">,
    modifiers?: SelectedModifier[],
  ) => void;
  removeItem: (lineId: string) => void;
  /** Quantities below 1 remove the line */
  setQuantity: (lineId: string, quantity: number) => void;
  /** Override a pending line's BASE price for this ticket only */
  setLinePrice: (lineId: string, unitPrice: number) => void;
  /** Replace a pending line's ingredients (add/remove after it's on the
   * ticket); the charged price re-derives from the new modifier set */
  setLineModifiers: (lineId: string, modifiers: SelectedModifier[]) => void;
  /** Drop pending lines AND their draft (after Send to Kitchen) */
  clearLines: () => void;
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
          l.menuItemId === item.id && sameModifiers(l.modifiers, modifiers),
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
            unitPrice: item.price,
            quantity: 1,
            modifiers,
          },
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

  setLineModifiers: (lineId, modifiers) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.lineId === lineId ? { ...l, modifiers } : l,
      ),
    })),

  clearLines: () =>
    set((state) => {
      const drafts = { ...state.drafts };
      const key = draftKey(state);
      if (key) delete drafts[key];
      return { lines: [], drafts };
    }),

  clearTicket: () =>
    set((state) => stashAndRestore(state, { ...EMPTY_TARGET })),
}));
