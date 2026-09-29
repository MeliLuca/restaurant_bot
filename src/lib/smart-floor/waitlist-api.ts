import { occupyTables } from "@/lib/api";
import type { WaitlistEntry } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import type { QueueParty } from "./queue";

export type WaitlistFields = Pick<
  WaitlistEntry,
  "customer_name" | "party_size" | "phone" | "tag_ids" | "map_id" | "notes"
>;

/** Parties still waiting that joined since `since` (earlier ones are stale) */
export async function fetchWaitlist(since: Date): Promise<WaitlistEntry[]> {
  const { data, error } = await getSupabase()
    .from("waitlist")
    .select("*")
    .eq("status", "waiting")
    .gte("created_at", since.toISOString())
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function addToWaitlist(fields: WaitlistFields): Promise<string> {
  const { data, error } = await getSupabase()
    .from("waitlist")
    .insert(fields)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function updateWaitlistEntry(
  id: string,
  fields: Partial<WaitlistFields>,
): Promise<void> {
  const { error } = await getSupabase().from("waitlist").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

/** "Salta per ora": the party keeps its place but claims no table until `until` */
export async function skipWaitlistEntry(id: string, until: Date | null): Promise<void> {
  const { error } = await getSupabase()
    .from("waitlist")
    .update({ skip_until: until ? until.toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Out of the queue: seated (anywhere) or gone */
export async function resolveWaitlistEntry(
  id: string,
  status: "seated" | "left",
): Promise<void> {
  const { error } = await getSupabase()
    .from("waitlist")
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Sit the party on these tables (occupied, linked) and take it off the queue */
export async function seatWaitlistEntry(id: string, tableIds: string[]): Promise<void> {
  await occupyTables(tableIds);
  await resolveWaitlistEntry(id, "seated");
}

export function toQueueParty(e: WaitlistEntry): QueueParty {
  return {
    id: e.id,
    name: e.customer_name,
    partySize: e.party_size,
    tagIds: e.tag_ids,
    mapId: e.map_id,
    joinedAt: Date.parse(e.created_at),
    skipUntil: e.skip_until ? Date.parse(e.skip_until) : null,
  };
}
