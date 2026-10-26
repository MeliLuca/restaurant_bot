"use client";

// Assistente AI — order task on the till: "Scrivi l'ordine". The waiter
// writes the order, checks the preview and adds it to the current ticket as
// PENDING lines — sending to the kitchen stays the usual button.
//
// Self-gated (module on, take_orders), so the ticket panel only mounts it.

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aiFetch } from "@/lib/ai/client";
import type { CustomItemResponse } from "@/lib/ai/contracts/order";
import {
  draftToTicketLines,
  placeholderCategories,
  type DraftLine,
} from "@/lib/ai/order/ticket";
import { useT } from "@/lib/i18n/use-translation";
import { useAiModule } from "@/stores/ai-store";
import { usePermission } from "@/stores/auth-store";
import { useTicketStore } from "@/stores/ticket-store";
import { OrderComposer } from "./order-composer";

export function OrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();

  async function addToTicket(draft: DraftLine[]) {
    // an off-menu line rides on its category's placeholder item
    const placeholders: Record<string, string> = {};
    for (const categoryId of placeholderCategories(draft)) {
      const item = await aiFetch<CustomItemResponse>("/api/ai/order/custom-item", { categoryId });
      placeholders[categoryId] = item.menuItemId;
    }
    const lines = draftToTicketLines(draft, placeholders);
    if (lines.length === 0) return;
    useTicketStore.getState().addLines(lines);
    toast.success(t("ai.order.added", { count: lines.length }));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            {t("ai.order.title")}
          </DialogTitle>
          <DialogDescription>{t("ai.order.description")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 overflow-y-auto px-6">
          {open && <OrderComposer onAdd={addToTicket} autoFocus />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The ticket panel's entry point: renders nothing unless the AI module is on
 * and this user takes orders */
export function OrderAssistButton({ disabled }: { disabled?: boolean }) {
  const t = useT();
  const ai = useAiModule();
  const canTakeOrders = usePermission("take_orders");
  const [open, setOpen] = useState(false);
  if (!ai.enabled || !canTakeOrders) return null;
  return (
    <>
      <Button
        size="lg"
        variant="outline"
        className="h-12 border-violet-300 text-base text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="mr-2 h-5 w-5" /> {t("ai.order.button")}
      </Button>
      <OrderDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
