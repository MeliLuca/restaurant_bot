"use client";

import { Check, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/use-translation";
import type { TableStatus } from "@/lib/database.types";

/**
 * Post-checkout prompt: the last split on a table has been settled, so how
 * should the table be left?
 *
 * Deliberately not dismissable. checkoutOrder leaves the table status
 * untouched on purpose, so a dismissed prompt strands the table as "occupied"
 * with nothing on it — the desktop dialog can be closed and does exactly that.
 * Two big taps is not a burden worth adding an escape route for.
 */
export function CleanupSheet({
  tableName,
  busy,
  onChoose,
  moved = false,
}: {
  tableName: string;
  /** Emptied by a cambio tavolo rather than a checkout */
  moved?: boolean;
  busy: boolean;
  onChoose: (status: TableStatus) => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50">
      <div className="rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <h2 className="text-lg font-semibold">
          {t(moved ? "move.tableEmpty" : "pos.tablePaid", { name: tableName })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pos.howLeaveTable")}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose("dirty")}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-secondary text-base font-semibold text-secondary-foreground disabled:opacity-50"
          >
            <Trash2 className="h-5 w-5" />
            {t("pos.markDirty")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose("available")}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Check className="h-5 w-5" />
            {t("pos.markAvailable")}
          </button>
        </div>
      </div>
    </div>
  );
}
