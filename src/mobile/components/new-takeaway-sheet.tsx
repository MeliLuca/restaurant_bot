"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { OverloadBanner } from "@/components/takeaway/overload-banner";
import { SlotGrid } from "@/components/takeaway/slot-grid";
import { fetchDeliveryLabels } from "@/lib/api";
import {
  DUPLICATE_NAME,
  createFollowUpOrder,
  createTakeawayOrder,
  findOpenTakeawayByName,
  suggestDistinctName,
} from "@/lib/takeaway/api";
import { defaultSlot } from "@/lib/takeaway/slots";
import { useTakeawayPressure } from "@/hooks/use-takeaway-load";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useTicketStore } from "@/stores/ticket-store";
import { mRoutes } from "@/mobile/lib/routes";

/**
 * Starting a take-away from the phone: name, time, go.
 *
 * The same three decisions the till asks for, in the same order, with the same
 * two answers when the name is already taken — a waiter who takes a call in
 * the dining room must not get a different rule from one who takes it at the
 * counter.
 */
export function NewTakeawaySheet({
  open,
  onClose,
  openOrders,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Tonight's open orders, for the name check and the follow-up path */
  openOrders: Order[];
  onCreated: () => Promise<void>;
}) {
  const t = useT();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setTakeaway = useTicketStore((s) => s.setTakeaway);
  const { config, load, options, pressureFor, refresh } =
    useTakeawayPressure(null);

  const [name, setName] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [pickupAt, setPickupAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const opened = new Date();
    setName("");
    setNow(opened);
    setPickupAt(defaultSlot(config, opened)?.key ?? null);
    void refresh();
    fetchDeliveryLabels()
      .then(setLabels)
      .catch(() => {});
    // `config` stays out: reloading settings must not move a chosen time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refresh]);

  const duplicate = findOpenTakeawayByName(name, openOrders);

  const chosenPressure =
    pickupAt !== null && load.hasRules
      ? (() => {
          const p = load.pressureAt(pickupAt, options);
          return p.over.length > 0 ? p : null;
        })()
      : null;

  async function go(create: () => Promise<{ orderId: string }>, label: string) {
    if (busy) return;
    setBusy(true);
    try {
      const { orderId } = await create();
      setTakeaway(orderId, label);
      await onCreated();
      onClose();
      router.push(mRoutes.takeawayOrder(orderId));
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      toast.error(
        message === DUPLICATE_NAME
          ? t("takeaway.nameTakenShort", { name: label })
          : message || t("floor.couldNotStartDelivery"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex max-h-[92vh] flex-col gap-3 overflow-y-auto p-4">
        <SheetTitle className="text-xl font-bold">
          {t("takeaway.newTakeaway")}
        </SheetTitle>

        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("floor.nameLabelPlaceholder")}
          aria-label={t("floor.deliveryNameAria")}
          className="h-12 text-base"
        />

        {labels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {labels.slice(0, 8).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setName(l)}
                className={cn(
                  "flex h-10 items-center rounded-full border px-3 text-sm",
                  name.trim() === l
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        )}

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
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void go(
                  () => createFollowUpOrder(duplicate, userId),
                  duplicate.customer_name ?? "",
                )
              }
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Plus className="h-5 w-5" />
              {t("takeaway.addToOrder", {
                number: duplicate.delivery_number ?? "?",
              })}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setName(suggestDistinctName(name, openOrders))}
              className="min-h-12 w-full rounded-xl border text-base font-medium"
            >
              {t("takeaway.useAnotherName", {
                name: suggestDistinctName(name, openOrders),
              })}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              void go(
                () => createTakeawayOrder(name.trim(), pickupAt, userId),
                name.trim(),
              )
            }
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Plus className="h-5 w-5" /> {t("floor.startDeliveryOrder")}
          </button>
        )}
      </SheetContent>
    </Sheet>
  );
}
