"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isPhone } from "@/lib/device";
import { MOBILE_ROOT, isMobileRoute } from "@/lib/mobile-route";
import { useUiModeStore } from "@/stores/ui-mode-store";

/**
 * Mounted OUTSIDE <AuthGate>, which renders <LockScreen/> rather than its
 * children when signed out — inside it, a phone would sit on the desktop route
 * through the whole PIN entry and only bounce afterwards.
 */
export function DeviceRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const mode = useUiModeStore((s) => s.mode);

  // The preference is persisted, and zustand rehydrates it asynchronously.
  // Acting on the default "auto" before rehydration would bounce a waiter who
  // explicitly chose the desktop UI, on every single load.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useUiModeStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useUiModeStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const onMobile = isMobileRoute(pathname);
    // An explicit choice always wins; "auto" defers to the device test.
    const wantMobile = mode === "auto" ? isPhone() : mode === "mobile";

    // replace(), never push(): the abandoned URL must not sit in the back stack.
    if (wantMobile && !onMobile) router.replace(`${MOBILE_ROOT}/tables`);
    else if (mode === "desktop" && onMobile) router.replace("/floor-plan");
    // Note the asymmetry: a tablet or desktop that *lands* on /m under "auto"
    // is left alone — /m is usable at any width, and one-way redirection makes
    // a ping-pong loop structurally impossible (mode cannot be both values).
    // If anyone later adds "bounce desktops out of /m under auto", that
    // invariant breaks.
  }, [hydrated, pathname, mode, router]);

  return null;
}
