"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n/use-translation";

export interface PriceEditLine {
  /** "pending" = unsent ticket line, "sent" = order_items row on the bill */
  kind: "pending" | "sent";
  id: string;
  /** Current unit price (a discount starts from this) */
  unitPrice: number;
}

export interface PriceEditTarget {
  /** Title: the line's name, or "3 righe" for a multi-selection */
  name: string;
  lines: PriceEditLine[];
}

interface PriceEditDialogProps {
  target: PriceEditTarget | null;
  onClose: () => void;
  /** New unit prices, in the order of `target.lines` */
  onSubmit: (target: PriceEditTarget, prices: number[]) => Promise<void> | void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Manual price override scoped to the current ticket/order only — the
 * global menu price is never touched. Works on one line or several: a new
 * unit price for all of them, or a percentage off each one's own price. */
export function PriceEditDialog({
  target,
  onClose,
  onSubmit,
}: PriceEditDialogProps) {
  const t = useT();
  const [mode, setMode] = useState<"price" | "discount">("price");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const prices = target?.lines.map((l) => l.unitPrice) ?? [];
  const samePrice = prices.every((p) => p === prices[0]);

  useEffect(() => {
    if (!target) return;
    setMode("price");
    const ps = target.lines.map((l) => l.unitPrice);
    // a common price is the obvious starting point; mixed prices start empty
    setValue(ps.every((p) => p === ps[0]) ? ps[0].toFixed(2) : "");
  }, [target]);

  const parsed = Number.parseFloat(value.replace(",", "."));
  const valid =
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    (mode === "price" || parsed <= 100);

  async function apply() {
    if (!target || !valid) return;
    const next = target.lines.map((l) =>
      mode === "price" ? round2(parsed) : round2(l.unitPrice * (1 - parsed / 100)),
    );
    setBusy(true);
    try {
      await onSubmit(target, next);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("pos.adjustPrice", { name: target?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("pos.appliesThisTicket")}</DialogDescription>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(m) => {
            setMode(m as "price" | "discount");
            setValue(
              m === "price" && samePrice && prices.length > 0
                ? prices[0].toFixed(2)
                : "",
            );
          }}
        >
          <TabsList className="grid h-11 w-full grid-cols-2">
            <TabsTrigger value="price" className="h-9">
              {t("cassa.lines.priceModeNew")}
            </TabsTrigger>
            <TabsTrigger value="discount" className="h-9">
              {t("cassa.lines.priceModeDiscount")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2">
          <Label htmlFor="override-price">
            {mode === "price" ? t("pos.unitPrice") : t("cassa.lines.discountLabel")}
          </Label>
          <Input
            id="override-price"
            type="number"
            inputMode="decimal"
            min={0}
            max={mode === "discount" ? 100 : undefined}
            step={mode === "price" ? 0.01 : 1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void apply();
              }
            }}
            className="h-12 text-lg"
            autoFocus
          />
          {(target?.lines.length ?? 0) > 1 && (
            <p className="text-xs text-muted-foreground">
              {mode === "price"
                ? t("cassa.lines.priceAllHint", { count: target?.lines.length ?? 0 })
                : t("cassa.lines.discountEachHint")}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="h-12" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="h-12" disabled={busy || !valid} onClick={apply}>
            {t("pos.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
