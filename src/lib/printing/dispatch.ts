// Raw TCP dispatch to LAN thermal printers (server-side only: node:net).
// Every payload is persisted to print_jobs before the socket opens, so a
// printer that's off/jammed leaves a 'failed' row that can be re-fired later
// with the exact same bytes.

import { createConnection } from "node:net";
import { getSupabase } from "@/lib/supabase/client";
import { renderTicket } from "./render";
import type { PrintPayload } from "./types";

const CONNECT_TIMEOUT_MS = 4000;

export interface DispatchResult {
  printerName: string;
  ok: boolean;
  error?: string;
}

function sendBuffer(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout: CONNECT_TIMEOUT_MS });
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.on("timeout", () => fail(new Error(`timeout connecting to ${host}:${port}`)));
    socket.on("error", fail);
    socket.on("connect", () => {
      socket.end(data, () => resolve());
    });
  });
}

async function dispatchOne(
  orderId: string | null,
  payload: PrintPayload,
): Promise<DispatchResult> {
  const sb = getSupabase();
  const data = renderTicket(payload);
  const { printer } = payload;

  const { data: job, error: insertError } = await sb
    .from("print_jobs")
    .insert({
      printer_id: printer.id,
      order_id: orderId,
      payload: "\\x" + data.toString("hex"),
    })
    .select("id")
    .single();
  if (insertError) {
    return { printerName: printer.name, ok: false, error: insertError.message };
  }

  try {
    // inet may render with a netmask suffix ("192.168.1.200/32") — strip it
    await sendBuffer(printer.local_ip.split("/")[0], printer.port, data);
    await sb
      .from("print_jobs")
      .update({ status: "sent", attempts: 1, sent_at: new Date().toISOString() })
      .eq("id", job.id);
    return { printerName: printer.name, ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sb
      .from("print_jobs")
      .update({ status: "failed", attempts: 1, last_error: message })
      .eq("id", job.id);
    return { printerName: printer.name, ok: false, error: message };
  }
}

/** Render and fire each payload to its printer in parallel (distinct hosts). */
export function dispatchPayloads(
  orderId: string | null,
  payloads: PrintPayload[],
): Promise<DispatchResult[]> {
  return Promise.all(payloads.map((p) => dispatchOne(orderId, p)));
}
