import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

let client: SupabaseClient<Database> | null = null;

/**
 * supabase-js has no request timeout, so a reachable-but-unresponsive backend
 * hangs every query forever: the screen keeps its spinner and no catch block
 * ever runs. That is not the exotic case here — it is a phone associated to
 * the restaurant's wifi with no working route to the server, which the
 * `navigator.onLine` warning cannot detect either.
 *
 * A bounded wait turns those hangs into ordinary errors the screens already
 * know how to render. 15s is far longer than any query this app issues,
 * including the analytics aggregates.
 */
const REQUEST_TIMEOUT_MS = 15_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // a caller-supplied signal still wins; this only adds a ceiling
  if (init?.signal) return fetch(input, init);

  // AbortController rather than AbortSignal.timeout, deliberately:
  // postgrest-js retries any fetch rejection whose name is not "AbortError",
  // and AbortSignal.timeout rejects with "TimeoutError" — so the deadline
  // would simply be re-issued up to the retry budget and never bind. An
  // explicit abort is treated as final, while genuine transient errors
  // (a dropped connection) still get postgrest's retries.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// Lazy singleton so the app builds and the shell renders without credentials;
// only screens that actually query the database require .env.local to be set.
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Copy .env.local.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  client = createClient<Database>(url, anonKey, {
    global: { fetch: fetchWithTimeout },
  });
  return client;
}
