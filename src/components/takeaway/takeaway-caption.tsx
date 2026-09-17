"use client";

import { useEffect, useState } from "react";
import { fetchParentOrder } from "@/lib/takeaway/api";
import type { Order } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";

/**
 * The line under a take-away's name in the ticket header.
 *
 * Says "follow-up to #12" when this order adds to another, because otherwise
 * the till shows two open orders with the same customer name and nothing to
 * explain why — and the waiter's next move (which one do I add to?) depends
 * entirely on knowing which is which.
 */
export function TakeawayCaption({
  order,
  bound,
}: {
  order: Order | null;
  /** An order exists; false while a brand-new take-away is being started */
  bound: boolean;
}) {
  const t = useT();
  const parentId = order?.parent_order_id ?? null;
  const [parentNumber, setParentNumber] = useState<number | null>(null);

  useEffect(() => {
    if (parentId === null) {
      setParentNumber(null);
      return;
    }
    let alive = true;
    // Best effort: a caption that fails to resolve falls back to the plain
    // "open take-away order" line rather than blocking the header.
    void fetchParentOrder(parentId)
      .then((p) => {
        if (alive) setParentNumber(p?.delivery_number ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [parentId]);

  const text =
    parentId !== null && parentNumber !== null
      ? t("takeaway.followUpOf", { number: parentNumber })
      : bound
        ? t("pos.openTakeawayOrder")
        : t("pos.newTakeawayLabel");

  return <span className="block text-xs text-muted-foreground">{text}</span>;
}
