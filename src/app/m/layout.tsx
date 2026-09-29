import { MFloorAlerts } from "@/mobile/components/m-floor-alerts";
import { MTabBar } from "@/mobile/components/m-tab-bar";
import { OfflineBar } from "@/mobile/components/offline-bar";

/**
 * The phone shell. <AppShell> hands /m a bare viewport with no ancestor height
 * constraint, so this layout owns the height: a fixed-height column where the
 * tab bar is pinned and <main> takes the rest.
 *
 * <main> deliberately does NOT scroll. Each screen is a flex column that owns
 * its own scroll region, which is what lets the order screen pin a cart bar
 * below a scrolling menu instead of having it scroll away.
 *
 * Safe areas: top/left/right are inset here so every screen inherits them —
 * the left/right pair is what matters in practice, since a phone turned
 * landscape puts the notch over the header's back button and the tab bar's
 * first label. The bottom is deliberately NOT inset here; the tab bar and each
 * screen's own action bar handle it, and doing both would double the gap.
 */
export default function MobileLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      <OfflineBar />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <MTabBar />
      <MFloorAlerts />
    </div>
  );
}
