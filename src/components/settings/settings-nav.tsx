"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const LINKS: { href: string; label: string; permission: string | null }[] = [
  { href: "/settings", label: "General", permission: null },
  { href: "/settings/menu", label: "Menu", permission: "manage_menu" },
  { href: "/settings/tables", label: "Tables & tags", permission: "manage_floor" },
  {
    href: "/settings/availability",
    label: "Availability",
    permission: "manage_availability",
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);

  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.filter(
        (l) => l.permission === null || permissions.includes(l.permission),
      ).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
            pathname === l.href
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
