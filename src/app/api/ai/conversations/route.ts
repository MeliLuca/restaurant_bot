// GET /api/ai/conversations?userId= — the user's saved chats, newest first.

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi } from "@/lib/ai/guard";
import { listConversations } from "@/lib/ai/chat/store";
import type { ConversationListResponse } from "@/lib/ai/contracts/chat";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return aiError("userId is required", 400, "bad_request");
  try {
    const out: ConversationListResponse = { conversations: await listConversations(userId) };
    return NextResponse.json(out);
  } catch (e) {
    return aiFailure(e);
  }
}
