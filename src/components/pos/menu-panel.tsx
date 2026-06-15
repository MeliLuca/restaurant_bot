"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/constants";
import type { Category, MenuItem } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";

interface MenuPanelProps {
  categories: Category[];
  items: MenuItem[];
  onAdd: (item: MenuItem) => void;
}

export function MenuPanel({ categories, items, onAdd }: MenuPanelProps) {
  const t = useT();
  if (categories.length === 0) {
    return (
      <p className="p-6 text-muted-foreground">{t("pos.noCategories")}</p>
    );
  }

  return (
    <Tabs defaultValue={categories[0].id} className="flex h-full flex-col gap-4">
      <TabsList className="h-auto w-fit flex-wrap justify-start p-1">
        {categories.map((c) => (
          <TabsTrigger key={c.id} value={c.id} className="h-11 px-5 text-base">
            {c.name}
          </TabsTrigger>
        ))}
      </TabsList>

      {categories.map((c) => (
        <TabsContent
          key={c.id}
          value={c.id}
          className="mt-0 flex-1 overflow-y-auto"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {items
              .filter((i) => i.category_id === c.id)
              .map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onAdd(i)}
                  className="flex min-h-24 flex-col items-start justify-between gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                >
                  <span className="font-medium leading-tight">{i.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatMoney(i.price)}
                  </span>
                </button>
              ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
