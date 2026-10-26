// POST /api/ai/analytics/products — revenue, trend and margin per product.
// Body: AnalyticsRangeRequest → ProductStatsResponse (contracts/analytics.ts).
// The figures are computed; with `insights` (default) the model adds 3–5
// observations on a digest of them — null when it is unavailable.

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { parseRangeRequest } from "@/lib/ai/analytics/range";
import { computeProductStats } from "@/lib/ai/analytics/products";

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const parsed = parseRangeRequest(await readBody(request));
  if (!parsed.ok) return aiError(parsed.error, 400, "bad_request");
  try {
    return NextResponse.json(await computeProductStats(parsed.value));
  } catch (e) {
    return aiFailure(e);
  }
}
