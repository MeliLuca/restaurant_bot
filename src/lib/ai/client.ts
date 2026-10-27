"use client";

// Browser side of the /api/ai routes: one fetch helper, so every screen
// reads errors the same way.
import type { AiErrorBody } from "./contracts/common";

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: AiErrorBody["code"],
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

/** GET when `body` is undefined, else POST JSON (or `method`). Throws AiRequestError. */
export async function aiFetch<T>(
  path: string,
  body?: unknown,
  method?: "PATCH" | "DELETE",
): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as (T & Partial<AiErrorBody>) | null;
  if (!res.ok || data === null) {
    throw new AiRequestError(data?.error ?? `HTTP ${res.status}`, res.status, data?.code);
  }
  return data;
}
