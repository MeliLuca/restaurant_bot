// GET /api/ai/health — is the Assistente AI usable right now?
// Query: ?bench=1 also runs a tiny generation and reports its speed.
// Works with the module switched off, so it can be checked before turning on.

import { NextResponse } from "next/server";
import { AI_PROFILE, aiConfig } from "@/lib/ai/config";
import { aiFailure, guardAi } from "@/lib/ai/guard";
import { chatText, gateStatus, ollamaHealth, tryAi } from "@/lib/ai/ollama";
import type { AiHealthResponse } from "@/lib/ai/contracts/health";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardAi({ allowOff: true });
  if (!guard.ok) return guard.response;
  try {
    const bench = new URL(request.url).searchParams.get("bench") === "1";
    const cfg = aiConfig();
    const ollama = await ollamaHealth();
    const benchResult =
      bench && ollama.reachable && ollama.installed
        ? await tryAi(() =>
            chatText(
              [{ role: "user", content: "Rispondi solo: pronto." }],
              { numPredict: 8, temperature: 0 },
            ),
          )
        : null;
    const body: AiHealthResponse = {
      module: { enabled: guard.settings.enabled },
      profile: { id: AI_PROFILE.id, label: AI_PROFILE.label },
      config: {
        model: cfg.model,
        host: cfg.host,
        numCtx: cfg.numCtx,
        maxConcurrency: cfg.maxConcurrency,
        timeoutMs: cfg.timeoutMs,
      },
      ollama,
      gate: gateStatus(),
      bench: benchResult ? benchResult.meta : null,
    };
    return NextResponse.json(body);
  } catch (e) {
    return aiFailure(e);
  }
}
