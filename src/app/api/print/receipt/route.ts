// POST /api/print/receipt — fire the full CASSA receipt for an order (all
// lines, company header, totals). Callable any time: checkout or reprint.
// With preconto: true it prints the same itemized bill under a big
// "PRE-CONTO / NON FISCALE" banner — purely informative, the order is not
// touched (this route never changes order/table state).
// Body: { orderId: string, preconto?: boolean }

import { NextResponse } from "next/server";
import { loadOrderPrintContext } from "@/lib/printing/data";
import { buildCassaPayload } from "@/lib/printing/route-order";
import { dispatchPayloads } from "@/lib/printing/dispatch";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId: unknown = body?.orderId;
  if (typeof orderId !== "string") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  const preconto = body?.preconto === true;

  try {
    const ctx = await loadOrderPrintContext(orderId);
    if (!ctx) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const payload = buildCassaPayload(
      ctx.order,
      ctx.items,
      ctx.printers,
      ctx.templates,
      ctx.settings,
      ctx.meta,
      preconto ? "PRECONTO" : "CONTO",
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
