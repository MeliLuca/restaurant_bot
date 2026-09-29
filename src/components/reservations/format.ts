"use client";

import { useMemo } from "react";
import { compareTableNames } from "@/lib/floor/maps";
import type { TFn } from "@/lib/i18n/use-translation";
import { useLangStore } from "@/lib/i18n/store";
import type { Unplaced } from "@/lib/smart-floor/assign";
import type { Booking, FloorContext, TableOption } from "@/lib/smart-floor/types";

/** "21:00" in the UI language */
export function useTimeFormat(): (d: Date | string | number) => string {
  const lang = useLangStore((s) => s.lang);
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (d) => f.format(new Date(d));
  }, [lang]);
}

/** "201 + 202", in the order a waiter reads them; "—" when none */
export function tableNamesOf(ctx: FloorContext, ids: string[]): string {
  if (ids.length === 0) return "—";
  return ids
    .map((id) => ctx.tables.get(id)?.name ?? "?")
    .sort(compareTableNames)
    .join(" + ");
}

/** What's less than perfect about seating a party there, as short notes */
export function optionNotes(
  t: TFn,
  ctx: FloorContext,
  booking: Booking,
  option: TableOption,
  tagName: (id: string) => string,
  mapName: (id: string | null) => string,
): string[] {
  const notes: string[] = [];
  if (option.tableIds.length > 1) {
    notes.push(t("reservations.noteJoined", { count: option.tableIds.length }));
  }
  if (option.spare < 0) {
    notes.push(t("reservations.noteSqueezed", { count: -option.spare }));
  } else if (option.spare > ctx.rules.maxSpareSeats) {
    notes.push(t("reservations.noteSpare", { count: option.spare }));
  }
  if (option.missingTagIds.length > 0) {
    notes.push(
      t("reservations.noteWithout", {
        tags: option.missingTagIds.map(tagName).join(", "),
      }),
    );
  }
  if (option.otherRoom) {
    notes.push(
      t("reservations.noteOtherRoom", {
        room: mapName(ctx.tables.get(option.tableIds[0])?.mapId ?? null),
        wanted: mapName(booking.mapId),
      }),
    );
  }
  return notes;
}

/** Why no table was found, in words */
export function reasonText(
  t: TFn,
  ctx: FloorContext,
  booking: Booking,
  reason: Unplaced["reason"],
  tagName: (id: string) => string,
): string {
  switch (reason) {
    case "too_big":
      return t("reservations.reasonTooBig", { count: booking.partySize });
    case "missing_mandatory_tag":
      return t("reservations.reasonMandatory", {
        tags: booking.tagIds
          .filter((id) => ctx.mandatoryTagIds.has(id))
          .map(tagName)
          .join(", "),
      });
    default:
      return t("reservations.reasonAllTaken");
  }
}
