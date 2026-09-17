"use client";

import { useEffect, useState } from "react";
import { fetchOpenOrderById } from "@/lib/api";
import { useT } from "@/lib/i18n/use-translation";
import { OrderScreen } from "./order-screen";

/**
 * Order taking for a take-away, addressed by the order itself.
 *
 * The table flow can name its target from the URL alone; a take-away's name
 * lives on the order, so it is fetched once before the shared screen binds the
 * ticket. Waiting is deliberate: binding a nameless take-away would put an
 * empty label on the header, the kitchen slip, and the checkout toast.
 */
export function TakeawayOrderScreen({ orderId }: { orderId: string }) {
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchOpenOrderById(orderId)
      .then((o) => {
        if (!alive) return;
        if (o) setName(o.order.customer_name ?? "");
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (failed) {
    return <p className="p-4 text-sm text-destructive">{t("m.loadFailed")}</p>;
  }
  if (name === null) {
    return <p className="p-4 text-muted-foreground">{t("common.loading")}</p>;
  }

  return <OrderScreen target={{ kind: "takeaway", orderId, name }} />;
}
