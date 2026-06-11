"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Carrot, Pencil, Plus, Trash2, UtensilsCrossed, X } from "lucide-react";
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
  createMenuItem,
  deleteCategory,
  deleteIngredient,
  deleteMenuItem,
  setMenuItemIngredients,
  updateMenuItem,
  type MenuItemWithIngredients,
} from "@/lib/settings-api";
import type { Category, Ingredient } from "@/lib/database.types";
import { cn } from "@/lib/utils";

interface MenuManagerProps {
  categories: Category[];
  items: MenuItemWithIngredients[];
  ingredients: Ingredient[];
  onChanged: () => Promise<void>;
}

export function MenuManager({
  categories,
  items,
  ingredients,
  onChanged,
}: MenuManagerProps) {
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] =
    useState<MenuItemWithIngredients | null>(null);
  const [dialogCategoryId, setDialogCategoryId] = useState("");

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
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

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    await run(
      () => createCategory(name, categories.length + 1),
      `Category “${name}” created`,
    );
    setNewCategory("");
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UtensilsCrossed className="h-5 w-5" /> Menu
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {categories.map((c) => {
            const categoryItems = items.filter((i) => i.category_id === c.id);
            return (
              <div key={c.id} className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() => openCreate(c.id)}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add item
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-muted-foreground"
                      aria-label={`Delete category ${c.name}`}
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => deleteCategory(c.id),
                          `Category “${c.name}” deleted`,
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {categoryItems.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">
                    No items yet.
                  </p>
                )}
                {categoryItems.map((item, idx) => (
                  <div key={item.id}>
                    {idx > 0 && <Separator className="my-1" />}
                    <div className="flex items-center gap-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {item.ingredients.length > 0
                            ? item.ingredients.map((g) => g.name).join(" · ")
                            : "No ingredients listed"}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatMoney(item.price)}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        title="Toggle whether this item is on the menu"
                        onClick={() =>
                          run(
                            () =>
                              updateMenuItem(item.id, {
                                is_available: !item.is_available,
                              }),
                            `${item.name} ${item.is_available ? "taken off" : "back on"} the menu`,
                          )
                        }
                        className={cn(
                          "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                          item.is_available
                            ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700"
                            : "border-foreground/20 bg-muted text-muted-foreground",
                        )}
                      >
                        {item.is_available ? "On menu" : "Off menu"}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        aria-label={`Edit ${item.name}`}
                        disabled={busy}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-muted-foreground"
                        aria-label={`Delete ${item.name}`}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => deleteMenuItem(item.id),
                            `${item.name} deleted`,
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          <form onSubmit={handleAddCategory} className="flex gap-2">
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="New category name (e.g. Sides)"
              className="h-12"
              aria-label="New category name"
            />
            <Button
              type="submit"
              className="h-12"
              disabled={busy || !newCategory.trim()}
            >
              <Plus className="mr-1 h-4 w-4" /> Add category
            </Button>
          </form>
        </CardContent>
      </Card>

      <IngredientsCard
        ingredients={ingredients}
        items={items}
        busy={busy}
        run={run}
      />

      <MenuItemDialog
        open={dialogOpen}
        item={editingItem}
        defaultCategoryId={dialogCategoryId}
        categories={categories}
        ingredients={ingredients}
        items={items}
        onClose={() => setDialogOpen(false)}
        onSaved={onChanged}
      />
    </>
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
  const [newIngredient, setNewIngredient] = useState("");

  const usageCount = (id: string) =>
    items.filter((i) => i.ingredients.some((g) => g.id === id)).length;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newIngredient.trim();
    if (!name) return;
    await run(() => createIngredient(name), `Ingredient “${name}” added`);
    setNewIngredient("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Carrot className="h-5 w-5" /> Ingredients
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {ingredients.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No ingredients yet — add some, then attach them to menu items.
            </p>
          )}
          {ingredients.map((g) => (
            <span
              key={g.id}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm"
            >
              {g.name}
              <span className="text-xs text-muted-foreground">
                {usageCount(g.id)}
              </span>
              <button
                type="button"
                aria-label={`Delete ingredient ${g.name}`}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() =>
                  run(() => deleteIngredient(g.id), `${g.name} deleted`)
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={newIngredient}
            onChange={(e) => setNewIngredient(e.target.value)}
            placeholder="New ingredient (e.g. Mozzarella)"
            className="h-12"
            aria-label="New ingredient name"
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newIngredient.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MenuItemDialog({
  open,
  item,
  defaultCategoryId,
  categories,
  ingredients,
  items,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: MenuItemWithIngredients | null;
  defaultCategoryId: string;
  categories: Category[];
  ingredients: Ingredient[];
  items: MenuItemWithIngredients[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ingredientIds, setIngredientIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setPrice(item ? item.price.toFixed(2) : "");
    setCategoryId(item?.category_id ?? defaultCategoryId);
    setIngredientIds(item ? item.ingredients.map((g) => g.id) : []);
  }, [open, item, defaultCategoryId]);

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
      toast.error("Item name is required");
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error("Enter a valid price");
      return;
    }
    if (!categoryId) {
      toast.error("Pick a category");
      return;
    }

    setBusy(true);
    try {
      let itemId = item?.id;
      if (itemId) {
        await updateMenuItem(itemId, {
          name: trimmed,
          price: parsedPrice,
          category_id: categoryId,
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
        });
      }
      await setMenuItemIngredients(itemId, ingredientIds);
      await onSaved();
      toast.success(`${trimmed} saved`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${item.name}` : "New menu item"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Margherita Pizza"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="item-price">Price</Label>
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
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Pick a category" />
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

          <div className="grid gap-2">
            <Label>Ingredients</Label>
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {ingredients.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No ingredients defined yet — add them below the menu.
                </p>
              )}
              {ingredients.map((g) => {
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
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="h-12"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {busy ? "Saving…" : item ? "Save changes" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
