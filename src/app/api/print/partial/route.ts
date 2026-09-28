// POST /api/print/partial — CASSA receipt for a subset of an order's lines
// (split-by-item payment): ONLY the paid items, under a "PAGAMENTO PARZIALE"
// banner. Totals are recomputed from the selected lines; the optional `total`
// is the amount actually charged (the last partial absorbs tax-rounding
// drift, so the caller's figure wins over a fresh computation).
// Body: { orderId: string, orderItemIds: string[], total?: number }

import { NextResponse } from "next/server";
import { loadOrderPrintContext } from "@/lib/printing/data";
import { buildCassaPayload } from "@/lib/printing/route-order";
import { dispatchPayloads } from "@/lib/printing/dispatch";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId: unknown = body?.orderId;
  const orderItemIds: unknown = body?.orderItemIds;
  if (
    typeof orderId !== "string" ||
    !Array.isArray(orderItemIds) ||
    orderItemIds.length === 0 ||
    !orderItemIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "orderId and orderItemIds are required" },
      { status: 400 },
    );
  }

  try {
    const ctx = await loadOrderPrintContext(orderId, orderItemIds);
    if (!ctx || ctx.items.length === 0) {
      return NextResponse.json(
        { error: "Order or items not found" },
        { status: 404 },
      );
    }

    const subtotalCents = ctx.items.reduce(
      (sum, i) => sum + Math.round(i.unit_price * 100) * i.quantity,
      0,
    );
    const totalCents =
      typeof body?.total === "number" && body.total >= 0
        ? Math.round(body.total * 100)
        : subtotalCents + Math.round(subtotalCents * ctx.order.tax_rate);

    const payload = buildCassaPayload(
      {
        ...ctx.order,
        subtotal: subtotalCents / 100,
        tax: (totalCents - subtotalCents) / 100,
        total: totalCents / 100,
      },
      ctx.items,
      ctx.printers,
      ctx.templates,
      ctx.settings,
      ctx.meta,
      "PARZIALE",
    );
    if (!payload) {
      return NextResponse.json(
        { error: "No active CASSA printer configured" },
        { status: 409 },
      );
    }
    const jobs = await dispatchPayloads(ctx.order.id, [payload], "conto");
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Print dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
