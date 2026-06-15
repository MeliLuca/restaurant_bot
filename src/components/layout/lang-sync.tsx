"use client";

import { useEffect } from "react";
import { useLangStore } from "@/lib/i18n/store";

/** Keeps <html lang> in sync with the selected UI language (the persisted
 * store rehydrates on the client, so this runs after mount). */
export function LangSync() {
  const lang = useLangStore((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}
