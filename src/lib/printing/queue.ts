// Held comande queue (server-side): list it per printer, probe whether the
// printer is back, reprint or discard. See dispatch.ts for how jobs get held.

import { getSupabase } from "@/lib/supabase/client";
import type { Printer, PrintJobKind } from "@/lib/database.types";
import { probePrinter, sendWithChecks, type HoldReason } from "./dispatch";

export interface HeldJob {
  id: string;
  kind: PrintJobKind;
  label: string | null;
  createdAt: string;
}

export interface PrinterQueue {
  printerId: string;
  printerName: string;
  /** Why the printer stopped (the first held job's reason) */
  reason: HoldReason;
  /** Live status from the last probe: null = ready to print. Only present
   * when the caller asked for a probe. */
  status?: HoldReason | null;
  jobs: HeldJob[];
}

// Every open device polls while a queue exists; cache probes so N devices
// don't each open a socket to a printer that serves one connection at a time.
const PROBE_TTL_MS = 8000;
const probeCache = new Map<string, { at: number; status: HoldReason | null }>();

async function cachedProbe(printer: Printer): Promise<HoldReason | null> {
  const hit = probeCache.get(printer.id);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.status;
  const status = await probePrinter(printer);
  probeCache.set(printer.id, { at: Date.now(), status });
  return status;
}

export async function loadQueues(probe: boolean): Promise<PrinterQueue[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("print_jobs")
    .select("id, kind, label, hold_reason, created_at, printer:printers(*)")
    .eq("status", "held")
    .order("created_at");
  if (error) throw new Error(error.message);

  const byPrinter = new Map<string, { printer: Printer; queue: PrinterQueue }>();
  for (const row of data) {
    const printer = row.printer as unknown as Printer | null;
    if (!printer) continue;
    let entry = byPrinter.get(printer.id);
    if (!entry) {
      entry = {
        printer,
        queue: {
          printerId: printer.id,
          printerName: printer.name,
          reason: (row.hold_reason as HoldReason | null) ?? "unreachable",
          jobs: [],
        },
      };
      byPrinter.set(printer.id, entry);
    }
    entry.queue.jobs.push({
      id: row.id,
      kind: row.kind,
      label: row.label,
      createdAt: row.created_at,
    });
  }

  const entries = Array.from(byPrinter.values());
  if (probe) {
    await Promise.all(
      entries.map(async (e) => {
        e.queue.status = await cachedProbe(e.printer);
      }),
    );
  }
  return entries.map((e) => e.queue);
}

export interface ReprintResult {
  printed: number;
  /** Jobs put back in the queue because the printer stopped again */
  remaining: number;
  reason?: HoldReason;
}

/**
 * Reprint the given held jobs of one printer, oldest first. The jobs are
 * claimed first (held → queued), so when two devices press "Ristampa tutte"
 * together only one of them prints each slip. On a new failure the job and
 * every one after it go back to 'held'.
 */
export async function reprintHeld(printerId: string, jobIds: string[]): Promise<ReprintResult> {
  const sb = getSupabase();
  const { data: claimed, error } = await sb
    .from("print_jobs")
    .update({ status: "queued" })
    .eq("printer_id", printerId)
    .eq("status", "held")
    .in("id", jobIds)
    .select("id, payload, attempts, created_at, printer:printers(*)")
    .order("created_at");
  if (error) throw new Error(error.message);
  if (claimed.length === 0) return { printed: 0, remaining: 0 };

  probeCache.delete(printerId);
  const printer = claimed[0].printer as unknown as Printer;
  let printed = 0;
  for (let i = 0; i < claimed.length; i++) {
    const job = claimed[i];
    // bytea comes back hex-encoded ("\x1b40…")
    const data = Buffer.from(job.payload.replace(/^\\x/, ""), "hex");
    const outcome = await sendWithChecks(printer, data);
    if (outcome.printed) {
      await sb
        .from("print_jobs")
        .update({
          status: "sent",
          attempts: job.attempts + 1,
          sent_at: new Date().toISOString(),
          hold_reason: null,
        })
        .eq("id", job.id);
      printed++;
      continue;
    }
    const rest = claimed.slice(i);
    await sb
      .from("print_jobs")
      .update({ status: "held", hold_reason: outcome.reason, last_error: outcome.error })
      .in(
        "id",
        rest.map((j) => j.id),
      );
    await sb
      .from("print_jobs")
      .update({ attempts: job.attempts + 1 })
      .eq("id", job.id);
    return { printed, remaining: rest.length, reason: outcome.reason };
  }
  return { printed, remaining: 0 };
}

/** Drop held jobs the staff chose not to reprint (kept for the log). */
export async function discardHeld(jobIds: string[]): Promise<void> {
  const { error } = await getSupabase()
    .from("print_jobs")
    .update({ status: "discarded" })
    .eq("status", "held")
    .in("id", jobIds);
  if (error) throw new Error(error.message);
}
