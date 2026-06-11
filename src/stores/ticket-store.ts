import { create } from "zustand";
import { calcTotals } from "@/lib/money";
import type { MenuItem } from "@/lib/database.types";

export interface TicketLine {
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
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

  /** Switch dine-in / take-away; changing mode clears the in-progress ticket */
  setMode: (mode: TicketMode) => void;
  /** Select a table; switching tables clears the in-progress ticket */
  setTable: (tableId: string, tableName: string) => void;
  /** Switch split within the current table; clears pending lines */
  setSubtable: (subtable: string | null) => void;
  /** Target a take-away: an existing open order, or a new customer name */
  setTakeaway: (orderId: string | null, name: string) => void;
  addItem: (item: Pick<MenuItem, "id" | "name" | "price">) => void;
  removeItem: (menuItemId: string) => void;
  /** Quantities below 1 remove the line */
  setQuantity: (menuItemId: string, quantity: number) => void;
  /** Drop pending lines but keep the target (after Send to Kitchen) */
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

export const useTicketStore = create<TicketState>((set) => ({
  mode: "table",
  ...EMPTY_TARGET,

  setMode: (mode) =>
    set((state) => (state.mode === mode ? {} : { mode, ...EMPTY_TARGET })),

  setTable: (tableId, tableName) =>
    set((state) =>
      state.mode === "table" && state.tableId === tableId
        ? { tableName }
        : { mode: "table", ...EMPTY_TARGET, tableId, tableName },
    ),

  setSubtable: (subtable) =>
    set((state) =>
      state.subtable === subtable ? {} : { subtable, lines: [] },
    ),

  setTakeaway: (orderId, name) =>
    set((state) =>
      state.mode === "takeaway" &&
      state.takeawayOrderId === orderId &&
      state.takeawayName === name
        ? {}
        : {
            mode: "takeaway",
            ...EMPTY_TARGET,
            takeawayOrderId: orderId,
            takeawayName: name,
          },
    ),

  addItem: (item) =>
    set((state) => {
      const existing = state.lines.find((l) => l.menuItemId === item.id);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          {
            menuItemId: item.id,
            name: item.name,
            unitPrice: item.price,
            quantity: 1,
          },
        ],
      };
    }),

  removeItem: (menuItemId) =>
    set((state) => ({
      lines: state.lines.filter((l) => l.menuItemId !== menuItemId),
    })),

  setQuantity: (menuItemId, quantity) =>
    set((state) => ({
      lines:
        quantity < 1
          ? state.lines.filter((l) => l.menuItemId !== menuItemId)
          : state.lines.map((l) =>
              l.menuItemId === menuItemId ? { ...l, quantity } : l,
            ),
    })),

  clearLines: () => set({ lines: [] }),

  clearTicket: () => set({ ...EMPTY_TARGET }),
}));
