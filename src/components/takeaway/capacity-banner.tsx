"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { OverloadBanner } from "@/components/takeaway/overload-banner";
import { setPickupTime } from "@/lib/takeaway/api";
import { useTakeawayPressure } from "@/hooks/use-takeaway-load";
import type { OpenOrder } from "@/lib/api";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";

/**
 * The capacity warning as the till sees it: live, above the ticket.
 *
 * It counts the unsent lines too, which is the whole point — the fiftieth
 * pizza has to be visible while it is still a tap away from being undone, not
 * after it has gone to the oven. Reading the draft straight from the ticket
 * store keeps the till's own component untouched but for the one line that
 * renders this.
 */
export function TakeawayCapacityBanner({
  openOrder,
  onChanged,
}: {
  openOrder: OpenOrder | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const mode = useTicketStore((s) => s.mode);
  const order = openOrder?.order ?? null;
  const pickupAt = order?.pickup_at ?? null;
  const { config, load, options, refresh } = useTakeawayPressure(
    order?.id ?? null,
  );

  // Re-read the evening whenever this ticket lands in it: a send changes what
  // every other screen's slot is worth, and this one is looking right at it.
  const sentPieces = openOrder?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;
  useEffect(() => {
    void refresh();
  }, [refresh, order?.id, pickupAt, sentPieces]);

  if (mode !== "takeaway" || pickupAt === null || !load.hasRules) return null;

  const pressure = load.pressureAt(pickupAt, options);
  if (pressure.over.length === 0) return null;

  async function moveTo(iso: string) {
    if (!order) return;
    try {
      await setPickupTime(order.id, iso);
      await onChanged();
      await refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("takeaway.couldNotSetPickup"),
      );
    }
  }

  return (
    <OverloadBanner
      className="mb-4"
      pressure={pressure}
      at={pickupAt}
      suggestions={load.suggest(pickupAt, config, options)}
      onPickTime={(iso) => void moveTo(iso)}
    />
  );
}
