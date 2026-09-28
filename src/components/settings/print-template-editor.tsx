"use client";

// Template editor ("modo 1"): block list | properties | live preview. On
// desktop the three sit side by side; below `lg` they become tabs. Nothing is
// written until Save — the preview and the test print both run on the draft.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Printer as PrinterIcon, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReceiptPreview } from "@/components/printing/receipt-preview";
import { BlockList } from "@/components/settings/print-template-blocks";
import {
  BlockProperties,
  TemplateSettings,
} from "@/components/settings/print-template-properties";
import { printTest } from "@/lib/api";
import type {
  PaperSize,
  Printer,
  PrintTemplateRow,
  RestaurantSettings,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { layoutTicket } from "@/lib/printing/layout";
import { sampleTicket, type SampleService } from "@/lib/printing/sample";
import type {
  BlockType,
  ContoVariant,
  PrintTemplate,
  TemplateBlock,
} from "@/lib/printing/template";
import { createBlock, newBlockId, templateFromRow } from "@/lib/printing/template";
import { updatePrintTemplate } from "@/lib/settings-api";
import { cn } from "@/lib/utils";

// Below 2xl the editor can't fit three columns: from lg the block list and
// the properties share the left column as tabs (preview stays on the right),
// below lg all three are tabs.
type Tab = "blocks" | "props" | "preview";

function Pills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 rounded-full px-3 text-sm transition-colors",
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

const matches = (query: string) =>
  typeof window !== "undefined" && window.matchMedia(query).matches;
const LG = "(min-width: 1024px)";
const XXL = "(min-width: 1536px)";

export function PrintTemplateEditor({
  row,
  printers,
  company,
}: {
  row: PrintTemplateRow;
  printers: Printer[];
  company: RestaurantSettings;
}) {
  const t = useT();
  const router = useRouter();
  const [initial] = useState(() => templateFromRow(row));
  const [tpl, setTpl] = useState<PrintTemplate>(initial);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [service, setService] = useState<SampleService>("table");
  const [variant, setVariant] = useState<ContoVariant>("CONTO");
  const [tab, setTab] = useState<Tab>("blocks");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  // the printers this kind of document can reach: a conto only prints on CASSA
  const testPrinters = printers.filter(
    (p) => p.is_active && (tpl.kind === "COMANDA" || p.printer_type === "CASSA"),
  );
  const [testPrinterId, setTestPrinterId] = useState<string>(
    () =>
      printers.find(
        (p) => p.is_active && (initial.kind === "COMANDA" || p.printer_type === "CASSA"),
      )?.id ?? "",
  );

  const dirty = JSON.stringify(tpl) !== savedJson;
  const selected = tpl.blocks.find((b) => b.id === selectedId) ?? null;

  // the preview tab only exists below lg: growing past it shows the blocks
  useEffect(() => {
    const mq = window.matchMedia(LG);
    const onChange = () => mq.matches && setTab((cur) => (cur === "preview" ? "blocks" : cur));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // browser-level guard (reload, closing the tab)
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
    const ticket = sampleTicket({
      kind: tpl.kind === "CONTO" ? "CASSA" : "CUCINA",
      company,
      variant,
      service,
    });
    return layoutTicket(tpl, ticket, company, tpl.paperSize);
  }, [tpl, company, variant, service]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const setBlocks = (fn: (blocks: TemplateBlock[]) => TemplateBlock[]) =>
    setTpl((cur) => ({ ...cur, blocks: fn(cur.blocks) }));

  function updateBlock(id: string, patch: Partial<TemplateBlock>) {
    setBlocks((blocks) =>
      blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as TemplateBlock) : b)),
    );
  }

  function insertAfterSelected(block: TemplateBlock) {
    setBlocks((blocks) => {
      const at = selectedId ? blocks.findIndex((b) => b.id === selectedId) : -1;
      if (at < 0) return [...blocks, block];
      return [...blocks.slice(0, at + 1), block, ...blocks.slice(at + 1)];
    });
    select(block.id);
  }

  function addBlock(type: BlockType) {
    insertAfterSelected(createBlock(type, tpl.kind));
  }

  function duplicateBlock(id: string) {
    const src = tpl.blocks.find((b) => b.id === id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.id = newBlockId();
    // right after the original
    setBlocks((blocks) => {
      const at = blocks.findIndex((b) => b.id === id);
      return [...blocks.slice(0, at + 1), copy, ...blocks.slice(at + 1)];
    });
    setSelectedId(copy.id);
  }

  function removeBlock(id: string) {
    setBlocks((blocks) => blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function select(id: string | null) {
    setSelectedId(id);
    if (id && !matches(XXL)) setTab("props");
  }

  // -------------------------------------------------------------------------
  // Save / test print / leave
  // -------------------------------------------------------------------------

  async function save() {
    const name = tpl.name.trim();
    if (!name) {
      toast.error(t("printTemplates.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await updatePrintTemplate(row.id, {
        name,
        paper_size: tpl.paperSize,
        blocks: tpl.blocks,
        feed_lines: tpl.feedLines,
        cut: tpl.cut,
      });
      const next = { ...tpl, name };
      setTpl(next);
      setSavedJson(JSON.stringify(next));
      toast.success(t("printTemplates.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  async function testPrint() {
    const printer = printers.find((p) => p.id === testPrinterId);
    if (!printer) return;
    setPrinting(true);
    try {
      const [job] = await printTest(printer.id, {
        template: tpl,
        variant,
        service,
      });
      if (job?.ok) toast.success(t("printTemplates.testSent", { name: printer.name }));
      else
        toast.error(
          t("printers.unreachable", {
            name: printer.name,
            error: job?.error ?? t("printers.unknownError"),
          }),
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("printers.testPrintFailed"));
    } finally {
      setPrinting(false);
    }
  }

  function leave(e: React.MouseEvent) {
    if (dirty && !window.confirm(t("printTemplates.unsavedConfirm"))) {
      e.preventDefault();
      return;
    }
    if (dirty) {
      // skip the beforeunload prompt for a navigation the user just confirmed
      e.preventDefault();
      setSavedJson(JSON.stringify(tpl));
      router.push("/settings/print-templates");
    }
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  const blocksPanel = (
    <BlockList
      blocks={tpl.blocks}
      kind={tpl.kind}
      selectedId={selectedId}
      onSelect={select}
      onReorder={(blocks) => setTpl((cur) => ({ ...cur, blocks }))}
      onToggleHidden={(id) =>
        updateBlock(id, { hidden: tpl.blocks.find((b) => b.id === id)?.hidden ? undefined : true })
      }
      onDuplicate={duplicateBlock}
      onRemove={removeBlock}
      onAdd={addBlock}
    />
  );

  const propsPanel = selected ? (
    <BlockProperties
      block={selected}
      kind={tpl.kind}
      onChange={(patch) => updateBlock(selected.id, patch)}
    />
  ) : (
    <TemplateSettings template={tpl} onChange={(patch) => setTpl((cur) => ({ ...cur, ...patch }))} />
  );

  const previewPanel = (
    <ReceiptPreview
      doc={doc}
      paper={tpl.paperSize}
      selectedBlockId={selectedId}
      onSelectBlock={(id) => select(id)}
      cutLabel={t("printTemplates.cutMarker")}
      tearLabel={t("printTemplates.tearMarker")}
      overflowLabel={t("printTemplates.overflow")}
    />
  );

  const panelTitle = (text: string, className = "2xl:block") => (
    <h2 className={cn("mb-3 hidden text-sm font-semibold", className)}>{text}</h2>
  );

  return (
    <div className="flex w-full max-w-[1500px] flex-col gap-4 p-4 lg:p-6">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="h-10 px-2">
          <Link href="/settings/print-templates" onClick={leave}>
            <ArrowLeft className="h-4 w-4" /> {t("printTemplates.back")}
          </Link>
        </Button>
        <Input
          aria-label={t("printTemplates.nameLabel")}
          className="h-10 w-full max-w-xs text-base font-semibold"
          value={tpl.name}
          onChange={(e) => setTpl((cur) => ({ ...cur, name: e.target.value }))}
        />
        <Badge variant="secondary">
          {tpl.kind === "COMANDA" ? t("printTemplates.kindComanda") : t("printTemplates.kindConto")}
        </Badge>
        <div className="ml-auto flex items-center gap-3">
          {dirty && (
            <span className="text-sm text-amber-700 dark:text-amber-400">
              {t("printTemplates.unsaved")}
            </span>
          )}
          <Button className="h-10 px-5" onClick={save} disabled={saving || !dirty}>
            <Save className="h-4 w-4" />
            {saving ? t("printTemplates.saving") : t("printTemplates.save")}
          </Button>
        </div>
      </div>

      {/* Preview controls + test print */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border bg-muted/30 px-3 py-2.5">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("printTemplates.paper")}
          <Pills<PaperSize>
            value={tpl.paperSize}
            onChange={(paperSize) => setTpl((cur) => ({ ...cur, paperSize }))}
            options={[
              { value: "80mm", label: "80mm" },
              { value: "58mm", label: "58mm" },
            ]}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("printTemplates.sample")}
          <Pills<SampleService>
            value={service}
            onChange={setService}
            options={[
              { value: "table", label: t("printTemplates.sampleTable") },
              { value: "takeaway", label: t("printTemplates.sampleTakeaway") },
            ]}
          />
        </label>
        {tpl.kind === "CONTO" && (
          <Pills<ContoVariant>
            value={variant}
            onChange={setVariant}
            options={[
              { value: "CONTO", label: t("printTemplates.variantConto") },
              { value: "PRECONTO", label: t("printTemplates.variantPreconto") },
              { value: "PARZIALE", label: t("printTemplates.variantParziale") },
            ]}
          />
        )}
        <div className="flex items-center gap-2 lg:ml-auto">
          {testPrinters.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("printTemplates.noPrinters")}</span>
          ) : (
            <>
              <Select value={testPrinterId} onValueChange={setTestPrinterId}>
                <SelectTrigger
                  className="h-9 w-44 bg-background"
                  aria-label={t("printTemplates.testPrinter")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {testPrinters.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-9 bg-background"
                onClick={testPrint}
                disabled={printing || !testPrinterId}
              >
                <PrinterIcon className="h-4 w-4" /> {t("printTemplates.testPrint")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs below 2xl (the preview tab only below lg) */}
      <div className="flex rounded-lg border p-0.5 2xl:hidden">
        {(
          [
            ["blocks", t("printTemplates.blocks"), ""],
            ["props", t("printTemplates.properties"), ""],
            ["preview", t("printTemplates.preview"), "lg:hidden"],
          ] as const
        ).map(([key, label, cls]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "h-10 flex-1 rounded-md text-sm font-medium",
              tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              cls,
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(300px,360px)_minmax(320px,400px)_1fr]">
        <section className={cn(tab === "blocks" ? "block" : "hidden", "2xl:block")}>
          {panelTitle(t("printTemplates.blocks"))}
          {blocksPanel}
        </section>
        <section className={cn(tab === "props" ? "block" : "hidden", "2xl:block")}>
          {panelTitle(t("printTemplates.properties"))}
          <div className="rounded-xl border p-4">{propsPanel}</div>
        </section>
        <section
          className={cn(
            tab === "preview" ? "block" : "hidden",
            "lg:sticky lg:top-4 lg:block lg:self-start",
          )}
        >
          {panelTitle(t("printTemplates.preview"), "lg:block")}
          <div className="overflow-x-auto rounded-xl bg-muted/50 p-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {previewPanel}
          </div>
        </section>
      </div>
    </div>
  );
}
