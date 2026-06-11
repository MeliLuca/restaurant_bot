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
import {
  setReservationStatus,
  updateTableStatus,
} from "@/lib/api";
import type { Reservation, RestaurantTable } from "@/lib/database.types";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const canManage = usePermission("manage_reservations");
  const tableName = (id: string) =>
    tables.find((t) => t.id === id)?.name ?? "?";

  async function seat(r: Reservation) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, "seated");
      await updateTableStatus(r.table_id, "occupied");
      await onChanged();
      toast.success(`${r.customer_name} seated at ${tableName(r.table_id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not seat party");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(r: Reservation) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, "cancelled");
      await onChanged();
      toast.success(`Reservation for ${r.customer_name} cancelled`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
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
          <CalendarClock className="h-5 w-5" /> Today&apos;s reservations
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or party size…"
              className="h-11 pl-9"
              aria-label="Search reservations by name or party size"
            />
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0"
            aria-label={`Sort by time, currently ${sortAsc ? "earliest" : "latest"} first`}
            onClick={() => setSortAsc((s) => !s)}
          >
            {sortAsc ? (
              <ArrowUpNarrowWide className="mr-1.5 h-4 w-4" />
            ) : (
              <ArrowDownWideNarrow className="mr-1.5 h-4 w-4" />
            )}
            {sortAsc ? "Earliest" : "Latest"}
          </Button>
        </div>

        {active.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            {query.trim()
              ? `No reservations match “${query.trim()}”.`
              : "No reservations for today yet."}
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
                  Party of {r.party_size} · Table {tableName(r.table_id)}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>
              {r.status === "seated" ? (
                <Badge variant="secondary">Seated</Badge>
              ) : !canManage ? (
                <Badge variant="outline">Booked</Badge>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={busyId === r.id}
                    onClick={() => seat(r)}
                  >
                    <Armchair className="mr-1 h-4 w-4" /> Seat
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 w-10 p-0"
                    aria-label={`Cancel reservation for ${r.customer_name}`}
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
