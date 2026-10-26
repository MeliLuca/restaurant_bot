// GET /api/ai/kitchen/alerts — items in preparation longer than their
// station's threshold (Settings → Moduli), per item and per order.
// Query: ?summary=1 also asks the model for a short Italian summary (only
// when something is late; null when the model is unavailable).

import { NextResponse } from "next/server";
import { aiFailure, guardAi } from "@/lib/ai/guard";
import { kitchenAlerts } from "@/lib/ai/kitchen/alerts";

export const dynamic = "force-dynamic";
// Next 14.2 still caches the GET fetches of a GET-only handler under
// force-dynamic (revalidate defaults to false): without this the module
// switch and the open orders would be read once and then served forever
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  try {
    const summary = new URL(request.url).searchParams.get("summary") === "1";
    return NextResponse.json(await kitchenAlerts(guard.settings, { summary }));
  } catch (e) {
    return aiFailure(e);
  }
}
