import { toast } from "sonner";
import type { PrintJobResult } from "@/lib/api";
import type { TFn } from "@/lib/i18n/use-translation";

/** Toast the outcome of a comande print: slips parked in a printer's queue
 * (the queue watcher takes it from there) apart from outright failures. */
export function warnOnSlipFailures(jobs: PrintJobResult[], t: TFn) {
  const held = jobs.filter((j) => !j.ok && j.held);
  const failed = jobs.filter((j) => !j.ok && !j.held);
  if (held.length > 0) {
    toast.warning(
      t("printQueue.heldToast", {
        printers: held.map((j) => j.printerName).join(", "),
      }),
    );
  }
  if (failed.length > 0) {
    toast.warning(
      t("pos.printerOffline", {
        printers: failed.map((f) => f.printerName).join(", "),
      }),
    );
  }
}
