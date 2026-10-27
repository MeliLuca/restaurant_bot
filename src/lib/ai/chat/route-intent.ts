// Assistente AI — the chat's first step: which task is this message for?
//
// The model sees the last few turns and answers with an intent plus the
// request rewritten to stand on its own ("e alle 22?" → "4 persone alle 22"),
// constrained by a JSON schema. When the model is unavailable a keyword rule
// does the same job, less well, so the chat still answers.

import { normalize } from "@/lib/menu-search";
import { chatJson, tryAi, type ChatMessage } from "../ollama";
import type { AiMeta } from "../contracts/common";
import type { ChatIntent, ChatTurn } from "../contracts/chat";

export const CHAT_INTENTS: ChatIntent[] = [
  "order",
  "price",
  "tables",
  "kitchen",
  "table_stats",
  "product_stats",
  "other",
];

export interface RoutedIntent {
  intent: ChatIntent;
  /** the request, self-contained, for the task endpoint */
  text: string;
  /** analyses only: how many days back, when said */
  days: number | null;
}

const SCHEMA = {
  type: "object",
  properties: {
    intento: { type: "string", enum: CHAT_INTENTS },
    testo: { type: "string" },
    giorni: { type: ["integer", "null"], minimum: 1, maximum: 366 },
  },
  required: ["intento", "testo", "giorni"],
};

const SYSTEM = `Smisti le richieste del personale di una trattoria verso lo strumento giusto. Rispondi SOLO con il JSON dello schema.
intento:
- order: un'ordinazione da scrivere (piatti, bevande, quantità, "senza", "extra")
- price: quanto far pagare un piatto fuori menù o composto da ingredienti
- tables: trovare un tavolo (numero di persone, eventuale orario, esigenze)
- kitchen: ritardi, ordini fermi, stato della cucina o del bar
- table_stats: resa, incasso o rotazione dei tavoli
- product_stats: vendite, incasso, margini o andamento di piatti e prodotti
- other: tutto il resto
testo: la richiesta riscritta in modo autonomo, prendendo dai messaggi precedenti i dettagli che servono; non aggiungere nulla che non è stato detto. Per price solo il piatto ("pizza con burrata e crudo"), senza la domanda.
giorni: solo per table_stats/product_stats, il periodo chiesto in giorni (ieri = 1, settimana = 7, mese = 30, anno = 365); null se non detto.
Se c'è una richiesta in corso e il messaggio aggiunge, toglie o cambia un dettaglio ("abbiamo anche dei bambini", "e alle 22?", "la tv non serve"), l'intento resta quello della richiesta in corso.`;

/** What the conversation is working on, said to the model in a line */
export interface RouteContext {
  lastIntent?: ChatIntent;
  /** e.g. "tavolo per 6 persone, adesso, con TV screen" */
  summary?: string;
}

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

/** Keyword fallback when the model is unavailable */
export function routeByKeywords(message: string, context?: RouteContext): RoutedIntent {
  const n = ` ${normalize(message)} `;
  const days = /\bsettiman/.test(n) ? 7 : /\bmese\b/.test(n) ? 30 : /\banno\b/.test(n) ? 365 : null;
  let intent: ChatIntent = "order";
  if (has(n, ["rende", "rendono", "incass", "rotazion", "margin", "vendut", "vendit", "statistic", "analisi"])) {
    intent = has(n, ["tavol"]) ? "table_stats" : "product_stats";
  } else if (has(n, ["cucina", "ritard", "aspetta", "fermi", "bar "])) {
    intent = "kitchen";
  } else if (has(n, ["persone", "posti", "siamo in", "tavolo per", "coperti alle", " pax"])) {
    intent = "tables";
  } else if (has(n, ["quanto", "prezzo", "fuori menu", "far pagare"])) {
    intent = "price";
  } else if (
    context?.lastIntent === "tables" &&
    has(n, ["bambin", "tv", "partita", "schermo", "disabil", "carrozzin", "finestr", " alle ", " ore ", "adesso", "fossero", "siamo", "sala", "giardino", "non serve", "senza"])
  ) {
    // a detail added to the table request in progress
    intent = "tables";
  }
  return { intent, text: message.trim(), days };
}

const MAX_TURNS = 6;

export async function routeIntent(
  turns: ChatTurn[],
  context?: RouteContext,
): Promise<{ routed: RoutedIntent; ai: AiMeta | null }> {
  const last = turns[turns.length - 1]?.content ?? "";
  const history = turns.slice(-MAX_TURNS, -1);
  const inProgress =
    context?.lastIntent && context.summary
      ? `\nRichiesta in corso (intento ${context.lastIntent}): ${context.summary}.`
      : "";
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM + inProgress },
    ...history.map((t) => ({ role: t.role, content: t.content.slice(0, 400) })),
    { role: "user", content: last },
  ];
  const result = await tryAi(() =>
    chatJson<{ intento: string; testo: string; giorni: number | null }>(messages, SCHEMA, {
      numPredict: 120,
      temperature: 0,
    }),
  );
  if (!result) return { routed: routeByKeywords(last, context), ai: null };
  const { intento, testo, giorni } = result.data;
  const intent = (CHAT_INTENTS as string[]).includes(intento) ? (intento as ChatIntent) : "other";
  return {
    routed: {
      intent,
      // a rewrite that lost the request is worse than the raw message
      text: typeof testo === "string" && testo.trim().length >= 2 ? testo.trim() : last.trim(),
      days:
        Number.isInteger(giorni) && giorni! >= 1 && giorni! <= 366 ? giorni : null,
    },
    ai: result.meta,
  };
}
