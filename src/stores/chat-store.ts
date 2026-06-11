import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  conversationOf,
  fetchMessagesFor,
  fetchReads,
  markConversationRead,
  sendMessage,
} from "@/lib/chat-api";
import { fetchStaff, type StaffMember } from "@/lib/staff-api";
import { getSupabase } from "@/lib/supabase/client";
import type { ChatMessage } from "@/lib/database.types";

const POLL_INTERVAL_MS = 15_000;

/** timestamptz strings come in mixed formats — compare as epoch millis */
export function ts(iso: string): number {
  return new Date(iso).getTime();
}

interface ChatState {
  userId: string | null;
  messages: ChatMessage[];
  /** conversation key -> last_read_at */
  reads: Record<string, string>;
  staff: StaffMember[];
  ready: boolean;
  /** registered by ChatListener to surface toasts for incoming messages */
  onIncoming: ((m: ChatMessage) => void) | null;
  init: (userId: string) => void;
  teardown: () => void;
  refresh: () => Promise<void>;
  send: (recipientId: string | null, body: string) => Promise<void>;
  markRead: (conversation: string) => Promise<void>;
  setOnIncoming: (cb: ((m: ChatMessage) => void) | null) => void;
}

// Realtime plumbing lives outside the store state: it never drives renders.
let channel: RealtimeChannel | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let realtimeUp = false;

function sortByTime(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => ts(a.created_at) - ts(b.created_at));
}

export const useChatStore = create<ChatState>()((set, get) => {
  /** Merge one message in (realtime event or send echo), deduped by id */
  function receive(m: ChatMessage, notify: boolean) {
    const { userId, messages, onIncoming } = get();
    if (!userId) return;
    // only the team channel and DMs that involve me
    if (
      m.recipient_id !== null &&
      m.sender_id !== userId &&
      m.recipient_id !== userId
    )
      return;
    if (messages.some((x) => x.id === m.id)) return;
    set({ messages: sortByTime([...messages, m]) });
    if (notify && m.sender_id !== userId) onIncoming?.(m);
  }

  return {
    userId: null,
    messages: [],
    reads: {},
    staff: [],
    ready: false,
    onIncoming: null,

    init: (userId) => {
      if (get().userId === userId) return;
      get().teardown();
      set({ userId });

      void (async () => {
        try {
          const [messages, reads, staff] = await Promise.all([
            fetchMessagesFor(userId),
            fetchReads(userId),
            fetchStaff(),
          ]);
          if (get().userId !== userId) return; // user switched mid-flight
          set({
            messages,
            reads: Object.fromEntries(
              reads.map((r) => [r.conversation, r.last_read_at]),
            ),
            staff,
            ready: true,
          });
        } catch {
          // polling below retries; the chat page surfaces load errors
        }
      })();

      channel = getSupabase()
        .channel("staff-chat")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => receive(payload.new as ChatMessage, true),
        )
        .subscribe((status) => {
          realtimeUp = status === "SUBSCRIBED";
        });

      // Fallback: if the websocket is down, keep the chat fresh by polling.
      pollTimer = setInterval(() => {
        if (!realtimeUp) void get().refresh();
      }, POLL_INTERVAL_MS);
    },

    teardown: () => {
      if (channel) {
        void getSupabase().removeChannel(channel);
        channel = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      realtimeUp = false;
      set({
        userId: null,
        messages: [],
        reads: {},
        staff: [],
        ready: false,
      });
    },

    refresh: async () => {
      const { userId, messages: before, onIncoming } = get();
      if (!userId) return;
      const messages = await fetchMessagesFor(userId);
      if (get().userId !== userId) return;
      const known = new Set(before.map((m) => m.id));
      set({ messages });
      for (const m of messages) {
        if (!known.has(m.id) && m.sender_id !== userId) onIncoming?.(m);
      }
    },

    send: async (recipientId, body) => {
      const { userId } = get();
      if (!userId) throw new Error("Not signed in");
      const m = await sendMessage(userId, recipientId, body);
      receive(m, false);
    },

    markRead: async (conversation) => {
      const { userId, reads } = get();
      if (!userId) return;
      const now = new Date().toISOString();
      set({ reads: { ...reads, [conversation]: now } });
      try {
        await markConversationRead(userId, conversation);
      } catch {
        // non-fatal: the badge clears locally; the marker retries next visit
      }
    },

    setOnIncoming: (cb) => set({ onIncoming: cb }),
  };
});

/** Unread count for one conversation */
export function unreadCount(
  state: Pick<ChatState, "userId" | "messages" | "reads">,
  conversation: string,
): number {
  const { userId, messages, reads } = state;
  if (!userId) return 0;
  const lastRead = reads[conversation] ? ts(reads[conversation]) : 0;
  return messages.filter(
    (m) =>
      m.sender_id !== userId &&
      conversationOf(m, userId) === conversation &&
      ts(m.created_at) > lastRead,
  ).length;
}

/** Total unread across all conversations (sidebar badge) */
export function useUnreadTotal(): number {
  return useChatStore((s) => {
    if (!s.userId) return 0;
    let total = 0;
    for (const m of s.messages) {
      if (m.sender_id === s.userId) continue;
      const conv = conversationOf(m, s.userId);
      const lastRead = s.reads[conv] ? ts(s.reads[conv]) : 0;
      if (ts(m.created_at) > lastRead) total++;
    }
    return total;
  });
}
