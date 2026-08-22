"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n/use-translation";

/**
 * Connection warning.
 *
 * Every screen here reads from Supabase over the restaurant's wifi, and a
 * phone carried across a dining room drops off it constantly. Without this the
 * failure is silent and misleading: the last fetch stays on screen, so a stale
 * bill looks like a current one.
 */
export function OfflineBar() {
  const t = useT();
  // starts online: navigator is unavailable during SSR, and assuming offline
  // would flash the bar on every load
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online) return null;

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-sm font-medium text-black">
      <WifiOff className="h-4 w-4 shrink-0" />
      {t("m.offline")}
    </div>
  );
}
