"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bike, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OverloadBanner } from "@/components/takeaway/overload-banner";
import { SlotGrid } from "@/components/takeaway/slot-grid";
import { fetchDeliveryLabels, nextDeliveryNumber } from "@/lib/api";
import {
  DUPLICATE_NAME,
  createFollowUpOrder,
  createTakeawayOrder,
  fetchTakeawayOrders,
  findOpenTakeawayByName,
  suggestDistinctName,
} from "@/lib/takeaway/api";
import { defaultSlot } from "@/lib/takeaway/slots";
import { useTakeawayPressure } from "@/hooks/use-takeaway-load";
import { cn } from "@/lib/utils";
import type { Order } from "@/lib/database.types";
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
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [name, setName] = useState("");
  const [pickupAt, setPickupAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  // No order exists yet, so nothing of ours is in the evening to move.
  const { config, load, options, pressureFor, refresh } =
    useTakeawayPressure(null);

  // Fetch tonight's next number + saved labels each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const opened = new Date();
    setName("");
    setNumber(null);
    setNow(opened);
    // Pre-pick the next free slot: most calls are for "as soon as it's ready",
    // and a sensible time already filled in beats an empty one nobody sets.
    setPickupAt(defaultSlot(config, opened)?.key ?? null);
    void refresh();
    Promise.all([
      nextDeliveryNumber(),
      fetchDeliveryLabels(),
      fetchTakeawayOrders("open"),
    ])
      .then(([n, l, o]) => {
        setNumber(n);
        setLabels(l);
        setOpenOrders(o);
      })
      .catch((e) =>
        toast.error(
          e instanceof Error ? e.message : t("floor.couldNotLoadDelivery"),
        ),
      );
    // `config` intentionally out of the deps: re-seeding the time because the
    // settings reloaded would move a choice already made in this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t, refresh]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy || duplicate !== null) return;
    setBusy(true);
    try {
      const { orderId } = await createTakeawayOrder(trimmed, pickupAt, userId);
      setTakeaway(orderId, trimmed);
      await onCreated();
      onClose();
      router.push("/pos");
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      toast.error(
        message === DUPLICATE_NAME
          ? t("takeaway.nameTakenShort", { name: trimmed })
          : message || t("floor.couldNotStartDelivery"),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Add to the order this customer already has open, rather than shadowing it */
  async function addToExisting() {
    if (!duplicate || busy) return;
    setBusy(true);
    try {
      const { orderId } = await createFollowUpOrder(duplicate, userId);
      setTakeaway(orderId, duplicate.customer_name ?? "");
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

  // Live as the name is typed: the answer has to arrive while the caller is
  // still saying it, not after the order is created.
  const duplicate = findOpenTakeawayByName(name, openOrders);

  // Shown under the grid the moment a full slot is picked, so the customer is
  // told while they are still on the phone.
  const chosenPressure =
    pickupAt !== null && load.hasRules
      ? (() => {
          const p = load.pressureAt(pickupAt, options);
          return p.over.length > 0 ? p : null;
        })()
      : null;

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
            <SlotGrid
              value={pickupAt}
              onChange={setPickupAt}
              config={config}
              now={now}
              pressureFor={pressureFor}
            />
            {chosenPressure !== null && (
              <OverloadBanner
                pressure={chosenPressure}
                at={pickupAt as string}
                suggestions={load.suggest(pickupAt as string, config, options)}
                onPickTime={setPickupAt}
              />
            )}
          </div>

          {duplicate !== null ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {t("takeaway.nameTaken", {
                    name: duplicate.customer_name ?? "",
                    number: duplicate.delivery_number ?? "?",
                  })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  className="h-12 flex-1"
                  disabled={busy}
                  onClick={() => void addToExisting()}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("takeaway.addToOrder", {
                    number: duplicate.delivery_number ?? "?",
                  })}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12"
                  disabled={busy}
                  onClick={() => setName(suggestDistinctName(name, openOrders))}
                >
                  {t("takeaway.useAnotherName", {
                    name: suggestDistinctName(name, openOrders),
                  })}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={busy || !name.trim()}
              onClick={() => void create()}
            >
              <Plus className="mr-2 h-5 w-5" /> {t("floor.startDeliveryOrder")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
