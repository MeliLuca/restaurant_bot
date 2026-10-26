// POST /api/ai/chat — one turn of the Assistente's chat.
// Body: { messages: [{ role: "user" | "assistant", content }] }, last = the
// new user message. The model only picks the task (lib/ai/chat/route-intent);
// the task's own endpoint computes the answer (lib/ai/chat/answer).

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { answer } from "@/lib/ai/chat/answer";
import { routeIntent } from "@/lib/ai/chat/route-intent";
import type { ChatResponse, ChatTurn } from "@/lib/ai/contracts/chat";

export const fetchCache = "force-no-store";

const MAX_MESSAGE = 1000;
const MAX_TURNS = 30;

function parseTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TURNS) return null;
  const turns: ChatTurn[] = [];
  for (const t of raw) {
    if (
      !t ||
      typeof t !== "object" ||
      ((t as ChatTurn).role !== "user" && (t as ChatTurn).role !== "assistant") ||
      typeof (t as ChatTurn).content !== "string"
    ) {
      return null;
    }
    turns.push({ role: (t as ChatTurn).role, content: (t as ChatTurn).content.slice(0, MAX_MESSAGE) });
  }
  return turns[turns.length - 1].role === "user" && turns[turns.length - 1].content.trim()
    ? turns
    : null;
}

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  const turns = parseTurns(body?.messages);
  if (!turns) {
    return aiError(
      "messages must be a non-empty list of {role, content}, ending with a user message",
      400,
      "bad_request",
    );
  }
  try {
    const { routed, ai } = await routeIntent(turns);
    const { reply, data } = await answer(routed, turns[turns.length - 1].content);
    const out: ChatResponse = { intent: routed.intent, reply, data, ai };
    return NextResponse.json(out);
  } catch (e) {
    return aiFailure(e);
  }
}
