import { getSupabase } from "@/lib/supabase/client";
import type { ChatMessage, ChatRead } from "@/lib/database.types";

/** Conversation key: the shared team channel or a peer user's id */
export const TEAM_CONVERSATION = "team";

/** The conversation a message belongs to, from this user's point of view */
export function conversationOf(m: ChatMessage, userId: string): string {
  if (m.recipient_id === null) return TEAM_CONVERSATION;
  return m.sender_id === userId ? m.recipient_id : m.sender_id;
}

/**
 * Everything this user can see: the team channel plus DMs they sent or
 * received. One query powers the thread, conversation list, and unread
 * counts. Returns the most recent messages in chronological order.
 */
export async function fetchMessagesFor(
  userId: string,
  limit = 500,
): Promise<ChatMessage[]> {
  const { data, error } = await getSupabase()
    .from("messages")
    .select("*")
    .or(
      `recipient_id.is.null,sender_id.eq.${userId},recipient_id.eq.${userId}`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data.reverse();
}

export async function sendMessage(
  senderId: string,
  recipientId: string | null,
  body: string,
): Promise<ChatMessage> {
  const { data, error } = await getSupabase()
    .from("messages")
    .insert({ sender_id: senderId, recipient_id: recipientId, body: body.trim() })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchReads(userId: string): Promise<ChatRead[]> {
  const { data, error } = await getSupabase()
    .from("chat_reads")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return data;
}

export async function markConversationRead(
  userId: string,
  conversation: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("chat_reads")
    .upsert(
      {
        user_id: userId,
        conversation,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,conversation" },
    );
  if (error) throw new Error(error.message);
}
