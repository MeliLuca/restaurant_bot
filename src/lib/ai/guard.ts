// Assistente AI (PROTOTYPE) — shared bits of the /api/ai route handlers.
// SERVER ONLY. Same conventions as the print routes: hand-checked bodies,
// `{ error }` + status on failure.
//
// Note: like every other route in this app, there is no server-side auth yet
// (login is a client-side PIN, RLS is deferred). Documented in docs/ai-module.md.

import { NextResponse } from "next/server";
import type { AiSettings } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import { aiConfig } from "./config";
import type { AiErrorBody } from "./contracts/common";

export function aiError(
  message: string,
  status: number,
  code?: AiErrorBody["code"],
): NextResponse<AiErrorBody> {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

export async function loadAiSettings(): Promise<AiSettings> {
  const { data, error } = await getSupabase()
    .from("ai_settings")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { ...data, custom_dish_min_overlap: Number(data.custom_dish_min_overlap) };
}

export type AiGuard =
  | { ok: true; settings: AiSettings }
  | { ok: false; response: NextResponse<AiErrorBody> };

/**
 * Every /api/ai route starts here: 404 when this build is not the prototype
 * (AI_PROTOTYPE unset), 503 when the module is switched off — unless
 * `allowOff` (health: an admin checks the model before turning it on).
 */
export async function guardAi(opts: { allowOff?: boolean } = {}): Promise<AiGuard> {
  if (!aiConfig().prototype) {
    return { ok: false, response: aiError("Not found", 404, "not_found") };
  }
  let settings: AiSettings;
  try {
    settings = await loadAiSettings();
  } catch (e) {
    return {
      ok: false,
      response: aiError(e instanceof Error ? e.message : "Settings unavailable", 500, "failed"),
    };
  }
  if (!settings.enabled && !opts.allowOff) {
    return { ok: false, response: aiError("The AI assistant is switched off", 503, "module_off") };
  }
  return { ok: true, settings };
}

/** The JSON body, or null when missing / not an object */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** 500 with the error's message, for the catch of a handler */
export function aiFailure(e: unknown, fallback = "AI request failed") {
  return aiError(e instanceof Error ? e.message : fallback, 500, "failed");
}
