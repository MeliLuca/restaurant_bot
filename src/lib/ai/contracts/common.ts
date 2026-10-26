// Assistente AI — types shared by every /api/ai contract. Safe for client
// and server (types only).

/** How the model's part of an answer was produced; null in a response = the
 * model was unavailable and only computed data came back */
export interface AiMeta {
  model: string;
  /** wall time of the model call, queue wait included */
  ms: number;
  promptTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
}

/** Error body of every /api/ai route */
export interface AiErrorBody {
  error: string;
  /** not_found = prototype flag off; module_off = switched off in Settings */
  code?: "not_found" | "module_off" | "bad_request" | "ai_unavailable" | "failed";
}
