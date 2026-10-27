// Assistente AI — the chat's second step: run the task and say what it found.
//
// Each task is reached through its own route handler (the same code the
// screens call), so the chat depends only on the contracts. The reply is
// built here from the computed data — never written by the model — except
// for the task's own model sentence (explanation / summary / insights),
// which each task has already checked against its numbers.

import { formatMoney } from "@/lib/constants";
import { currentServiceDayStart } from "@/lib/stats-api";
import { POST as orderParse } from "@/app/api/ai/order/parse/route";
import { POST as orderPrice } from "@/app/api/ai/order/price/route";
import { POST as tablesSuggest } from "@/app/api/ai/tables/suggest/route";
import { GET as kitchenAlerts } from "@/app/api/ai/kitchen/alerts/route";
import { POST as tableStats } from "@/app/api/ai/analytics/tables/route";
import { POST as productStats } from "@/app/api/ai/analytics/products/route";
import { chatText, tryAi } from "../ollama";
import type { AiChatContext } from "@/lib/database.types";
import type { ChatData } from "../contracts/chat";
import type { OrderParseResponse, OrderPriceResponse } from "../contracts/order";
import type { TableSuggestResponse } from "../contracts/tables";
import type { KitchenAlertsResponse } from "../contracts/kitchen";
import type { ProductStatsResponse, TableStatsResponse } from "../contracts/analytics";
import type { RoutedIntent } from "./route-intent";

const INTERNAL = "http://internal";

/** Call a task's handler in-process; its error body becomes the reply */
async function call<T>(
  handler: (r: Request) => Promise<Response>,
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await handler(
    new Request(`${INTERNAL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  return { ok: true, data };
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The last `days` service days, today's included */
export function lastDays(days: number, now = new Date()): { from: string; to: string } {
  const to = currentServiceDayStart(now);
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: dayKey(from), to: dayKey(to) };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function orderReply(r: OrderParseResponse): string {
  if (r.status === "refuse") return r.reply ?? "Non posso farlo.";
  const rows = [
    ...r.lines.map(
      (l) =>
        `${l.quantity}× ${l.name}${l.modifiers.length ? ` (${l.modifiers.map((m) => `${m.isRemoval ? "−" : "+"} ${m.name}`).join(", ")})` : ""} — ${formatMoney(l.unitPrice)}${l.confidence === "low" ? " ⚠ da controllare" : ""}`,
    ),
    ...r.customDishes.map(
      (c) =>
        `${c.quantity}× ${c.name} — ${formatMoney(c.price)} (${c.mode === "variation" ? `come variazione di ${c.base.name}` : "fuori menù"})`,
    ),
  ];
  const parts: string[] = [];
  if (r.status === "staff") parts.push("⚠ Allergie o intolleranze: serve la conferma di un cameriere.");
  if (rows.length) parts.push(rows.join("\n"));
  if (r.unresolved.length) parts.push(`Non trovato: ${r.unresolved.map((u) => u.text).join(", ")}.`);
  if (r.clarification) parts.push(r.clarification);
  else if (r.reply && r.status !== "staff") parts.push(r.reply);
  if (rows.length) parts.push("Per metterlo nel conto usa «Scrivi l'ordine» in Cassa.");
  return parts.join("\n\n") || "Non ho riconosciuto nessun piatto.";
}

function breakdownRow(b: OrderPriceResponse["breakdown"][number]): string {
  switch (b.kind) {
    case "base":
      return `Base ${b.label}: ${formatMoney(b.amount)}`;
    case "addition":
      return `+ ${b.label}: ${formatMoney(b.amount)}`;
    case "removal":
      return `− ${b.label}${b.credit ? ` (scambio, credito ${formatMoney(b.credit)})` : ""}`;
    case "unknown":
      return `? ${b.label}: non a listino, non conteggiato`;
    default:
      return `Totale: ${formatMoney(b.amount)}`;
  }
}

function priceReply(r: OrderPriceResponse): string {
  return [
    `${r.name}: ${formatMoney(r.price)} ${r.mode === "variation" ? `come variazione di ${r.base.name}` : `fuori menù (base ${r.base.name})`}.`,
    r.breakdown.map(breakdownRow).join("\n"),
    r.similar.length
      ? `Piatti simili: da ${formatMoney(r.range.min)} a ${formatMoney(r.range.max)}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Tables are named by number here: "12" reads as "Tavolo 12" */
const tableLabel = (name: string) => (/^\d+$/.test(name) ? `Tavolo ${name}` : name);

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

/** "6 persone, adesso, con TV screen e Child friendly" */
export function tablesRequestText(r: {
  partySize: number;
  time: string | null;
  tagNames?: string[];
}): string {
  const when = r.time ? `alle ${clock(r.time)}` : "adesso";
  const tags = r.tagNames?.length
    ? `, con ${r.tagNames.length > 1 ? `${r.tagNames.slice(0, -1).join(", ")} e ${r.tagNames[r.tagNames.length - 1]}` : r.tagNames[0]}`
    : "";
  return `${r.partySize} persone, ${when}${tags}`;
}

function tablesReply(r: TableSuggestResponse): string {
  if (!r.options.length) {
    return `${tablesRequestText(r.request)}: ${r.reason ?? "nessun tavolo adatto."}`;
  }
  const list = r.options
    .slice(0, 4)
    .map((o) => `• ${o.tableNames.map(tableLabel).join(" + ")} (${o.seats} posti${o.mapName ? `, ${o.mapName}` : ""}) — ${o.reason}`)
    .join("\n");
  return [`${tablesRequestText(r.request)}:`, list, r.explanation ?? ""].filter(Boolean).join("\n\n");
}

function kitchenReply(r: KitchenAlertsResponse): string {
  if (!r.byOrder.length) {
    return `Nessun ritardo (soglie: cucina ${r.thresholds.CUCINA}', bar ${r.thresholds.BAR}').`;
  }
  const list = r.byOrder
    .slice(0, 5)
    // a take-away label already carries its own number ("Asporto Gianni (#1)")
    .map((o) => `• ${o.where}${o.where.includes("(#") ? "" : ` (#${o.ticketNumber})`}: ${o.items.map((i) => `${i.quantity}× ${i.name} ${i.minutes}'`).join(", ")}`)
    .join("\n");
  return [r.summary ?? `${r.byOrder.length} ordini in ritardo.`, list].join("\n\n");
}

function tableStatsReply(r: TableStatsResponse): string {
  const t = r.totals;
  const top = r.tables
    .filter((x) => x.bills > 0)
    .slice(0, 5)
    .map(
      (x) =>
        `• ${tableLabel(x.tableName)}: ${formatMoney(x.revenue)}, ${x.bills} sedute, ${x.revenuePerCover !== null ? `${formatMoney(x.revenuePerCover)} a coperto` : "—"}`,
    )
    .join("\n");
  return [
    `Dal ${r.range.from} al ${r.range.to}: ${formatMoney(t.revenue)} in sala, ${t.bills} sedute, ${t.covers} coperti, ${t.rotationsPerService.toFixed(1)} rotazioni per tavolo a servizio.`,
    top || "Nessun conto pagato nel periodo.",
    r.insights?.length ? r.insights.map((i) => `→ ${i}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function productStatsReply(r: ProductStatsResponse): string {
  const t = r.totals;
  const top = r.products
    .filter((p) => !p.isCoperto)
    .slice(0, 5)
    .map(
      (p) =>
        `• ${p.name}: ${p.quantity} venduti, ${formatMoney(p.revenue)}${p.foodCostPct !== null ? `, food cost ${pct(p.foodCostPct)}` : ""}`,
    )
    .join("\n");
  return [
    `Dal ${r.range.from} al ${r.range.to}: ${formatMoney(t.revenue)} su ${t.quantity} prodotti${t.trend !== null ? ` (${t.trend >= 0 ? "+" : ""}${pct(t.trend)} sul periodo prima)` : ""}. Costo noto per il ${pct(r.costCoverage)} dell'incasso.`,
    top || "Nessuna vendita nel periodo.",
    r.insights?.length ? r.insights.map((i) => `→ ${i}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const OTHER_SYSTEM = `Sei l'assistente di una trattoria, dentro il gestionale. Sai: scrivere un'ordinazione dal testo, proporre il prezzo di un piatto fuori menù, trovare il tavolo migliore per un gruppo, segnalare i ritardi in cucina, analizzare la resa di tavoli e prodotti. Rispondi in italiano in una o due frasi brevi. Non dire mai prezzi, numeri o dati che non ti sono stati dati: se la domanda chiede dati, spiega quale delle cose che sai fare può rispondere.`;

/** "e il mese prima?" keeps the period of the analysis before; else 30 days */
const statsDays = (context: AiChatContext) =>
  (context.lastIntent === "table_stats" || context.lastIntent === "product_stats") && context.days
    ? context.days
    : 30;

/** The line that tells the router what the chat is working on */
export function contextSummary(context: AiChatContext): string | undefined {
  if (context.lastIntent === "tables" && context.tables) {
    return `tavolo per ${tablesRequestText(context.tables)}`;
  }
  if ((context.lastIntent === "table_stats" || context.lastIntent === "product_stats") && context.days) {
    return `analisi degli ultimi ${context.days} giorni`;
  }
  return undefined;
}

export interface Answer {
  reply: string;
  data: ChatData;
  /** what the conversation works on after this answer */
  context: AiChatContext;
}

export async function answer(
  routed: RoutedIntent,
  question: string,
  context: AiChatContext = {},
): Promise<Answer> {
  const fail = (error: string): Answer => ({
    reply: `Non sono riuscito: ${error}`,
    data: { intent: "other", result: null },
    // a failed turn changes nothing the chat was working on
    context,
  });
  const done = (reply: string, data: ChatData, extra: AiChatContext = {}): Answer => ({
    reply,
    data,
    context: { ...context, ...extra, lastIntent: data.intent },
  });
  switch (routed.intent) {
    case "order": {
      const r = await call<OrderParseResponse>(orderParse, "/api/ai/order/parse", { text: routed.text });
      if (!r.ok) return fail(r.error);
      return done(orderReply(r.data), { intent: "order", result: r.data });
    }
    case "price": {
      const r = await call<OrderPriceResponse>(orderPrice, "/api/ai/order/price", { text: routed.text });
      if (!r.ok) return fail(r.error);
      return done(priceReply(r.data), { intent: "price", result: r.data });
    }
    case "tables": {
      // a follow-up reads the new message on top of the request so far —
      // the request is kept by the app, not re-told by the model
      const previous = context.lastIntent === "tables" ? context.tables : undefined;
      const r = await call<TableSuggestResponse>(
        tablesSuggest,
        "/api/ai/tables/suggest",
        previous
          ? {
              text: question,
              previous: {
                partySize: previous.partySize,
                time: previous.time,
                tagIds: previous.tagIds,
                mapId: previous.mapId,
              },
            }
          : { text: routed.text },
      );
      if (!r.ok) return fail(r.error);
      const q = r.data.request;
      return done(tablesReply(r.data), { intent: "tables", result: r.data }, {
        tables: {
          partySize: q.partySize,
          time: q.time,
          tagIds: q.tagIds,
          tagNames: q.tagNames,
          mapId: q.mapId,
        },
      });
    }
    case "kitchen": {
      const r = await call<KitchenAlertsResponse>(kitchenAlerts, "/api/ai/kitchen/alerts?summary=1");
      if (!r.ok) return fail(r.error);
      return done(kitchenReply(r.data), { intent: "kitchen", result: r.data });
    }
    case "table_stats": {
      const days = routed.days ?? statsDays(context);
      const r = await call<TableStatsResponse>(tableStats, "/api/ai/analytics/tables", lastDays(days));
      if (!r.ok) return fail(r.error);
      return done(tableStatsReply(r.data), { intent: "table_stats", result: r.data }, { days });
    }
    case "product_stats": {
      const days = routed.days ?? statsDays(context);
      const r = await call<ProductStatsResponse>(productStats, "/api/ai/analytics/products", lastDays(days));
      if (!r.ok) return fail(r.error);
      return done(productStatsReply(r.data), { intent: "product_stats", result: r.data }, { days });
    }
    default: {
      const r = await tryAi(() =>
        chatText(
          [
            { role: "system", content: OTHER_SYSTEM },
            { role: "user", content: question },
          ],
          { numPredict: 120 },
        ),
      );
      return done(
        r?.data ||
          "Posso scrivere un ordine, proporre un prezzo fuori menù, trovare un tavolo, controllare i ritardi in cucina o analizzare tavoli e prodotti.",
        { intent: "other", result: null },
      );
    }
  }
}
