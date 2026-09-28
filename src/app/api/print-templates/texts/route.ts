// POST /api/print-templates/texts — the "Testi di stampa" save path. It can
// only replace the `text` of existing static text blocks: the stored blocks
// are re-read here and every other field (order, formatting, visibility,
// labels, placeholders in rows) is kept exactly as stored, whatever the body
// says. Anything that isn't a known text block of this template is refused,
// so this route can never change a template's layout.
// Body: { templateId: string, texts: { [blockId]: string } }

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/client";
import { normalizeBlocks } from "@/lib/printing/template";

// generous for a footer note, small enough that a paste accident isn't a roll
const MAX_TEXT_LENGTH = 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const templateId: unknown = body?.templateId;
  const texts: unknown = body?.texts;
  if (
    typeof templateId !== "string" ||
    !texts ||
    typeof texts !== "object" ||
    Array.isArray(texts) ||
    !Object.values(texts).every((v) => typeof v === "string")
  ) {
    return NextResponse.json(
      { error: "templateId and texts (block id → string) are required" },
      { status: 400 },
    );
  }
  const updates = texts as Record<string, string>;
  if (Object.values(updates).some((v) => v.length > MAX_TEXT_LENGTH)) {
    return NextResponse.json(
      { error: `Texts are limited to ${MAX_TEXT_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();
    const { data: row, error } = await sb
      .from("print_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const blocks = normalizeBlocks(row.blocks, row.kind);
    const textIds = new Set(blocks.filter((b) => b.type === "text").map((b) => b.id));
    const foreign = Object.keys(updates).filter((id) => !textIds.has(id));
    if (foreign.length > 0) {
      return NextResponse.json(
        { error: "Only the template's text blocks can be edited here" },
        { status: 400 },
      );
    }

    const next = blocks.map((b) =>
      b.type === "text" && b.id in updates ? { ...b, text: updates[b.id] } : b,
    );
    const { error: updateError } = await sb
      .from("print_templates")
      .update({ blocks: next, updated_at: new Date().toISOString() })
      .eq("id", templateId);
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the texts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
