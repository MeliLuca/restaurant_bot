"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MOBILE_ROOT, isMobileRoute } from "@/lib/mobile-route";
import { useUiModeStore } from "@/stores/ui-mode-store";

/**
 * Phone = coarse pointer AND a short screen edge below Tailwind's `sm`.
 *
 * `pointer: coarse` is the half that guarantees a desktop user is never
 * bounced — no mouse-driven browser reports coarse, so a laptop with a narrow
 * window stays put. Width alone would fail that.
 *
 * The short *screen* edge (not the viewport width) is what makes this
 * orientation-independent: a phone turned sideways has a >=640px viewport
 * (iPhone 14 landscape is 844), and a width test would throw the waiter back
 * to the desktop UI mid-shift. An iPad's 820 short edge stays on desktop,
 * which is correct — the w-24 rail is already tablet-tuned.
 *
 * Deliberately not user-agent sniffing: UA misclassifies iPadOS, which
 * requests desktop sites by default.
 */
function isPhone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) < 640
  );
}

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
