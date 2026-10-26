"use client";

// Assistente AI — the order task on /assistente: a playground of "Scrivi
// l'ordine" (same reading and preview, nothing goes on a bill) and the
// off-menu price box.

import { useState } from "react";
import { Calculator, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiFetch, AiRequestError } from "@/lib/ai/client";
import type { OrderPriceResponse } from "@/lib/ai/contracts/order";
import type { AiSettings } from "@/lib/database.types";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { OrderComposer } from "./order-composer";
import { PriceDetails } from "./order-preview";

function PriceBox({ settings }: { settings: AiSettings }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OrderPriceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function calc() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await aiFetch<OrderPriceResponse>("/api/ai/order/price", { text: trimmed }));
    } catch (e) {
      setResult(null);
      setError(
        e instanceof AiRequestError && e.status === 404
          ? t("ai.order.priceBox.notFound")
          : e instanceof Error
            ? e.message
            : t("ai.order.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <Calculator className="h-4 w-4 text-violet-600" />
          {t("ai.order.priceBox.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("ai.order.priceBox.description")}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void calc();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder={t("ai.order.priceBox.placeholder")}
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("ai.order.priceBox.calc")}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{result.name}</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(result.price)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("ai.order.custom.overlap", {
              pct: Math.round(result.overlap * 100),
              base: result.base.name,
            })}{" "}
            ·{" "}
            {result.mode === "variation"
              ? t("ai.order.custom.asVariation", {
                  base: result.base.name,
                  price: formatMoney(result.price),
                })
              : t("ai.order.custom.asCustom", { price: formatMoney(result.price) })}{" "}
            (≥ {Math.round(settings.custom_dish_min_overlap * 100)}%)
          </p>
          <PriceDetails proposal={result} />
        </div>
      )}
    </section>
  );
}

export function OrderTab({ settings }: { settings: AiSettings }) {
  const t = useT();
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[3fr_2fr]">
      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-violet-600" />
            {t("ai.order.title")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("ai.order.playground")}</p>
        </div>
        <OrderComposer />
      </section>
      <PriceBox settings={settings} />
    </div>
  );
}
