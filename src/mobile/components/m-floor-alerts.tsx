"use client";

import { usePathname } from "next/navigation";
import { FloorAlerts } from "@/components/smart-floor/floor-alerts";
import { isFocusedFlow } from "./m-tab-bar";

/**
 * Gestione Sala Smart's alerts on the phone (Admin, Sala Manager): a table
 * ready for the waitlist, a late booking. Not over an order being built or a
 * bill being paid — the same screens that hide the tab bar.
 */
export function MFloorAlerts() {
  const pathname = usePathname();
  if (isFocusedFlow(pathname)) return null;
  return <FloorAlerts phone />;
}
