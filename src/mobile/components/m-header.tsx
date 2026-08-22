"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Monitor } from "lucide-react";
import { useT } from "@/lib/i18n/use-translation";
import { useUiModeStore } from "@/stores/ui-mode-store";

/**
 * Compact phone header: a back affordance, a title, and an optional action.
 * Deliberately one row — vertical space is the scarcest resource on this UI,
 * which is exactly what the desktop floor plan gets wrong on a phone.
 */
export function MHeader({
  title,
  backHref,
  action,
}: {
  title: string;
  backHref?: string;
  action?: React.ReactNode;
}) {
  return (
    // a flex sibling of the screen's scroll region, so it stays put without
    // needing sticky positioning
    <header className="flex min-h-14 shrink-0 items-center gap-1 border-b bg-card px-2">
      {backHref && (
        <Link
          href={backHref}
          aria-label="back"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-semibold">
        {title}
      </h1>
      {action}
    </header>
  );
}

/** Escape hatch out of the phone UI. Sets an explicit preference, so the
 *  device redirect stops sending this device to /m. */
export function DesktopSwitch() {
  const t = useT();
  const router = useRouter();
  const setMode = useUiModeStore((s) => s.setMode);

  return (
    <button
      type="button"
      title={t("m.desktopVersion")}
      aria-label={t("m.desktopVersion")}
      onClick={() => {
        setMode("desktop");
        router.replace("/floor-plan");
      }}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
    >
      <Monitor className="h-5 w-5" />
    </button>
  );
}
