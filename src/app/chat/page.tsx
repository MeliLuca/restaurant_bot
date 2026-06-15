"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { ConversationList } from "@/components/chat/conversation-list";
import { MessageThread } from "@/components/chat/message-thread";
import { TEAM_CONVERSATION, conversationOf } from "@/lib/chat-api";
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messages);
  const reads = useChatStore((s) => s.reads);
  const staff = useChatStore((s) => s.staff);
  const ready = useChatStore((s) => s.ready);
  const send = useChatStore((s) => s.send);
  const markRead = useChatStore((s) => s.markRead);

  // null = conversation list (mobile); desktop shows both panes
  const [selected, setSelected] = useState<string | null>(null);

  const threadMessages = useMemo(
    () =>
      user && selected
        ? messages.filter((m) => conversationOf(m, user.id) === selected)
        : [],
    [messages, selected, user],
  );

  // Keep the open conversation marked as read, also as new messages arrive
  const lastId = threadMessages[threadMessages.length - 1]?.id;
  useEffect(() => {
    if (selected && lastId) void markRead(selected);
  }, [selected, lastId, markRead]);

  if (!user) return null;

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={cn(
          "w-full shrink-0 flex-col border-r sm:flex sm:w-80",
          selected ? "hidden" : "flex",
        )}
      >
        <div className="border-b px-4 py-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MessageCircle className="h-5 w-5" /> {t("chat.title")}
          </h1>
        </div>
        {ready ? (
          <ConversationList
            userId={user.id}
            staff={staff}
            messages={messages}
            reads={reads}
            selected={selected}
            onSelect={setSelected}
          />
        ) : (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}
      </div>

      <div
        className={cn(
          "min-w-0 flex-1 flex-col sm:flex",
          selected ? "flex" : "hidden",
        )}
      >
        {selected ? (
          <MessageThread
            conversation={selected}
            userId={user.id}
            staff={staff}
            messages={threadMessages}
            onSend={(body) =>
              send(selected === TEAM_CONVERSATION ? null : selected, body)
            }
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="hidden h-full items-center justify-center text-sm text-muted-foreground sm:flex">
            {t("chat.pickConversation")}
          </div>
        )}
      </div>
    </div>
  );
}
