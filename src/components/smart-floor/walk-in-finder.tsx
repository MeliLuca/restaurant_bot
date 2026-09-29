"use client";

// "Trova posto": a party walks in without a booking. Say how many they are
// (and what they need): the tab lists the tables free now, the ones to
// clear, and the ones about to free up, best first; the Sala map shows the
// one picked. Tables the waitlist claimed aren't offered.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Armchair, ListPlus, Sparkles, TriangleAlert, UsersRound } from "lucide-react";
import { reasonText, tableNamesOf, useTimeFormat } from "@/components/reservations/format";
import { Button } from "@/components/ui/button";
import { occupyTables } from "@/lib/api";
import type { FloorMap, Reservation } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { UPCOMING_MINUTES } from "@/lib/smart-floor/overlay";
import type { Booking } from "@/lib/smart-floor/types";
import {
  findWalkInSeats,
  type WalkIn,
  type WalkInOption,
  type WalkInState,
} from "@/lib/smart-floor/walk-in";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import {
  OptionDetails,
  PartyInputs,
  optionKey,
  parsePartySize,
  takenMeanwhile,
  type WalkInFloor,
} from "./walk-in-shared";

const MINUTE = 60_000;

const SECTIONS: { state: WalkInState; titleKey: TranslationKey; dot: string }[] = [
  { state: "free", titleKey: "walkIn.free", dot: "bg-blue-600" },
  { state: "dirty", titleKey: "walkIn.dirty", dot: "bg-amber-800" },
  { state: "finishing", titleKey: "walkIn.finishing", dot: "bg-red-600" },
];

interface WalkInFinderProps {
  floor: WalkInFloor;
  /** Today's reservations (the ones due soon without a table are pointed out) */
  reservations: Reservation[];
  maps: FloorMap[];
  now: number;
  /** Tables the waitlist claimed → the party's name */
  claims: Map<string, string>;
  /** The option to show on the map (null = none), with its label there */
  onPick: (option: WalkInOption | null, label: string) => void;
  /** Add the party to the waitlist (with what was typed here) */
  onQueue: (walkIn: WalkIn) => void;
  /** After seating: the floor changed */
  onSeated: () => Promise<void>;
}

export function WalkInFinder({
  floor,
  reservations,
  maps,
  now,
  claims,
  onPick,
  onQueue,
  onSeated,
}: WalkInFinderProps) {
  const t = useT();
  const time = useTimeFormat();
  const canSeat = usePermission("manage_tables");
  const { ctx, finishing, tags } = floor;
  const [party, setParty] = useState("2");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const size = parsePartySize(party);
  const claimKey = Array.from(claims.keys()).sort().join(",");
  const result = useMemo(() => {
    if (!ctx || size === null) return null;
    return findWalkInSeats(ctx, { partySize: size, tagIds, mapId }, finishing, {
      exclude: new Set(claimKey ? claimKey.split(",") : []),
    });
  }, [ctx, finishing, size, tagIds, mapId, claimKey]);

  const all = result ? [...result.free, ...result.dirty, ...result.finishing] : [];
  const picked = all.find((o) => optionKey(o) === pickedKey) ?? all[0] ?? null;
  const pickedId = picked ? optionKey(picked) : null;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const latest = useRef(picked);
  latest.current = picked;
  // the option object changes on every refresh; its tables are what matters
  useEffect(() => {
    pickRef.current(latest.current, t("walkIn.mapLabel", { count: size ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedId, size]);
  useEffect(() => () => pickRef.current(null, ""), []);

  // bookings due soon with no table yet: seating walk-ins takes their room
  const unassigned = reservations.filter((r) => {
    if (r.status !== "booked" || r.table_ids.length > 0) return false;
    const start = Date.parse(r.reserved_at);
    return start >= now - 30 * MINUTE && start - now <= UPCOMING_MINUTES * MINUTE;
  }).length;

  // "Rossi: 12 · Bianchi: 8 + 9"
  const held = new Map<string, string[]>();
  claims.forEach((name, tableId) => held.set(name, [...(held.get(name) ?? []), tableId]));
  const heldText = ctx
    ? Array.from(held)
        .map(([name, ids]) => `${name}: ${tableNamesOf(ctx, ids)}`)
        .join(" · ")
    : "";

  const tagName = (id: string) => tags.find((tg) => tg.id === id)?.name ?? "?";
  const booking: Booking = {
    id: "__walk_in__",
    name: "",
    partySize: size ?? 1,
    start: now,
    tagIds,
    mapId,
    tableIds: [],
    locked: false,
  };
  const mapName = (id: string) => maps.find((m) => m.id === id)?.name ?? "?";

  async function seat(o: WalkInOption) {
    if (!ctx) return;
    const names = tableNamesOf(ctx, o.tableIds);
    setBusy(true);
    try {
      const taken = await takenMeanwhile(o.tableIds);
      if (taken.length > 0) {
        toast.error(t("walkIn.justTaken", { tables: tableNamesOf(ctx, taken) }));
        await onSeated();
        return;
      }
      await occupyTables(o.tableIds);
      await onSeated();
      toast.success(
        o.shortStay && o.leaveBy !== null
          ? t("walkIn.seatedUntil", { tables: names, until: time(o.leaveBy) })
          : t("walkIn.seated", { tables: names }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSeat"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <PartyInputs
        idPrefix="walk-in"
        party={party}
        onParty={setParty}
        tags={tags}
        tagIds={tagIds}
        onTags={setTagIds}
        maps={maps}
        mapId={mapId}
        onMap={setMapId}
      />

      {unassigned > 0 && (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          {t("walkIn.unassigned", { count: unassigned })}
        </p>
      )}
      {heldText && (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <ListPlus className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          {t("walkIn.heldForQueue", { list: heldText })}
        </p>
      )}

      {size === null ? (
        <p className="text-sm text-muted-foreground">{t("floor.partySizeMin")}</p>
      ) : !ctx || !result ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : result.reason ? (
        <p className="flex gap-2 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
          {result.reason !== "all_taken"
            ? reasonText(t, ctx, booking, result.reason, tagName)
            : mapId
              ? t("walkIn.allTakenRoom", { room: mapName(mapId) })
              : t("walkIn.allTaken")}
        </p>
      ) : (
        SECTIONS.map(({ state, titleKey, dot }) => {
          const list = result[state];
          return (
            <div key={state} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                {t(titleKey)}
                <span className="font-normal text-muted-foreground">({list.length})</span>
              </h3>
              {state === "finishing" && list.length > 0 && (
                <p className="text-xs text-muted-foreground">{t("walkIn.finishingHint")}</p>
              )}
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("walkIn.none")}</p>
              ) : (
                <ul role="radiogroup" aria-label={t(titleKey)} className="flex flex-col gap-2">
                  {list.map((o) => {
                    const active = optionKey(o) === pickedId;
                    return (
                      <li key={optionKey(o)}>
                        <div
                          role="radio"
                          aria-checked={active}
                          aria-label={t("walkIn.optionAria", {
                            tables: tableNamesOf(ctx, o.tableIds),
                            seats: o.seats,
                          })}
                          tabIndex={0}
                          onClick={() => setPickedKey(optionKey(o))}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setPickedKey(optionKey(o));
                            }
                          }}
                          className={cn(
                            "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "border-emerald-600 bg-emerald-500/10" : "hover:bg-accent",
                          )}
                        >
                          <OptionDetails
                            ctx={ctx}
                            option={o}
                            booking={booking}
                            tags={tags}
                            maps={maps}
                            trailing={
                              o === all[0] && (
                                <span className="text-xs text-emerald-700 dark:text-emerald-400">
                                  {t("walkIn.best")}
                                </span>
                              )
                            }
                          />
                          {canSeat && state !== "finishing" && (
                            <Button
                              className="mt-1 h-11"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void seat(o);
                              }}
                            >
                              {state === "dirty" ? (
                                <Sparkles className="mr-2 h-4 w-4" />
                              ) : (
                                <Armchair className="mr-2 h-4 w-4" />
                              )}
                              {t(state === "dirty" ? "walkIn.seatClean" : "walkIn.seat")}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      )}

      {canSeat && size !== null && (
        <Button
          variant="outline"
          className="h-11"
          onClick={() => onQueue({ partySize: size, tagIds, mapId })}
        >
          <ListPlus className="mr-2 h-4 w-4" /> {t("walkIn.addToQueue")}
        </Button>
      )}
    </div>
  );
}
