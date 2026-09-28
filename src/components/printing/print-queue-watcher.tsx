"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { discardHeldJobs, fetchPrintQueues, reprintHeldJobs } from "@/lib/api";
import { useT } from "@/lib/i18n/use-translation";
import type { PrinterQueue } from "@/lib/printing/queue";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// How often every device asks whether a stopped printer is back. The server
// caches probes, so more devices don't mean more sockets to the printer.
const POLL_MS = 10_000;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

/**
 * App-wide watcher for comande held because a printer stopped (see
 * lib/printing/queue.ts). Shows a floating pill per stopped printer on every
 * device and, once the printer answers "ready" again, pops the reprint
 * dialog. Whoever confirms first reprints; realtime clears it elsewhere.
 * Mounted once in the root layout.
 */
export function PrintQueueWatcher() {
  const t = useT();
  const [queues, setQueues] = useState<PrinterQueue[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Più tardi" on a ready printer: don't pop it again until it stops anew
  const snoozed = useRef(new Set<string>());
  const wasReady = useRef(new Map<string, boolean>());

  const refresh = useCallback(async () => {
    try {
      const next = await fetchPrintQueues(true);
      setQueues(next);
      for (const q of next) {
        const ready = q.status === null;
        const before = wasReady.current.get(q.printerId);
        wasReady.current.set(q.printerId, ready);
        if (!ready) snoozed.current.delete(q.printerId);
        else if (!before && !snoozed.current.has(q.printerId)) {
          // just came back (or found ready on load): ask to reprint
          setOpenId((cur) => cur ?? q.printerId);
        }
      }
      const live = new Set(next.map((q) => q.printerId));
      Array.from(wasReady.current.keys()).forEach((id) => {
        if (!live.has(id)) {
          wasReady.current.delete(id);
          snoozed.current.delete(id);
        }
      });
    } catch {
      // queue is advisory; keep the last known state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = getSupabase()
      .channel(`print-jobs-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "print_jobs" },
        () => void refresh(),
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      void getSupabase().removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Poll only while something is waiting
  const waiting = queues.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [waiting, refresh]);

  const open = queues.find((q) => q.printerId === openId) ?? null;
  const ready = open?.status === null;

  function close() {
    if (open && ready) snoozed.current.add(open.printerId);
    setOpenId(null);
  }

  async function reprintAll() {
    if (!open) return;
    setBusy(true);
    try {
      const res = await reprintHeldJobs(
        open.printerId,
        open.jobs.map((j) => j.id),
      );
      if (res.remaining > 0) {
        toast.warning(
          t("printQueue.stoppedAgain", {
            printed: res.printed,
            remaining: res.remaining,
            reason: t(`printQueue.reason.${res.reason ?? "unreachable"}`),
          }),
        );
      } else if (res.printed > 0) {
        toast.success(t("printQueue.reprinted", { count: res.printed }));
      }
      setOpenId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("printQueue.reprintFailed"));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function discard(jobId: string) {
    try {
      await discardHeldJobs([jobId]);
      // drop it now; the refresh below re-probes, which takes a moment
      setQueues((prev) =>
        prev
          .map((q) => ({ ...q, jobs: q.jobs.filter((j) => j.id !== jobId) }))
          .filter((q) => q.jobs.length > 0),
      );
      await refresh();
    } catch {
      toast.error(t("printQueue.discardFailed"));
    }
  }

  if (queues.length === 0) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 print:hidden sm:bottom-4">
        {queues.map((q) => {
          const back = q.status === null;
          return (
            <button
              key={q.printerId}
              type="button"
              onClick={() => setOpenId(q.printerId)}
              className={cn(
                "pointer-events-auto flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg",
                back
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-amber-500 text-black hover:bg-amber-600",
              )}
            >
              {back ? (
                <Printer className="size-4 shrink-0" />
              ) : (
                <TriangleAlert className="size-4 shrink-0" />
              )}
              <span className="truncate">
                {back
                  ? t("printQueue.back", { printer: q.printerName, count: q.jobs.length })
                  : `${t("printQueue.stopped", {
                      printer: q.printerName,
                      count: q.jobs.length,
                    })} · ${t(`printQueue.reason.${q.status ?? q.reason}`)}`}
              </span>
            </button>
          );
        })}
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("printQueue.dialogTitle", { printer: open?.printerName ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {ready
                ? t("printQueue.readyDescription")
                : t("printQueue.stoppedDescription", {
                    reason: t(`printQueue.reason.${open?.status ?? open?.reason ?? "unreachable"}`),
                  })}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-md border">
            {open?.jobs.map((job) => (
              <li key={job.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="tabular-nums text-muted-foreground">{timeOf(job.createdAt)}</span>
                <span className="flex-1 truncate">
                  <span className="font-medium">{job.label ?? "—"}</span>
                  <span className="text-muted-foreground"> · {t(`printQueue.kind.${job.kind}`)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void discard(job.id)}
                  aria-label={t("printQueue.discard")}
                >
                  <X />
                  {t("printQueue.discard")}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-12" disabled={busy} onClick={close}>
              {t("printQueue.later")}
            </Button>
            <Button className="h-12" disabled={busy || !ready} onClick={reprintAll}>
              {busy
                ? t("printQueue.reprinting")
                : t("printQueue.reprintAll", { count: open?.jobs.length ?? 0 })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
