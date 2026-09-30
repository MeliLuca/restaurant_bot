"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, MessageCircle, ReceiptText, ShoppingBag } from "lucide-react";
import { useTakeawayBadge } from "@/hooks/use-takeaway-badge";
import type { Permission } from "@/lib/auth/permissions";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";
import { useUnreadTotal } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { mRoutes } from "@/mobile/lib/routes";

/**
 * Four tabs at the very most, and only the ones this role actually works.
 * Order-taking is a flow entered from a table, not a destination — which is
 * what keeps every label full-width and readable. The desktop bottom nav packs
 * eight cells into the same space and truncates them all ("Statis…", "Impos…").
 *
 * Take-away is the one that comes and goes: a host seating tables has no use
 * for the queue, and an irrelevant tab here costs a quarter of the bar.
 */
const TABS: {
  href: string;
  labelKey: TranslationKey;
  icon: typeof LayoutGrid;
  permission?: Permission;
}[] = [
  { href: mRoutes.tables(), labelKey: "m.tabTables", icon: LayoutGrid },
  { href: mRoutes.bills(), labelKey: "m.tabBills", icon: ReceiptText },
  {
    href: mRoutes.takeaway(),
    labelKey: "m.tabTakeaway",
    icon: ShoppingBag,
    permission: "view_takeaway",
  },
  { href: mRoutes.chat(), labelKey: "m.tabChat", icon: MessageCircle },
];

/** Focused flows own the whole screen: the tabs would both steal room from
 *  the cart bar and invite a stray tap that abandons a half-built round. */
export function isFocusedFlow(pathname: string): boolean {
  return pathname.endsWith("/order") || pathname.endsWith("/pay");
}

export function MTabBar() {
  const pathname = usePathname();
  const t = useT();
  const unread = useUnreadTotal();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const takeaway = useTakeawayBadge(permissions.includes("view_takeaway"));

  if (isFocusedFlow(pathname)) return null;

  // one number per tab at most; red = something is late
  const badgeFor = (href: string) =>
    href === mRoutes.chat() && unread > 0
      ? { count: unread, alert: false, label: t("nav.unreadMessages", { count: unread }) }
      : href === mRoutes.takeaway() && takeaway.open > 0
        ? {
            count: takeaway.open,
            alert: takeaway.late > 0,
            label:
              takeaway.late > 0
                ? t("nav.takeawaysLate", { count: takeaway.open, late: takeaway.late })
                : t("nav.takeawaysOpen", { count: takeaway.open }),
          }
        : null;

  const visible = TABS.filter(
    (tab) => !tab.permission || permissions.includes(tab.permission),
  );

  return (
    <nav className="flex shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)]">
      {visible.map(({ href, labelKey, icon: Icon }) => {
        const active = pathname.startsWith(href);
        const badge = badgeFor(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-accent-foreground",
            )}
          >
            <span className="relative">
              <Icon className="h-6 w-6" />
              {badge && (
                <span
                  title={badge.label}
                  className={cn(
                    "absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 tabular-nums",
                    badge.alert ? "bg-red-500 text-white" : "bg-primary text-primary-foreground",
                  )}
                >
                  <span aria-hidden>{badge.count > 99 ? "99+" : badge.count}</span>
                  <span className="sr-only">{badge.label}</span>
                </span>
              )}
            </span>
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
