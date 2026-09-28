"use client";

import { Link2, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/constants";
import type { LinkedBill } from "@/lib/floor/links";
import { useT } from "@/lib/i18n/use-translation";

/**
 * "The linked table hasn't paid yet" — shown before a checkout (or split) of
 * a bill whose linked partners still have open bills. Advisory: the cashier
 * can pay anyway, jump to one of the other bills, or back out.
 */
export function LinkedBillsDialog({
  bills,
  label,
  confirmLabel,
  onConfirm,
  onOpenBill,
  onCancel,
}: {
  /** null = closed */
  bills: LinkedBill[] | null;
  /** The bill about to be paid */
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  onOpenBill: (bill: LinkedBill) => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={!!bills} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-amber-500" /> {t("links.warnTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("links.warnBody", { name: label })}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {bills?.map((b) => (
            <li
              key={b.orderId}
              className="flex items-center gap-2 rounded-md border px-3 py-2"
            >
              <span className="font-semibold">{b.label}</span>
              <span className="ml-auto tabular-nums">{formatMoney(b.total)}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-10"
                onClick={() => onOpenBill(b)}
              >
                <ReceiptText className="mr-1 h-4 w-4" />
                {t("links.openBill", { name: b.label })}
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <Button size="lg" className="h-14 text-base" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button size="lg" variant="ghost" className="h-12" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
