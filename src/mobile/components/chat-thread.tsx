"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { MessageThread } from "@/components/chat/message-thread";
import { TEAM_CONVERSATION, conversationOf } from "@/lib/chat-api";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { mRoutes } from "@/mobile/lib/routes";

/**
 * One conversation. MessageThread brings its own header, back button and
 * composer, so this screen deliberately does not add an MHeader on top.
 *
 * The tab bar stays visible here: MessageThread hides its back button at `sm`
 * and up, so on a tablet running the phone UI the Chat tab is the only way
 * back to the list.
 */
export function ChatThread({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messages);
  const staff = useChatStore((s) => s.staff);
  const ready = useChatStore((s) => s.ready);
  const send = useChatStore((s) => s.send);
  const markRead = useChatStore((s) => s.markRead);

  const threadMessages = useMemo(
    () =>
      user
        ? messages.filter((m) => conversationOf(m, user.id) === conversationId)
        : [],
    [messages, conversationId, user],
  );

  // keep it read as new messages land while the thread is open
  const lastId = threadMessages[threadMessages.length - 1]?.id;
  useEffect(() => {
    if (lastId) void markRead(conversationId);
  }, [conversationId, lastId, markRead]);

  if (!user) return null;

  // A thread is deep-linkable, unlike the desktop page where selection is
  // local state. On a cold load the store is still empty, and rendering the
  // thread straight away would claim "no messages" for a conversation that
  // has plenty.
  if (!ready) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  return (
    // a flex box rather than MessageThread's own h-full, so the height comes
    // from the /m layout's column instead of a percentage chain
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageThread
        conversation={conversationId}
        userId={user.id}
        staff={staff}
        messages={threadMessages}
        onSend={(body) =>
          send(
            conversationId === TEAM_CONVERSATION ? null : conversationId,
            body,
          )
        }
        onBack={() => router.push(mRoutes.chat())}
      />
    </div>
  );
}
