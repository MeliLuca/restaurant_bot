"use client";

import { useEffect } from "react";
import type { OpenOrder } from "@/lib/api";
import { useTicketStore } from "@/stores/ticket-store";

/**
 * Points the global ticket at the bill on screen.
 *
 * Needed because the shared checkout reads its target from the ticket store,
 * not from an argument: without this, paying a bill while the ticket still
 * pointed at another table would flush *that* table's unsent lines and close
 * *that* order. Binding makes the two agree.
 *
 * Rebinding is safe — the store stashes the outgoing target's pending lines as
 * a draft (see stashAndRestore), so nothing a waiter typed is lost — and it is
 * also what surfaces this bill's own unsent lines to the screen, which is why
 * the bill blocks payment until they are sent.
 */
export function useBillTarget(bill: OpenOrder | null, tableName: string | null) {
  const setMode = useTicketStore((s) => s.setMode);
  const setTable = useTicketStore((s) => s.setTable);
  const setSubtable = useTicketStore((s) => s.setSubtable);
  const setTakeaway = useTicketStore((s) => s.setTakeaway);

  // primitives, not the order object: `bill` is a fresh object after every
  // refresh and would otherwise re-run these on each poll
  const order = bill?.order;
  const orderId = order?.id ?? null;
  const takeaway = order?.order_type === "takeaway";
  const billTableId = order?.table_id ?? null;
  const subtable = order?.subtable ?? null;
  const customerName = order?.customer_name ?? null;

  useEffect(() => {
    if (!orderId) return;
    if (takeaway) {
      setMode("takeaway");
      setTakeaway(orderId, customerName ?? "");
    } else {
      setMode("table");
    }
  }, [orderId, takeaway, customerName, setMode, setTakeaway]);

  // `tableName` arrives with a second fetch; binding a nameless target would
  // leave the checkout toast blank
  useEffect(() => {
    if (takeaway || !billTableId || !tableName) return;
    setTable(billTableId, tableName);
  }, [takeaway, billTableId, tableName, setTable]);

  // runs after setTable in the same commit, which resets subtable to null
  useEffect(() => {
    if (takeaway || !billTableId || !tableName) return;
    setSubtable(subtable);
  }, [takeaway, billTableId, tableName, subtable, setSubtable]);
}
