// Assistente AI — saved chats (ai_conversations / ai_messages). SERVER ONLY.
// Every read and write is scoped to the owner: a chat that is not the
// caller's reads as missing.

import { getSupabase } from "@/lib/supabase/client";
import type { AiChatContext, AiConversation, AiMessage } from "@/lib/database.types";
import type { ChatIntent, ConversationSummary, SavedMessage } from "../contracts/chat";

const toSummary = (c: AiConversation): ConversationSummary => ({
  id: c.id,
  title: c.title,
  titled: c.titled,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});

const toMessage = (m: AiMessage): SavedMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  intent: (m.intent as ChatIntent | null) ?? null,
  modelMs: m.model_ms,
  createdAt: m.created_at,
});

export async function userExists(userId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("app_users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await getSupabase()
    .from("ai_conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data.map(toSummary);
}

/** The conversation row, or null when missing or not the user's */
export async function getConversation(
  id: string,
  userId: string,
): Promise<AiConversation | null> {
  const { data, error } = await getSupabase()
    .from("ai_conversations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getMessages(conversationId: string): Promise<SavedMessage[]> {
  const { data, error } = await getSupabase()
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at")
    .limit(500);
  if (error) throw new Error(error.message);
  return data.map(toMessage);
}

/** "Siamo in 6 e vogliamo vedere la partita…" → the first words, as a
 * provisional title until the model names the chat */
export function provisionalTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length <= 48) return flat;
  const cut = flat.slice(0, 48);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 24))}…`;
}

export async function createConversation(
  userId: string,
  firstMessage: string,
): Promise<AiConversation> {
  const { data, error } = await getSupabase()
    .from("ai_conversations")
    .insert({ user_id: userId, title: provisionalTitle(firstMessage) })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function addMessages(
  conversationId: string,
  rows: { role: "user" | "assistant"; content: string; intent?: ChatIntent; modelMs?: number | null }[],
): Promise<SavedMessage[]> {
  // the reply is stamped a moment after the question, so they sort in order
  const base = Date.now();
  const { data, error } = await getSupabase()
    .from("ai_messages")
    .insert(
      rows.map((r, i) => ({
        conversation_id: conversationId,
        role: r.role,
        content: r.content,
        intent: r.intent ?? null,
        model_ms: r.modelMs ?? null,
        created_at: new Date(base + i).toISOString(),
      })),
    )
    .select("*");
  if (error) throw new Error(error.message);
  return data.map(toMessage).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function touchConversation(
  id: string,
  context: AiChatContext,
): Promise<ConversationSummary> {
  const { data, error } = await getSupabase()
    .from("ai_conversations")
    .update({ context, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toSummary(data);
}

export async function renameConversation(
  id: string,
  userId: string,
  title: string,
): Promise<ConversationSummary | null> {
  const { data, error } = await getSupabase()
    .from("ai_conversations")
    .update({ title, titled: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSummary(data) : null;
}

/** Set by the model after the first answer — unless the user renamed it */
export async function setGeneratedTitle(id: string, title: string): Promise<void> {
  const { error } = await getSupabase()
    .from("ai_conversations")
    .update({ title, titled: true })
    .eq("id", id)
    .eq("titled", false);
  if (error) throw new Error(error.message);
}

export async function deleteConversation(id: string, userId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("ai_conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(error.message);
  return data.length > 0;
}
