// POST /api/print/test — fire a sample ticket at one printer so managers can
// verify the IP/port/paper configuration from the admin panel.
// Body: { printerId: string }

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/client";
import { dispatchPayloads } from "@/lib/printing/dispatch";
import type { Ticket, TicketMeta } from "@/lib/printing/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const printerId: unknown = body?.printerId;
  if (typeof printerId !== "string") {
    return NextResponse.json({ error: "printerId is required" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const [{ data: printer, error }, settingsResult] = await Promise.all([
      sb.from("printers").select("*").eq("id", printerId).maybeSingle(),
      sb.from("restaurant_settings").select("*").single(),
    ]);
    if (error) throw new Error(error.message);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (!printer) {
      return NextResponse.json({ error: "Printer not found" }, { status: 404 });
    }

    const meta: TicketMeta = {
      ticketNumber: 0,
      tableName: "PROVA",
      subtable: null,
      customerName: null,
      serverName: "Test",
      openedAt: new Date().toISOString(),
    };
    const sampleLines = [
      { quantity: 1, name: "Stampa di prova", modifiers: ["FUNZIONA"], unitPrice: 0, lineTotal: 0 },
    ];
    const ticket: Ticket =
      printer.printer_type === "CASSA"
        ? {
            kind: "CASSA",
            meta,
            company: settingsResult.data,
            lines: sampleLines,
            subtotal: 0,
            taxRate: 0,
            tax: 0,
            total: 0,
          }
        : {
            kind: printer.printer_type === "BAR" ? "BAR" : "CUCINA",
            meta,
            lines: sampleLines,
          };

    const jobs = await dispatchPayloads(null, [{ printer, ticket }]);
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Print dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
