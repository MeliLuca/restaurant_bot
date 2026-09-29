"use client";

// Beside the Sala map: "Trova posto" for a party walking in, and the
// waitlist ("coda") for the ones who wait for a table.

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  FloorMap,
  Order,
  Reservation,
  TableLink,
  WaitlistEntry,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { claimedTables, matchQueue } from "@/lib/smart-floor/queue";
import type { WalkIn, WalkInOption } from "@/lib/smart-floor/walk-in";
import { toQueueParty } from "@/lib/smart-floor/waitlist-api";
import { cn } from "@/lib/utils";
import { WaitlistDialog } from "./waitlist-dialog";
import { WaitlistQueue } from "./waitlist-queue";
import { WalkInFinder } from "./walk-in-finder";
import { useWalkInFloor } from "./walk-in-shared";

export type WalkInTab = "find" | "queue";

export function WalkInPanel({
  tab,
  onTab,
  tables,
  reservations,
  links,
  maps,
  openOrders,
  waitlist,
  now,
  onPick,
  onChanged,
  onClose,
}: {
  tab: WalkInTab;
  onTab: (tab: WalkInTab) => void;
  tables: TableWithTags[];
  reservations: Reservation[];
  links: TableLink[];
  maps: FloorMap[];
  openOrders: Order[];
  /** Waiting parties, in arrival order */
  waitlist: WaitlistEntry[];
  now: number;
  /** The option to show on the map (null = none), with its label there */
  onPick: (option: WalkInOption | null, label: string) => void;
  /** The floor or the queue changed: read them again */
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const floor = useWalkInFloor({ tables, reservations, links, openOrders, now });
  const [dialog, setDialog] = useState<{
    editing: WaitlistEntry | null;
    prefill: WalkIn | null;
  } | null>(null);

  const matches = useMemo(
    () =>
      floor.ctx ? matchQueue(floor.ctx, waitlist.map(toQueueParty), floor.finishing) : new Map(),
    [floor.ctx, floor.finishing, waitlist],
  );
  const claims = useMemo(() => {
    const names = new Map(waitlist.map((e) => [e.id, e.customer_name]));
    const out = new Map<string, string>();
    claimedTables(matches).forEach((partyId, tableId) =>
      out.set(tableId, names.get(partyId) ?? "?"),
    );
    return out;
  }, [matches, waitlist]);

  const tabs: { value: WalkInTab; label: string }[] = [
    { value: "find", label: t("walkIn.title") },
    { value: "queue", label: t("queue.tab", { count: waitlist.length }) },
  ];

  return (
    <section
      aria-label={t("walkIn.title")}
      className="flex h-full min-h-0 flex-col rounded-xl border bg-card"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div role="tablist" className="flex flex-1 gap-1">
          {tabs.map((tb) => (
            <button
              key={tb.value}
              type="button"
              role="tab"
              aria-selected={tab === tb.value}
              onClick={() => onTab(tb.value)}
              className={cn(
                "flex h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                tab === tb.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          aria-label={t("walkIn.close")}
          title={t("walkIn.close")}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {tab === "find" ? (
          <WalkInFinder
            floor={floor}
            reservations={reservations}
            maps={maps}
            now={now}
            claims={claims}
            onPick={onPick}
            onQueue={(prefill) => setDialog({ editing: null, prefill })}
            onSeated={async () => {
              await onChanged();
              onClose();
            }}
          />
        ) : (
          <WaitlistQueue
            floor={floor}
            entries={waitlist}
            matches={matches}
            maps={maps}
            now={now}
            onPick={onPick}
            onAdd={() => setDialog({ editing: null, prefill: null })}
            onEdit={(editing) => setDialog({ editing, prefill: null })}
            onChanged={onChanged}
          />
        )}
      </div>

      <WaitlistDialog
        open={dialog !== null}
        editing={dialog?.editing ?? null}
        prefill={dialog?.prefill ?? null}
        tags={floor.tags}
        maps={maps}
        onClose={() => setDialog(null)}
        onSaved={async () => {
          await onChanged();
          // a party just queued from "Trova posto": show it in line
          if (!dialog?.editing) onTab("queue");
        }}
      />
    </section>
  );
}
