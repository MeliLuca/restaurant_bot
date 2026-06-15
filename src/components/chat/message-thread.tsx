"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, SendHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEAM_CONVERSATION } from "@/lib/chat-api";
import type { StaffMember } from "@/lib/staff-api";
import type { ChatMessage } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

interface MessageThreadProps {
  conversation: string;
  userId: string;
  staff: StaffMember[];
  /** Messages of this conversation only, chronological */
  messages: ChatMessage[];
  onSend: (body: string) => Promise<void>;
  onBack: () => void;
}

export function MessageThread({
  conversation,
  userId,
  staff,
  messages,
  onSend,
  onBack,
}: MessageThreadProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isTeam = conversation === TEAM_CONVERSATION;
  const nameOf = (id: string) =>
    staff.find((u) => u.id === id)?.name ?? t("chat.staffFallback");
  const title = isTeam ? t("chat.team") : nameOf(conversation);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation, messages.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await onSend(body);
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("chat.couldNotSend"));
    } finally {
      setBusy(false);
    }
  }

  let lastDay = "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 sm:hidden"
          aria-label={t("chat.backToConversations")}
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {isTeam && <Users className="h-5 w-5 text-muted-foreground" />}
        <div className="min-w-0">
          <div className="truncate font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">
            {isTeam ? t("chat.visibleToAll") : t("chat.privateConversation")}
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("chat.noMessages")}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const day = DAY_FORMATTER.format(new Date(m.created_at));
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 text-center text-xs font-medium text-muted-foreground">
                  {day}
                </div>
              )}
              <div
                className={cn(
                  "mb-2 flex flex-col",
                  mine ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2",
                    mine
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted",
                  )}
                >
                  {isTeam && !mine && (
                    <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                      {nameOf(m.sender_id)}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-sm">
                    {m.body}
                  </div>
                </div>
                <div className="mt-0.5 px-1 text-[11px] text-muted-foreground">
                  {TIME_FORMATTER.format(new Date(m.created_at))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("chat.messagePlaceholder", { name: title })}
          className="h-12"
          aria-label={t("chat.messageAria", { name: title })}
          maxLength={1000}
        />
        <Button
          type="submit"
          className="h-12 px-5"
          disabled={busy || !draft.trim()}
          aria-label={t("chat.sendMessage")}
        >
          <SendHorizontal className="h-5 w-5" />
        </Button>
      </form>
    </div>
  );
}
