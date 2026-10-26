// GET /api/ai/health
import type { AiMeta } from "./common";

export interface AiHealthResponse {
  module: { enabled: boolean };
  profile: { id: string; label: string };
  config: {
    model: string;
    host: string;
    numCtx: number;
    maxConcurrency: number;
    timeoutMs: number;
  };
  ollama: {
    reachable: boolean;
    host: string;
    model: string;
    version: string | null;
    installed: boolean;
    loaded: boolean;
    sizeBytes: number | null;
    error: string | null;
  };
  gate: { running: number; waiting: number };
  /** only with ?bench=1 and a reachable model */
  bench: AiMeta | null;
}
