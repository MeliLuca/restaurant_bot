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

export interface PriceEditTarget {
  /** "pending" = unsent ticket line, "sent" = order_items row on the bill */
  kind: "pending" | "sent";
  id: string;
  name: string;
  unitPrice: number;
}

interface PriceEditDialogProps {
  target: PriceEditTarget | null;
  onClose: () => void;
  onSubmit: (target: PriceEditTarget, unitPrice: number) => Promise<void> | void;
}

/** Manual price override scoped to the current ticket/order only — the
 * global menu price is never touched. */
export function PriceEditDialog({
  target,
  onClose,
  onSubmit,
}: PriceEditDialogProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) setValue(target.unitPrice.toFixed(2));
  }, [target]);

  const parsed = Number.parseFloat(value);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  async function apply() {
    if (!target || !valid) return;
    setBusy(true);
    try {
      await onSubmit(target, Math.round(parsed * 100) / 100);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust price — {target?.name}</DialogTitle>
          <DialogDescription>
            Applies to this ticket only — the menu price is unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="override-price">Unit price</Label>
          <Input
            id="override-price"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
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
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-12" disabled={busy || !valid} onClick={apply}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
