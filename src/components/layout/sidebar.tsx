"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ReceiptText, Settings, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/floor-plan", label: "Floor Plan", icon: LayoutGrid },
  { href: "/pos", label: "POS", icon: ReceiptText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-24 shrink-0 flex-col items-center border-r bg-card py-4 lg:w-56 lg:items-stretch lg:px-3">
      <div className="mb-6 flex items-center justify-center gap-2 px-2 lg:justify-start">
        <UtensilsCrossed className="h-8 w-8 text-primary" />
        <span className="hidden text-lg font-semibold lg:inline">Trattoria</span>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
              <Icon className="h-6 w-6" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
