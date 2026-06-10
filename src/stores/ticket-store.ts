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

interface TicketState {
  /** Table the ticket belongs to; null = no table selected yet */
  tableId: string | null;
  tableName: string | null;
  lines: TicketLine[];

  /** Select a table; switching tables clears the in-progress ticket */
  setTable: (tableId: string, tableName: string) => void;
  addItem: (item: Pick<MenuItem, "id" | "name" | "price">) => void;
  removeItem: (menuItemId: string) => void;
  /** Quantities below 1 remove the line */
  setQuantity: (menuItemId: string, quantity: number) => void;
  /** Drop pending lines but keep the selected table (after Send to Kitchen) */
  clearLines: () => void;
  clearTicket: () => void;
}

export const useTicketStore = create<TicketState>((set) => ({
  tableId: null,
  tableName: null,
  lines: [],

  setTable: (tableId, tableName) =>
    set((state) =>
      state.tableId === tableId
        ? { tableName }
        : { tableId, tableName, lines: [] },
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

  clearTicket: () => set({ tableId: null, tableName: null, lines: [] }),
}));
