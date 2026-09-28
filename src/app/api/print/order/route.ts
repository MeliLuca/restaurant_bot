// POST /api/print/order — fire production slips (CUCINA/BAR) for an order.
// Body: { orderId: string, orderItemIds?: string[] } — pass the ids of the
// round just sent so reorders don't reprint the whole ticket.

import { NextResponse } from "next/server";
import { loadOrderPrintContext } from "@/lib/printing/data";
import { buildProductionPayloads } from "@/lib/printing/route-order";
import { dispatchPayloads } from "@/lib/printing/dispatch";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId: unknown = body?.orderId;
  const orderItemIds: unknown = body?.orderItemIds;
  if (typeof orderId !== "string") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  if (
    orderItemIds !== undefined &&
    !(Array.isArray(orderItemIds) && orderItemIds.every((i) => typeof i === "string"))
  ) {
    return NextResponse.json(
      { error: "orderItemIds must be an array of ids" },
      { status: 400 },
    );
  }

  try {
    const ctx = await loadOrderPrintContext(orderId, orderItemIds);
    if (!ctx) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const payloads = buildProductionPayloads(
      ctx.items,
      ctx.printers,
      ctx.templates,
      ctx.settings,
      ctx.meta,
    );
    const jobs = await dispatchPayloads(ctx.order.id, payloads, "comanda");
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Print dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
