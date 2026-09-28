// POST /api/print/queue/reprint — reprint held comande of one printer, oldest
// first. Body: { printerId: string, jobIds: string[] }.

import { NextResponse } from "next/server";
import { reprintHeld } from "@/lib/printing/queue";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const printerId: unknown = body?.printerId;
  const jobIds: unknown = body?.jobIds;
  if (
    typeof printerId !== "string" ||
    !Array.isArray(jobIds) ||
    !jobIds.every((i) => typeof i === "string")
  ) {
    return NextResponse.json(
      { error: "printerId and jobIds are required" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await reprintHeld(printerId, jobIds));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Reprint failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
