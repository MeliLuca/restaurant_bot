"use client";

import { useEffect } from "react";
import { useTicketStore } from "@/stores/ticket-store";

/**
 * Binds the global ticket to the target named in the URL.
 *
 * The store already stashes unsent lines per target (`drafts`), so walking
 * table A -> table B -> back restores A's pending lines with no extra
 * bookkeeping — that mechanism was built for the desktop split picker and
 * applies verbatim here.
 *
 * `tableName` is optional because it arrives with the menu fetch; the binding
 * is skipped until it is known, so the store never sees a nameless target.
 */
export function useTicketTarget(
  tableId: string,
  tableName: string | undefined,
  subtable: string | null,
) {
  const setMode = useTicketStore((s) => s.setMode);
  const setTable = useTicketStore((s) => s.setTable);
  const setSubtable = useTicketStore((s) => s.setSubtable);

  useEffect(() => {
    setMode("table");
  }, [setMode]);

  useEffect(() => {
    if (!tableName) return;
    setTable(tableId, tableName);
  }, [tableId, tableName, setTable]);

  // Runs after setTable in the same commit. setTable resets subtable to null,
  // then this restores the one the URL asked for.
  useEffect(() => {
    if (!tableName) return;
    setSubtable(subtable);
  }, [tableName, subtable, setSubtable]);
}

/**
 * The take-away flavour of the same binding.
 *
 * Separate from the table version rather than a branch inside it: the two
 * targets have nothing in common but the store they write to, and a single
 * hook taking four half-used arguments is how you end up binding a table id
 * as a customer name.
 */
export function useTakeawayTicketTarget(
  /** null when the screen is pointed at a table — the hook then does nothing */
  orderId: string | null,
  name: string,
): void {
  const setMode = useTicketStore((s) => s.setMode);
  const setTakeaway = useTicketStore((s) => s.setTakeaway);

  // Inert without an order, because the screen calls both binding hooks on
  // every render and only one of them owns the target. Switching the store to
  // take-away mode here while a table was being served would silently move the
  // waiter's unsent round onto nothing at all.
  useEffect(() => {
    if (!orderId) return;
    setMode("takeaway");
    setTakeaway(orderId, name);
  }, [orderId, name, setMode, setTakeaway]);
}
