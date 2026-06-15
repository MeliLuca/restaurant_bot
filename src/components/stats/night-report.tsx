"use client";

import { formatMoney } from "@/lib/constants";
import type { Category } from "@/lib/database.types";
import { useT, type TFn } from "@/lib/i18n/use-translation";
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
  t: TFn,
): string {
  const esc = (value: string | number) => {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cells: (string | number)[]) => cells.map(esc).join(",");

  const lines = [
    row(t("report.night"), REPORT_DAY_FORMATTER.format(dayStart)),
    row(t("report.serviceWindowLabel"), t("report.serviceWindowValue")),
    "",
    row(t("report.orders")),
    row(t("report.billsClosedPaid"), summary.paidCount),
    row(t("report.stillOpen"), summary.openCount),
    row(t("report.cancelled"), summary.cancelledCount),
    row(t("report.totalOrders"), totalOrders(summary)),
    "",
    row(t("report.itemsOrderedParen")),
    row(t("report.item"), t("report.category"), t("report.qty"), t("report.subtotal")),
    ...items.map((i) =>
      row(
        i.name,
        (i.categoryId && categoryNames.get(i.categoryId)?.name) ??
          t("report.uncategorized"),
        i.quantity,
        i.revenue.toFixed(2),
      ),
    ),
    row(t("report.itemsTotal"), "", summary.itemsOrdered, itemsTotal(items).toFixed(2)),
    "",
    row(t("report.revenuePaidBills")),
    row(t("report.subtotal"), summary.paidSubtotal.toFixed(2)),
    row(t("report.tax"), summary.paidTax.toFixed(2)),
    row(t("report.total"), summary.paidTotal.toFixed(2)),
    row(t("report.dineIn"), summary.dineInPaidTotal.toFixed(2)),
    row(t("report.takeaway"), summary.takeawayPaidTotal.toFixed(2)),
    row(t("report.stillOpenNotPaid"), summary.openTotal.toFixed(2)),
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
  const t = useT();
  return (
    <section className="hidden text-black print:block">
      <h1 className="text-2xl font-bold">{t("report.title")}</h1>
      <p className="mt-1 text-sm">
        {t("report.servicePrinted", {
          start: REPORT_DAY_FORMATTER.format(dayStart),
          end: REPORT_DAY_FORMATTER.format(serviceDayEnd(dayStart)),
          printed: PRINTED_AT_FORMATTER.format(new Date()),
        })}
      </p>

      <h2 className="mt-6 text-lg font-semibold">{t("report.orders")}</h2>
      <table className="mt-2 w-full max-w-md border-collapse text-sm">
        <tbody>
          <tr className="border-b border-neutral-300">
            <td className="py-1">{t("report.billsClosedPaid")}</td>
            <td className="py-1 text-right tabular-nums">{summary.paidCount}</td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">{t("report.stillOpen")}</td>
            <td className="py-1 text-right tabular-nums">{summary.openCount}</td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">{t("report.cancelled")}</td>
            <td className="py-1 text-right tabular-nums">
              {summary.cancelledCount}
            </td>
          </tr>
          <tr className="font-semibold">
            <td className="py-1">{t("report.totalOrders")}</td>
            <td className="py-1 text-right tabular-nums">
              {totalOrders(summary)}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-lg font-semibold">{t("report.itemsOrdered")}</h2>
      <p className="text-xs text-neutral-600">
        {t("report.acrossPaidOpenSubtotals")}
      </p>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-700 text-left">
            <th className="py-1 font-semibold">{t("report.item")}</th>
            <th className="py-1 font-semibold">{t("report.category")}</th>
            <th className="py-1 text-right font-semibold">{t("report.qty")}</th>
            <th className="py-1 text-right font-semibold">
              {t("report.subtotal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-600">
                {t("report.nothingOrdered")}
              </td>
            </tr>
          )}
          {items.map((item) => (
            <tr key={item.menuItemId} className="border-b border-neutral-300">
              <td className="py-1">{item.name}</td>
              <td className="py-1">
                {(item.categoryId && categoryNames.get(item.categoryId)?.name) ??
                  t("report.uncategorized")}
              </td>
              <td className="py-1 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1 text-right tabular-nums">
                {formatMoney(item.revenue)}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1" colSpan={2}>
              {t("report.itemsTotal")}
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

      <h2 className="mt-6 text-lg font-semibold">
        {t("report.revenuePaidBills")}
      </h2>
      <table className="mt-2 w-full max-w-md border-collapse text-sm">
        <tbody>
          <tr className="border-b border-neutral-300">
            <td className="py-1">{t("report.subtotal")}</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.paidSubtotal)}
            </td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">{t("report.tax")}</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.paidTax)}
            </td>
          </tr>
          <tr className="border-b border-neutral-300 font-semibold">
            <td className="py-1">{t("report.total")}</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.paidTotal)}
            </td>
          </tr>
          <tr className="border-b border-neutral-300">
            <td className="py-1">{t("report.dineInTakeaway")}</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.dineInPaidTotal)} /{" "}
              {formatMoney(summary.takeawayPaidTotal)}
            </td>
          </tr>
          <tr>
            <td className="py-1">{t("report.stillOpenNotPaid")}</td>
            <td className="py-1 text-right tabular-nums">
              {formatMoney(summary.openTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
