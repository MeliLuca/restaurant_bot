// Assistente AI — analytics: revenue, trend and (where a cost is set) margin
// per product. SERVER ONLY. The numbers are productStats
// (lib/analytics/aggregate.ts); the model only comments a rounded digest.

import { fetchCategoryNames, fetchOrdersForRange } from "@/lib/analytics-api";
import { productStats, type ProductStatRow } from "@/lib/analytics/aggregate";
import { previousPeriod } from "@/lib/analytics/date-range";
import type { MenuClass, ProductStatsResponse } from "@/lib/ai/contracts/analytics";
import { WEEKDAY_IT, pct, r0, writeObservations } from "./insights";
import type { ParsedRange } from "./range";

const CLASS_IT: Record<MenuClass, string> = {
  star: "stella (venduto e redditizio)",
  workhorse: "cavallo di battaglia (venduto, incassa poco)",
  puzzle: "enigma (incassa, si vende poco)",
  dog: "zavorra (poco venduto, incassa poco)",
};

function digestRow(p: ProductStatRow) {
  return {
    piatto: p.name,
    categoria: p.categoryName,
    pezzi: p.quantity,
    incasso: r0(p.revenue),
    quota_pct: pct(p.share),
    variazione_pct: pct(p.trend),
    ...(p.foodCostPct !== null
      ? { food_cost_pct: pct(p.foodCostPct), margine: r0(p.margin ?? 0) }
      : {}),
    classe: p.class ? CLASS_IT[p.class] : null,
  };
}

export async function computeProductStats(req: ParsedRange): Promise<ProductStatsResponse> {
  const [orders, prevOrders, categoryNames] = await Promise.all([
    fetchOrdersForRange(req.range),
    fetchOrdersForRange(previousPeriod(req.range)),
    fetchCategoryNames(),
  ]);
  const stats = productStats(orders, prevOrders, req.range, {
    weekday: req.weekday,
    categoryId: req.categoryId,
    categoryNames,
  });

  const body: ProductStatsResponse = {
    range: {
      from: req.from,
      to: req.to,
      weekday: req.weekday,
      categoryId: req.categoryId,
      days: stats.days,
      serviceDays: stats.openDays,
    },
    products: stats.products,
    totals: stats.totals,
    costCoverage: stats.costCoverage,
    insights: null,
    ai: null,
  };

  if (req.insights && stats.products.length > 0) {
    // dishes only: the coperto is a charge, a "Fuori menù" row is many dishes
    const dishes = stats.products.filter((p) => !p.isCoperto && !p.isCustom);
    const costed = dishes.filter((p) => p.foodCostPct !== null);
    const digest = {
      periodo: {
        dal: req.from,
        al: req.to,
        solo_giorno: req.weekday === null ? null : WEEKDAY_IT[req.weekday],
        categoria: req.categoryId ? (categoryNames.get(req.categoryId) ?? null) : null,
        giorni_aperti: stats.openDays,
      },
      totale: {
        incasso: r0(stats.totals.revenue),
        pezzi: stats.totals.quantity,
        incasso_periodo_precedente: r0(stats.totals.prevRevenue),
        variazione_pct: pct(stats.totals.trend),
        piatti_con_costo_pct: pct(stats.costCoverage),
        food_cost_pct: pct(stats.totals.foodCostPct),
      },
      piu_venduti: dishes.slice(0, 5).map(digestRow),
      meno_venduti: dishes.length > 5 ? dishes.slice(-5).reverse().map(digestRow) : [],
      food_cost_piu_alto: [...costed]
        .sort((a, b) => (b.foodCostPct ?? 0) - (a.foodCostPct ?? 0))
        .slice(0, 3)
        .map(digestRow),
      in_calo: dishes
        .filter((p) => p.trend !== null && p.trend < 0)
        .sort((a, b) => (a.trend ?? 0) - (b.trend ?? 0))
        .slice(0, 3)
        .map((p) => ({ piatto: p.name, variazione_pct: pct(p.trend), incasso: r0(p.revenue) })),
    };
    const ai = await writeObservations("prodotti", digest);
    if (ai) {
      body.insights = ai.insights;
      body.ai = ai.ai;
    }
  }
  return body;
}
