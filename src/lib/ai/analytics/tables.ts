// Assistente AI — analytics: rotation and revenue per table. SERVER ONLY.
// The numbers are tableStats (lib/analytics/aggregate.ts); the model only
// comments a rounded digest of them.

import { fetchOrdersForRange, fetchTablesForAnalytics } from "@/lib/analytics-api";
import { tableStats, type TableStatRow } from "@/lib/analytics/aggregate";
import type { TableStatsResponse } from "@/lib/ai/contracts/analytics";
import { WEEKDAY_IT, pct, r0, r1, writeObservations } from "./insights";
import type { ParsedRange } from "./range";

function digestRow(t: TableStatRow) {
  return {
    tavolo: t.tableName,
    sala: t.mapName,
    posti: t.capacity,
    incasso: r0(t.revenue),
    tavolate: t.bills,
    rotazioni_per_servizio: r1(t.rotationsPerService),
    euro_per_coperto: r1(t.revenuePerCover),
    euro_per_ora_occupata: r1(t.revenuePerTableHour),
    euro_per_posto_ora: r1(t.revenuePerSeatHour),
    minuti_medi: t.avgMinutes,
    quota_pct: pct(t.share),
  };
}

export async function computeTableStats(req: ParsedRange): Promise<TableStatsResponse> {
  const [orders, tables] = await Promise.all([
    fetchOrdersForRange(req.range),
    fetchTablesForAnalytics(),
  ]);
  const stats = tableStats(orders, tables, req.range, req.weekday);

  const body: TableStatsResponse = {
    range: {
      from: req.from,
      to: req.to,
      weekday: req.weekday,
      days: stats.days,
      serviceDays: stats.openDays,
    },
    tables: stats.tables,
    totals: { ...stats.totals, openHours: stats.openHours },
    byWeekday: stats.byWeekday,
    insights: null,
    ai: null,
  };

  if (req.insights && stats.totals.bills > 0) {
    const used = stats.tables.filter((t) => t.bills > 0);
    const idle = stats.tables.filter((t) => t.bills === 0);
    // the weakest use of the seats, not merely the smallest tables
    const weakest = [...used]
      .sort((a, b) => (a.revenuePerSeatHour ?? 0) - (b.revenuePerSeatHour ?? 0))
      .slice(0, 5);
    const days = stats.byWeekday.filter((d) => d.bills > 0);
    const best = [...days].sort((a, b) => b.revenue - a.revenue)[0];
    const digest = {
      periodo: {
        dal: req.from,
        al: req.to,
        solo_giorno: req.weekday === null ? null : WEEKDAY_IT[req.weekday],
        giorni_aperti: stats.openDays,
      },
      totale: {
        incasso: r0(stats.totals.revenue),
        tavolate: stats.totals.bills,
        coperti: stats.totals.covers,
        euro_per_coperto: r1(stats.totals.revenuePerCover),
        minuti_medi: stats.totals.avgMinutes,
        rotazioni_per_tavolo_usato: r1(stats.totals.rotationsPerService),
      },
      tavoli_migliori: used.slice(0, 5).map(digestRow),
      tavoli_meno_redditizi: used.length > 5 ? weakest.map(digestRow) : [],
      // a bare count next to table names reads as a table ("tavolo 89")
      quanti_tavoli_senza_conti: idle.length,
      alcuni_tavoli_senza_conti: idle.slice(0, 8).map((t) => t.tableName),
      // one weekday with seatings is no comparison
      giorno_migliore:
        best && days.length > 1
          ? { giorno: WEEKDAY_IT[best.weekday], incasso: r0(best.revenue), tavolate: best.bills }
          : null,
    };
    const ai = await writeObservations(
      "tavoli",
      digest,
      stats.tables.map((t) => t.tableName),
    );
    if (ai) {
      body.insights = ai.insights;
      body.ai = ai.ai;
    }
  }
  return body;
}
