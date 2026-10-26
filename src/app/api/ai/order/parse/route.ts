// POST /api/ai/order/parse — "Scrivi l'ordine": free text → ticket lines.
// Body: { text: string }. The model reads the words; the menu match and every
// price are computed by the app (lib/ai/order). Without the model the simple
// cases still come back, read by rules (extractedBy: "rules", ai: null).

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { parseOrder } from "@/lib/ai/order/parse";

// the menu is read on every call: never serve a cached copy
export const fetchCache = "force-no-store";

const MAX_TEXT = 1000;

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return aiError("text is required", 400, "bad_request");
  if (text.length > MAX_TEXT) {
    return aiError(`text is longer than ${MAX_TEXT} characters`, 400, "bad_request");
  }
  try {
    return NextResponse.json(await parseOrder(text, guard.settings));
  } catch (e) {
    return aiFailure(e);
  }
}
