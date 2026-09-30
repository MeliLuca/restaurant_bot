import { TAX_RATE } from "@/lib/constants";

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface TicketTotals {
  subtotal: number;
  tax: number;
  total: number;
}

// Math is done in integer cents to avoid floating-point drift. Historical
// orders pass their snapshotted orders.tax_rate; new tickets use the default.
export function calcTotals(
  lines: PricedLine[],
  taxRate: number = TAX_RATE,
): TicketTotals {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity,
    0,
  );
  const taxCents = Math.round(subtotalCents * taxRate);
  return {
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    total: (subtotalCents + taxCents) / 100,
  };
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** A line's variation as the pricing sees it. */
export interface PricedModifier {
  /** List price as an addition; 0 on a removal */
  priceAdjustment: number;
  isRemoval?: boolean;
  /** Removals only: the ingredient's listino price, credited against an
   * addition when the customer swaps one ingredient for another. Pricing-only
   * — the DB keeps removals at price_adjustment 0. */
  creditPrice?: number;
}

/**
 * Net price of each added ingredient once swaps are settled, most-expensive
 * first, in cents, with the index of the modifier it came from. A removed
 * ingredient credits its listino price against ONE addition ("tolgo X, metto
 * Y"): same price → the swap is free, pricier addition → only the difference
 * is paid, cheaper addition → free, never a discount. Exact-price matches
 * pair first (the rule staff actually state), then the biggest leftover credit
 * goes to the biggest remaining addition; unused credit is simply lost.
 * Free-of-charge results drop out of the ranking.
 */
function netAdditions(
  modifiers: PricedModifier[],
): Array<{ index: number; cents: number }> {
  const net = modifiers
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => !m.isRemoval && m.priceAdjustment > 0)
    .map(({ m, index }) => ({ index, cents: toCents(m.priceAdjustment) }))
    .sort((a, b) => b.cents - a.cents);
  const credits = modifiers
    .filter((m) => m.isRemoval && (m.creditPrice ?? 0) > 0)
    .map((m) => toCents(m.creditPrice!))
    .sort((a, b) => b - a);

  const used = net.map(() => false);
  const leftover: number[] = [];
  for (const c of credits) {
    const i = net.findIndex((a, j) => !used[j] && a.cents === c);
    if (i >= 0) {
      net[i] = { ...net[i], cents: 0 };
      used[i] = true;
    } else {
      leftover.push(c);
    }
  }
  for (const c of leftover) {
    const i = used.indexOf(false); // unused entries are still sorted
    if (i < 0) break;
    net[i] = { ...net[i], cents: Math.max(0, net[i].cents - c) };
    used[i] = true;
  }
  return net.filter((a) => a.cents > 0).sort((a, b) => b.cents - a.cents);
}

/**
 * What each modifier is charged, in (fractional) cents, indexed like the
 * input. Swaps and the diminishing scale applied, then scaled down so the
 * entries sum to exactly the rounded surcharge. Analytics attribution — keep
 * pricing itself on addedIngredientsSurcharge.
 */
export function addedIngredientsCharges(modifiers: PricedModifier[]): number[] {
  const charges = modifiers.map(() => 0);
  const ranked = netAdditions(modifiers);
  let raw = 0;
  ranked.forEach(({ index, cents }, i) => {
    charges[index] = cents * Math.log2(1 + 1 / (i + 1));
    raw += charges[index];
  });
  if (raw === 0) return charges;
  const scale = floorToTenCents(raw) / raw;
  return charges.map((c) => c * scale);
}

// Surcharges round DOWN to the 10 cents (house rule: 7,58 → 7,50). The
// epsilon absorbs float noise: log2 sums that are exactly 200 can land on
// 199.99999999999997 and must not floor to 190.
function floorToTenCents(cents: number): number {
  return Math.floor(cents / 10 + 1e-9) * 10;
}

/**
 * Extra charge for the ingredients ADDED to a dish, on a diminishing
 * logarithmic scale. Add-ons range ≈€1–€3 and customers heavily modify
 * standard pizzas, so each successive ingredient is charged less than the
 * last. After swaps are settled (netAdditions) the ingredients are ranked
 * most-expensive-first and the i-th one (1-based) is charged at weight:
 *
 *     w(i) = log2(1 + 1/i)            // w(1)=1, w(2)≈0.585, w(3)≈0.415, …
 *
 * so P_total = Σ price(i) · w(i). The weights telescope — Σ_{i=1..n} w(i) =
 * log2(n+1) — so when every add-on costs the same this is exactly the old
 * aggregate form S·log2(n+1)/n (n=1 full price, n=2 ≈0.79×, n=3 ≈0.67×, …).
 * Charging per rank rather than tapering the whole sum keeps it MONOTONE:
 * because every weight is ≥ 0 and ranks only shift down (to weaker weights)
 * when a pricier item is inserted, adding an ingredient can never lower the
 * surcharge — the old closed form could (a cheap add-on shrank the factor
 * faster than it grew the sum, dropping the charge). Removing a standard
 * ingredient is never a deduction by itself; it only offsets an addition
 * (a swap). Order-independent: it reads only the current set of modifiers.
 * Euros, rounded DOWN to the 10 cents — only the surcharge is rounded, so a
 * hand-set base price keeps its exact cents.
 */
export function addedIngredientsSurcharge(modifiers: PricedModifier[]): number {
  const ranked = netAdditions(modifiers);
  if (ranked.length === 0) return 0;
  const totalCents = ranked.reduce(
    (sum, { cents }, i) => sum + cents * Math.log2(1 + 1 / (i + 1)),
    0,
  );
  return floorToTenCents(totalCents) / 100;
}

/**
 * Linear sum of the additions once swaps are settled, before the taper —
 * separates "the swap saved this" from "the diminishing scale saved this" in
 * the picker footer. Euros, cent-exact.
 */
export function addedIngredientsNetSum(modifiers: PricedModifier[]): number {
  return netAdditions(modifiers).reduce((sum, a) => sum + a.cents, 0) / 100;
}

/**
 * Plain linear sum S of the added ingredients, before the diminishing taper —
 * lets the POS show the "before → after" of the scale. Euros, cent-exact.
 */
export function addedIngredientsLinearSum(modifiers: PricedModifier[]): number {
  return (
    modifiers
      .filter((m) => !m.isRemoval && m.priceAdjustment > 0)
      .reduce((sum, m) => sum + toCents(m.priceAdjustment), 0) / 100
  );
}

/**
 * Price actually charged per unit: base price plus the diminishing surcharge
 * for added ingredients (removals add nothing, but offset a swapped-in one). This is what
 * order_items.unit_price snapshots, so downstream money flows (totals, splits,
 * stats, receipt) never re-derive modifiers.
 */
export function unitPriceWithModifiers(
  basePrice: number,
  modifiers: PricedModifier[],
): number {
  return (
    (toCents(basePrice) + toCents(addedIngredientsSurcharge(modifiers))) / 100
  );
}

/**
 * Split an integer cent amount into `parts` near-equal shares that sum back
 * to the amount exactly — the first `remainder` shares carry the extra cent
 * (e.g. 1000/3 → [334, 333, 333]), so no rounding error can accumulate.
 */
export function splitCents(totalCents: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}

/**
 * Cents still owed on an order after its partial payments.
 *
 * Lives here rather than in api.ts because it is pure money math with no
 * Supabase involvement — which also lets bill-preview.ts use it without
 * creating an import cycle back through the data layer.
 */
export function remainingBalanceCents(
  order: { total: number },
  payments: { amount: number }[],
): number {
  return (
    toCents(order.total) - payments.reduce((sum, p) => sum + toCents(p.amount), 0)
  );
}
