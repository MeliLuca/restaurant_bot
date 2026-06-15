"use client";

import { Users } from "lucide-react";
import { TEAM_CONVERSATION, conversationOf } from "@/lib/chat-api";
import type { StaffMember } from "@/lib/staff-api";
import { useT } from "@/lib/i18n/use-translation";
import { ts, unreadCount } from "@/stores/chat-store";
import type { ChatMessage } from "@/lib/database.types";
import { cn } from "@/lib/utils";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? TIME_FORMATTER.format(d)
    : DATE_FORMATTER.format(d);
}

interface ConversationListProps {
  userId: string;
  staff: StaffMember[];
  messages: ChatMessage[];
  reads: Record<string, string>;
  selected: string | null;
  onSelect: (conversation: string) => void;
}

export function ConversationList({
  userId,
  staff,
  messages,
  reads,
  selected,
  onSelect,
}: ConversationListProps) {
  const t = useT();
  const nameOf = (id: string) =>
    staff.find((u) => u.id === id)?.name ?? t("chat.staffFallback");

  const lastIn = (conversation: string): ChatMessage | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (conversationOf(messages[i], userId) === conversation)
        return messages[i];
    }
    return undefined;
  };

  const contacts = staff
    .filter((u) => u.is_active && u.id !== userId)
    .map((u) => ({ key: u.id, name: u.name, role: u.roles?.name ?? "" }))
    .sort((a, b) => {
      const la = lastIn(a.key);
      const lb = lastIn(b.key);
      if (la && lb) return ts(lb.created_at) - ts(la.created_at);
      if (la || lb) return la ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const rows = [
    { key: TEAM_CONVERSATION, name: t("chat.team"), role: t("chat.everyone") },
    ...contacts,
  ];

  return (
    <div className="flex flex-col overflow-y-auto">
      {rows.map((row) => {
        const last = lastIn(row.key);
        const unread = unreadCount({ userId, messages, reads }, row.key);
        const active = selected === row.key;
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => onSelect(row.key)}
            className={cn(
              "flex min-h-16 items-center gap-3 border-b px-4 py-2 text-left transition-colors",
              active ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                row.key === TEAM_CONVERSATION
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted font-semibold",
              )}
            >
              {row.key === TEAM_CONVERSATION ? (
                <Users className="h-5 w-5" />
              ) : (
                row.name.slice(0, 1).toUpperCase()
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{row.name}</span>
                {last && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {when(last.created_at)}
                  </span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-muted-foreground">
                  {last
                    ? t("chat.messagePreview", {
                        sender:
                          last.sender_id === userId
                            ? t("chat.you")
                            : nameOf(last.sender_id),
                        body: last.body,
                      })
                    : row.key === TEAM_CONVERSATION
                      ? t("chat.teamSubtitle")
                      : row.role}
                </span>
                {unread > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
