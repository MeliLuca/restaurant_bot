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
