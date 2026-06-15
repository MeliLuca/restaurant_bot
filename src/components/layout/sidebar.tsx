"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutGrid,
  LogOut,
  MessageCircle,
  ReceiptText,
  Settings,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/auth/permissions";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";
import { useUnreadTotal } from "@/stores/chat-store";

const NAV_ITEMS: {
  href: string;
  labelKey: TranslationKey;
  icon: typeof LayoutGrid;
  permission?: Permission;
}[] = [
  { href: "/floor-plan", labelKey: "nav.floorPlan", icon: LayoutGrid },
  { href: "/pos", labelKey: "nav.pos", icon: ReceiptText, permission: "take_orders" },
  { href: "/chat", labelKey: "nav.chat", icon: MessageCircle },
  { href: "/stats", labelKey: "nav.stats", icon: BarChart3, permission: "view_stats" },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const unread = useUnreadTotal();

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      !item.permission || (user?.permissions.includes(item.permission) ?? false),
  );

  return (
    <aside className="flex h-full w-24 shrink-0 flex-col items-center border-r bg-card py-4 print:hidden lg:w-56 lg:items-stretch lg:px-3">
      <div className="mb-6 flex items-center justify-center gap-2 px-2 lg:justify-start">
        <UtensilsCrossed className="h-8 w-8 text-primary" />
        <span className="hidden text-lg font-semibold lg:inline">
          {t("nav.brand")}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {visibleItems.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                // min 56px tap target for tablet use
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors",
                "lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-base",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span className="relative">
                <Icon className="h-6 w-6" />
                {href === "/chat" && unread > 0 && (
                  <span
                    className="absolute -right-2.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                    aria-label={t("nav.unreadMessages", { count: unread })}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
              <span>{t(labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="flex flex-col items-center gap-1 border-t pt-3 lg:items-stretch">
          <div className="flex flex-col items-center gap-0.5 px-2 lg:flex-row lg:gap-2">
            <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 text-center lg:text-left">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {user.roleName}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-sm"
          >
            <LogOut className="h-5 w-5" />
            <span>{t("nav.switchUser")}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
