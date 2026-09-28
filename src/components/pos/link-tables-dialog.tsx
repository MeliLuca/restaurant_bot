"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { fetchOpenDineInOrders } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import type { Order, RestaurantTable, TableLink } from "@/lib/database.types";
import {
  findMember,
  linkPartners,
  linkTables,
  targetLabel,
  unlinkTable,
  type LinkTarget,
} from "@/lib/floor/links";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

interface LinkTablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bill being linked (current POS target) */
  target: LinkTarget;
  label: string;
  tables: RestaurantTable[];
  links: TableLink[];
  onChanged: () => Promise<void>;
}

/**
 * Link the current bill to other tables / splits. Every table is offered as a
 * whole, plus each split that has an open bill. Tapping a chip links it (a
 * chip already in another group merges that group in); partners are listed
 * on top with an unlink button each.
 */
export function LinkTablesDialog({
  open,
  onOpenChange,
  target,
  label,
  tables,
  links,
  onChanged,
}: LinkTablesDialogProps) {
  const t = useT();
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    fetchOpenDineInOrders()
      .then(setOpenOrders)
      .catch(() => {
        // splits are a convenience; whole tables can still be linked
      });
  }, [open]);

  const names = useMemo(
    () => new Map(tables.map((tb) => [tb.id, tb.name])),
    [tables],
  );
  const own = findMember(links, target);
  const partners = linkPartners(links, target);
  // A split on a table that is linked as a whole already belongs to that
  // whole-table member, so edits act on the member, not on a new one.
  const source: LinkTarget = own
    ? { tableId: own.table_id, subtable: own.subtable }
    : target;
  const sourceLabel = own
    ? targetLabel(names.get(own.table_id) ?? label, own.subtable)
    : label;

  const billOf = (m: TableLink) =>
    openOrders
      .filter(
        (o) =>
          o.table_id === m.table_id &&
          (m.subtable === null || o.subtable === m.subtable),
      )
      .reduce((sum, o) => sum + o.total, 0);
  const hasBill = (m: TableLink) =>
    openOrders.some(
      (o) =>
        o.table_id === m.table_id &&
        (m.subtable === null || o.subtable === m.subtable),
    );

  const q = query.trim().toLowerCase();
  const candidates = tables
    .filter((tb) => q === "" || tb.name.toLowerCase().includes(q))
    .map((tb) => ({
      table: tb,
      splits: Array.from(
        new Set(
          openOrders
            .filter((o) => o.table_id === tb.id && o.subtable !== null)
            .map((o) => o.subtable as string),
        ),
      ),
    }));

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("links.failed"));
    } finally {
      setBusy(false);
    }
  }

  function toggle(other: LinkTarget, otherLabel: string) {
    const member = links.find(
      (l) =>
        l.table_id === other.tableId &&
        (l.subtable ?? null) === other.subtable,
    );
    if (own && member && member.group_id === own.group_id) {
      void run(
        () => unlinkTable(other),
        t("links.unlinked", { name: otherLabel }),
      );
      return;
    }
    void run(
      () => linkTables(source, other),
      t("links.linked", { a: sourceLabel, b: otherLabel }),
    );
  }

  const chip = (other: LinkTarget, text: string) => {
    const isSelf =
      other.tableId === source.tableId && other.subtable === source.subtable;
    const member = links.find(
      (l) =>
        l.table_id === other.tableId &&
        (l.subtable ?? null) === other.subtable,
    );
    const inGroup = !!own && !!member && member.group_id === own.group_id;
    const elsewhere = !!member && !inGroup;
    return (
      <button
        key={`${other.tableId}:${other.subtable ?? ""}`}
        type="button"
        disabled={busy || isSelf}
        aria-pressed={inGroup}
        onClick={() => toggle(other, text)}
        className={cn(
          "flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-40",
          inGroup
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent",
        )}
      >
        {(inGroup || elsewhere) && <Link2 className="h-3.5 w-3.5" />}
        {text}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> {t("links.dialogTitle", { name: sourceLabel })}
          </DialogTitle>
          <DialogDescription>{t("links.dialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("links.current")}
          </h3>
          {partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("links.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {partners.map((m) => {
                const name = targetLabel(names.get(m.table_id) ?? "?", m.subtable);
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                  >
                    <span className="font-medium">{name}</span>
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                      {hasBill(m)
                        ? formatMoney(billOf(m))
                        : t("links.noOpenBill")}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      disabled={busy}
                      aria-label={t("links.unlinkAria", { name })}
                      onClick={() =>
                        void run(
                          () =>
                            unlinkTable({
                              tableId: m.table_id,
                              subtable: m.subtable,
                            }),
                          t("links.unlinked", { name }),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {own && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 self-start"
              disabled={busy}
              onClick={() =>
                void run(
                  () => unlinkTable(source),
                  t("links.unlinked", { name: sourceLabel }),
                )
              }
            >
              {t("links.unlinkSelf")}
            </Button>
          )}
        </div>

        <Separator />

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("links.addTitle")}
          </h3>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("links.search")}
              className="h-11 pl-9"
              aria-label={t("links.search")}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("links.noResults")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 py-1">
                {candidates.flatMap(({ table, splits }) => [
                  chip({ tableId: table.id, subtable: null }, table.name),
                  ...splits.map((s) =>
                    chip(
                      { tableId: table.id, subtable: s },
                      targetLabel(table.name, s),
                    ),
                  ),
                ])}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
