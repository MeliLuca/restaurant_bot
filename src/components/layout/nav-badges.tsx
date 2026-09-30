"use client";

// The small numbers on the nav items. Each module owns its summary hook; this
// file only decides how they look and which item carries which, so a screen
// never has to show another module's lists to keep people aware of them.

import { useReservationsBadge } from "@/hooks/use-reservations-badge";
import { useTakeawayBadge } from "@/hooks/use-takeaway-badge";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { usePermission } from "@/stores/auth-store";
import { useUnreadTotal } from "@/stores/chat-store";

export interface NavBadgeData {
  count: number;
  /** alert = something needs doing (unread, late); neutral = just how many */
  tone: "neutral" | "alert";
  /** What the number means, for screen readers and the hover tip */
  label: string;
}

/** Badge per nav href, only where there is something to say */
export function useNavBadges(): Map<string, NavBadgeData> {
  const t = useT();
  const unread = useUnreadTotal();
  const takeaway = useTakeawayBadge(usePermission("view_takeaway"));
  const reservations = useReservationsBadge(usePermission("manage_reservations"));

  const badges = new Map<string, NavBadgeData>();
  if (unread > 0) {
    badges.set("/chat", {
      count: unread,
      tone: "alert",
      label: t("nav.unreadMessages", { count: unread }),
    });
  }
  if (takeaway.open > 0) {
    badges.set("/asporto", {
      count: takeaway.open,
      tone: takeaway.late > 0 ? "alert" : "neutral",
      label:
        takeaway.late > 0
          ? t("nav.takeawaysLate", { count: takeaway.open, late: takeaway.late })
          : t("nav.takeawaysOpen", { count: takeaway.open }),
    });
  }
  if (reservations.late > 0) {
    badges.set("/prenotazioni", {
      count: reservations.late,
      tone: "alert",
      label: t("nav.reservationsLate", { count: reservations.late }),
    });
  }
  return badges;
}

/** Pinned to the top-right corner of a nav icon (its parent is `relative`) */
export function NavBadge({ badge }: { badge: NavBadgeData }) {
  return (
    <span
      title={badge.label}
      className={cn(
        // the ring keeps it readable on the highlighted (active) item too
        "absolute -right-2.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-2 ring-card",
        badge.tone === "alert" ? "bg-red-500 text-white" : "bg-primary text-primary-foreground",
      )}
    >
      <span aria-hidden>{badge.count > 99 ? "99+" : badge.count}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}
