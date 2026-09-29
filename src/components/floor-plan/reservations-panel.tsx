"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Armchair,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarClock,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { seatReservation, setReservationStatus } from "@/lib/api";
import type { Reservation, RestaurantTable } from "@/lib/database.types";
import { compareTableNames } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

interface ReservationsPanelProps {
  reservations: Reservation[];
  tables: RestaurantTable[];
  onChanged: () => Promise<void>;
}

export function ReservationsPanel({
  reservations,
  tables,
  onChanged,
}: ReservationsPanelProps) {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const canManage = usePermission("manage_reservations");
  // a party may hold several tables pushed together ("201 + 202")
  const tableNames = (ids: string[]) =>
    ids.length === 0
      ? "—"
      : ids
          .map((id) => tables.find((t) => t.id === id)?.name ?? "?")
          .sort(compareTableNames)
          .join(" + ");

  async function seat(r: Reservation) {
    setBusyId(r.id);
    try {
      await seatReservation(r);
      await onChanged();
      toast.success(
        t("floor.seatedAt", {
          name: r.customer_name,
          table: tableNames(r.table_ids),
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotSeat"));
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(r: Reservation) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, "cancelled");
      await onChanged();
      toast.success(t("floor.reservationCancelled", { name: r.customer_name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("floor.couldNotCancel"));
    } finally {
      setBusyId(null);
    }
  }

  const active = useMemo(() => {
    let list = reservations.filter(
      (r) => r.status === "booked" || r.status === "seated",
    );
    const q = query.trim().toLowerCase();
    if (q) {
      // digits = party size, anything else = customer name
      list = /^\d+$/.test(q)
        ? list.filter((r) => r.party_size === parseInt(q, 10))
        : list.filter((r) => r.customer_name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) =>
      sortAsc
        ? a.reserved_at.localeCompare(b.reserved_at)
        : b.reserved_at.localeCompare(a.reserved_at),
    );
  }, [reservations, query, sortAsc]);

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarClock className="h-5 w-5" /> {t("floor.todaysReservations")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("floor.nameOrPartySize")}
              className="h-11 pl-9"
              aria-label={t("floor.searchReservationsAria")}
            />
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0"
            aria-label={t("floor.sortByTimeAria", {
              order: sortAsc ? t("floor.earliestLower") : t("floor.latestLower"),
            })}
            onClick={() => setSortAsc((s) => !s)}
          >
            {sortAsc ? (
              <ArrowUpNarrowWide className="mr-1.5 h-4 w-4" />
            ) : (
              <ArrowDownWideNarrow className="mr-1.5 h-4 w-4" />
            )}
            {sortAsc ? t("floor.earliest") : t("floor.latest")}
          </Button>
        </div>

        {active.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            {query.trim()
              ? t("floor.noReservationsMatch", { query: query.trim() })
              : t("floor.noReservationsToday")}
          </p>
        )}
        {active.map((r, i) => (
          <div key={r.id}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-center gap-3 py-2">
              <div className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                {TIME_FORMATTER.format(new Date(r.reserved_at))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.customer_name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("floor.partyOf", {
                    count: r.party_size,
                    table: tableNames(r.table_ids),
                  })}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>
              {r.status === "seated" ? (
                <Badge variant="secondary">{t("floor.seated")}</Badge>
              ) : !canManage ? (
                <Badge variant="outline">{t("floor.booked")}</Badge>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={busyId === r.id || r.table_ids.length === 0}
                    onClick={() => seat(r)}
                  >
                    <Armchair className="mr-1 h-4 w-4" /> {t("floor.seat")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 w-10 p-0"
                    aria-label={t("floor.cancelReservationAria", {
                      name: r.customer_name,
                    })}
                    disabled={busyId === r.id}
                    onClick={() => cancel(r)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
