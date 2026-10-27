// Assistente AI — contract of the CHAT (integration).
//   POST   /api/ai/chat                        one turn, saved in a conversation
//   GET    /api/ai/conversations?userId=       the user's chats, newest first
//   GET    /api/ai/conversations/:id?userId=   one chat with its messages
//   PATCH  /api/ai/conversations/:id           { userId, title } rename
//   DELETE /api/ai/conversations/:id?userId=   delete
// The model only classifies the request (intent + a few arguments); the
// task's own endpoint computes the answer, and the reply text is built from
// that computed data — so even the chat never states a number of its own.
// A conversation remembers what it is working on (AiChatContext), so a
// follow-up builds on the request before instead of starting over.
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
  /** saved form: who is writing (app_users id)… */
  userId?: string;
  /** …the chat to continue (absent = a new one)… */
  conversationId?: string;
  /** …and the new message */
  message?: string;
  /** stateless form (API clients, tests): the whole conversation, last = the
   * new user message; nothing is saved and nothing is remembered */
  messages?: ChatTurn[];
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

export interface ConversationSummary {
  id: string;
  title: string;
  /** false while the title is still the first words of the first message */
  titled: boolean;
  createdAt: string;
  /** time of the last message */
  updatedAt: string;
}

export interface SavedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent: ChatIntent | null;
  /** model time of the routing (null = keyword fallback / user message) */
  modelMs: number | null;
  createdAt: string;
}

export interface ChatResponse {
  intent: ChatIntent;
  /** the reply to show; built from the computed data */
  reply: string;
  data: ChatData;
  /** the routing call (null = model unavailable, keyword fallback used) */
  ai: AiMeta | null;
  /** saved form only: the chat (created on the first message) and both
   * messages as stored. The title is replaced by the model's a few seconds
   * later — the list follows ai_conversations in realtime. */
  conversation: ConversationSummary | null;
  messages: SavedMessage[] | null;
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
}

export interface ConversationDetailResponse {
  conversation: ConversationSummary;
  messages: SavedMessage[];
}
