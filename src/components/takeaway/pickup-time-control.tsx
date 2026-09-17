"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlotGrid } from "@/components/takeaway/slot-grid";
import { formatTime, type SlotConfig } from "@/lib/takeaway/slots";
import { setPickupTime } from "@/lib/takeaway/api";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Read-only chip — the shape a pickup time takes wherever one is shown */
export function PickupChip({
  pickupAt,
  onClick,
  className,
}: {
  pickupAt: string | null;
  onClick?: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={t("takeaway.editPickupAria")}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
        onClick && "hover:bg-accent",
        pickupAt === null && "border-dashed text-muted-foreground",
        className,
      )}
    >
      <Clock className="h-4 w-4" />
      <span className="tabular-nums">
        {pickupAt === null ? t("takeaway.setTime") : formatTime(pickupAt)}
      </span>
    </button>
  );
}

/**
 * The pickup time on an open order: shows it, and is the way to change it.
 *
 * Self-contained — chip, dialog and the write all live here — so the till's
 * ticket header takes one line to adopt it and has nothing to unpick when it
 * changes. A take-away gets re-timed often (the customer calls back, the oven
 * is behind), so this is an everyday control, not a correction path.
 */
export function PickupTimeControl({
  orderId,
  pickupAt,
  onChanged,
  config,
  className,
}: {
  orderId: string | null;
  pickupAt: string | null;
  onChanged: () => Promise<void> | void;
  config?: SlotConfig;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(pickupAt);
  const [busy, setBusy] = useState(false);
  // Freeze "now" per dialog opening: the grid must not renumber under a thumb.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (open) {
      setDraft(pickupAt);
      setNow(new Date());
    }
  }, [open, pickupAt]);

  if (!orderId) return null;

  async function save() {
    if (busy || !orderId) return;
    setBusy(true);
    try {
      await setPickupTime(orderId, draft);
      await onChanged();
      setOpen(false);
      toast.success(
        draft === null
          ? t("takeaway.pickupCleared")
          : t("takeaway.pickupSet", { time: formatTime(draft) }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("takeaway.couldNotSetPickup"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PickupChip
        pickupAt={pickupAt}
        onClick={() => setOpen(true)}
        className={className}
      />
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Clock className="h-5 w-5" /> {t("takeaway.pickupTime")}
            </DialogTitle>
            <DialogDescription>{t("takeaway.pickupTimeBody")}</DialogDescription>
          </DialogHeader>
          <SlotGrid value={draft} onChange={setDraft} config={config} now={now} />
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="h-12 flex-1"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="lg"
              className="h-12 flex-[2]"
              disabled={busy}
              onClick={() => void save()}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
