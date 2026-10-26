"use client";

// Assistente AI — order task: textarea → /api/ai/order/parse → preview.
// The dialog on the till passes `onAdd`; the playground on /assistente does
// not, so it only reads and prices.

import { useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aiFetch } from "@/lib/ai/client";
import type { OrderParseResponse } from "@/lib/ai/contracts/order";
import { draftFromResponse, type DraftLine } from "@/lib/ai/order/ticket";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";
import { OrderPreview } from "./order-preview";

export function OrderComposer({
  onAdd,
  autoFocus,
}: {
  /** resolves when the lines are on the ticket; omitted = playground */
  onAdd?: (draft: DraftLine[]) => Promise<void>;
  autoFocus?: boolean;
}) {
  const t = useT();
  const canEditPrice = usePermission("override_price");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<OrderParseResponse | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function read() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await aiFetch<OrderParseResponse>("/api/ai/order/parse", { text: trimmed });
      setResult(res);
      setDraft(draftFromResponse(res));
    } catch (e) {
      setResult(null);
      setDraft([]);
      setError(e instanceof Error ? e.message : t("ai.order.error"));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!onAdd || draft.length === 0) return;
    setAdding(true);
    try {
      await onAdd(draft);
      setText("");
      setResult(null);
      setDraft([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.order.addFailed"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void read();
          }
        }}
        rows={3}
        maxLength={1000}
        placeholder={t("ai.order.placeholder")}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("ai.order.keysHint")}</span>
        <Button onClick={() => void read()} disabled={busy || !text.trim()}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {busy ? t("ai.thinking") : t("ai.order.read")}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <OrderPreview
          result={result}
          draft={draft}
          onChange={setDraft}
          canEditPrice={canEditPrice}
        />
      )}

      {onAdd && result && (
        <Button
          size="lg"
          className="h-12"
          disabled={adding || draft.length === 0}
          onClick={() => void add()}
        >
          {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          {t("ai.order.add")}
        </Button>
      )}
    </div>
  );
}
