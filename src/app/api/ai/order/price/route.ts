// POST /api/ai/order/price — the price of a dish that is not on the menu.
// Body: { text } ("pizza con burrata, crudo e pistacchio") or
// { categoryId, ingredients: string[], name? }. Priced from the most similar
// dish of the category with the POS variation rules; 404 when there is
// nothing to compare with.

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { priceDish } from "@/lib/ai/order/parse";

export const fetchCache = "force-no-store";

const isStrings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((s) => typeof s === "string");

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : undefined;
  const ingredients = body?.ingredients;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : undefined;
  if (categoryId !== undefined) {
    if (!isStrings(ingredients) || ingredients.length === 0) {
      return aiError("ingredients must be a non-empty array of strings", 400, "bad_request");
    }
  } else if (!text || text.length > 300) {
    return aiError("text (≤ 300 characters) or categoryId + ingredients is required", 400, "bad_request");
  }
  try {
    const result = await priceDish(
      categoryId !== undefined
        ? { categoryId, ingredients: ingredients as string[], name }
        : { text, name },
      guard.settings,
    );
    if (!result) return aiError("No similar dish to price it from", 404, "failed");
    return NextResponse.json(result);
  } catch (e) {
    return aiFailure(e);
  }
}
