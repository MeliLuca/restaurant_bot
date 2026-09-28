"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoveBillForm, type MoveDone } from "@/components/order/move-bill-form";
import { fetchTables, updateTableStatus } from "@/lib/api";
import type { RestaurantTable, TableStatus } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { useTicketStore } from "@/stores/ticket-store";
import { mRoutes } from "@/mobile/lib/routes";
import { useBill } from "@/mobile/hooks/use-bill";
import { useBillTarget } from "@/mobile/hooks/use-bill-target";
import { CleanupSheet } from "./cleanup-sheet";
import { MHeader } from "./m-header";

/**
 * Cambio tavolo on the phone: its own route (like /pay) so the back gesture
 * cancels. On success the waiter lands on the destination bill — or first on
 * the dirty/available sheet when the source table was left empty.
 */
export function MoveScreen({ orderId }: { orderId: string }) {
  const t = useT();
  const router = useRouter();
  const { bill, tableName, label, closed, loading } = useBill(orderId);
  // bound so `lines` below are this bill's unsent ones (they block the move)
  useBillTarget(bill, tableName);
  const lines = useTicketStore((s) => s.lines);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [cleanup, setCleanup] = useState<{
    tableId: string;
    tableName: string;
    next: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTables()
      .then(setTables)
      .catch(() => toast.error(t("m.loadFailed")));
  }, [t]);

  function handleDone(done: MoveDone) {
    const next = mRoutes.bill(done.result.orderId);
    if (done.result.tableFreed && bill?.order.table_id) {
      setCleanup({ tableId: bill.order.table_id, tableName: tableName ?? "", next });
      return;
    }
    router.replace(next);
  }

  async function applyCleanup(status: TableStatus) {
    if (!cleanup) return;
    setBusy(true);
    try {
      await updateTableStatus(cleanup.tableId, status);
      toast.success(
        status === "dirty"
          ? t("pos.tableFlaggedCleaning", { name: cleanup.tableName })
          : t("pos.tableIsFree", { name: cleanup.tableName }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.updateFailed"));
    } finally {
      setBusy(false);
      router.replace(cleanup.next);
    }
  }

  // outlives the source bill, which may be gone (moved whole / merged)
  if (cleanup) {
    return (
      <CleanupSheet
        tableName={cleanup.tableName}
        moved
        busy={busy}
        onChoose={(status) => void applyCleanup(status)}
      />
    );
  }

  if (!bill || !tableName) {
    return (
      <>
        <MHeader title="…" backHref={mRoutes.bill(orderId)} />
        <div className="p-4 text-muted-foreground">
          {closed && !loading ? t("m.billClosedBody") : t("common.loading")}
        </div>
      </>
    );
  }

  return (
    <>
      <MHeader title={t("move.title", { name: label })} backHref={mRoutes.bill(orderId)} />
      <div className="flex min-h-0 flex-1 flex-col p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <MoveBillForm
          bill={bill}
          tableName={tableName}
          tables={tables}
          pendingCount={lines.length}
          onDone={handleDone}
          onCancel={() => router.replace(mRoutes.bill(orderId))}
        />
      </div>
    </>
  );
}
