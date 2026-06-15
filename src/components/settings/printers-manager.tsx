"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Printer as PrinterIcon, Receipt, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { printTest } from "@/lib/api";
import {
  createPrinter,
  deletePrinter,
  updatePrinter,
  updateRestaurantSettings,
  type PrinterInput,
} from "@/lib/settings-api";
import type {
  PaperSize,
  Printer,
  PrinterType,
  RestaurantSettings,
} from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const PRINTER_TYPES: { value: PrinterType; hintKey: TranslationKey }[] = [
  { value: "CASSA", hintKey: "printers.hintCassa" },
  { value: "CUCINA", hintKey: "printers.hintCucina" },
  { value: "BAR", hintKey: "printers.hintBar" },
];

interface PrintersManagerProps {
  printers: Printer[];
  settings: RestaurantSettings;
  onChanged: () => Promise<void>;
}

export function PrintersManager({
  printers,
  settings,
  onChanged,
}: PrintersManagerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function handleTestPrint(printer: Printer) {
    setBusy(true);
    try {
      const [job] = await printTest(printer.id);
      if (job?.ok) toast.success(t("printers.testSent", { name: printer.name }));
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
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-lg">
            <span className="flex items-center gap-2">
              <PrinterIcon className="h-5 w-5" /> {t("printers.networkPrinters")}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              disabled={busy}
              onClick={() => {
                setEditingPrinter(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> {t("printers.addPrinter")}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          {printers.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              {t("printers.noPrinters")}
            </p>
          )}
          {printers.map((p, idx) => (
            <div key={p.id}>
              {idx > 0 && <Separator className="my-1" />}
              <div className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge variant="secondary">{p.printer_type}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.local_ip}:{p.port} · {p.paper_size}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  title={t("printers.toggleSendHint")}
                  onClick={() =>
                    run(
                      () => updatePrinter(p.id, { is_active: !p.is_active }),
                      p.is_active
                        ? t("printers.deactivated", { name: p.name })
                        : t("printers.activated", { name: p.name }),
                    )
                  }
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                    p.is_active
                      ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700"
                      : "border-foreground/20 bg-muted text-muted-foreground",
                  )}
                >
                  {p.is_active ? t("printers.active") : t("printers.off")}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 shrink-0"
                  disabled={busy}
                  onClick={() => handleTestPrint(p)}
                >
                  {t("printers.testPrint")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label={t("printers.editAria", { name: p.name })}
                  disabled={busy}
                  onClick={() => {
                    setEditingPrinter(p);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-muted-foreground"
                  aria-label={t("printers.deleteAria", { name: p.name })}
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => deletePrinter(p.id),
                      t("printers.deleted", { name: p.name }),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ReceiptIdentityCard settings={settings} onChanged={onChanged} />

      <PrinterDialog
        open={dialogOpen}
        printer={editingPrinter}
        onClose={() => setDialogOpen(false)}
        onSaved={onChanged}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Company identity printed on the CASSA receipt
// ---------------------------------------------------------------------------

function ReceiptIdentityCard({
  settings,
  onChanged,
}: {
  settings: RestaurantSettings;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [form, setForm] = useState({
    business_name: settings.business_name,
    address: settings.address,
    vat_number: settings.vat_number,
    phone: settings.phone,
    receipt_greeting: settings.receipt_greeting,
    legal_footer: settings.legal_footer,
  });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateRestaurantSettings(form);
      await onChanged();
      toast.success(t("printers.receiptDetailsSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("floor.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  const fields: {
    key: keyof typeof form;
    labelKey: TranslationKey;
    placeholder: string;
  }[] = [
    { key: "business_name", labelKey: "printers.businessName", placeholder: "Trattoria da…" },
    { key: "address", labelKey: "printers.address", placeholder: "Via Roma 12, Milano" },
    { key: "vat_number", labelKey: "printers.vatNumber", placeholder: "IT01234567890" },
    { key: "phone", labelKey: "printers.phone", placeholder: "+39 …" },
    { key: "receipt_greeting", labelKey: "printers.greeting", placeholder: "Grazie e a presto!" },
    { key: "legal_footer", labelKey: "printers.legalFooter", placeholder: "Documento commerciale…" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className="h-5 w-5" /> {t("printers.receiptDetails")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="grid gap-2">
                <Label htmlFor={`rs-${f.key}`}>{t(f.labelKey)}</Label>
                <Input
                  id={`rs-${f.key}`}
                  className="h-12"
                  value={form[f.key]}
                  onChange={set(f.key)}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
          </div>
          <Button type="submit" className="h-12 self-end px-6" disabled={busy}>
            {busy ? t("common.saving") : t("printers.saveReceiptDetails")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add / edit printer dialog
// ---------------------------------------------------------------------------

const IP_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function PrinterDialog({
  open,
  printer,
  onClose,
  onSaved,
}: {
  open: boolean;
  printer: Printer | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [port, setPort] = useState("9100");
  const [printerType, setPrinterType] = useState<PrinterType>("CUCINA");
  const [paperSize, setPaperSize] = useState<PaperSize>("80mm");
  const [printPrices, setPrintPrices] = useState(true);
  const [printGrandTotal, setPrintGrandTotal] = useState(true);
  const [printLegalFooter, setPrintLegalFooter] = useState(false);
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [extraFeedLines, setExtraFeedLines] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(printer?.name ?? "");
    setLocalIp(printer?.local_ip ?? "");
    setPort(String(printer?.port ?? 9100));
    setPrinterType(printer?.printer_type ?? "CUCINA");
    setPaperSize(printer?.paper_size ?? "80mm");
    setPrintPrices(printer?.print_prices ?? true);
    setPrintGrandTotal(printer?.print_grand_total ?? true);
    setPrintLegalFooter(printer?.print_legal_footer ?? false);
    setHeaderText(printer?.header_text ?? "");
    setFooterText(printer?.footer_text ?? "");
    setExtraFeedLines(String(printer?.extra_feed_lines ?? 0));
  }, [open, printer]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedIp = localIp.trim();
    const parsedPort = parseInt(port, 10);
    const parsedFeed = parseInt(extraFeedLines, 10);
    if (!trimmedName) {
      toast.error(t("printers.printerNameRequired"));
      return;
    }
    if (!IP_PATTERN.test(trimmedIp)) {
      toast.error(t("printers.validIpv4"));
      return;
    }
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      toast.error(t("printers.portRange"));
      return;
    }
    if (!Number.isInteger(parsedFeed) || parsedFeed < 0 || parsedFeed > 10) {
      toast.error(t("printers.blankLinesRange"));
      return;
    }

    const fields: PrinterInput = {
      name: trimmedName,
      local_ip: trimmedIp,
      port: parsedPort,
      printer_type: printerType,
      paper_size: paperSize,
      print_prices: printPrices,
      print_grand_total: printGrandTotal,
      print_legal_footer: printLegalFooter,
      header_text: headerText.trim(),
      footer_text: footerText.trim(),
      extra_feed_lines: parsedFeed,
    };

    setBusy(true);
    try {
      if (printer) await updatePrinter(printer.id, fields);
      else await createPrinter(fields);
      await onSaved();
      toast.success(t("printers.printerSaved", { name: trimmedName }));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("floor.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {printer
              ? t("printers.editPrinter", { name: printer.name })
              : t("printers.newPrinter")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="printer-name">{t("printers.name")}</Label>
            <Input
              id="printer-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("printers.namePlaceholder")}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="printer-ip">{t("printers.localIp")}</Label>
              <Input
                id="printer-ip"
                className="h-12"
                value={localIp}
                onChange={(e) => setLocalIp(e.target.value)}
                placeholder="192.168.1.200"
                inputMode="decimal"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="printer-port">{t("printers.port")}</Label>
              <Input
                id="printer-port"
                className="h-12"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>{t("printers.ticketType")}</Label>
              <Select
                value={printerType}
                onValueChange={(v) => setPrinterType(v as PrinterType)}
              >
                <SelectTrigger className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINTER_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      {t("printers.ticketOption", {
                        type: pt.value,
                        hint: t(pt.hintKey),
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("printers.paperWidth")}</Label>
              <Select
                value={paperSize}
                onValueChange={(v) => setPaperSize(v as PaperSize)}
              >
                <SelectTrigger className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="80mm">{t("printers.paper80")}</SelectItem>
                  <SelectItem value="58mm">{t("printers.paper58")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("printers.printOptions")}</Label>
            <div className="flex flex-col gap-1 rounded-lg border p-3">
              <OptionCheckbox
                id="opt-prices"
                label={t("printers.optPrices")}
                checked={printPrices}
                onChange={setPrintPrices}
                disabled={printerType !== "CASSA"}
                disabledHint={t("printers.optPricesHint")}
              />
              <OptionCheckbox
                id="opt-total"
                label={t("printers.optTotal")}
                checked={printGrandTotal}
                onChange={setPrintGrandTotal}
                disabled={printerType !== "CASSA"}
                disabledHint={t("printers.optTotalHint")}
              />
              <OptionCheckbox
                id="opt-legal"
                label={t("printers.optLegal")}
                checked={printLegalFooter}
                onChange={setPrintLegalFooter}
                disabled={printerType !== "CASSA"}
                disabledHint={t("printers.optLegalHint")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="printer-header">{t("printers.extraHeader")}</Label>
              <Input
                id="printer-header"
                className="h-12"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder={t("printers.phHeader")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="printer-footer">{t("printers.extraFooter")}</Label>
              <Input
                id="printer-footer"
                className="h-12"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder={t("printers.phFooter")}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="printer-feed">{t("printers.blankLinesLabel")}</Label>
            <Input
              id="printer-feed"
              className="h-12 w-32"
              type="number"
              min={0}
              max={10}
              value={extraFeedLines}
              onChange={(e) => setExtraFeedLines(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={onClose}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {busy
                ? t("common.saving")
                : printer
                  ? t("printers.saveChanges")
                  : t("printers.addPrinter")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OptionCheckbox({
  id,
  label,
  checked,
  onChange,
  disabled,
  disabledHint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-sm",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="h-5 w-5 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {disabled && disabledHint && (
          <span className="block text-xs text-muted-foreground">
            {disabledHint}
          </span>
        )}
      </span>
    </label>
  );
}
