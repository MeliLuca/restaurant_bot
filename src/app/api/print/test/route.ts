// POST /api/print/test — fire a sample ticket at one printer so managers can
// verify the IP/port/paper configuration and the look of a template.
// Body: { printerId: string, template?: DraftTemplate, variant?, service? }
// Without `template` the printer's own template is used (conto on a CASSA,
// comanda elsewhere); with it, the editor's unsaved draft is printed as-is.

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/client";
import { dispatchPayloads } from "@/lib/printing/dispatch";
import { sampleTicket } from "@/lib/printing/sample";
import type { ContoVariant, PrintTemplate } from "@/lib/printing/template";
import { normalizeBlocks, resolveTemplate } from "@/lib/printing/template";

const VARIANTS: ContoVariant[] = ["CONTO", "PRECONTO", "PARZIALE"];

function draftFromBody(raw: unknown): PrintTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "COMANDA" && r.kind !== "CONTO") return null;
  return {
    id: null,
    name: typeof r.name === "string" ? r.name : "Bozza",
    kind: r.kind,
    paperSize: r.paperSize === "58mm" ? "58mm" : "80mm",
    blocks: normalizeBlocks(r.blocks, r.kind),
    feedLines:
      typeof r.feedLines === "number" ? Math.min(10, Math.max(0, Math.round(r.feedLines))) : 0,
    cut: r.cut !== false,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const printerId: unknown = body?.printerId;
  if (typeof printerId !== "string") {
    return NextResponse.json({ error: "printerId is required" }, { status: 400 });
  }
  const draft = body?.template === undefined ? null : draftFromBody(body.template);
  if (body?.template !== undefined && !draft) {
    return NextResponse.json({ error: "Invalid template" }, { status: 400 });
  }
  const variant: ContoVariant = VARIANTS.includes(body?.variant) ? body.variant : "CONTO";
  const service = body?.service === "takeaway" ? "takeaway" : "table";

  try {
    const sb = getSupabase();
    const [{ data: printer, error }, templatesResult, settingsResult] = await Promise.all([
      sb.from("printers").select("*").eq("id", printerId).maybeSingle(),
      sb.from("print_templates").select("*"),
      sb.from("restaurant_settings").select("*").single(),
    ]);
    if (error) throw new Error(error.message);
    if (templatesResult.error) throw new Error(templatesResult.error.message);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (!printer) {
      return NextResponse.json({ error: "Printer not found" }, { status: 404 });
    }

    const template =
      draft ??
      resolveTemplate(
        printer,
        printer.printer_type === "CASSA" ? "CONTO" : "COMANDA",
        templatesResult.data,
      );
    const ticket = sampleTicket({
      kind:
        template.kind === "CONTO"
          ? "CASSA"
          : printer.printer_type === "BAR"
            ? "BAR"
            : "CUCINA",
      company: settingsResult.data,
      variant,
      service,
    });

    const jobs = await dispatchPayloads(null, [{ printer, ticket, template }]);
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Print dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
