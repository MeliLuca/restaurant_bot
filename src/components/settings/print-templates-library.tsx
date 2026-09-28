"use client";

// Template library: the two built-in standard layouts (read-only, can be
// duplicated) plus every saved template, each with a thumbnail of the paper
// and the printers using it.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReceiptPreview } from "@/components/printing/receipt-preview";
import type {
  Printer,
  PrintTemplateKind,
  PrintTemplateRow,
  RestaurantSettings,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { layoutTicket } from "@/lib/printing/layout";
import { sampleTicket } from "@/lib/printing/sample";
import type { PrintTemplate } from "@/lib/printing/template";
import { standardTemplate, templateFromRow } from "@/lib/printing/template";
import { createPrintTemplate, deletePrintTemplate } from "@/lib/settings-api";
import { cn } from "@/lib/utils";

const KINDS: PrintTemplateKind[] = ["COMANDA", "CONTO"];

function Thumbnail({
  template,
  company,
}: {
  template: PrintTemplate;
  company: RestaurantSettings;
}) {
  const doc = useMemo(
    () =>
      layoutTicket(
        template,
        sampleTicket({ kind: template.kind === "CONTO" ? "CASSA" : "CUCINA", company }),
        company,
        template.paperSize,
      ),
    [template, company],
  );
  return (
    <div className="relative h-52 overflow-hidden rounded-lg bg-muted/60 pt-3">
      <ReceiptPreview doc={doc} paper={template.paperSize} fontSize={6} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted/90 to-transparent" />
    </div>
  );
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function PrintTemplatesLibrary({
  templates,
  printers,
  company,
  onChanged,
}: {
  templates: PrintTemplateRow[];
  printers: Printer[];
  company: RestaurantSettings;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const names = templates.map((tpl) => tpl.name);

  function usersOf(kind: PrintTemplateKind, id: string | null): Printer[] {
    return printers.filter(
      (p) =>
        (kind === "COMANDA" ? p.comanda_template_id : p.conto_template_id) === id &&
        (kind === "COMANDA" || p.printer_type === "CASSA"),
    );
  }

  // The built-in layout as the printers still on it actually print it (their
  // legacy header/footer/price options), so a duplicate starts from reality.
  const standards = useMemo(
    () => KINDS.map((k) => standardTemplate(k, usersOf(k, null)[0])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printers],
  );
  const saved = useMemo(() => templates.map(templateFromRow), [templates]);

  async function create(template: PrintTemplate, name: string) {
    setBusy(true);
    try {
      const id = await createPrintTemplate({
        name,
        kind: template.kind,
        paper_size: template.paperSize,
        blocks: template.blocks,
        feed_lines: template.feedLines,
        cut: template.cut,
      });
      toast.success(t("printTemplates.created"));
      router.push(`/settings/print-templates/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
      setBusy(false);
    }
  }

  function duplicate(template: PrintTemplate) {
    void create(template, uniqueName(t("printTemplates.copyOf", { name: template.name }), names));
  }

  async function remove(template: PrintTemplate) {
    if (!template.id) return;
    if (!window.confirm(t("printTemplates.confirmDelete", { name: template.name }))) return;
    setBusy(true);
    try {
      await deletePrintTemplate(template.id);
      await onChanged();
      toast.success(t("printTemplates.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  const card = (template: PrintTemplate) => {
    const builtIn = template.id === null;
    const users = usersOf(template.kind, template.id);
    const userNames = users.map((p) => p.name).join(", ");
    return (
      <Card key={template.id ?? `std-${template.kind}`} className="flex flex-col overflow-hidden">
        <CardContent className="flex flex-1 flex-col gap-3 p-4">
          {builtIn ? (
            <Thumbnail template={template} company={company} />
          ) : (
            <Link href={`/settings/print-templates/${template.id}`} aria-label={template.name}>
              <Thumbnail template={template} company={company} />
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{template.name}</span>
            <Badge variant="secondary">
              {template.kind === "COMANDA"
                ? t("printTemplates.kindComanda")
                : t("printTemplates.kindConto")}
            </Badge>
            {builtIn && <Badge variant="outline">{t("printTemplates.builtIn")}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {builtIn
              ? users.length > 0
                ? t("printTemplates.usedByStandard", { names: userNames })
                : t("printTemplates.builtInHint")
              : users.length > 0
                ? t("printTemplates.usedBy", { names: userNames })
                : t("printTemplates.unused")}
          </p>
          <div className="mt-auto flex flex-wrap gap-2">
            {!builtIn && (
              <Button asChild size="sm" className="h-9">
                <Link href={`/settings/print-templates/${template.id}`}>
                  <Pencil className="h-4 w-4" /> {t("printTemplates.edit")}
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              disabled={busy}
              onClick={() => duplicate(template)}
            >
              <Copy className="h-4 w-4" /> {t("printTemplates.duplicate")}
            </Button>
            {!builtIn && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-muted-foreground"
                disabled={busy || users.length > 0}
                title={users.length > 0 ? t("printTemplates.deleteInUse") : undefined}
                onClick={() => remove(template)}
              >
                <Trash2 className="h-4 w-4" /> {t("printTemplates.delete")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t("printTemplates.intro")}</p>
        <Button className="h-11" onClick={() => setCreating(true)} disabled={busy}>
          <Plus className="h-4 w-4" /> {t("printTemplates.newTemplate")}
        </Button>
      </div>

      {KINDS.map((kind) => (
        <section key={kind} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {kind === "COMANDA" ? t("printTemplates.kindComanda") : t("printTemplates.kindConto")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {standards.filter((s) => s.kind === kind).map(card)}
            {saved.filter((s) => s.kind === kind).map(card)}
          </div>
        </section>
      ))}

      <NewTemplateDialog
        open={creating}
        busy={busy}
        taken={names}
        onClose={() => setCreating(false)}
        onCreate={(name, kind, fromStandard) =>
          create(
            fromStandard
              ? standards.find((s) => s.kind === kind)!
              : { ...standardTemplate(kind), blocks: [] },
            name,
          )
        }
      />
    </>
  );
}

function NewTemplateDialog({
  open,
  busy,
  taken,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  taken: string[];
  onClose: () => void;
  onCreate: (name: string, kind: PrintTemplateKind, fromStandard: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PrintTemplateKind>("COMANDA");
  const [fromStandard, setFromStandard] = useState(true);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast.error(t("printTemplates.nameRequired"));
    if (taken.includes(trimmed)) return toast.error(t("printTemplates.nameTaken"));
    onCreate(trimmed, kind, fromStandard);
  }

  const choice = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-start gap-0.5 rounded-lg border p-3 text-left text-sm transition-colors",
      active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("printTemplates.newTemplate")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tpl-name">{t("printTemplates.nameLabel")}</Label>
            <Input
              id="tpl-name"
              className="h-12"
              autoFocus
              value={name}
              placeholder={t("printTemplates.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("printTemplates.kindLabel")}</Label>
            <div className="flex gap-2">
              {KINDS.map((k) => (
                <button key={k} type="button" className={choice(kind === k)} onClick={() => setKind(k)}>
                  <span className="font-medium">
                    {k === "COMANDA" ? t("printTemplates.kindComanda") : t("printTemplates.kindConto")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {k === "COMANDA"
                      ? t("printTemplates.kindComandaHint")
                      : t("printTemplates.kindContoHint")}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{t("printTemplates.startFrom")}</Label>
            <div className="flex gap-2">
              <button type="button" className={choice(fromStandard)} onClick={() => setFromStandard(true)}>
                {t("printTemplates.startStandard")}
              </button>
              <button type="button" className={choice(!fromStandard)} onClick={() => setFromStandard(false)}>
                {t("printTemplates.startEmpty")}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="h-12" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {t("printTemplates.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
