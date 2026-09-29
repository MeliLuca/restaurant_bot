"use client";

import { useMemo, useState } from "react";
import {
  Armchair,
  Lock,
  LockOpen,
  Pencil,
  Phone,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Reservation, TableTag } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import type { FloorContext } from "@/lib/smart-floor/types";
import { cn } from "@/lib/utils";
import { tableNamesOf, useTimeFormat } from "./format";

type Filter = "active" | "unassigned" | "closed";

const FILTERS: { value: Filter; labelKey: TranslationKey }[] = [
  { value: "active", labelKey: "reservations.filterActive" },
  { value: "unassigned", labelKey: "reservations.filterUnassigned" },
  { value: "closed", labelKey: "reservations.filterClosed" },
];

const STATUS_KEY: Record<Reservation["status"], TranslationKey> = {
  booked: "reservations.statusBooked",
  seated: "reservations.statusSeated",
  cancelled: "reservations.statusCancelled",
  no_show: "reservations.statusNoShow",
};

interface ReservationListProps {
  reservations: Reservation[];
  ctx: FloorContext;
  tags: TableTag[];
  /** May assign tables (plan_floor, on a computer) */
  canPlan: boolean;
  /** May create/edit/seat/cancel (manage_reservations) */
  canEdit: boolean;
  /** Seating only makes sense on the day itself */
  isToday: boolean;
  busyId: string | null;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  selected: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  onEdit: (r: Reservation) => void;
  onAssign: (ids: string[]) => void;
  onSeat: (r: Reservation) => void;
  onCancel: (r: Reservation) => void;
  onToggleLock: (r: Reservation) => void;
}

export function ReservationList({
  reservations,
  ctx,
  tags,
  canPlan,
  canEdit,
  isToday,
  busyId,
  focusId,
  onFocus,
  selected,
  onSelectedChange,
  onEdit,
  onAssign,
  onSeat,
  onCancel,
  onToggleLock,
}: ReservationListProps) {
  const t = useT();
  const time = useTimeFormat();
  const [filter, setFilter] = useState<Filter>("active");
  const tagById = useMemo(() => new Map(tags.map((tg) => [tg.id, tg])), [tags]);

  const active = reservations.filter(
    (r) => r.status === "booked" || r.status === "seated",
  );
  const unassigned = active.filter(
    (r) => r.status === "booked" && r.table_ids.length === 0,
  );
  const shown =
    filter === "active"
      ? active
      : filter === "unassigned"
        ? unassigned
        : reservations.filter(
            (r) => r.status === "cancelled" || r.status === "no_show",
          );
  const covers = active.reduce((sum, r) => sum + r.party_size, 0);
  const selectable = (r: Reservation) => canPlan && r.status === "booked";

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t("reservations.summary", {
          count: active.length,
          covers,
          unassigned: unassigned.length,
        })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
              filter === f.value
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t(f.labelKey)}
            {f.value === "unassigned" && unassigned.length > 0 && ` (${unassigned.length})`}
          </button>
        ))}
      </div>

      {canPlan && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted p-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={unassigned.length === 0}
            onClick={() => onSelectedChange(new Set(unassigned.map((r) => r.id)))}
          >
            {t("reservations.selectUnassigned")}
          </Button>
          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => onSelectedChange(new Set())}
            >
              {t("reservations.clearSelection")}
            </Button>
          )}
          <Button
            size="sm"
            className="ml-auto h-9"
            disabled={selected.size === 0}
            onClick={() => onAssign(Array.from(selected))}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            {t("reservations.assignSelected", { count: selected.size })}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("reservations.empty")}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {shown.map((r) => {
            const booked = r.status === "booked";
            const hasTables = r.table_ids.length > 0;
            return (
              <li
                key={r.id}
                onMouseEnter={() => onFocus(r.id)}
                className={cn(
                  "flex gap-3 rounded-lg border p-3 transition-colors",
                  focusId === r.id && "border-primary bg-accent",
                )}
              >
                {canPlan && (
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-primary"
                    aria-label={t("reservations.selectAria", { name: r.customer_name })}
                    disabled={!selectable(r)}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold tabular-nums">
                      {time(r.reserved_at)}
                    </span>
                    <span className="truncate font-medium">{r.customer_name}</span>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> {r.party_size}
                    </span>
                    {r.locked && (
                      <Lock
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label={t("reservations.locked")}
                      />
                    )}
                    {!booked && (
                      <Badge variant="secondary">{t(STATUS_KEY[r.status])}</Badge>
                    )}
                  </div>
                  {r.tag_ids.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.tag_ids.map((id) => (
                        <Badge
                          key={id}
                          variant="outline"
                          className={cn(
                            "font-normal",
                            ctx.mandatoryTagIds.has(id) && "border-foreground",
                          )}
                        >
                          {tagById.get(id)?.name ?? "?"}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {r.phone && (
                      <a
                        href={`tel:${r.phone.replace(/\s+/g, "")}`}
                        className="flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" /> {r.phone}
                      </a>
                    )}
                    {r.notes && <span className="truncate">{r.notes}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {hasTables ? (
                      <span className="text-sm">
                        {t("reservations.tablesLabel", {
                          tables: tableNamesOf(ctx, r.table_ids),
                        })}
                      </span>
                    ) : booked ? (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                        {t("reservations.unassigned")}
                      </Badge>
                    ) : null}
                    <div className="ml-auto flex gap-1">
                      {canPlan && booked && (
                        <Button
                          size="sm"
                          variant={hasTables ? "outline" : "default"}
                          className="h-9"
                          disabled={busyId === r.id}
                          onClick={() => onAssign([r.id])}
                        >
                          <Sparkles className="mr-1 h-4 w-4" />
                          {t(hasTables ? "reservations.reassign" : "reservations.assign")}
                        </Button>
                      )}
                      {canPlan && booked && hasTables && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 w-9 p-0"
                          aria-label={t(r.locked ? "reservations.unlock" : "reservations.lock")}
                          title={t(r.locked ? "reservations.unlock" : "reservations.lock")}
                          disabled={busyId === r.id}
                          onClick={() => onToggleLock(r)}
                        >
                          {r.locked ? (
                            <Lock className="h-4 w-4" />
                          ) : (
                            <LockOpen className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {canEdit && booked && isToday && hasTables && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 w-9 p-0"
                          aria-label={t("reservations.seatAria", { name: r.customer_name })}
                          title={t("floor.seat")}
                          disabled={busyId === r.id}
                          onClick={() => onSeat(r)}
                        >
                          <Armchair className="h-4 w-4" />
                        </Button>
                      )}
                      {canEdit && booked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 w-9 p-0"
                          aria-label={t("reservations.editAria", { name: r.customer_name })}
                          title={t("reservations.edit")}
                          disabled={busyId === r.id}
                          onClick={() => onEdit(r)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canEdit && booked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 w-9 p-0"
                          aria-label={t("floor.cancelReservationAria", { name: r.customer_name })}
                          title={t("reservations.cancel")}
                          disabled={busyId === r.id}
                          onClick={() => onCancel(r)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
