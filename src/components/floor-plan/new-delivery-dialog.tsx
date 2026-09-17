"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bike, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SlotGrid } from "@/components/takeaway/slot-grid";
import { fetchDeliveryLabels, nextDeliveryNumber } from "@/lib/api";
import { createTakeawayOrder } from "@/lib/takeaway/api";
import { defaultSlot } from "@/lib/takeaway/slots";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";
import { useAuthStore } from "@/stores/auth-store";

interface NewDeliveryDialogProps {
  open: boolean;
  onClose: () => void;
  /** Refresh the floor (counter + open list) after the order is created */
  onCreated: () => Promise<void>;
}

export function NewDeliveryDialog({
  open,
  onClose,
  onCreated,
}: NewDeliveryDialogProps) {
  const router = useRouter();
  const t = useT();
  const setTakeaway = useTicketStore((s) => s.setTakeaway);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [number, setNumber] = useState<number | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [pickupAt, setPickupAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  // Fetch tonight's next number + saved labels each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const opened = new Date();
    setName("");
    setNumber(null);
    setNow(opened);
    // Pre-pick the next free slot: most calls are for "as soon as it's ready",
    // and a sensible time already filled in beats an empty one nobody sets.
    setPickupAt(defaultSlot(undefined, opened)?.key ?? null);
    Promise.all([nextDeliveryNumber(), fetchDeliveryLabels()])
      .then(([n, l]) => {
        setNumber(n);
        setLabels(l);
      })
      .catch((e) =>
        toast.error(
          e instanceof Error ? e.message : t("floor.couldNotLoadDelivery"),
        ),
      );
  }, [open, t]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const { orderId } = await createTakeawayOrder(trimmed, pickupAt, userId);
      setTakeaway(orderId, trimmed);
      await onCreated();
      onClose();
      router.push("/pos");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("floor.couldNotStartDelivery"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Bike className="h-6 w-6" /> {t("floor.newDelivery")}
            {number !== null && (
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-base font-semibold text-primary-foreground tabular-nums">
                #{number}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t("floor.deliveryNumberAuto")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            placeholder={t("floor.nameLabelPlaceholder")}
            className="h-12 text-base"
            aria-label={t("floor.deliveryNameAria")}
          />

          {labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setName(l)}
                  className={cn(
                    "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
                    name.trim() === l
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-sm font-medium">{t("takeaway.pickupTime")}</span>
            <SlotGrid value={pickupAt} onChange={setPickupAt} now={now} />
          </div>

          <Button
            size="lg"
            className="h-14 text-base"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            <Plus className="mr-2 h-5 w-5" /> {t("floor.startDeliveryOrder")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
