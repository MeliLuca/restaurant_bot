// POST /api/ai/chat — one turn of the Assistente's chat.
// Saved form: { userId, conversationId?, message } — the turn is stored in
// the user's conversation (created on the first message) and builds on what
// that conversation is working on. Stateless form: { messages: [{ role,
// content }] }, last = the new user message; nothing is saved.
// The model only picks the task (lib/ai/chat/route-intent); the task's own
// endpoint computes the answer (lib/ai/chat/answer).

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { answer, contextSummary } from "@/lib/ai/chat/answer";
import { routeIntent } from "@/lib/ai/chat/route-intent";
import {
  addMessages,
  createConversation,
  getConversation,
  getMessages,
  touchConversation,
  userExists,
} from "@/lib/ai/chat/store";
import { nameConversation } from "@/lib/ai/chat/title";
import type { ChatIntent, ChatResponse, ChatTurn } from "@/lib/ai/contracts/chat";
import type { AiChatContext } from "@/lib/database.types";

export const fetchCache = "force-no-store";

const MAX_MESSAGE = 1000;
const MAX_TURNS = 30;
/** the router reads only the end of a long chat */
const HISTORY_TURNS = 8;

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

async function respond(turns: ChatTurn[], context: AiChatContext) {
  const { routed, ai } = await routeIntent(turns, {
    lastIntent: context.lastIntent as ChatIntent | undefined,
    summary: contextSummary(context),
  });
  const result = await answer(routed, turns[turns.length - 1].content, context);
  return { routed, ai, ...result };
}

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);

  // stateless form
  if (body?.messages !== undefined) {
    const turns = parseTurns(body.messages);
    if (!turns) {
      return aiError(
        "messages must be a non-empty list of {role, content}, ending with a user message",
        400,
        "bad_request",
      );
    }
    try {
      const r = await respond(turns, {});
      const out: ChatResponse = {
        intent: r.routed.intent,
        reply: r.reply,
        data: r.data,
        ai: r.ai,
        conversation: null,
        messages: null,
      };
      return NextResponse.json(out);
    } catch (e) {
      return aiFailure(e);
    }
  }

  // saved form
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const conversationId =
    typeof body?.conversationId === "string" ? body.conversationId : undefined;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!userId || !message) {
    return aiError("userId and message (or messages) are required", 400, "bad_request");
  }
  if (message.length > MAX_MESSAGE) {
    return aiError(`message is longer than ${MAX_MESSAGE} characters`, 400, "bad_request");
  }
  try {
    if (!(await userExists(userId))) return aiError("Unknown user", 400, "bad_request");
    const existing = conversationId ? await getConversation(conversationId, userId) : null;
    if (conversationId && !existing) {
      return aiError("Conversation not found", 404, "not_found");
    }
    const history: ChatTurn[] = existing
      ? (await getMessages(existing.id))
          .slice(-HISTORY_TURNS)
          .map((m) => ({ role: m.role, content: m.content }))
      : [];
    const r = await respond([...history, { role: "user", content: message }], existing?.context ?? {});

    // saved only once answered: a failed turn leaves the chat as it was
    const conversation = existing ?? (await createConversation(userId, message));
    const saved = await addMessages(conversation.id, [
      { role: "user", content: message },
      { role: "assistant", content: r.reply, intent: r.routed.intent, modelMs: r.ai?.ms ?? null },
    ]);
    const summary = await touchConversation(conversation.id, r.context);
    if (!conversation.titled) {
      // after the reply: the list picks the title up in realtime
      void nameConversation(conversation.id, message, r.reply).catch((e) =>
        console.warn("[ai] title:", e instanceof Error ? e.message : e),
      );
    }
    const out: ChatResponse = {
      intent: r.routed.intent,
      reply: r.reply,
      data: r.data,
      ai: r.ai,
      conversation: summary,
      messages: saved,
    };
    return NextResponse.json(out);
  } catch (e) {
    return aiFailure(e);
  }
}
