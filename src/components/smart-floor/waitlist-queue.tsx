"use client";

// The waitlist ("coda"), first come first served: each party with the table
// it gets now (free / to clear), or next (about to free up), or nothing yet.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Armchair,
  Hourglass,
  ListPlus,
  LogOut,
  Pencil,
  Phone,
  SkipForward,
  Sparkles,
  Undo2,
  Users,
  UserCheck,
} from "lucide-react";
import { reasonText, tableNamesOf, useTimeFormat } from "@/components/reservations/format";
import { Button } from "@/components/ui/button";
import type { FloorMap, WaitlistEntry } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { QUEUE_SKIP_MINUTES, type QueueMatch } from "@/lib/smart-floor/queue";
import type { Booking } from "@/lib/smart-floor/types";
import type { WalkInOption } from "@/lib/smart-floor/walk-in";
import {
  resolveWaitlistEntry,
  seatWaitlistEntry,
  skipWaitlistEntry,
} from "@/lib/smart-floor/waitlist-api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { OptionDetails, takenMeanwhile, waitedText, type WalkInFloor } from "./walk-in-shared";

const STATE_STYLE: Record<WalkInOption["state"], string> = {
  free: "text-emerald-700 dark:text-emerald-400",
  dirty: "text-amber-800 dark:text-amber-500",
  finishing: "text-muted-foreground",
};

export function WaitlistQueue({
  floor,
  entries,
  matches,
  maps,
  now,
  onPick,
  onAdd,
  onEdit,
  onChanged,
}: {
  floor: WalkInFloor;
  /** Waiting parties in arrival order */
  entries: WaitlistEntry[];
  matches: Map<string, QueueMatch>;
  maps: FloorMap[];
  now: number;
  onPick: (option: WalkInOption | null, label: string) => void;
  onAdd: () => void;
  onEdit: (entry: WaitlistEntry) => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const time = useTimeFormat();
  const canSeat = usePermission("manage_tables");
  const { ctx, tags } = floor;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const withTable = entries.filter((e) => matches.get(e.id)?.option);
  const picked =
    entries.find((e) => e.id === pickedId && matches.get(e.id)?.option) ?? withTable[0] ?? null;
  const pickedOption = picked ? (matches.get(picked.id)?.option ?? null) : null;
  const pickKey = picked && pickedOption ? `${picked.id}:${pickedOption.tableIds.join()}` : "";
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const label = picked ? `${picked.customer_name} (${picked.party_size})` : "";
  const latest = useRef({ option: pickedOption, label });
  latest.current = { option: pickedOption, label };
  useEffect(() => {
    pickRef.current(latest.current.option, latest.current.label);
  }, [pickKey, label]);
  useEffect(() => () => pickRef.current(null, ""), []);

  async function run(e: WaitlistEntry, action: () => Promise<void>, success: string) {
    setBusyId(e.id);
    try {
      await action();
      await onChanged();
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.somethingWrong"));
    } finally {
      setBusyId(null);
    }
  }

  async function seat(e: WaitlistEntry, o: WalkInOption) {
    if (!ctx) return;
    setBusyId(e.id);
    try {
      const taken = await takenMeanwhile(o.tableIds);
      if (taken.length > 0) {
        toast.error(t("walkIn.justTaken", { tables: tableNamesOf(ctx, taken) }));
        await onChanged();
        return;
      }
      await seatWaitlistEntry(e.id, o.tableIds);
      await onChanged();
      toast.success(
        t("queue.seated", { name: e.customer_name, tables: tableNamesOf(ctx, o.tableIds) }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("floor.couldNotSeat"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{t("queue.intro")}</p>
      {canSeat && (
        <Button variant="outline" className="h-11" onClick={onAdd}>
          <ListPlus className="mr-2 h-4 w-4" /> {t("queue.add")}
        </Button>
      )}

      {entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("queue.empty")}</p>
      ) : !ctx ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((e) => {
            const m = matches.get(e.id);
            const o = m?.option ?? null;
            const busy = busyId === e.id;
            const active = picked?.id === e.id && !!o;
            const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
            const needs = [
              ...e.tag_ids.map(tagName),
              ...(e.map_id ? [maps.find((mp) => mp.id === e.map_id)?.name ?? "?"] : []),
            ];
            const booking: Booking = {
              id: e.id,
              name: e.customer_name,
              partySize: e.party_size,
              start: now,
              tagIds: e.tag_ids,
              mapId: e.map_id,
              tableIds: [],
              locked: false,
            };
            return (
              <li
                key={e.id}
                aria-current={active || undefined}
                tabIndex={o ? 0 : undefined}
                onClick={() => o && setPickedId(e.id)}
                onKeyDown={(ev) => {
                  if (!o || ev.target !== ev.currentTarget) return;
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    setPickedId(e.id);
                  }
                }}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  o && "cursor-pointer",
                  active ? "border-emerald-600 bg-emerald-500/10" : o && "hover:bg-accent",
                  m?.skipped && "opacity-70",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums">
                    {m?.position ?? "·"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <span className="truncate text-base font-semibold">{e.customer_name}</span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Users className="h-3.5 w-3.5" /> {e.party_size}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Hourglass className="h-3.5 w-3.5" />
                        {waitedText(t, Date.parse(e.created_at), now)}
                      </span>
                    </p>
                    {needs.length > 0 && (
                      <p className="text-xs text-muted-foreground">{needs.join(" · ")}</p>
                    )}
                    {e.notes && <p className="text-xs text-muted-foreground">{e.notes}</p>}
                    {e.phone && (
                      <a
                        href={`tel:${e.phone.replace(/\s+/g, "")}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="mt-0.5 flex w-fit items-center gap-1 underline-offset-2 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" /> {e.phone}
                      </a>
                    )}
                  </div>
                  {canSeat && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      aria-label={t("queue.edit", { name: e.customer_name })}
                      title={t("queue.edit", { name: e.customer_name })}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEdit(e);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="flex flex-col gap-1 border-t pt-1.5">
                  {m?.skipped ? (
                    <span className="text-muted-foreground">
                      {t("queue.skippedUntil", { time: time(e.skip_until!) })}
                    </span>
                  ) : o ? (
                    <>
                      <span className={cn("font-medium", STATE_STYLE[o.state])}>
                        {t(`queue.state.${o.state}`, { tables: tableNamesOf(ctx, o.tableIds) })}
                      </span>
                      <OptionDetails
                        ctx={ctx}
                        option={o}
                        booking={booking}
                        tags={tags}
                        maps={maps}
                        heading={false}
                      />
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {m?.reason && m.reason !== "all_taken"
                        ? reasonText(t, ctx, booking, m.reason, tagName)
                        : t("queue.nothingYet")}
                    </span>
                  )}
                </div>

                {canSeat && (
                  <div className="flex flex-wrap gap-1.5" onClick={(ev) => ev.stopPropagation()}>
                    {o && o.state !== "finishing" && !m?.skipped && (
                      <Button
                        size="sm"
                        className="h-9"
                        disabled={busy}
                        onClick={() => void seat(e, o)}
                      >
                        {o.state === "dirty" ? (
                          <Sparkles className="mr-1 h-4 w-4" />
                        ) : (
                          <Armchair className="mr-1 h-4 w-4" />
                        )}
                        {t(o.state === "dirty" ? "walkIn.seatClean" : "walkIn.seat")}
                      </Button>
                    )}
                    {m?.skipped ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            e,
                            () => skipWaitlistEntry(e.id, null),
                            t("queue.backInLine", { name: e.customer_name }),
                          )
                        }
                      >
                        <Undo2 className="mr-1 h-4 w-4" /> {t("queue.unskip")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            e,
                            () =>
                              skipWaitlistEntry(
                                e.id,
                                new Date(Date.now() + QUEUE_SKIP_MINUTES * 60_000),
                              ),
                            t("queue.skipped", { name: e.customer_name }),
                          )
                        }
                      >
                        <SkipForward className="mr-1 h-4 w-4" /> {t("queue.skip")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          e,
                          () => resolveWaitlistEntry(e.id, "seated"),
                          t("queue.seatedElsewhere", { name: e.customer_name }),
                        )
                      }
                    >
                      <UserCheck className="mr-1 h-4 w-4" /> {t("queue.alreadySeated")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 text-muted-foreground"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          e,
                          () => resolveWaitlistEntry(e.id, "left"),
                          t("queue.leftDone", { name: e.customer_name }),
                        )
                      }
                    >
                      <LogOut className="mr-1 h-4 w-4" /> {t("queue.left")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
