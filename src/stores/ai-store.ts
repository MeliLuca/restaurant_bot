"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { AiSettings } from "@/lib/database.types";
import { AI_PROTOTYPE_UI } from "@/lib/ai/flags";
import { fetchAiSettings } from "@/lib/ai/settings";
import { getSupabase } from "@/lib/supabase/client";

interface AiState {
  settings: AiSettings | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useAiStore = create<AiState>()((set) => ({
  settings: null,
  error: null,
  refresh: async () => {
    try {
      set({ settings: await fetchAiSettings(), error: null });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load Assistente AI",
      });
    }
  },
}));

// One realtime channel shared by every mounted consumer (same pattern as
// smart-floor-store): flipping the module shows or hides it everywhere.
let channel: RealtimeChannel | null = null;
let consumers = 0;

function refreshNow() {
  void useAiStore.getState().refresh();
}

function onVisible() {
  if (document.visibilityState === "visible") refreshNow();
}

function subscribe() {
  consumers += 1;
  if (consumers > 1) return;
  refreshNow();
  channel = getSupabase()
    .channel("ai-settings")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ai_settings" },
      refreshNow,
    )
    .subscribe();
  document.addEventListener("visibilitychange", onVisible);
}

function unsubscribe() {
  consumers -= 1;
  if (consumers > 0) return;
  if (channel) {
    void getSupabase().removeChannel(channel);
    channel = null;
  }
  document.removeEventListener("visibilitychange", onVisible);
}

/**
 * The Assistente AI prototype's settings, kept live. `available` = this build
 * carries the prototype (env flag); `enabled` = available AND switched on.
 * Without the flag nothing is fetched and everything reads false.
 */
export function useAiModule() {
  useEffect(() => {
    if (!AI_PROTOTYPE_UI) return;
    subscribe();
    return unsubscribe;
  }, []);
  const settings = useAiStore((s) => s.settings);
  const error = useAiStore((s) => s.error);
  return {
    available: AI_PROTOTYPE_UI,
    settings,
    enabled: AI_PROTOTYPE_UI && (settings?.enabled ?? false),
    loaded: !AI_PROTOTYPE_UI || settings !== null,
    error,
  };
}
