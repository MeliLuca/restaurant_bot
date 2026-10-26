// Assistente AI — contract of the CHAT (integration).
//   POST /api/ai/chat   one conversation turn → routed to the right task
// The model only classifies the request (intent + a few arguments); the
// task's own endpoint computes the answer, and the reply text is built from
// that computed data — so even the chat never states a number of its own.
import type { AiMeta } from "./common";
import type { OrderParseResponse, OrderPriceResponse } from "./order";
import type { TableSuggestResponse } from "./tables";
import type { KitchenAlertsResponse } from "./kitchen";
import type { ProductStatsResponse, TableStatsResponse } from "./analytics";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** the conversation so far, last item = the new user message */
  messages: ChatTurn[];
}

export type ChatIntent =
  | "order"
  | "price"
  | "tables"
  | "kitchen"
  | "table_stats"
  | "product_stats"
  | "other";

export type ChatData =
  | { intent: "order"; result: OrderParseResponse }
  | { intent: "price"; result: OrderPriceResponse }
  | { intent: "tables"; result: TableSuggestResponse }
  | { intent: "kitchen"; result: KitchenAlertsResponse }
  | { intent: "table_stats"; result: TableStatsResponse }
  | { intent: "product_stats"; result: ProductStatsResponse }
  | { intent: "other"; result: null };

export interface ChatResponse {
  intent: ChatIntent;
  /** the reply to show; built from the computed data */
  reply: string;
  data: ChatData;
  /** the routing call (null = model unavailable, keyword fallback used) */
  ai: AiMeta | null;
}
