// GET    /api/ai/conversations/:id?userId=   one chat with its messages
// PATCH  /api/ai/conversations/:id           { userId, title } rename
// DELETE /api/ai/conversations/:id?userId=   delete it and its messages
// A chat that is not the user's answers 404, like a missing one.

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import {
  deleteConversation,
  getConversation,
  getMessages,
  renameConversation,
} from "@/lib/ai/chat/store";
import type { ConversationDetailResponse } from "@/lib/ai/contracts/chat";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Params = { params: { id: string } };

const MAX_TITLE = 80;

export async function GET(request: Request, { params }: Params) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return aiError("userId is required", 400, "bad_request");
  try {
    const c = await getConversation(params.id, userId);
    if (!c) return aiError("Conversation not found", 404, "not_found");
    const out: ConversationDetailResponse = {
      conversation: {
        id: c.id,
        title: c.title,
        titled: c.titled,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      },
      messages: await getMessages(c.id),
    };
    return NextResponse.json(out);
  } catch (e) {
    return aiFailure(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  if (!userId || !title) return aiError("userId and title are required", 400, "bad_request");
  if (title.length > MAX_TITLE) {
    return aiError(`title is longer than ${MAX_TITLE} characters`, 400, "bad_request");
  }
  try {
    const c = await renameConversation(params.id, userId, title);
    if (!c) return aiError("Conversation not found", 404, "not_found");
    return NextResponse.json(c);
  } catch (e) {
    return aiFailure(e);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return aiError("userId is required", 400, "bad_request");
  try {
    if (!(await deleteConversation(params.id, userId))) {
      return aiError("Conversation not found", 404, "not_found");
    }
    return NextResponse.json({ deleted: params.id });
  } catch (e) {
    return aiFailure(e);
  }
}
