"use client";

// "Testi di stampa" (modo 2): edit only the static text blocks of a saved
// template, next to the same live preview the template editor uses. No block
// can be added, moved or restyled here — the save route enforces it too.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LayoutTemplate, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReceiptPreview } from "@/components/printing/receipt-preview";
import type {
  Printer,
  PrintTemplateRow,
  RestaurantSettings,
} from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { layoutTicket } from "@/lib/printing/layout";
import { sampleTicket } from "@/lib/printing/sample";
import type { ContoVariant, TextBlock } from "@/lib/printing/template";
import { templateFromRow } from "@/lib/printing/template";
import { savePrintTexts } from "@/lib/settings-api";
import { cn } from "@/lib/utils";

const textareaClass =
  "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

const VARIANTS: { value: ContoVariant; key: TranslationKey }[] = [
  { value: "CONTO", key: "printTemplates.variantConto" },
  { value: "PRECONTO", key: "printTemplates.variantPreconto" },
  { value: "PARZIALE", key: "printTemplates.variantParziale" },
];

/** The printers a template is assigned to, for the "used by" line */
function usersOf(row: PrintTemplateRow, printers: Printer[]): Printer[] {
  return printers.filter((p) =>
    row.kind === "COMANDA"
      ? p.comanda_template_id === row.id
      : p.printer_type === "CASSA" && p.conto_template_id === row.id,
  );
}

export function PrintTextsEditor({
  templates,
  printers,
  company,
  canManageTemplates,
  onSaved,
}: {
  templates: PrintTemplateRow[];
  printers: Printer[];
  company: RestaurantSettings;
  canManageTemplates: boolean;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  // open on a template that is actually printing, if there is one
  const [selectedId, setSelectedId] = useState<string>(
    () => (templates.find((r) => usersOf(r, printers).length > 0) ?? templates[0])?.id ?? "",
  );
  const row = templates.find((r) => r.id === selectedId) ?? null;
  const template = useMemo(() => (row ? templateFromRow(row) : null), [row]);
  const textBlocks = useMemo(
    () => (template?.blocks.filter((b): b is TextBlock => b.type === "text") ?? []),
    [template],
  );

  const [texts, setTexts] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [variant, setVariant] = useState<ContoVariant>("CONTO");
  const [saving, setSaving] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // reset the draft whenever another template (or a fresh copy of it) loads
  useEffect(() => {
    setTexts(Object.fromEntries(textBlocks.map((b) => [b.id, b.text])));
    setFocusedId(null);
  }, [textBlocks]);

  const changed = textBlocks.filter((b) => (texts[b.id] ?? b.text) !== b.text);
  const dirty = changed.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const doc = useMemo(() => {
    if (!template) return null;
    const draft = {
      ...template,
      blocks: template.blocks.map((b) =>
        b.type === "text" && b.id in texts ? { ...b, text: texts[b.id] } : b,
      ),
    };
    const ticket = sampleTicket({
      kind: template.kind === "CONTO" ? "CASSA" : "CUCINA",
      company,
      variant,
    });
    return layoutTicket(draft, ticket, company, template.paperSize);
  }, [template, texts, company, variant]);

  function switchTemplate(id: string) {
    if (dirty && !window.confirm(t("printTexts.unsavedConfirm"))) return;
    setSelectedId(id);
  }

  async function save() {
    if (!row || !dirty) return;
    setSaving(true);
    try {
      await savePrintTexts(
        row.id,
        Object.fromEntries(changed.map((b) => [b.id, texts[b.id]])),
      );
      await onSaved(); // reload: the saved row becomes the new baseline
      toast.success(t("printTexts.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-6 text-sm text-muted-foreground">
          {canManageTemplates ? t("printTexts.noTemplatesManager") : t("printTexts.noTemplates")}
          {canManageTemplates && (
            <Button asChild variant="outline">
              <Link href="/settings/print-templates">
                <LayoutTemplate className="h-4 w-4" /> {t("printTexts.openTemplates")}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const users = row ? usersOf(row, printers) : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("printTexts.intro")}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Card>
          <CardContent className="flex flex-col gap-5 p-5">
            <div className="grid gap-2">
              <Label>{t("printTexts.template")}</Label>
              <Select value={selectedId} onValueChange={switchTemplate}>
                <SelectTrigger className="h-12 w-full min-w-0 [&>span]:truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ·{" "}
                      {r.kind === "COMANDA"
                        ? t("printTemplates.kindComanda")
                        : t("printTemplates.kindConto")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {users.length > 0
                  ? t("printTexts.usedBy", { names: users.map((p) => p.name).join(", ") })
                  : t("printTexts.unused")}
              </span>
            </div>

            {textBlocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("printTexts.noTextBlocks")}</p>
            ) : (
              textBlocks.map((b, i) => (
                <div key={b.id} className="grid gap-2">
                  <Label htmlFor={`txt-${b.id}`} className="flex items-center gap-2">
                    {b.label || t("printTexts.untitled", { n: i + 1 })}
                    {b.hidden && (
                      <Badge variant="outline" className="font-normal">
                        {t("printTemplates.hiddenBadge")}
                      </Badge>
                    )}
                  </Label>
                  <textarea
                    id={`txt-${b.id}`}
                    ref={(el) => {
                      fieldRefs.current[b.id] = el;
                    }}
                    className={cn(textareaClass, focusedId === b.id && "ring-1 ring-ring")}
                    value={texts[b.id] ?? b.text}
                    maxLength={1000}
                    onFocus={() => setFocusedId(b.id)}
                    onChange={(e) => setTexts((cur) => ({ ...cur, [b.id]: e.target.value }))}
                  />
                </div>
              ))
            )}

            <div className="flex items-center justify-end gap-3">
              {dirty && (
                <span className="text-sm text-amber-700 dark:text-amber-400">
                  {t("printTexts.unsaved")}
                </span>
              )}
              <Button className="h-12 px-6" onClick={save} disabled={!dirty || saving}>
                <Save className="h-4 w-4" />
                {saving ? t("printTexts.saving") : t("printTexts.save")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {doc && template && (
          <div className="flex flex-col items-center gap-3 lg:sticky lg:top-4 lg:self-start">
            {template.kind === "CONTO" && (
              <div className="inline-flex rounded-full border p-0.5">
                {VARIANTS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    aria-pressed={variant === v.value}
                    onClick={() => setVariant(v.value)}
                    className={cn(
                      "h-8 rounded-full px-3 text-sm transition-colors",
                      variant === v.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {t(v.key)}
                  </button>
                ))}
              </div>
            )}
            <div className="max-w-full overflow-x-auto rounded-xl bg-muted/50 p-4">
              <ReceiptPreview
                doc={doc}
                paper={template.paperSize}
                selectedBlockId={focusedId}
                // clicking a line of a text block jumps to its field
                onSelectBlock={(id) => {
                  const field = fieldRefs.current[id];
                  if (field) field.focus();
                }}
                cutLabel={t("printTemplates.cutMarker")}
                tearLabel={t("printTemplates.tearMarker")}
                overflowLabel={t("printTemplates.overflow")}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
