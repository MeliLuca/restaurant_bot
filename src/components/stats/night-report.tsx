"use client";

import { formatMoney } from "@/lib/constants";
import type { Category } from "@/lib/database.types";
import { serviceDayEnd, type ItemStat, type NightSummary } from "@/lib/stats-api";

const REPORT_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const PRINTED_AT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function totalOrders(summary: NightSummary): number {
  return summary.paidCount + summary.openCount + summary.cancelledCount;
}

export function itemsTotal(items: ItemStat[]): number {
  return (
    items.reduce((sum, i) => sum + Math.round(i.revenue * 100), 0) / 100
  );
}

/** CSV version of the night report (items + subtotals, order counts, totals) */
export function buildNightCsv(
  dayStart: Date,
  summary: NightSummary,
  items: ItemStat[],
  categoryNames: Map<string, Category>,
): string {
  const esc = (value: string | number) => {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cells: (string | number)[]) => cells.map(esc).join(",");

  const lines = [
    row("Night", REPORT_DAY_FORMATTER.format(dayStart)),
    row("Service window", "6:00 AM - 6:00 AM next day"),
    "",
    row("Orders"),
    row("Bills closed (paid)", summary.paidCount),
    row("Still open", summary.openCount),
    row("Cancelled", summary.cancelledCount),
    row("Total orders", totalOrders(summary)),
    "",
    row("Items ordered (paid & open orders)"),
    row("Item", "Category", "Quantity", "Subtotal"),
    ...items.map((i) =>
      row(
        i.name,
        (i.categoryId && categoryNames.get(i.categoryId)?.name) ?? "Uncategorized",
        i.quantity,
        i.revenue.toFixed(2),
      ),
    ),
    row("Items total", "", summary.itemsOrdered, itemsTotal(items).toFixed(2)),
    "",
    row("Revenue (paid bills)"),
    row("Subtotal", summary.paidSubtotal.toFixed(2)),
    row("Tax", summary.paidTax.toFixed(2)),
    row("Total", summary.paidTotal.toFixed(2)),
    row("Dine-in", summary.dineInPaidTotal.toFixed(2)),
    row("Take-away", summary.takeawayPaidTotal.toFixed(2)),
    row("Still open (not yet paid)", summary.openTotal.toFixed(2)),
  ];
  return lines.join("\n");
}

interface NightReportProps {
  dayStart: Date;
  summary: NightSummary;
  items: ItemStat[];
  categoryNames: Map<string, Category>;
}

/** Print-only layout: rendered hidden on screen, shown by the print stylesheet */
export function NightReport({
  dayStart,
  summary,
  items,
  categoryNames,
}: NightReportProps) {
  return (
    <section className="hidden text-black print:block">
      <h1 className="text-2xl font-bold">Trattoria — Night stats</h1>
      <p className="mt-1 text-sm">
        Service from {REPORT_DAY_FORMATTER.format(dayStart)} 6:00 AM to{" "}
        {REPORT_DAY_FORMATTER.format(serviceDayEnd(dayStart))} 6:00 AM ·
        printed {PRINTED_AT_FORMATTER.format(new Date())}
      </p>

      <h2 className="mt-6 text-lg font-semibold">Orders</h2>
      <table className="mt-2 w-full max-w-md border-collapse text-sm">
        <tbody>
          <tr className="border-b border-neutral-300">
            <td className="py-1">Bills closed (paid)</td>
            <td className="py-1 text-right tabular-nums">{summary.paidCount}</td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">Still open</td>
            <td className="py-1 text-right tabular-nums">{summary.openCount}</td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">Cancelled</td>
            <td className="py-1 text-right tabular-nums">
              {summary.cancelledCount}
            </td>
          </tr>
          <tr className="font-semibold">
            <td className="py-1">Total orders</td>
            <td className="py-1 text-right tabular-nums">
              {totalOrders(summary)}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-lg font-semibold">Items ordered</h2>
      <p className="text-xs text-neutral-600">
        Across paid & open orders; subtotals are before tax.
      </p>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-700 text-left">
            <th className="py-1 font-semibold">Item</th>
            <th className="py-1 font-semibold">Category</th>
            <th className="py-1 text-right font-semibold">Qty</th>
            <th className="py-1 text-right font-semibold">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-600">
                Nothing ordered.
              </td>
            </tr>
          )}
          {items.map((item) => (
            <tr key={item.menuItemId} className="border-b border-neutral-300">
              <td className="py-1">{item.name}</td>
              <td className="py-1">
                {(item.categoryId && categoryNames.get(item.categoryId)?.name) ??
                  "Uncategorized"}
              </td>
              <td className="py-1 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1 text-right tabular-nums">
                {formatMoney(item.revenue)}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1" colSpan={2}>
              Items total
            </td>
            <td className="py-1 text-right tabular-nums">
              {summary.itemsOrdered}
            </td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(itemsTotal(items))}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-lg font-semibold">Revenue (paid bills)</h2>
      <table className="mt-2 w-full max-w-md border-collapse text-sm">
        <tbody>
          <tr className="border-b border-neutral-300">
            <td className="py-1">Subtotal</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.paidSubtotal)}
            </td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">Tax</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.paidTax)}
            </td>
          </tr>
          <tr className="border-b border-neutral-300 font-semibold">
            <td className="py-1">Total</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.paidTotal)}
            </td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">Dine-in / Take-away</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.dineInPaidTotal)} /{" "}
              {formatMoney(summary.takeawayPaidTotal)}
            </td>
          </tr>
          <tr>
            <td className="py-1">Still open (not yet paid)</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.openTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
