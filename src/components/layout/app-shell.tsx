"use client";

import { usePathname } from "next/navigation";
import { isMobileRoute } from "@/lib/mobile-route";
import { Sidebar } from "./sidebar";

/**
 * Chooses the app chrome. The phone tree under /m owns its whole viewport —
 * no desktop rail, no bottom-nav padding, and crucially no outer scroll
 * container, so its own sticky bars are measured against the right box. It
 * supplies its chrome from src/app/m/layout.tsx.
 *
 * Rendered inside <AuthGate>, which returns null until the persisted auth
 * store rehydrates. The desktop chrome is therefore never in the SSR HTML at
 * all, so this usePathname() branch only ever evaluates post-hydration and
 * cannot produce a mismatch.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isMobileRoute(pathname)) return <>{children}</>;

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <Sidebar />
      {/* pb-14 clears the phone bottom nav rendered by <Sidebar> */}
      <main className="flex-1 overflow-y-auto pb-14 print:overflow-visible sm:pb-0">
        {children}
      </main>
    </div>
  );
}
