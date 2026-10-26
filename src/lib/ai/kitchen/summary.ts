// Assistente AI — the model's one-paragraph summary of the late list. SERVER
// ONLY. The model gets the computed list and nothing else (a few compact
// lines, never the whole board); every number in its answer is checked
// against that list, so it can phrase the waits but never invent one.

import { chatText, tryAi } from "@/lib/ai/ollama";
import type { AiMeta } from "@/lib/ai/contracts/common";
import type { KitchenStation, LateOrder } from "@/lib/ai/contracts/kitchen";

/** The prompt names this many orders at most; the rest are only counted */
const MAX_ORDERS = 8;
const MAX_ITEMS_PER_ORDER = 4;

const STATION_IT: Record<KitchenStation, string> = { CUCINA: "cucina", BAR: "bar" };

const SYSTEM = [
  "Sei l'assistente della cucina di un ristorante.",
  "Ricevi l'elenco dei piatti in ritardo, già ordinato dall'attesa più lunga.",
  "Scrivi per il responsabile di sala 1-3 frasi brevi in italiano, prima le attese più lunghe,",
  "nello stile: Tavolo 12 aspetta la carbonara da 24'.",
  "Usa solo nomi e numeri presenti nell'elenco, i minuti esattamente come scritti.",
  "Non inventare nulla. Niente elenchi, niente saluti.",
].join(" ");

/** "Tavolo 12: Carbonara ×2 da 24' (cucina); Spritz da 10' (bar)" — no
 * ticket numbers: the model has no use for them (and "Asporto Rossi (#3)"
 * already carries the delivery number) */
export function lateLines(byOrder: LateOrder[]): string[] {
  const lines = byOrder.slice(0, MAX_ORDERS).map((o) => {
    const items = o.items.slice(0, MAX_ITEMS_PER_ORDER).map((i) => {
      const qty = i.quantity > 1 ? ` ×${i.quantity}` : "";
      return `${i.name}${qty} da ${i.minutes}' (${STATION_IT[i.station]})`;
    });
    const more = o.items.length - MAX_ITEMS_PER_ORDER;
    if (more > 0) items.push(`altri ${more} piatti`);
    return `${o.where}: ${items.join("; ")}`;
  });
  const rest = byOrder.length - MAX_ORDERS;
  if (rest > 0) lines.push(`…e altri ${rest} ordini in ritardo`);
  return lines;
}

/** Every number written in `text` ("38.000" / "38 000" read as 38000) */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.  ]\d{3})*/g) ?? []).map((n) => n.replace(/\D/g, ""));
}

/**
 * The model's summary of the late list, or null when the model is
 * unavailable or its text holds a number the list does not.
 */
export async function summarizeLate(
  byOrder: LateOrder[],
): Promise<{ text: string; meta: AiMeta } | null> {
  if (byOrder.length === 0) return null;
  const lines = lateLines(byOrder);
  const prompt = `Piatti in ritardo:\n${lines.join("\n")}`;
  const result = await tryAi(() =>
    chatText(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      { numPredict: 120, temperature: 0.2 },
    ),
  );
  if (!result || !result.data) return null;
  const known = new Set(numbersIn(prompt));
  const invented = numbersIn(result.data).filter((n) => !known.has(n));
  if (invented.length > 0) {
    console.warn(`[ai] kitchen summary dropped, unknown numbers: ${invented.join(", ")}`);
    return null;
  }
  // one paragraph: the model likes a line per sentence
  return { text: result.data.replace(/\s*\n+\s*/g, " "), meta: result.meta };
}
