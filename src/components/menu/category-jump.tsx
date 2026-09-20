"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n/use-translation";
import { categoryEmoji } from "@/lib/category-icons";
import type { Category } from "@/lib/database.types";

/**
 * What replaced the category chips. The chips were permanent chrome for an
 * occasional need — you pick a category when you first arrive, then browse or
 * search. So the categories moved behind one button, and the screen they gave
 * back went to the food.
 */

interface CategoryJumpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** Items per category id, so a section's size is visible before jumping */
  counts: Map<string, number>;
  onPick: (categoryId: string) => void;
  /** Bottom sheet on the phone, centred panel at the till */
  variant: "sheet" | "dialog";
}

export function CategoryJump({
  open,
  onOpenChange,
  categories,
  counts,
  onPick,
  variant,
}: CategoryJumpProps) {
  const t = useT();
  const title = t("pos.jumpToCategory");

  // Alphabetical, not the listino's sort_order. Order on the paper menu is a
  // course order nobody browsing this list is following: they already know the
  // category they want and are hunting for its name, which is faster to find
  // in the order names are filed in. The menu itself keeps its own order.
  const sorted = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, "it", { sensitivity: "base" }),
  );

  const list = (
    <ul
      className={
        variant === "dialog"
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
          : "divide-y overflow-y-auto"
      }
    >
      {sorted.map((c) => {
        const count = counts.get(c.id) ?? 0;
        if (count === 0) return null;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => {
                onPick(c.id);
                onOpenChange(false);
              }}
              className={
                variant === "dialog"
                  ? "flex min-h-14 w-full items-center justify-between gap-2 rounded-lg border px-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "flex min-h-14 w-full items-center justify-between gap-2 px-4 text-left active:bg-accent"
              }
            >
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="shrink-0 text-3xl leading-none">
                  {categoryEmoji(c.name)}
                </span>
                <span className="min-w-0 truncate text-base font-medium">
                  {c.name}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {count}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (variant === "dialog") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogTitle>{title}</DialogTitle>
          {list}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="h-[70dvh]">
        <div className="flex h-full flex-col">
          <SheetTitle className="shrink-0 px-4 pb-2 text-base">
            {title}
          </SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
