"use client";

// Assistente AI — order task: the preview of a read order, shared by the
// "Scrivi l'ordine" dialog (POS) and the playground tab (/assistente).
// Every amount on screen is re-derived with the POS pricing helpers
// (lib/ai/order/ticket.ts): the model never wrote any of them.

import { AlertTriangle, CircleHelp, Minus, Plus, ShieldAlert, Sparkles, Trash2, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/constants";
import type {
  CustomDishProposal,
  LineChoice,
  OrderParseResponse,
  PriceBreakdownRow,
} from "@/lib/ai/contracts/order";
import { draftUnitPrice, type DraftLine } from "@/lib/ai/order/ticket";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** "+ X" / "− X" by isRemoval — never by the sign of the price */
function ModifierList({ choice }: { choice: Pick<LineChoice, "modifiers" | "notes"> }) {
  if (choice.modifiers.length === 0 && choice.notes.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-xs text-muted-foreground">
      {choice.modifiers.map((m) => (
        <li key={`${m.ingredientId}:${m.isRemoval}`} className="flex justify-between gap-2">
          <span>
            {m.isRemoval ? "− " : "+ "}
            {m.name}
          </span>
          {!m.isRemoval && m.priceAdjustment > 0 && (
            <span className="tabular-nums">+{formatMoney(m.priceAdjustment)}</span>
          )}
        </li>
      ))}
      {choice.notes.map((n) => (
        <li key={`note:${n}`} className="italic">
          {n}
        </li>
      ))}
    </ul>
  );
}

function Stepper({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1" aria-label={t("ai.order.quantity", { name })}>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={t("ai.order.decrease")}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-6 text-center font-semibold tabular-nums">{value}</span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={t("ai.order.increase")}
        disabled={value >= 20}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Flags({ choice }: { choice: LineChoice }) {
  const t = useT();
  const noteOnly = choice.noteOnly.filter((n) => !choice.unknownIngredients.some((u) => n.endsWith(u)));
  return (
    <>
      {noteOnly.length > 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {t("ai.order.noteOnly", { names: noteOnly.join(", ") })}
        </p>
      )}
      {choice.unknownIngredients.length > 0 && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {t("ai.order.unknownIngredients", { names: choice.unknownIngredients.join(", ") })}
        </p>
      )}
    </>
  );
}

function MenuLineCard({
  d,
  onChange,
  onRemove,
}: {
  d: Extract<DraftLine, { kind: "menu" }>;
  onChange: (d: DraftLine) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const unit = draftUnitPrice(d);
  // the line's own pick first, then the other candidates
  const options = [d.line as LineChoice, ...d.line.alternatives];
  const low = d.line.confidence === "low";
  return (
    <li className={cn("rounded-lg border p-3", low && "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{d.choice.name}</div>
          {d.choice.ingredients && (
            <div className="text-xs leading-snug text-muted-foreground">{d.choice.ingredients}</div>
          )}
          <div className="text-xs text-muted-foreground">
            {d.choice.categoryName} · {t("ai.order.each", { amount: formatMoney(unit) })}
          </div>
          <ModifierList choice={d.choice} />
          <Flags choice={d.choice} />
          <p className="mt-1 text-xs italic text-muted-foreground/80">“{d.line.sourceText}”</p>
        </div>
        <Stepper name={d.choice.name} value={d.quantity} onChange={(q) => onChange({ ...d, quantity: q })} />
        <span className="w-16 pt-1 text-right font-medium tabular-nums">{formatMoney(unit * d.quantity)}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          aria-label={t("ai.order.remove", { name: d.choice.name })}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {low && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("ai.order.lowConfidence")}
          </p>
          {options.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t("ai.order.alternatives")}:</span>
              {options.map((o) => {
                const selected = o.menuItemId === d.choice.menuItemId;
                return (
                  <button
                    key={o.menuItemId}
                    type="button"
                    onClick={() => onChange({ ...d, choice: o })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs hover:bg-accent",
                      selected && "border-primary bg-primary/10 font-medium text-primary",
                    )}
                    title={o.ingredients ?? undefined}
                  >
                    {o.name} · {formatMoney(draftUnitPrice({ ...d, choice: o }))}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function breakdownLabel(t: TFn, row: PriceBreakdownRow): string {
  switch (row.kind) {
    case "base":
      return t("ai.order.custom.breakdown.base", { label: row.label });
    case "addition":
      return t("ai.order.custom.breakdown.addition", { label: row.label });
    case "removal":
      return t("ai.order.custom.breakdown.removal", {
        label: row.label,
        credit: formatMoney(row.credit ?? 0),
      });
    case "unknown":
      return t("ai.order.custom.breakdown.unknown", { label: row.label });
    default:
      return t("ai.order.custom.breakdown.total");
  }
}

/** Base + each addition/credit + total, then the similar dishes and the range */
export function PriceDetails({ proposal }: { proposal: CustomDishProposal }) {
  const t = useT();
  return (
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <ul className="flex flex-col gap-0.5">
        {proposal.breakdown.map((row, i) => (
          <li
            key={`${row.kind}:${row.label}:${i}`}
            className={cn(
              "flex justify-between gap-2",
              row.kind === "total" ? "border-t pt-1 font-semibold" : "text-muted-foreground",
              row.kind === "unknown" && "text-red-600 dark:text-red-400",
            )}
          >
            <span>{breakdownLabel(t, row)}</span>
            <span className="tabular-nums">
              {row.kind === "removal" ? "—" : formatMoney(row.amount)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{t("ai.order.custom.similar")}</span>
        {proposal.similar.map((s) => (
          <span key={s.menuItemId} className="flex justify-between gap-2 text-muted-foreground">
            <span>
              {s.name} ({formatMoney(s.basePrice)}) · {Math.round(s.overlap * 100)}%
            </span>
            <span className="tabular-nums">
              {t("ai.order.custom.asVariationOf", { price: formatMoney(s.price) })}
            </span>
          </span>
        ))}
        <span className="mt-1 font-medium">
          {t("ai.order.custom.range", {
            min: formatMoney(proposal.range.min),
            max: formatMoney(proposal.range.max),
          })}
        </span>
      </div>
    </div>
  );
}

function CustomDishCard({
  d,
  canEditPrice,
  onChange,
  onRemove,
}: {
  d: Extract<DraftLine, { kind: "custom" }>;
  canEditPrice: boolean;
  onChange: (d: DraftLine) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const p = d.proposal;
  const unit = draftUnitPrice(d);
  const variationPrice = draftUnitPrice({ ...d, mode: "variation" });
  return (
    <li className="rounded-lg border border-violet-300 p-3 dark:border-violet-800">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {p.name}
            <Badge variant="outline" className="border-violet-400 text-violet-700 dark:text-violet-300">
              {t("ai.order.custom.badge")}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
            {p.ingredients.map((i) => (
              <span
                key={`${i.ingredientId ?? i.name}`}
                className={cn(
                  "rounded bg-muted px-1.5 py-0.5",
                  !i.ingredientId && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                  i.implied && "text-muted-foreground",
                )}
              >
                {i.name}
                {i.implied && ` (${t("ai.order.custom.implied")})`}
                {!i.ingredientId && ` — ${t("ai.order.custom.notInPantry")}`}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("ai.order.custom.overlap", { pct: Math.round(p.overlap * 100), base: p.base.name })}
          </p>
        </div>
        <Stepper name={p.name} value={d.quantity} onChange={(q) => onChange({ ...d, quantity: q })} />
        <span className="w-16 pt-1 text-right font-medium tabular-nums">{formatMoney(unit * d.quantity)}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          aria-label={t("ai.order.remove", { name: p.name })}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-2 flex flex-col gap-1.5 text-sm">
        {p.base.allowsVariations ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              checked={d.mode === "variation"}
              onChange={() => onChange({ ...d, mode: "variation" })}
            />
            <span>
              {t("ai.order.custom.asVariation", { base: p.base.name, price: formatMoney(variationPrice) })}
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("ai.order.custom.noVariations", { base: p.base.name })}
          </p>
        )}
        <label className="flex cursor-pointer flex-wrap items-center gap-2">
          <input
            type="radio"
            checked={d.mode === "custom"}
            onChange={() => onChange({ ...d, mode: "custom" })}
          />
          <span>{t("ai.order.custom.asCustom", { price: formatMoney(d.price) })}</span>
          {d.mode === "custom" && (
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              className="h-8 w-24"
              aria-label={t("ai.order.custom.price")}
              title={canEditPrice ? undefined : t("ai.order.custom.priceLocked")}
              disabled={!canEditPrice}
              value={Number.isFinite(d.price) ? d.price : 0}
              onChange={(e) => {
                const v = Number(e.target.value.replace(",", "."));
                onChange({ ...d, price: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
            />
          )}
        </label>
        {d.mode === "variation" && <ModifierList choice={{ modifiers: p.modifiers, notes: [] }} />}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">{t("ai.order.custom.similar")}</summary>
        <div className="mt-2">
          <PriceDetails proposal={p} />
        </div>
      </details>
    </li>
  );
}

/** What the model said back, and the status rules the app enforces */
export function ParseStatus({ result }: { result: OrderParseResponse }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      {result.status === "staff" && (
        <p className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t("ai.order.status.staff")}
        </p>
      )}
      {result.status === "refuse" && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          {t("ai.order.status.refuse")}
        </p>
      )}
      {result.status === "clarify" && (
        <p className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">{t("ai.order.status.clarify")}</span>
            {result.clarification && <>: {result.clarification}</>}
          </span>
        </p>
      )}
      {result.reply && result.status !== "clarify" && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <span>
            <span className="font-medium">{t("ai.aiNote")}:</span> {result.reply}
          </span>
        </p>
      )}
      {result.extractedBy === "rules" && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("ai.unavailable")} {t("ai.order.rulesFallback")}
        </p>
      )}
      {result.ai && (
        <p className="text-xs text-muted-foreground/70">
          {t("ai.order.readByAi", { model: result.ai.model, s: Math.round(result.ai.ms / 100) / 10 })}
        </p>
      )}
    </div>
  );
}

export function OrderPreview({
  result,
  draft,
  onChange,
  canEditPrice,
}: {
  result: OrderParseResponse;
  draft: DraftLine[];
  onChange: (draft: DraftLine[]) => void;
  canEditPrice: boolean;
}) {
  const t = useT();
  const update = (key: string, next: DraftLine) =>
    onChange(draft.map((d) => (d.key === key ? next : d)));
  const remove = (key: string) => onChange(draft.filter((d) => d.key !== key));
  const total = draft.reduce((s, d) => s + Math.round(draftUnitPrice(d) * 100) * d.quantity, 0) / 100;

  return (
    <div className="flex flex-col gap-3">
      <ParseStatus result={result} />
      {draft.length === 0 && result.unresolved.length === 0 && (
        <p className="py-2 text-center text-sm text-muted-foreground">{t("ai.order.empty")}</p>
      )}
      {draft.length > 0 && (
        <ul className="flex flex-col gap-2">
          {draft.map((d) =>
            d.kind === "menu" ? (
              <MenuLineCard key={d.key} d={d} onChange={(n) => update(d.key, n)} onRemove={() => remove(d.key)} />
            ) : (
              <CustomDishCard
                key={d.key}
                d={d}
                canEditPrice={canEditPrice}
                onChange={(n) => update(d.key, n)}
                onRemove={() => remove(d.key)}
              />
            ),
          )}
        </ul>
      )}
      {result.unresolved.length > 0 && (
        <div className="rounded-md border border-dashed p-2 text-sm">
          <p className="font-medium">{t("ai.order.unresolved.title")}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {result.unresolved.map((u, i) => (
              <li key={`${u.text}:${i}`}>
                “{u.text}” — {t(`ai.order.unresolved.${u.reason}`)}
                {u.categoryName && u.reason === "too_vague" && ` (${u.categoryName})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft.length > 0 && (
        <div className="flex justify-between border-t pt-2 text-sm font-semibold">
          <span>{t("ai.order.total")}</span>
          <span className="tabular-nums">{formatMoney(total)}</span>
        </div>
      )}
    </div>
  );
}
