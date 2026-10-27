"use client";

// Assistente AI — the chat tab: saved conversations on the left (title and
// time, newest first, like a normal chat app), the open one on the right.
// The server picks the task, answers from the task's own computed data and
// stores both messages (/api/ai/chat); the model names a new chat a few
// seconds after its first answer, and the list follows that in realtime.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, Check, MessageSquarePlus, Pencil, SendHorizontal, Trash2, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { aiFetch } from "@/lib/ai/client";
import type {
  ChatIntent,
  ChatResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummary,
  SavedMessage,
} from "@/lib/ai/contracts/chat";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useLangStore } from "@/lib/i18n/store";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

/** A message on screen: saved, or the user's own while the answer is coming */
interface Shown extends Omit<SavedMessage, "id"> {
  id: string;
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

// the chat open when the user last left the page, per user and device
const lastKey = (userId: string) => `rms-ai-chat:${userId}`;
function readLast(userId: string): string | null {
  try {
    return localStorage.getItem(lastKey(userId));
  } catch {
    return null;
  }
}
function writeLast(userId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(lastKey(userId), id);
    else localStorage.removeItem(lastKey(userId));
  } catch {
    // private window / blocked storage: the list still has every chat
  }
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

type Group = "today" | "yesterday" | "lastWeek" | "older";
function groupOf(iso: string, now: Date): Group {
  const diff = startOfDay(now) - startOfDay(new Date(iso));
  if (diff <= 0) return "today";
  if (diff <= DAY) return "yesterday";
  if (diff <= 7 * DAY) return "lastWeek";
  return "older";
}

export function AiChat() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [chats, setChats] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // the chat on screen, for answers that arrive after the user moved on
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const locale = lang === "it" ? "it-IT" : "en-US";
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const whenOf = (iso: string) => {
    const g = groupOf(iso, new Date());
    if (g === "today") return timeOf(iso);
    if (g === "yesterday") return `${t("ai.chat.yesterday")} ${timeOf(iso)}`;
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
  };

  const loadList = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await aiFetch<ConversationListResponse>(
        `/api/ai/conversations?userId=${encodeURIComponent(userId)}`,
      );
      setChats(r.conversations);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("ai.chat.loadFailed"));
    }
  }, [userId, t]);

  const open = useCallback(
    async (id: string | null) => {
      setActiveId(id);
      setEditing(null);
      if (userId) writeLast(userId, id);
      if (!id || !userId) {
        setMessages([]);
        return;
      }
      try {
        const r = await aiFetch<ConversationDetailResponse>(
          `/api/ai/conversations/${id}?userId=${encodeURIComponent(userId)}`,
        );
        if (activeRef.current === id) setMessages(r.messages);
      } catch {
        // deleted on another device: start a new one instead
        if (activeRef.current === id) {
          setActiveId(null);
          setMessages([]);
          writeLast(userId, null);
        }
      }
    },
    [userId],
  );

  // first load: the list, and the chat that was open last time
  useEffect(() => {
    if (!userId) return;
    void loadList();
    const last = readLast(userId);
    if (last) void open(last);
  }, [userId, loadList, open]);

  // a title written by the model, or a chat from another device
  useRealtimeRefresh("ai-conversations", ["ai_conversations"], loadList, !!userId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || !userId) return;
    const sentFrom = activeId;
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: `pending-${now}`, role: "user", content, intent: null, modelMs: null, createdAt: now },
    ]);
    setDraft("");
    setBusy(true);
    try {
      const res = await aiFetch<ChatResponse>("/api/ai/chat", {
        userId,
        message: content,
        ...(sentFrom ? { conversationId: sentFrom } : {}),
      });
      const conv = res.conversation!;
      if (activeRef.current === sentFrom) {
        setActiveId(conv.id);
        writeLast(userId, conv.id);
        setMessages((prev) => [...prev.filter((m) => !m.id.startsWith("pending-")), ...res.messages!]);
      }
      setChats((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
    } catch (e) {
      if (activeRef.current === sentFrom) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `${t("ai.chat.error")} ${e instanceof Error ? e.message : ""}`.trim(),
            intent: null,
            modelMs: null,
            createdAt: new Date().toISOString(),
            error: true,
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string, title: string) {
    const clean = title.replace(/\s+/g, " ").trim();
    setEditing(null);
    if (!clean || !userId) return;
    try {
      const c = await aiFetch<ConversationSummary>(`/api/ai/conversations/${id}`, { userId, title: clean }, "PATCH");
      setChats((prev) => prev.map((x) => (x.id === id ? c : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    }
  }

  async function remove(chat: ConversationSummary) {
    if (!userId || !window.confirm(t("ai.chat.confirmDelete", { title: chat.title }))) return;
    try {
      await aiFetch(`/api/ai/conversations/${chat.id}?userId=${encodeURIComponent(userId)}`, undefined, "DELETE");
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      if (activeId === chat.id) void open(null);
      toast.success(t("ai.chat.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    }
  }

  const now = new Date();
  const groups: { key: Group; items: ConversationSummary[] }[] = (
    ["today", "yesterday", "lastWeek", "older"] as Group[]
  )
    .map((key) => ({ key, items: chats.filter((c) => groupOf(c.updatedAt, now) === key) }))
    .filter((g) => g.items.length > 0);

  return (
    <Card className="flex h-[calc(100dvh-12rem)] min-h-[28rem] overflow-hidden">
      {/* saved chats */}
      <aside className="flex w-64 shrink-0 flex-col border-r">
        <div className="border-b p-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            disabled={busy}
            onClick={() => void open(null)}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t("ai.chat.newChat")}
          </Button>
        </div>
        <nav aria-label={t("ai.chat.history")} className="flex-1 overflow-y-auto p-2">
          {loadError && <p className="px-2 py-1 text-xs text-destructive">{loadError}</p>}
          {!loadError && chats.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("ai.chat.noChats")}</p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-3">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {t(`ai.chat.${g.key}`)}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((c) => (
                  <li key={c.id} className="group relative">
                    {editing?.id === c.id ? (
                      <form
                        className="flex items-center gap-1 px-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void rename(c.id, editing.title);
                        }}
                      >
                        <Input
                          autoFocus
                          value={editing.title}
                          maxLength={80}
                          onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                          onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                          className="h-8 text-sm"
                        />
                        <Button type="submit" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t("common.save")}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t("common.cancel")} onClick={() => setEditing(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void open(c.id)}
                          className={cn(
                            "flex w-full flex-col rounded-md px-2 py-1.5 pr-14 text-left transition-colors",
                            c.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                          )}
                        >
                          <span className={cn("truncate text-sm", !c.titled && "italic text-muted-foreground")}>
                            {c.title}
                          </span>
                          <span className="text-xs text-muted-foreground">{whenOf(c.updatedAt)}</span>
                        </button>
                        <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-0.5 group-focus-within:flex group-hover:flex">
                          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("ai.chat.rename")} onClick={() => setEditing({ id: c.id, title: c.title })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={t("ai.chat.delete")} onClick={() => void remove(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* the open chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.length === 0 && !busy && (
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
          {messages.map((m) => (
            <div key={m.id} className={cn("flex gap-2", m.role === "user" ? "flex-row-reverse" : "flex-row")}>
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
                <div
                  className={cn(
                    "mt-1.5 flex items-center gap-2 text-xs",
                    m.role === "user" ? "justify-end text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {m.intent && <Badge variant="outline">{t(INTENT_LABEL[m.intent])}</Badge>}
                  {m.role === "assistant" && m.intent && m.modelMs === null && t("ai.chat.keywords")}
                  <span>{timeOf(m.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
          {busy && <p className="text-sm text-muted-foreground">{t("ai.thinking")}</p>}
          <div ref={endRef} />
        </div>
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
      </section>
    </Card>
  );
}
