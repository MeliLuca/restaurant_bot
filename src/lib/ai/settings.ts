import { getSupabase } from "@/lib/supabase/client";
import type { AiSettings } from "@/lib/database.types";

export type AiSettingsPatch = Partial<Omit<AiSettings, "id" | "updated_at">>;

/** Bounds of the numeric knobs — mirror the checks in the ai_assistant migration */
export const AI_LIMITS = {
  kitchen_late_minutes: [3, 120],
  bar_late_minutes: [1, 60],
  custom_dish_min_overlap: [0, 1],
} as const satisfies Partial<Record<keyof AiSettings, readonly [number, number]>>;

export type AiNumberKey = keyof typeof AI_LIMITS;

export async function fetchAiSettings(): Promise<AiSettings> {
  const { data, error } = await getSupabase()
    .from("ai_settings")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  // numeric comes back as a string from PostgREST
  return { ...data, custom_dish_min_overlap: Number(data.custom_dish_min_overlap) };
}

export async function updateAiSettings(fields: AiSettingsPatch): Promise<void> {
  const { error } = await getSupabase()
    .from("ai_settings")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}
