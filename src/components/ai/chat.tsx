"use client";

// Assistente AI — the chat tab: one box for any request. The server picks
// the task and answers from the task's own computed data (/api/ai/chat).

import { useEffect, useRef, useState } from "react";
import { Bot, SendHorizontal, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { aiFetch } from "@/lib/ai/client";
import type { ChatIntent, ChatResponse, ChatTurn } from "@/lib/ai/contracts/chat";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

interface Message extends ChatTurn {
  intent?: ChatIntent;
  /** model wall time of the routing call; null = keyword fallback */
  ms?: number | null;
  error?: boolean;
}

const INTENT_LABEL: Record<ChatIntent, TranslationKey> = {
  order: "ai.tabs.order",
  price: "ai.chat.intentPrice",
  tables: "ai.tabs.tables",
  kitchen: "ai.tabs.kitchen",
  table_stats: "ai.chat.intentTableStats",
  product_stats: "ai.chat.intentProductStats",
  other: "ai.chat.intentOther",
};

const EXAMPLES: TranslationKey[] = [
  "ai.chat.example1",
  "ai.chat.example2",
  "ai.chat.example3",
  "ai.chat.example4",
];

export function AiChat() {
  const t = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history: Message[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setBusy(true);
    try {
      const res = await aiFetch<ChatResponse>("/api/ai/chat", {
        // errors never go back to the model as context
        messages: history
          .filter((m) => !m.error)
          .map(({ role, content: c }) => ({ role, content: c })),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply, intent: res.intent, ms: res.ai?.ms ?? null },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `${t("ai.chat.error")} ${e instanceof Error ? e.message : ""}`.trim(),
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex h-full min-h-[28rem] flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">{t("ai.chat.empty")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((k) => (
                <Button key={k} variant="outline" size="sm" onClick={() => void send(t(k))}>
                  {t(k)}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex gap-2", m.role === "user" ? "flex-row-reverse" : "flex-row")}
          >
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              {m.role === "user" ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4 text-violet-600" />}
            </div>
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-line rounded-xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : m.error
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted",
              )}
            >
              {m.content}
              {m.intent && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{t(INTENT_LABEL[m.intent])}</Badge>
                  {m.ms === null ? t("ai.chat.keywords") : m.ms !== undefined && `${(m.ms / 1000).toFixed(1)} s`}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-muted-foreground">{t("ai.thinking")}</p>}
        <div ref={endRef} />
      </CardContent>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={2}
          placeholder={t("ai.chat.placeholder")}
          className="min-h-11 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" className="h-auto" disabled={busy || !draft.trim()} aria-label={t("ai.chat.send")}>
          <SendHorizontal className="h-5 w-5" />
        </Button>
      </form>
    </Card>
  );
}
