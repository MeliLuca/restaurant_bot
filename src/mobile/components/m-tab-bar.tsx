"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, MessageCircle, ReceiptText } from "lucide-react";
import { useT } from "@/lib/i18n/use-translation";
import { useUnreadTotal } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import { mRoutes } from "@/mobile/lib/routes";

/**
 * Three tabs, deliberately. Order-taking is a flow entered from a table, not a
 * destination — which is what keeps every label full-width and readable. The
 * desktop bottom nav packs eight cells into the same space and truncates them
 * all ("Statis…", "Impos…").
 */
const TABS = [
  { href: mRoutes.tables(), labelKey: "m.tabTables", icon: LayoutGrid },
  { href: mRoutes.bills(), labelKey: "m.tabBills", icon: ReceiptText },
  { href: mRoutes.chat(), labelKey: "m.tabChat", icon: MessageCircle },
] as const;

/** Focused flows own the whole screen: the tabs would both steal room from
 *  the cart bar and invite a stray tap that abandons a half-built round. */
function isFocusedFlow(pathname: string): boolean {
  return pathname.endsWith("/order") || pathname.endsWith("/pay");
}

export function MTabBar() {
  const pathname = usePathname();
  const t = useT();
  const unread = useUnreadTotal();

  if (isFocusedFlow(pathname)) return null;

  return (
    <nav className="flex shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ href, labelKey, icon: Icon }) => {
        const active = pathname.startsWith(href);
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
              {href === mRoutes.chat() && unread > 0 && (
                <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
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
