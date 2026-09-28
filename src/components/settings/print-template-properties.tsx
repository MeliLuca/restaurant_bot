"use client";

// Right-hand side of the template editor: the selected block's content,
// formatting and visibility, or the template's own settings when nothing is
// selected. Every change goes straight to the editor state (live preview).

import { useRef } from "react";
import { AlignCenter, AlignLeft, AlignRight, Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PrintTemplateKind } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import type {
  Align,
  BlockStyle,
  BlockVisibility,
  ContoVariant,
  Magnify,
  PrintTemplate,
  TemplateBlock,
} from "@/lib/printing/template";
import { placeholdersFor } from "@/lib/printing/template";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  vertical,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  /** Stack the options — for labels too long to sit side by side */
  vertical?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("rounded-md border p-0.5", vertical ? "flex flex-col" : "inline-flex")}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-9 min-w-9 items-center rounded px-2.5 text-sm transition-colors",
            vertical ? "justify-start" : "justify-center",
            o.value === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "h-9 rounded-md border px-3 text-sm transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="inline-flex items-center rounded-md border">
        <button
          type="button"
          aria-label={`${label} −`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-8 text-center text-sm tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`${label} +`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

const MAGNIFY: Magnify[] = [1, 2, 3, 4];
const textareaClass =
  "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

// ---------------------------------------------------------------------------
// Placeholder insertion
// ---------------------------------------------------------------------------

function PlaceholderPicker({
  kind,
  onInsert,
}: {
  kind: PrintTemplateKind;
  onInsert: (token: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{t("printTemplates.insertField")}</span>
      <div className="flex flex-wrap gap-1.5">
        {placeholdersFor(kind).map((p) => (
          <button
            key={p.key}
            type="button"
            // keep focus (and the caret) in the text field being edited
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(`{${p.key}}`)}
            className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs hover:bg-accent"
            title={`{${p.key}}`}
          >
            {t(`printTemplates.ph.${p.key}` as TranslationKey)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("printTemplates.optionalHint")}</p>
    </div>
  );
}

/** Insert text at the caret of an input, returning the new value */
function insertAtCaret(el: HTMLInputElement | null, value: string, token: string): string {
  if (!el) return value + token;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function FormattingSection({
  block,
  onStyle,
}: {
  block: TemplateBlock;
  onStyle: (patch: Partial<BlockStyle>) => void;
}) {
  const t = useT();
  const s = block.style;
  const showAlign = block.type === "text" || block.type === "row";
  const showSize = block.type !== "space";

  return (
    <Section title={t("printTemplates.formatting")}>
      {showAlign && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t("printTemplates.align")}</span>
          <Segmented<Align>
            ariaLabel={t("printTemplates.align")}
            value={s.align}
            onChange={(align) => onStyle({ align })}
            options={[
              { value: "left", label: <AlignLeft className="h-4 w-4" />, title: t("printTemplates.alignLeft") },
              { value: "center", label: <AlignCenter className="h-4 w-4" />, title: t("printTemplates.alignCenter") },
              { value: "right", label: <AlignRight className="h-4 w-4" />, title: t("printTemplates.alignRight") },
            ]}
          />
        </div>
      )}
      {showSize && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("printTemplates.font")}</span>
            <Segmented
              ariaLabel={t("printTemplates.font")}
              value={s.font}
              onChange={(font) => onStyle({ font })}
              options={[
                { value: "A", label: t("printTemplates.fontA") },
                { value: "B", label: t("printTemplates.fontB") },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("printTemplates.width")}</span>
            <Segmented
              ariaLabel={t("printTemplates.width")}
              value={s.width}
              onChange={(width) => onStyle({ width })}
              options={MAGNIFY.map((m) => ({ value: m, label: `${m}×` }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("printTemplates.height")}</span>
            <Segmented
              ariaLabel={t("printTemplates.height")}
              value={s.height}
              onChange={(height) => onStyle({ height })}
              options={MAGNIFY.map((m) => ({ value: m, label: `${m}×` }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Toggle checked={s.bold} onChange={(bold) => onStyle({ bold })} className="font-bold">
              {t("printTemplates.bold")}
            </Toggle>
            <Toggle checked={s.underline} onChange={(underline) => onStyle({ underline })} className="underline">
              {t("printTemplates.underline")}
            </Toggle>
            <Toggle checked={s.invert} onChange={(invert) => onStyle({ invert })}>
              {t("printTemplates.invert")}
            </Toggle>
          </div>
          <p className="text-xs text-muted-foreground">{t("printTemplates.fontNote")}</p>
        </>
      )}
      <Stepper
        label={t("printTemplates.spaceBefore")}
        value={s.spaceBefore}
        min={0}
        max={10}
        onChange={(spaceBefore) => onStyle({ spaceBefore })}
      />
      <Stepper
        label={t("printTemplates.spaceAfter")}
        value={s.spaceAfter}
        min={0}
        max={10}
        onChange={(spaceAfter) => onStyle({ spaceAfter })}
      />
    </Section>
  );
}

const VARIANTS: { value: ContoVariant; key: TranslationKey }[] = [
  { value: "CONTO", key: "printTemplates.variantConto" },
  { value: "PRECONTO", key: "printTemplates.variantPreconto" },
  { value: "PARZIALE", key: "printTemplates.variantParziale" },
];

function VisibilitySection({
  kind,
  visibility,
  onChange,
}: {
  kind: PrintTemplateKind;
  visibility: BlockVisibility;
  onChange: (v: BlockVisibility) => void;
}) {
  const t = useT();
  const variants = visibility.variants ?? VARIANTS.map((v) => v.value);

  function toggleVariant(variant: ContoVariant, on: boolean) {
    const next = on ? [...variants, variant] : variants.filter((v) => v !== variant);
    // keep at least one: a block printed on no receipt at all is just "hidden"
    if (next.length === 0) return;
    onChange({
      ...visibility,
      variants: next.length === VARIANTS.length ? undefined : next,
    });
  }

  return (
    <Section title={t("printTemplates.visibility")}>
      {kind === "CONTO" && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("printTemplates.variantsLabel")}</span>
          <div className="flex flex-wrap gap-x-4">
            {VARIANTS.map((v) => (
              <Check
                key={v.value}
                label={t(v.key)}
                checked={variants.includes(v.value)}
                onChange={(on) => toggleVariant(v.value, on)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{t("printTemplates.serviceLabel")}</span>
        <Segmented
          vertical
          ariaLabel={t("printTemplates.serviceLabel")}
          value={visibility.service ?? "all"}
          onChange={(v) =>
            onChange({ ...visibility, service: v === "all" ? undefined : v })
          }
          options={[
            { value: "all", label: t("printTemplates.serviceAll") },
            { value: "table", label: t("printTemplates.serviceTable") },
            { value: "takeaway", label: t("printTemplates.serviceTakeaway") },
          ]}
        />
      </div>
    </Section>
  );
}

function ContentSection({
  block,
  kind,
  onChange,
}: {
  block: TemplateBlock;
  kind: PrintTemplateKind;
  onChange: (patch: Partial<TemplateBlock>) => void;
}) {
  const t = useT();
  const leftRef = useRef<HTMLInputElement>(null);
  const rightRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<"left" | "right">("left");

  switch (block.type) {
    case "text":
      return (
        <Section title={t(`printTemplates.type.${block.type}`)}>
          <div className="grid gap-1.5">
            <Label htmlFor="blk-label">{t("printTemplates.label")}</Label>
            <Input
              id="blk-label"
              className="h-10"
              value={block.label}
              onChange={(e) => onChange({ label: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">{t("printTemplates.labelHint")}</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="blk-text">{t("printTemplates.text")}</Label>
            <textarea
              id="blk-text"
              className={textareaClass}
              value={block.text}
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </div>
        </Section>
      );
    case "row":
      return (
        <Section title={t(`printTemplates.type.${block.type}`)}>
          <div className="grid gap-1.5">
            <Label htmlFor="blk-left">{t("printTemplates.left")}</Label>
            <Input
              id="blk-left"
              ref={leftRef}
              className="h-10 font-mono"
              value={block.left}
              onFocus={() => (lastFocused.current = "left")}
              onChange={(e) => onChange({ left: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="blk-right">{t("printTemplates.right")}</Label>
            <Input
              id="blk-right"
              ref={rightRef}
              className="h-10 font-mono"
              value={block.right}
              onFocus={() => (lastFocused.current = "right")}
              onChange={(e) => onChange({ right: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">{t("printTemplates.rightHint")}</span>
          </div>
          <PlaceholderPicker
            kind={kind}
            onInsert={(token) =>
              lastFocused.current === "right"
                ? onChange({ right: insertAtCaret(rightRef.current, block.right, token) })
                : onChange({ left: insertAtCaret(leftRef.current, block.left, token) })
            }
          />
        </Section>
      );
    case "separator":
      return (
        <Section title={t(`printTemplates.type.${block.type}`)}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("printTemplates.char")}</span>
            <Segmented
              ariaLabel={t("printTemplates.char")}
              value={block.char}
              onChange={(char) => onChange({ char })}
              options={["-", "=", "*", ".", "_", "~", " "].map((c) => ({
                value: c,
                label: <span className="font-mono">{c === " " ? "␣" : c}</span>,
              }))}
            />
          </div>
        </Section>
      );
    case "space":
      return (
        <Section title={t(`printTemplates.type.${block.type}`)}>
          <Stepper
            label={t("printTemplates.lines")}
            value={block.lines}
            min={1}
            max={10}
            onChange={(lines) => onChange({ lines })}
          />
        </Section>
      );
    case "items":
      return (
        <Section title={t(`printTemplates.type.${block.type}`)}>
          <Check
            label={t("printTemplates.itemsUppercase")}
            checked={block.uppercase}
            onChange={(uppercase) => onChange({ uppercase })}
          />
          {kind === "CONTO" && (
            <>
              <Check
                label={t("printTemplates.itemsPrices")}
                checked={block.showPrices}
                onChange={(showPrices) => onChange({ showPrices })}
              />
              <Check
                label={t("printTemplates.itemsHeader")}
                checked={block.columnHeader}
                onChange={(columnHeader) => onChange({ columnHeader })}
              />
            </>
          )}
          <span className="pt-1 text-xs text-muted-foreground">{t("printTemplates.modifiers")}</span>
          <div className="flex flex-wrap gap-2">
            <Toggle checked={block.modifierBold} onChange={(modifierBold) => onChange({ modifierBold })}>
              {t("printTemplates.modBold")}
            </Toggle>
            <Toggle
              checked={block.modifierAsterisks}
              onChange={(modifierAsterisks) => onChange({ modifierAsterisks })}
            >
              {t("printTemplates.modAsterisks")}
            </Toggle>
            <Toggle
              checked={block.modifierUppercase}
              onChange={(modifierUppercase) => onChange({ modifierUppercase })}
            >
              {t("printTemplates.modUppercase")}
            </Toggle>
          </div>
          <Stepper
            label={t("printTemplates.modIndent")}
            value={block.modifierIndent}
            min={0}
            max={12}
            onChange={(modifierIndent) => onChange({ modifierIndent })}
          />
          <Stepper
            label={t("printTemplates.gapLines")}
            value={block.gapLines}
            min={0}
            max={5}
            onChange={(gapLines) => onChange({ gapLines })}
          />
          <p className="text-xs text-muted-foreground">{t("printTemplates.itemsStyleHint")}</p>
        </Section>
      );
    case "totals":
      return (
        <Section title={t(`printTemplates.type.${block.type}`)}>
          <Check
            label={t("printTemplates.totSubtotal")}
            checked={block.showSubtotal}
            onChange={(showSubtotal) => onChange({ showSubtotal })}
          />
          <Check
            label={t("printTemplates.totTax")}
            checked={block.showTax}
            onChange={(showTax) => onChange({ showTax })}
          />
          <Check
            label={t("printTemplates.totTotal")}
            checked={block.showTotal}
            onChange={(showTotal) => onChange({ showTotal })}
          />
          {block.showTotal && (
            <>
              <span className="pt-1 text-xs text-muted-foreground">{t("printTemplates.totalSize")}</span>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{t("printTemplates.width")}</span>
                <Segmented
                  value={block.totalWidth}
                  onChange={(totalWidth) => onChange({ totalWidth })}
                  options={MAGNIFY.map((m) => ({ value: m, label: `${m}×` }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{t("printTemplates.height")}</span>
                <Segmented
                  value={block.totalHeight}
                  onChange={(totalHeight) => onChange({ totalHeight })}
                  options={MAGNIFY.map((m) => ({ value: m, label: `${m}×` }))}
                />
              </div>
              <Check
                label={t("printTemplates.bold")}
                checked={block.totalBold}
                onChange={(totalBold) => onChange({ totalBold })}
              />
            </>
          )}
        </Section>
      );
  }
}

export function BlockProperties({
  block,
  kind,
  onChange,
}: {
  block: TemplateBlock;
  kind: PrintTemplateKind;
  onChange: (patch: Partial<TemplateBlock>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* key: reset the caret refs when another block is selected */}
      <ContentSection key={block.id} block={block} kind={kind} onChange={onChange} />
      <FormattingSection
        block={block}
        onStyle={(patch) => onChange({ style: { ...block.style, ...patch } })}
      />
      <VisibilitySection
        kind={kind}
        visibility={block.visibility}
        onChange={(visibility) => onChange({ visibility })}
      />
    </div>
  );
}

export function TemplateSettings({
  template,
  onChange,
}: {
  template: PrintTemplate;
  onChange: (patch: Partial<PrintTemplate>) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("printTemplates.selectBlockHint")}</p>
      <Section title={t("printTemplates.templateSettings")}>
        <Stepper
          label={t("printTemplates.feedLines")}
          value={template.feedLines}
          min={0}
          max={10}
          onChange={(feedLines) => onChange({ feedLines })}
        />
        <Check
          label={t("printTemplates.cut")}
          checked={template.cut}
          onChange={(cut) => onChange({ cut })}
        />
      </Section>
    </div>
  );
}
