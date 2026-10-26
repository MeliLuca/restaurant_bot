// POST /api/ai/order/custom-item — the category's "Fuori menù" placeholder,
// created on first use. Body: { categoryId }. An off-menu line is sent as
// this item with its own name in order_items.custom_name.

import { NextResponse } from "next/server";
import { aiError, aiFailure, guardAi, readBody } from "@/lib/ai/guard";
import { ensureCustomItem } from "@/lib/ai/order/placeholder";

export async function POST(request: Request) {
  const guard = await guardAi();
  if (!guard.ok) return guard.response;
  const body = await readBody(request);
  const categoryId = body?.categoryId;
  if (typeof categoryId !== "string" || !/^[0-9a-f-]{36}$/i.test(categoryId)) {
    return aiError("categoryId is required", 400, "bad_request");
  }
  try {
    const item = await ensureCustomItem(categoryId);
    if (!item) return aiError("Category not found", 404, "failed");
    return NextResponse.json(item);
  } catch (e) {
    return aiFailure(e);
  }
}
