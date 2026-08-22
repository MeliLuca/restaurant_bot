import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * "auto" lets the device decide; the other two are explicit choices made from
 * the "Versione desktop" / "Versione telefono" controls. Persisted per device
 * (same pattern as rms-auth / rms-lang) because that is the right scope: a
 * shared terminal should not inherit a waiter's phone preference.
 */
export type UiMode = "auto" | "desktop" | "mobile";

interface UiModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

export const useUiModeStore = create<UiModeState>()(
  persist(
    (set) => ({
      mode: "auto",
      setMode: (mode) => set({ mode }),
    }),
    { name: "rms-ui-mode" },
  ),
);
