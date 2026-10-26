// POST /api/ai/tables/suggest — the best tables for a party, now or later.
// Body: TableSuggestRequest (free text and/or the pieces). The tables come
// from the Gestione Sala Smart engine; the model only reads the text and
// explains the pick (lib/ai/tables).

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { parseRequest, suggestForRequest, TablesRequestError } from "@/lib/ai/tables/service";

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  if (!body) return aiError("Body must be a JSON object", 400, "bad_request");
  try {
    const parsed = parseRequest(body);
    if (parsed.text === null && parsed.partySize === null) {
      return aiError("Give a text or a partySize", 400, "bad_request");
    }
    return NextResponse.json(await suggestForRequest(parsed));
  } catch (e) {
    if (e instanceof TablesRequestError) return aiError(e.message, 400, "bad_request");
    return aiFailure(e);
  }
}
