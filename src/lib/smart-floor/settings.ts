import { getSupabase } from "@/lib/supabase/client";
import type { SmartFloorSettings } from "@/lib/database.types";

export type SmartFloorSettingsPatch = Partial<
  Omit<SmartFloorSettings, "id" | "updated_at">
>;

/** Bounds of the numeric knobs — mirror the checks in the smart_floor migration */
export const SMART_FLOOR_LIMITS = {
  meal_minutes: [30, 480],
  buffer_minutes: [0, 120],
  late_after_minutes: [5, 120],
  occupied_warn_minutes: [5, 180],
  overfill_seats: [0, 4],
  max_spare_seats: [0, 20],
  join_bonus_seats: [0, 4],
  join_distance: [0, 200],
  max_join_tables: [2, 8],
} as const satisfies Partial<Record<keyof SmartFloorSettings, readonly [number, number]>>;

export type SmartFloorNumberKey = keyof typeof SMART_FLOOR_LIMITS;

export async function fetchSmartFloorSettings(): Promise<SmartFloorSettings> {
  const { data, error } = await getSupabase()
    .from("smart_floor_settings")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateSmartFloorSettings(
  fields: SmartFloorSettingsPatch,
): Promise<void> {
  const { error } = await getSupabase()
    .from("smart_floor_settings")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/** A mandatory feature is never left out when a booking asks for it */
export async function setTagMandatory(
  tagId: string,
  mandatory: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from("table_tags")
    .update({ is_mandatory: mandatory })
    .eq("id", tagId);
  if (error) throw new Error(error.message);
}
