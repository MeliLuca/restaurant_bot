// Raw TCP dispatch to LAN thermal printers (server-side only: node:net).
// Every payload is persisted to print_jobs before the socket opens, so a
// printer that's off/jammed leaves a row that can be re-fired later with the
// exact same bytes.
//
// A printer out of paper still accepts bytes over TCP, so a clean send proves
// nothing. Around each send we ask the printer for its real-time status
// (DLE EOT): before, so a printer that's already stopped isn't fed, and
// shortly after, so paper running out mid-slip is caught too. Printers that
// don't answer status queries are sent to blind, as before.
//
// Comande (kind comanda/cambio_tavolo) that can't print are parked as 'held'
// and every later comanda for that printer queues behind them, so they come
// out in order once someone reprints the queue. Receipts and tests never
// queue: they're needed now, the cashier just gets the error.

import { createConnection, type Socket } from "node:net";
import { getSupabase } from "@/lib/supabase/client";
import type { Printer, PrintJobKind } from "@/lib/database.types";
import { targetLabel } from "./layout";
import { renderTicket } from "./render";
import type { PrintPayload } from "./types";

const CONNECT_TIMEOUT_MS = 4000;
// How long a status query may take before we decide the printer doesn't
// support DLE EOT (answers arrive within a few ms on printers that do).
const STATUS_TIMEOUT_MS = 800;
// Wait after sending before the post-check: long enough for a comanda to
// print and for a roll running out mid-slip to trip the paper sensor.
const POST_CHECK_DELAY_MS = 2000;
// Some printers only answer once their buffer has printed, so allow longer.
const POST_CHECK_TIMEOUT_MS = 3000;

const DLE = 0x10;
const EOT = 0x04;
// DLE EOT 2 (offline cause) + DLE EOT 4 (roll paper sensor): two status bytes
const STATUS_QUERY = [DLE, EOT, 2, DLE, EOT, 4];

/** Why a comanda is held, as a code the UI translates. queued_behind = the
 * printer was fine as far as we know, but older comande are still waiting. */
export type HoldReason =
  | "paper_out"
  | "cover_open"
  | "printer_error"
  | "unreachable"
  | "queued_behind";

const REASON_MESSAGES: Record<HoldReason, string> = {
  paper_out: "printer is out of paper",
  cover_open: "printer cover is open",
  printer_error: "printer reports an error",
  unreachable: "printer unreachable",
  queued_behind: "earlier comande are waiting for this printer",
};

export interface DispatchResult {
  printerName: string;
  ok: boolean;
  error?: string;
  /** Set when the comanda was parked in the printer's queue */
  held?: HoldReason;
}

function isQueueable(kind: PrintJobKind): boolean {
  return kind === "comanda" || kind === "cambio_tavolo";
}

/** Status bytes always have bits 1 and 4 set and bits 0 and 7 clear. */
function isStatusByte(b: number): boolean {
  return (b & 0x93) === 0x12;
}

/** Decode [offline cause, paper sensor]; null when the printer can print. */
function decodeStatus([offline, paper]: number[]): HoldReason | null {
  if (offline & 0x04) return "cover_open";
  if (offline & 0x20 || paper & 0x60) return "paper_out";
  if (offline & 0x40) return "printer_error";
  return null;
}

/** One TCP session with a printer: raw writes plus status round-trips. */
class PrinterSession {
  private received: number[] = [];
  private waiter: (() => void) | null = null;

  private constructor(private socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      // Keep only status bytes: some firmwares also push ASB/garbage
      chunk.forEach((b) => {
        if (isStatusByte(b)) this.received.push(b);
      });
      this.waiter?.();
    });
    socket.on("error", () => this.waiter?.());
  }

  static open(host: string, port: number): Promise<PrinterSession> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port, timeout: CONNECT_TIMEOUT_MS });
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.once("timeout", () => fail(new Error(`timeout connecting to ${host}:${port}`)));
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.removeAllListeners("timeout");
        socket.removeAllListeners("error");
        socket.setTimeout(0);
        resolve(new PrinterSession(socket));
      });
    });
  }

  write(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Ask for the two status bytes; null if the printer doesn't answer. */
  async status(timeoutMs: number): Promise<number[] | null> {
    this.received = [];
    await this.write(Buffer.from(STATUS_QUERY));
    const deadline = Date.now() + timeoutMs;
    while (this.received.length < 2 && Date.now() < deadline && !this.socket.destroyed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deadline - Date.now());
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.waiter = null;
    }
    return this.received.length >= 2 ? this.received.slice(0, 2) : null;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.destroyed) return resolve();
      this.socket.end(() => resolve());
      setTimeout(() => {
        this.socket.destroy();
        resolve();
      }, 1000);
    });
  }
}

type SendOutcome = { printed: true } | { printed: false; reason: HoldReason; error: string };

function hostOf(printer: Printer): string {
  // inet may render with a netmask suffix ("192.168.1.200/32") — strip it
  return printer.local_ip.split("/")[0];
}

/**
 * Send one buffer with status checks around it. printed: false covers both
 * "never sent" and "sent but paper ran out" — either way the slip must be
 * printed again in full.
 */
export async function sendWithChecks(printer: Printer, data: Buffer): Promise<SendOutcome> {
  let session: PrinterSession;
  try {
    session = await PrinterSession.open(hostOf(printer), printer.port);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { printed: false, reason: "unreachable", error };
  }
  try {
    const before = await session.status(STATUS_TIMEOUT_MS);
    const blocked = before && decodeStatus(before);
    if (blocked) {
      return { printed: false, reason: blocked, error: REASON_MESSAGES[blocked] };
    }
    await session.write(data);
    if (before) {
      await new Promise((r) => setTimeout(r, POST_CHECK_DELAY_MS));
      const after = await session.status(POST_CHECK_TIMEOUT_MS);
      const failed = after && decodeStatus(after);
      if (failed) {
        return { printed: false, reason: failed, error: REASON_MESSAGES[failed] };
      }
    }
    return { printed: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { printed: false, reason: "unreachable", error };
  } finally {
    await session.close();
  }
}

/**
 * Ask a printer whether it could print right now, without printing.
 * Printers that don't answer status queries count as ready once reachable.
 */
export async function probePrinter(printer: Printer): Promise<HoldReason | null> {
  let session: PrinterSession;
  try {
    session = await PrinterSession.open(hostOf(printer), printer.port);
  } catch {
    return "unreachable";
  }
  try {
    const status = await session.status(STATUS_TIMEOUT_MS);
    return status ? decodeStatus(status) : null;
  } catch {
    return "unreachable";
  } finally {
    await session.close();
  }
}

async function hasHeldJobs(printerId: string): Promise<boolean> {
  const { count, error } = await getSupabase()
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("printer_id", printerId)
    .eq("status", "held");
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

async function dispatchOne(
  orderId: string | null,
  payload: PrintPayload,
  kind: PrintJobKind,
): Promise<DispatchResult> {
  const sb = getSupabase();
  const data = renderTicket(payload);
  const { printer } = payload;
  const queueable = isQueueable(kind);

  // Older comande still waiting: join the queue so the order is preserved.
  const behind = queueable && (await hasHeldJobs(printer.id));

  const { data: job, error: insertError } = await sb
    .from("print_jobs")
    .insert({
      printer_id: printer.id,
      order_id: orderId,
      payload: "\\x" + data.toString("hex"),
      kind,
      label: targetLabel(payload.ticket.meta),
      ...(behind ? { status: "held" as const, hold_reason: "queued_behind" } : {}),
    })
    .select("id")
    .single();
  if (insertError) {
    return { printerName: printer.name, ok: false, error: insertError.message };
  }
  if (behind) {
    return {
      printerName: printer.name,
      ok: false,
      error: REASON_MESSAGES.queued_behind,
      held: "queued_behind",
    };
  }

  const outcome = await sendWithChecks(printer, data);
  if (outcome.printed) {
    await sb
      .from("print_jobs")
      .update({ status: "sent", attempts: 1, sent_at: new Date().toISOString() })
      .eq("id", job.id);
    return { printerName: printer.name, ok: true };
  }
  await sb
    .from("print_jobs")
    .update({
      status: queueable ? "held" : "failed",
      attempts: 1,
      last_error: outcome.error,
      hold_reason: queueable ? outcome.reason : null,
    })
    .eq("id", job.id);
  return {
    printerName: printer.name,
    ok: false,
    error: outcome.error,
    ...(queueable ? { held: outcome.reason } : {}),
  };
}

/** Render and fire each payload to its printer in parallel (distinct hosts). */
export function dispatchPayloads(
  orderId: string | null,
  payloads: PrintPayload[],
  kind: PrintJobKind,
): Promise<DispatchResult[]> {
  return Promise.all(payloads.map((p) => dispatchOne(orderId, p, kind)));
}
