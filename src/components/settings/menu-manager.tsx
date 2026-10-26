"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Carrot,
  Check,
  LayoutGrid,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/lib/constants";
import {
  createCategory,
  createIngredient,
  createLineNote,
  createMenuItem,
  deleteCategory,
  deleteIngredient,
  deleteLineNote,
  deleteMenuItem,
  fetchLineNotes,
  setMenuItemIngredients,
  updateIngredient,
  updateMenuItem,
  updateMenuItems,
  type MenuItemWithIngredients,
} from "@/lib/settings-api";
import type {
  Category,
  Ingredient,
  LineNote,
  Printer,
} from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { buildHaystack, normalize, tokenize } from "@/lib/menu-search";
import { cn } from "@/lib/utils";

interface MenuManagerProps {
  categories: Category[];
  items: MenuItemWithIngredients[];
  ingredients: Ingredient[];
  printers: Printer[];
  onChanged: () => Promise<void>;
}

/** How many result rows to render before asking for a "show more" click. */
const PAGE_SIZE = 50;

/** Optional cost input: "" = unknown (null), else a number ≥ 0; undefined = invalid */
function parseCost(raw: string): number | null | undefined {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

export function MenuManager({
  categories,
  items,
  ingredients,
  printers,
  onChanged,
}: MenuManagerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"items" | "library">("items");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] =
    useState<MenuItemWithIngredients | null>(null);
  const [dialogCategoryId, setDialogCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  // Multi-select for bulk edits. Cleared whenever the visible set changes (see
  // the effect below), so an action can only ever reach rows the user just saw
  // — selecting every pizza, switching to Bruschette and hitting a toggle must
  // not silently rewrite the pizzas too.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Same field applied to every selected row, in one request per chunk.
   * Deliberately not routed through `run`: the selection has to survive a
   * failure so the user can retry without picking everything again. */
  async function bulkUpdate(
    fields: Parameters<typeof updateMenuItems>[1],
    success: string,
  ) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await updateMenuItems(ids, fields);
      await onChanged();
      setSelected(new Set());
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  function openCreate(categoryId: string) {
    setEditingItem(null);
    setDialogCategoryId(categoryId);
    setDialogOpen(true);
  }

  function openEdit(item: MenuItemWithIngredients) {
    setEditingItem(item);
    setDialogCategoryId(item.category_id);
    setDialogOpen(true);
  }

  // Pre-normalised name + ingredients per item, so keystrokes only scan strings
  const searchIndex = useMemo(
    () =>
      items.map((item) => ({
        item,
        haystack: buildHaystack([
          item.name,
          ...item.ingredients.map((g) => g.name),
        ]),
      })),
    [items],
  );

  const categoryRank = useMemo(
    () => new Map(categories.map((c, i) => [c.id, i])),
    [categories],
  );

  const categoryStats = useMemo(() => {
    const stats = new Map<string, { total: number; off: number }>();
    for (const item of items) {
      const s = stats.get(item.category_id) ?? { total: 0, off: 0 };
      s.total += 1;
      if (!item.is_available) s.off += 1;
      stats.set(item.category_id, s);
    }
    return stats;
  }, [items]);

  const words = useMemo(
    () => tokenize(deferredQuery),
    [deferredQuery],
  );

  const results = useMemo(() => {
    let rows = searchIndex;
    if (categoryFilter !== "all")
      rows = rows.filter((r) => r.item.category_id === categoryFilter);
    if (words.length > 0)
      rows = rows.filter((r) => words.every((w) => r.haystack.includes(w)));
    return rows
      .map((r) => r.item)
      .sort(
        (a, b) =>
          (categoryRank.get(a.category_id) ?? 0) -
            (categoryRank.get(b.category_id) ?? 0) ||
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name),
      );
  }, [searchIndex, categoryFilter, words, categoryRank]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelected(new Set());
  }, [deferredQuery, categoryFilter]);

  const browsing = words.length > 0 || categoryFilter !== "all";
  const visible = results.slice(0, visibleCount);
  const allResultsSelected =
    results.length > 0 && results.every((r) => selected.has(r.id));
  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? "";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <TabPill
          active={tab === "items"}
          label={t("menu.tabItems")}
          onClick={() => setTab("items")}
        />
        <TabPill
          active={tab === "library"}
          label={t("menu.tabLibrary")}
          onClick={() => setTab("library")}
        />
      </div>

      {tab === "items" && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <UtensilsCrossed className="h-5 w-5" /> {t("menu.menuTitle")}
            </CardTitle>
            <Button
              className="h-10"
              disabled={busy || categories.length === 0}
              onClick={() =>
                openCreate(
                  categoryFilter !== "all"
                    ? categoryFilter
                    : (categories[0]?.id ?? ""),
                )
              }
            >
              <Plus className="mr-1 h-4 w-4" /> {t("menu.newItem")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("menu.searchPlaceholder")}
              className="h-12 pl-9 pr-10"
              autoFocus
              aria-label={t("menu.searchPlaceholder")}
            />
            {query && (
              <button
                type="button"
                aria-label={t("menu.clearSearchAria")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            <CategoryChip
              active={categoryFilter === "all"}
              label={t("menu.allCategories")}
              count={items.length}
              onClick={() => setCategoryFilter("all")}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                active={categoryFilter === c.id}
                label={c.name}
                count={categoryStats.get(c.id)?.total ?? 0}
                onClick={() =>
                  setCategoryFilter((cur) => (cur === c.id ? "all" : c.id))
                }
              />
            ))}
          </div>

          {browsing ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {results.length === 1
                    ? t("menu.resultsOne")
                    : t("menu.resultsMany", { count: results.length })}
                </p>
                {results.length > 0 && (
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline"
                    onClick={() =>
                      setSelected(
                        allResultsSelected
                          ? new Set()
                          : new Set(results.map((r) => r.id)),
                      )
                    }
                  >
                    {allResultsSelected
                      ? t("menu.clearSelection")
                      : t("menu.selectAllResults", { count: results.length })}
                  </button>
                )}
              </div>

              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
                  <span className="px-1 text-sm font-medium">
                    {t("menu.selectedCount", { count: selected.size })}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() =>
                        bulkUpdate(
                          { allows_variations: true },
                          t("menu.bulkVariationsOn", { count: selected.size }),
                        )
                      }
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {t("menu.bulkAllowVariations")}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() =>
                        bulkUpdate(
                          { allows_variations: false },
                          t("menu.bulkVariationsOff", { count: selected.size }),
                        )
                      }
                    >
                      <Ban className="mr-1 h-4 w-4" />
                      {t("menu.bulkBlockVariations")}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() =>
                        bulkUpdate(
                          { is_available: true },
                          t("menu.bulkOnMenu", { count: selected.size }),
                        )
                      }
                    >
                      {t("menu.onMenu")}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() =>
                        bulkUpdate(
                          { is_available: false },
                          t("menu.bulkOffMenu", { count: selected.size }),
                        )
                      }
                    >
                      {t("menu.offMenu")}
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-10"
                      disabled={busy}
                      onClick={() => setSelected(new Set())}
                    >
                      {t("menu.clearSelection")}
                    </Button>
                  </div>
                </div>
              )}
              {results.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("menu.noResults")}
                </p>
              )}
              <div>
                {visible.map((item, idx) => {
                  const showHeader =
                    categoryFilter === "all" &&
                    (idx === 0 ||
                      visible[idx - 1].category_id !== item.category_id);
                  return (
                    <div key={item.id}>
                      {showHeader && (
                        <div
                          className={cn(
                            "pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                            idx === 0 && "pt-0",
                          )}
                        >
                          {categoryName(item.category_id)}
                        </div>
                      )}
                      {!showHeader && idx > 0 && <Separator className="my-1" />}
                      <ItemRow
                        item={item}
                        busy={busy}
                        run={run}
                        onEdit={openEdit}
                        selected={selected.has(item.id)}
                        onToggleSelect={toggleSelected}
                      />
                    </div>
                  );
                })}
              </div>
              {results.length > visibleCount && (
                <Button
                  variant="outline"
                  className="h-12"
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                >
                  {t("menu.showMore", {
                    count: Math.min(PAGE_SIZE, results.length - visibleCount),
                  })}
                </Button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/50" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {t("menu.searchHint")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {tab === "library" && (
        <>
          <CategoriesCard
            categories={categories}
            stats={categoryStats}
            busy={busy}
            run={run}
          />

          <IngredientsCard
            ingredients={ingredients}
            items={items}
            busy={busy}
            run={run}
          />

          <LineNotesCard />
        </>
      )}

      <MenuItemDialog
        open={dialogOpen}
        item={editingItem}
        defaultCategoryId={dialogCategoryId}
        categories={categories}
        ingredients={ingredients}
        printers={printers}
        items={items}
        onClose={() => setDialogOpen(false)}
        onSaved={onChanged}
      />
    </>
  );
}

function TabPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function CategoriesCard({
  categories,
  stats,
  busy,
  run,
}: {
  categories: Category[];
  stats: Map<string, { total: number; off: number }>;
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
}) {
  const t = useT();
  const [newCategory, setNewCategory] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    await run(
      () => createCategory(name, categories.length + 1),
      t("menu.categoryCreated", { name }),
    );
    setNewCategory("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LayoutGrid className="h-5 w-5" /> {t("menu.categoriesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          {categories.map((c, idx) => {
            const s = stats.get(c.id) ?? { total: 0, off: 0 };
            return (
              <div key={c.id}>
                {idx > 0 && <Separator className="my-1" />}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.total === 1
                        ? t("menu.categoryItemsOne")
                        : t("menu.categoryItemsMany", { count: s.total })}
                      {s.off > 0 &&
                        ` · ${t("menu.offMenuCount", { count: s.off })}`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-muted-foreground"
                    aria-label={t("menu.deleteCategoryAria", { name: c.name })}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => deleteCategory(c.id),
                        t("menu.categoryDeleted", { name: c.name }),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder={t("menu.newCategoryPlaceholder")}
            className="h-12"
            aria-label={t("menu.newCategoryAria")}
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newCategory.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("menu.addCategory")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CategoryChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1.5 text-xs",
          active ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ItemRow({
  item,
  busy,
  run,
  onEdit,
  selected,
  onToggleSelect,
}: {
  item: MenuItemWithIngredients;
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  onEdit: (item: MenuItemWithIngredients) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md py-1.5",
        selected && "bg-primary/5",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t("menu.selectItemAria", { name: item.name })}
        onClick={() => onToggleSelect(item.id)}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input hover:border-foreground/40",
        )}
      >
        {selected && <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.codice && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
              {item.codice}
            </span>
          )}
          <span className="truncate font-medium">{item.name}</span>
          {item.is_custom && (
            <span
              title={t("ai.analytics.customBadgeHint")}
              className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700"
            >
              {t("ai.analytics.customBadge")}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {item.ingredients.length > 0
            ? item.ingredients.map((g) => g.name).join(" · ")
            : t("menu.noIngredientsListed")}
        </div>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {formatMoney(item.price)}
      </span>
      <button
        type="button"
        disabled={busy}
        title={t("menu.toggleOnMenuHint")}
        onClick={() =>
          run(
            () =>
              updateMenuItem(item.id, {
                is_available: !item.is_available,
              }),
            item.is_available
              ? t("menu.itemTakenOff", { name: item.name })
              : t("menu.itemBackOn", { name: item.name }),
          )
        }
        className={cn(
          "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
          item.is_available
            ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700"
            : "border-foreground/20 bg-muted text-muted-foreground",
        )}
      >
        {item.is_available ? t("menu.onMenu") : t("menu.offMenu")}
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0"
        aria-label={t("menu.editItemAria", { name: item.name })}
        disabled={busy}
        onClick={() => onEdit(item)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0 text-muted-foreground"
        aria-label={t("menu.deleteItemAria", { name: item.name })}
        disabled={busy}
        onClick={() =>
          run(
            () => deleteMenuItem(item.id),
            t("menu.nameDeleted", { name: item.name }),
          )
        }
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function IngredientsCard({
  ingredients,
  items,
  busy,
  run,
}: {
  ingredients: Ingredient[];
  items: MenuItemWithIngredients[];
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
}) {
  const t = useT();
  const [newIngredient, setNewIngredient] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Ingredient | null>(null);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items)
      for (const g of item.ingredients) m.set(g.id, (m.get(g.id) ?? 0) + 1);
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    const f = normalize(filter.trim());
    return f
      ? ingredients.filter((g) => normalize(g.name).includes(f))
      : ingredients;
  }, [ingredients, filter]);

  const MAX_CHIPS = 80;
  const shown = filtered.slice(0, MAX_CHIPS);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newIngredient.trim();
    if (!name) return;
    const price = newPrice.trim() === "" ? 0 : Number(newPrice);
    if (!Number.isFinite(price) || price < 0) {
      toast.error(t("menu.validIngredientPrice"));
      return;
    }
    await run(
      () => createIngredient(name, price),
      t("menu.ingredientAdded", { name }),
    );
    setNewIngredient("");
    setNewPrice("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Carrot className="h-5 w-5" /> {t("menu.ingredientsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ingredients.length > MAX_CHIPS && (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("menu.filterIngredientsPlaceholder")}
            className="h-12"
            aria-label={t("menu.filterIngredientsPlaceholder")}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {ingredients.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("menu.noIngredientsYet")}
            </p>
          )}
          {shown.map((g) => (
            <span
              key={g.id}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm"
            >
              {g.name}
              {g.price > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  +{formatMoney(g.price)}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {usage.get(g.id) ?? 0}
              </span>
              <button
                type="button"
                aria-label={t("menu.editIngredientAria", { name: g.name })}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => setEditing(g)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("menu.deleteIngredientAria", { name: g.name })}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() =>
                  run(
                    () => deleteIngredient(g.id),
                    t("menu.nameDeleted", { name: g.name }),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {filtered.length > MAX_CHIPS && (
            <span className="self-center text-xs text-muted-foreground">
              {t("menu.moreIngredients", {
                count: filtered.length - MAX_CHIPS,
              })}
            </span>
          )}
        </div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={newIngredient}
            onChange={(e) => setNewIngredient(e.target.value)}
            placeholder={t("menu.newIngredientPlaceholder")}
            className="h-12"
            aria-label={t("menu.newIngredientAria")}
          />
          <Input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className="h-12 w-28"
            aria-label={t("menu.ingredientPrice")}
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newIngredient.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("common.add")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {t("menu.ingredientPriceHelp")}
        </p>
      </CardContent>
      <IngredientDialog
        ingredient={editing}
        busy={busy}
        run={run}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

/**
 * Note rapide: the free kitchen instructions ("Ben cotta", "Prima") offered as
 * one-tap buttons in the POS line editor. Owns its own list rather than riding
 * the page's refresh — nothing else on this page reads it.
 */
function LineNotesCard() {
  const t = useT();
  const [notes, setNotes] = useState<LineNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchLineNotes()
      .then(setNotes)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : t("common.somethingWrong")),
      );
  }, [t]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      setNotes(await fetchLineNotes());
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newNote.trim();
    if (!name) return;
    // picked notes are stored comma-joined on the line, so a comma would
    // split one note into two on the comanda
    if (name.includes(",")) {
      toast.error(t("menu.lineNoteNoComma"));
      return;
    }
    await run(() => createLineNote(name), t("menu.lineNoteAdded", { name }));
    setNewNote("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquareText className="h-5 w-5" /> {t("menu.lineNotesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {notes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("menu.noLineNotesYet")}
            </p>
          )}
          {notes.map((n) => (
            <span
              key={n.id}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm"
            >
              {n.name}
              <button
                type="button"
                aria-label={t("menu.deleteLineNoteAria", { name: n.name })}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() =>
                  run(
                    () => deleteLineNote(n.id),
                    t("menu.nameDeleted", { name: n.name }),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder={t("menu.newLineNotePlaceholder")}
            className="h-12"
            aria-label={t("menu.newLineNoteAria")}
          />
          <Button type="submit" className="h-12" disabled={busy || !newNote.trim()}>
            <Plus className="mr-1 h-4 w-4" /> {t("common.add")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {t("menu.lineNotesHelp")}
        </p>
      </CardContent>
    </Card>
  );
}

/** Rename an ingredient or reprice it as an add-on. Kept inline rather than
 *  as a chip-side field: the pantry runs to a couple of hundred rows and a
 *  grid of live number inputs is a lot of accidental edits waiting to happen. */
function IngredientDialog({
  ingredient,
  busy,
  run,
  onClose,
}: {
  ingredient: Ingredient | null;
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");

  useEffect(() => {
    if (!ingredient) return;
    setName(ingredient.name);
    setPrice(ingredient.price.toFixed(2));
    setCost(ingredient.cost == null ? "" : Number(ingredient.cost).toFixed(2));
  }, [ingredient]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredient) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("menu.ingredientNameRequired"));
      return;
    }
    const parsed = Number(price);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error(t("menu.validIngredientPrice"));
      return;
    }
    const parsedCost = parseCost(cost);
    if (parsedCost === undefined) {
      toast.error(t("ai.analytics.validCost"));
      return;
    }
    await run(
      () =>
        updateIngredient(ingredient.id, {
          name: trimmed,
          price: parsed,
          cost: parsedCost,
        }),
      t("menu.ingredientSaved", { name: trimmed }),
    );
    onClose();
  }

  return (
    <Dialog open={ingredient !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("menu.editIngredientTitle", { name: ingredient?.name ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ing-name">{t("menu.name")}</Label>
            <Input
              id="ing-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ing-price">{t("menu.ingredientPrice")}</Label>
            <Input
              id="ing-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              step="0.01"
              min="0"
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              {t("menu.ingredientPriceHelp")}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ing-cost">{t("ai.analytics.costLabel")}</Label>
            <Input
              id="ing-cost"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="—"
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              {t("ai.analytics.ingredientCostHelp")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Radix Select can't carry an empty-string value; sentinel for "no printer"
const NO_PRINTER = "none";

function MenuItemDialog({
  open,
  item,
  defaultCategoryId,
  categories,
  ingredients,
  printers,
  items,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: MenuItemWithIngredients | null;
  defaultCategoryId: string;
  categories: Category[];
  ingredients: Ingredient[];
  printers: Printer[];
  items: MenuItemWithIngredients[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [codice, setCodice] = useState("");
  const [cost, setCost] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ingredientIds, setIngredientIds] = useState<string[]>([]);
  const [allowsVariations, setAllowsVariations] = useState(false);
  const [printerId, setPrinterId] = useState(NO_PRINTER);
  const [ingredientFilter, setIngredientFilter] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setPrice(item ? item.price.toFixed(2) : "");
    setCodice(item?.codice ?? "");
    setCost(item?.cost == null ? "" : Number(item.cost).toFixed(2));
    setCategoryId(item?.category_id ?? defaultCategoryId);
    setIngredientIds(item ? item.ingredients.map((g) => g.id) : []);
    setAllowsVariations(item?.allows_variations ?? false);
    setPrinterId(item?.target_printer_id ?? NO_PRINTER);
    setIngredientFilter("");
  }, [open, item, defaultCategoryId]);

  // Selected chips always stay visible; the filter only narrows the rest
  const MAX_UNSELECTED = 40;
  const pickerIngredients = useMemo(() => {
    const f = normalize(ingredientFilter.trim());
    const selectedSet = new Set(ingredientIds);
    const selected = ingredients.filter((g) => selectedSet.has(g.id));
    const unselected = ingredients.filter(
      (g) => !selectedSet.has(g.id) && (!f || normalize(g.name).includes(f)),
    );
    return { selected, unselected };
  }, [ingredients, ingredientIds, ingredientFilter]);

  function toggleIngredient(id: string) {
    setIngredientIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const parsedPrice = parseFloat(price);
    if (!trimmed) {
      toast.error(t("menu.itemNameRequired"));
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error(t("menu.validPrice"));
      return;
    }
    if (!categoryId) {
      toast.error(t("menu.pickCategory"));
      return;
    }
    const parsedCost = parseCost(cost);
    if (parsedCost === undefined) {
      toast.error(t("ai.analytics.validCost"));
      return;
    }

    const targetPrinterId = printerId === NO_PRINTER ? null : printerId;
    const trimmedCodice = codice.trim() || null;
    setBusy(true);
    try {
      let itemId = item?.id;
      if (itemId) {
        await updateMenuItem(itemId, {
          name: trimmed,
          price: parsedPrice,
          category_id: categoryId,
          target_printer_id: targetPrinterId,
          codice: trimmedCodice,
          allows_variations: allowsVariations,
          cost: parsedCost,
        });
      } else {
        const maxSort = Math.max(
          0,
          ...items
            .filter((i) => i.category_id === categoryId)
            .map((i) => i.sort_order),
        );
        itemId = await createMenuItem({
          categoryId,
          name: trimmed,
          price: parsedPrice,
          sortOrder: maxSort + 1,
          targetPrinterId,
          codice: trimmedCodice,
          allowsVariations,
          cost: parsedCost,
        });
      }
      await setMenuItemIngredients(itemId, ingredientIds);
      await onSaved();
      toast.success(t("menu.nameSaved", { name: trimmed }));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("floor.couldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item ? t("menu.editItemTitle", { name: item.name }) : t("menu.newItem")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="item-name">{t("menu.name")}</Label>
            <Input
              id="item-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("menu.namePlaceholderItem")}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="item-price">{t("menu.price")}</Label>
              <Input
                id="item-price"
                className="h-12"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("menu.category")}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder={t("menu.pickCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="item-codice">{t("menu.code")}</Label>
              <Input
                id="item-codice"
                className="h-12"
                value={codice}
                onChange={(e) => setCodice(e.target.value)}
                placeholder={t("menu.codePlaceholder")}
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="item-cost">{t("ai.analytics.costLabel")}</Label>
              <Input
                id="item-cost"
                className="h-12"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="—"
              />
            </div>
            <p className="col-span-2 -mt-2 text-xs text-muted-foreground">
              {t("ai.analytics.costHelp")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label>{t("menu.printsTo")}</Label>
            <Select value={printerId} onValueChange={setPrinterId}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRINTER}>
                  {t("menu.noPrinterOption")}
                </SelectItem>
                {printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t("menu.printerOption", {
                      name: p.name,
                      type: p.printer_type,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t("menu.ingredientsLabel")}</Label>
            {ingredients.length > MAX_UNSELECTED && (
              <Input
                value={ingredientFilter}
                onChange={(e) => setIngredientFilter(e.target.value)}
                placeholder={t("menu.filterIngredientsPlaceholder")}
                className="h-12"
                aria-label={t("menu.filterIngredientsPlaceholder")}
              />
            )}
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {ingredients.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("menu.noIngredientsDefinedYet")}
                </p>
              )}
              {[
                ...pickerIngredients.selected,
                ...pickerIngredients.unselected.slice(0, MAX_UNSELECTED),
              ].map((g) => {
                const active = ingredientIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleIngredient(g.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {g.name}
                  </button>
                );
              })}
              {pickerIngredients.unselected.length > MAX_UNSELECTED && (
                <span className="self-center text-xs text-muted-foreground">
                  {t("menu.moreIngredients", {
                    count: pickerIngredients.unselected.length - MAX_UNSELECTED,
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("menu.variations")}</Label>
            <button
              type="button"
              disabled={busy}
              aria-pressed={allowsVariations}
              onClick={() => setAllowsVariations((v) => !v)}
              className={cn(
                "inline-flex min-h-11 w-fit items-center gap-2 rounded-full border px-4 text-sm transition-colors disabled:opacity-50",
                allowsVariations
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {allowsVariations ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : (
                <Ban className="h-4 w-4 shrink-0" />
              )}
              {t("menu.allowsVariations")}
            </button>
            <p className="text-xs text-muted-foreground">
              {t("menu.allowsVariationsHelp")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={onClose}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {busy
                ? t("common.saving")
                : item
                  ? t("printers.saveChanges")
                  : t("menu.createItem")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
