"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";

// permission: null = everyone; an array = any one of them
const LINKS: {
  href: string;
  labelKey: TranslationKey;
  permission: string | string[] | null;
}[] = [
  { href: "/settings", labelKey: "settings.navGeneral", permission: null },
  { href: "/settings/menu", labelKey: "settings.navMenu", permission: "manage_menu" },
  { href: "/settings/tables", labelKey: "settings.navTablesTags", permission: "manage_floor" },
  { href: "/settings/floor-maps", labelKey: "settings.navFloorMaps", permission: "manage_floor" },
  {
    href: "/settings/availability",
    labelKey: "settings.navAvailability",
    permission: "manage_availability",
  },
  { href: "/settings/takeaway", labelKey: "settings.navTakeaway", permission: "manage_menu" },
  { href: "/settings/printers", labelKey: "settings.navPrinters", permission: "manage_printers" },
  {
    href: "/settings/print-templates",
    labelKey: "settings.navPrintTemplates",
    permission: "manage_printers",
  },
  {
    href: "/settings/print-texts",
    labelKey: "settings.navPrintTexts",
    permission: ["edit_print_texts", "manage_printers"],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const t = useT();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);

  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.filter(
        (l) =>
          l.permission === null ||
          [l.permission].flat().some((p) => permissions.includes(p)),
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
          {t(l.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
