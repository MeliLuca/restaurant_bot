// Assistente AI — order task: the preview's editable state and how it becomes
// ticket lines. Pure and React-free; safe for the browser (types + money only).
//
// Prices are re-derived here with the POS helper, never copied from the
// server's number: what the preview shows is what the ticket will charge.

import { unitPriceWithModifiers } from "@/lib/money";
import type { TicketLine } from "@/stores/ticket-store";
import type {
  CustomDishProposal,
  LineChoice,
  OrderParseResponse,
  ParsedLine,
} from "../contracts/order";

export type DraftLine =
  | {
      key: string;
      kind: "menu";
      line: ParsedLine;
      /** the line's pick, or the alternative the waiter chose */
      choice: LineChoice;
      quantity: number;
    }
  | {
      key: string;
      kind: "custom";
      proposal: CustomDishProposal;
      quantity: number;
      mode: "variation" | "custom";
      /** "Fuori menù" price per unit; starts at the proposal's */
      price: number;
    };

export function draftFromResponse(r: OrderParseResponse): DraftLine[] {
  return [
    ...r.lines.map((line, i): DraftLine => ({
      key: `m${i}`,
      kind: "menu",
      line,
      choice: line,
      quantity: line.quantity,
    })),
    ...r.customDishes.map((proposal, i): DraftLine => ({
      key: `c${i}`,
      kind: "custom",
      proposal,
      quantity: proposal.quantity,
      mode: proposal.base.allowsVariations ? proposal.mode : "custom",
      price: proposal.price,
    })),
  ];
}

/** What one unit of the draft line charges */
export function draftUnitPrice(d: DraftLine): number {
  if (d.kind === "menu") return unitPriceWithModifiers(d.choice.basePrice, d.choice.modifiers);
  if (d.mode === "variation") {
    return unitPriceWithModifiers(d.proposal.base.price, d.proposal.modifiers);
  }
  return d.price;
}

/** Categories whose "Fuori menù" placeholder the draft needs */
export function placeholderCategories(draft: DraftLine[]): string[] {
  const ids: string[] = [];
  draft.forEach((d) => {
    if (d.kind === "custom" && d.mode === "custom" && !ids.includes(d.proposal.categoryId)) {
      ids.push(d.proposal.categoryId);
    }
  });
  return ids;
}

/**
 * The draft as TicketLine inputs (store.addLines). `unitPrice` is the BASE
 * price, modifiers carry their swap credit; an off-menu line is the
 * category's placeholder at the agreed price, named by its own name.
 */
export function draftToTicketLines(
  draft: DraftLine[],
  placeholders: Record<string, string>,
): Omit<TicketLine, "lineId">[] {
  return draft.flatMap((d): Omit<TicketLine, "lineId">[] => {
    if (d.quantity < 1) return [];
    if (d.kind === "menu") {
      return [
        {
          menuItemId: d.choice.menuItemId,
          name: d.choice.name,
          ingredients: d.choice.ingredients,
          unitPrice: d.choice.basePrice,
          quantity: d.quantity,
          modifiers: d.choice.modifiers,
          notes: d.choice.notes,
        },
      ];
    }
    const p = d.proposal;
    // what the pantry does not have still has to reach the kitchen
    const unknown = p.ingredients.filter((i) => !i.ingredientId).map((i) => `+ ${i.name}`);
    if (d.mode === "variation") {
      return [
        {
          menuItemId: p.base.menuItemId,
          name: p.base.name,
          ingredients: p.base.caption,
          unitPrice: p.base.price,
          quantity: d.quantity,
          modifiers: p.modifiers,
          notes: unknown,
        },
      ];
    }
    const placeholder = placeholders[p.categoryId];
    if (!placeholder) return [];
    return [
      {
        menuItemId: placeholder,
        name: p.name,
        customName: p.name,
        ingredients: null,
        unitPrice: Math.max(0, Math.round(d.price * 100) / 100),
        quantity: d.quantity,
        modifiers: [],
        // the free name already lists every ingredient, known or not
        notes: [],
        priceOverridden: true,
      },
    ];
  });
}
