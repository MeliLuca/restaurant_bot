"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/constants";
import { useT, type TFn } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/database.types";
import { menuLabel, menuLabelText, type MenuItemView } from "@/lib/menu-display";
import { groupByCategory } from "@/lib/menu-search";

/**
 * The menu, as one continuous scroll with sticky category headers — the shape
 * every delivery app's restaurant page settled on, and the reason this replaced
 * both the till's wrapping tab strip and the phone's chip rail. With 18
 * categories those cost most of a phone screen before a single dish was
 * visible; here the food starts at the top and the category is a header you
 * scroll past, or jump to from the search bar.
 *
 * Searching narrows this same list rather than opening a dropdown, so results
 * keep their section headers: "prosciutto" reads as hits under Piadine, Panini
 * and Pizze, which is the answer to "where do I find it", not just "what".
 */

/** Rough section heights for content-visibility; the browser corrects them. */
const ROW_HEIGHT = 68;
const CARD_HEIGHT = 112;
const HEADER_HEIGHT = 44;
/** Mid-breakpoint guess: the grid is 2/3/4 columns depending on width. */
const GRID_COLUMNS_ESTIMATE = 3;
/** Frames a category jump will re-aim for before accepting where it landed. */
const MAX_SCROLL_CORRECTIONS = 10;

export type MenuListVariant = "grid" | "rows";

interface MenuListProps {
  categories: Category[];
  /** Already filtered by the query — this component only groups and renders */
  items: MenuItemView[];
  /** Pending ordered quantity per menu_item_id; drives the tint and the badge */
  counts: Map<string, number>;
  /** Raw query, for the empty state only */
  query: string;
  variant: MenuListVariant;
  onAdd: (item: MenuItemView) => void;
  /** Category to bring to the top; the caller clears it once handled */
  scrollToCategoryId?: string | null;
  onScrolledToCategory?: () => void;
  className?: string;
  /** Grid variant only: replaces the default column classes, for a list that
   * sits in a narrower column than the viewport suggests */
  gridColsClassName?: string;
}

export function MenuList({
  categories,
  items,
  counts,
  query,
  variant,
  onAdd,
  scrollToCategoryId,
  onScrolledToCategory,
  className,
  gridColsClassName,
}: MenuListProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const sections = useMemo(
    () => groupByCategory(items, categories),
    [items, categories],
  );

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  // Rows are memoised, so the add handler has to keep a stable identity or
  // every tap would re-render all 1,000 of them.
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;
  const lastAdded = useRef<{ id: string; title: string } | null>(null);
  const handleAdd = useCallback((item: MenuItemView, title: string) => {
    lastAdded.current = { id: item.id, title };
    onAddRef.current(item);
  }, []);

  // Announced once, in one live region — never per row. Keyed off the counts
  // actually changing, so a rejected add (no table selected) stays silent.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const last = lastAdded.current;
    if (!last) return;
    const n = counts.get(last.id) ?? 0;
    if (n > 0) {
      setAnnouncement(`${last.title} · ${t("pos.orderedCount", { count: n })}`);
    }
  }, [counts, t]);

  useEffect(() => {
    if (!scrollToCategoryId) return;
    const section = sectionRefs.current.get(scrollToCategoryId);
    const container = scrollRef.current;
    onScrolledToCategory?.();
    if (!section || !container) return;

    // Sections are laid out from an estimate until they actually render, so
    // scrolling past them changes their height and moves the target out from
    // under us. Re-aim each frame until it stops moving — landing a category
    // header anywhere but the top is the one thing this button must not do.
    let frame = 0;
    let attempts = 0;
    const settle = () => {
      const top = section.offsetTop;
      if (Math.abs(container.scrollTop - top) < 1 || attempts++ >= MAX_SCROLL_CORRECTIONS) {
        return;
      }
      container.scrollTop = top;
      frame = requestAnimationFrame(settle);
    };
    container.scrollTop = section.offsetTop;
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [scrollToCategoryId, onScrolledToCategory]);

  return (
    <div
      ref={scrollRef}
      className={cn("relative min-h-0 flex-1 overflow-y-auto", className)}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {sections.length === 0 && (
        <p className="p-6 text-muted-foreground">
          {query.trim()
            ? t("pos.noItemsMatch", { query: query.trim() })
            : t("pos.noCategories")}
        </p>
      )}

      {sections.map((section) => (
        <section
          key={section.category.id}
          ref={(el) => {
            if (el) sectionRefs.current.set(section.category.id, el);
            else sectionRefs.current.delete(section.category.id);
          }}
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: `auto ${estimateHeight(section.items.length, variant)}px`,
          }}
        >
          <h2 className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b bg-background px-4 py-2 text-sm font-semibold">
            <span className="truncate">{section.category.name}</span>
            <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
              {t("pos.categoryCount", { count: section.items.length })}
            </span>
          </h2>

          <ul
            className={cn(
              variant === "grid"
                ? cn(
                    "grid gap-3 p-4",
                    gridColsClassName ??
                      "grid-cols-2 md:grid-cols-3 2xl:grid-cols-4",
                  )
                : "divide-y",
            )}
          >
            {section.items.map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                categoryName={categoryName.get(item.category_id) ?? ""}
                count={counts.get(item.id) ?? 0}
                variant={variant}
                onAdd={handleAdd}
                t={t}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function estimateHeight(count: number, variant: MenuListVariant): number {
  const body =
    variant === "grid"
      ? Math.ceil(count / GRID_COLUMNS_ESTIMATE) * CARD_HEIGHT
      : count * ROW_HEIGHT;
  return body + HEADER_HEIGHT;
}

interface MenuRowProps {
  item: MenuItemView;
  categoryName: string;
  count: number;
  variant: MenuListVariant;
  onAdd: (item: MenuItemView, title: string) => void;
  t: TFn;
}

/**
 * One tappable dish. Memoised on primitives so adding an item re-renders that
 * row alone — the sections keep their DOM under content-visibility, so without
 * this every tap would reconcile the whole listino.
 */
const MenuRow = memo(function MenuRow({
  item,
  categoryName,
  count,
  variant,
  onAdd,
  t,
}: MenuRowProps) {
  const label = menuLabel(item, categoryName);
  const ordered = count > 0;
  const ariaLabel = ordered
    ? `${menuLabelText(label)} · ${t("pos.orderedCount", { count })}`
    : menuLabelText(label);

  if (variant === "grid") {
    return (
      <li>
        <button
          type="button"
          onClick={() => onAdd(item, label.title)}
          aria-label={ariaLabel}
          className={cn(
            "relative flex min-h-24 w-full flex-col items-start justify-between gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
            ordered && "border-primary/40 bg-muted pr-10",
          )}
        >
          {ordered && <OrderedBadge count={count} className="absolute right-2 top-2" />}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium leading-tight">{label.title}</span>
            {label.ingredients && (
              <span className="text-xs leading-snug text-muted-foreground line-clamp-3">
                {label.ingredients}
              </span>
            )}
          </span>
          <span className="text-sm text-muted-foreground">
            {formatMoney(item.price)}
          </span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onAdd(item, label.title)}
        aria-label={ariaLabel}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent",
          ordered && "bg-muted",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base leading-snug">{label.title}</span>
          {label.ingredients && (
            <span className="text-sm leading-snug text-muted-foreground">
              {label.ingredients}
            </span>
          )}
        </span>
        {ordered && <OrderedBadge count={count} />}
        <span className="shrink-0 text-base font-semibold tabular-nums">
          {formatMoney(item.price)}
        </span>
      </button>
    </li>
  );
});

/**
 * How many are on the round. Re-keyed on the number so it replays its pulse on
 * every add — 2 → 3 is otherwise indistinguishable from a tap that missed.
 */
function OrderedBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      key={count}
      aria-hidden
      className={cn(
        "flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground animate-in zoom-in-50 duration-150",
        className,
      )}
    >
      {count}
    </span>
  );
}
