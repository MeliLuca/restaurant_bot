"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { SmartFloorSettings } from "@/lib/database.types";
import { fetchSmartFloorSettings } from "@/lib/smart-floor/settings";
import { getSupabase } from "@/lib/supabase/client";

interface SmartFloorState {
  settings: SmartFloorSettings | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useSmartFloorStore = create<SmartFloorState>()((set) => ({
  settings: null,
  error: null,
  refresh: async () => {
    try {
      set({ settings: await fetchSmartFloorSettings(), error: null });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load Gestione Sala Smart",
      });
    }
  },
}));

// One realtime channel shared by every mounted consumer: flipping the module
// on the till shows (or hides) it on every device without a reload.
let channel: RealtimeChannel | null = null;
let consumers = 0;

function refreshNow() {
  void useSmartFloorStore.getState().refresh();
}

function onVisible() {
  if (document.visibilityState === "visible") refreshNow();
}

function subscribe() {
  consumers += 1;
  if (consumers > 1) return;
  refreshNow();
  channel = getSupabase()
    .channel("smart-floor-settings")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "smart_floor_settings" },
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
 * Gestione Sala Smart's settings, kept live. `enabled` stays false until they
 * load, so module UI never flashes in on a device where it is switched off.
 */
export function useSmartFloor() {
  useEffect(() => {
    subscribe();
    return unsubscribe;
  }, []);
  const settings = useSmartFloorStore((s) => s.settings);
  const error = useSmartFloorStore((s) => s.error);
  return {
    settings,
    enabled: settings?.enabled ?? false,
    loaded: settings !== null,
    error,
  };
}
