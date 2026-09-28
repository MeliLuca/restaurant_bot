// POST /api/print/queue/discard — drop held comande without printing them.
// Body: { jobIds: string[] }.

import { NextResponse } from "next/server";
import { discardHeld } from "@/lib/printing/queue";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const jobIds: unknown = body?.jobIds;
  if (!Array.isArray(jobIds) || !jobIds.every((i) => typeof i === "string")) {
    return NextResponse.json({ error: "jobIds are required" }, { status: 400 });
  }
  try {
    await discardHeld(jobIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Discard failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
