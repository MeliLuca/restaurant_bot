import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Lang = "it" | "en";

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/** UI language. Defaults to Italian (this is a trattoria) and persists the
 * user's choice per device, mirroring the auth-store pattern. */
export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: "it",
      setLang: (lang) => set({ lang }),
    }),
    { name: "rms-lang" },
  ),
);
