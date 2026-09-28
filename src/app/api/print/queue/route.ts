// GET /api/print/queue[?probe=1] — held comande grouped per printer. With
// probe, each printer is asked (cached a few seconds) whether it's back.

import { NextResponse } from "next/server";
import { loadQueues } from "@/lib/printing/queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get("probe") === "1";
  try {
    return NextResponse.json({ queues: await loadQueues(probe) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load the print queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
