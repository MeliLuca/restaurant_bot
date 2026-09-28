// POST /api/print/transfer — the kitchen's "CAMBIO TAVOLO" notice: production
// slips for the lines just moved, printed under their NEW table with a banner
// naming where they came from, so nothing gets run to the old table.
// Body: { orderId: string, orderItemIds: string[], from: string }
// (`from` is the source as printed, e.g. "TAVOLO 3" or "TAVOLO 3/Gino")

import { NextResponse } from "next/server";
import { loadOrderPrintContext } from "@/lib/printing/data";
import { buildProductionPayloads } from "@/lib/printing/route-order";
import { dispatchPayloads } from "@/lib/printing/dispatch";
import { targetLabel } from "@/lib/printing/layout";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId: unknown = body?.orderId;
  const orderItemIds: unknown = body?.orderItemIds;
  const from: unknown = body?.from;
  if (
    typeof orderId !== "string" ||
    typeof from !== "string" ||
    !Array.isArray(orderItemIds) ||
    orderItemIds.length === 0 ||
    !orderItemIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "orderId, orderItemIds and from are required" },
      { status: 400 },
    );
  }

  try {
    const ctx = await loadOrderPrintContext(orderId, orderItemIds);
    if (!ctx) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const banner = [
      "CAMBIO TAVOLO",
      `DA: ${from.toUpperCase()}`,
      `A: ${targetLabel(ctx.meta)}`,
    ];
    const payloads = buildProductionPayloads(
      ctx.items,
      ctx.printers,
      ctx.templates,
      ctx.settings,
      ctx.meta,
    ).map((p) =>
      p.ticket.kind === "CASSA" ? p : { ...p, ticket: { ...p.ticket, banner } },
    );
    const jobs = await dispatchPayloads(ctx.order.id, payloads, "cambio_tavolo");
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Print dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
