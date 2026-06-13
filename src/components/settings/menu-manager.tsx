"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Carrot,
  Pencil,
  Plus,
  SlidersHorizontal,
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
  createMenuItem,
  createModifier,
  createModifierGroup,
  deleteCategory,
  deleteIngredient,
  deleteMenuItem,
  deleteModifier,
  deleteModifierGroup,
  setMenuItemIngredients,
  setMenuItemModifierGroups,
  updateMenuItem,
  updateModifier,
  updateModifierGroup,
  type MenuItemWithIngredients,
} from "@/lib/settings-api";
import type { ModifierGroupWithModifiers } from "@/lib/api";
import type {
  Category,
  Ingredient,
  Modifier,
  Printer,
} from "@/lib/database.types";
import { cn } from "@/lib/utils";

interface MenuManagerProps {
  categories: Category[];
  items: MenuItemWithIngredients[];
  ingredients: Ingredient[];
  modifierGroups: ModifierGroupWithModifiers[];
  printers: Printer[];
  onChanged: () => Promise<void>;
}

export function MenuManager({
  categories,
  items,
  ingredients,
  modifierGroups,
  printers,
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

      <ModifierGroupsCard
        groups={modifierGroups}
        items={items}
        busy={busy}
        run={run}
        onChanged={onChanged}
      />

      <MenuItemDialog
        open={dialogOpen}
        item={editingItem}
        defaultCategoryId={dialogCategoryId}
        categories={categories}
        ingredients={ingredients}
        modifierGroups={modifierGroups}
        printers={printers}
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

// Radix Select can't carry an empty-string value; sentinel for "no printer"
const NO_PRINTER = "none";

function MenuItemDialog({
  open,
  item,
  defaultCategoryId,
  categories,
  ingredients,
  modifierGroups,
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
  modifierGroups: ModifierGroupWithModifiers[];
  printers: Printer[];
  items: MenuItemWithIngredients[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ingredientIds, setIngredientIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [printerId, setPrinterId] = useState(NO_PRINTER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setPrice(item ? item.price.toFixed(2) : "");
    setCategoryId(item?.category_id ?? defaultCategoryId);
    setIngredientIds(item ? item.ingredients.map((g) => g.id) : []);
    setGroupIds(item ? [...item.modifierGroupIds] : []);
    setPrinterId(item?.target_printer_id ?? NO_PRINTER);
  }, [open, item, defaultCategoryId]);

  function toggleIngredient(id: string) {
    setIngredientIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  function toggleGroup(id: string) {
    setGroupIds((ids) =>
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

    const targetPrinterId = printerId === NO_PRINTER ? null : printerId;
    setBusy(true);
    try {
      let itemId = item?.id;
      if (itemId) {
        await updateMenuItem(itemId, {
          name: trimmed,
          price: parsedPrice,
          category_id: categoryId,
          target_printer_id: targetPrinterId,
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
        });
      }
      await setMenuItemIngredients(itemId, ingredientIds);
      await setMenuItemModifierGroups(itemId, groupIds);
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
            <Label>Prints to</Label>
            <Select value={printerId} onValueChange={setPrinterId}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRINTER}>
                  Receipt only — no production slip
                </SelectItem>
                {printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.printer_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div className="grid gap-2">
            <Label>Variations</Label>
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {modifierGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No modifier groups defined yet — add them below the menu.
                </p>
              )}
              {modifierGroups.map((g) => {
                const active = groupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleGroup(g.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {g.name}
                    <span
                      className={cn(
                        "ml-1.5 text-xs",
                        active
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground",
                      )}
                    >
                      {g.modifiers.length}
                    </span>
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

function adjustmentLabel(amount: number): string {
  if (amount === 0) return "free";
  return `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}

function ruleLabel(min: number, max: number): string {
  if (min === max) return min === 1 ? "choose 1" : `choose ${min}`;
  if (min === 0) return max === 1 ? "optional" : `up to ${max}`;
  return `choose ${min}–${max}`;
}

/**
 * Admin for pizzeria-style variations: groups (Impasto, Aggiunte, Senza…) with
 * a min/max rule and priced options. Items opt in via the menu-item dialog;
 * the POS then forces a valid selection before the item joins a ticket.
 */
function ModifierGroupsCard({
  groups,
  items,
  busy,
  run,
  onChanged,
}: {
  groups: ModifierGroupWithModifiers[];
  items: MenuItemWithIngredients[];
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [groupDialog, setGroupDialog] = useState<{
    open: boolean;
    group: ModifierGroupWithModifiers | null;
  }>({ open: false, group: null });
  const [optionDialog, setOptionDialog] = useState<{
    open: boolean;
    groupId: string;
    optionCount: number;
    option: Modifier | null;
  }>({ open: false, groupId: "", optionCount: 0, option: null });

  const usageCount = (groupId: string) =>
    items.filter((i) => i.modifierGroupIds.includes(groupId)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <SlidersHorizontal className="h-5 w-5" /> Modifier groups
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No modifier groups yet — add one, then attach it to menu items.
          </p>
        )}
        {groups.map((g) => {
          const used = usageCount(g.id);
          return (
            <div key={g.id} className="rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold">{g.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {ruleLabel(g.min_selections, g.max_selections)} ·{" "}
                    {used === 0
                      ? "unused"
                      : `${used} item${used === 1 ? "" : "s"}`}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10"
                    disabled={busy}
                    onClick={() =>
                      setOptionDialog({
                        open: true,
                        groupId: g.id,
                        optionCount: g.modifiers.length,
                        option: null,
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add option
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={`Edit group ${g.name}`}
                    disabled={busy}
                    onClick={() => setGroupDialog({ open: true, group: g })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground"
                    aria-label={`Delete group ${g.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => deleteModifierGroup(g.id),
                        `Group “${g.name}” deleted`,
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {g.modifiers.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No options yet.
                </p>
              ) : (
                g.modifiers.map((m, idx) => (
                  <div key={m.id}>
                    {idx > 0 && <Separator className="my-1" />}
                    <div className="flex items-center gap-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span
                        className={cn(
                          "shrink-0 text-sm tabular-nums",
                          m.price_adjustment === 0
                            ? "text-muted-foreground"
                            : "font-medium",
                        )}
                      >
                        {adjustmentLabel(m.price_adjustment)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        aria-label={`Edit option ${m.name}`}
                        disabled={busy}
                        onClick={() =>
                          setOptionDialog({
                            open: true,
                            groupId: g.id,
                            optionCount: g.modifiers.length,
                            option: m,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-muted-foreground"
                        aria-label={`Delete option ${m.name}`}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => deleteModifier(m.id),
                            `${m.name} deleted`,
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}

        <Button
          variant="outline"
          className="h-12 self-start"
          disabled={busy}
          onClick={() => setGroupDialog({ open: true, group: null })}
        >
          <Plus className="mr-1 h-4 w-4" /> Add group
        </Button>
      </CardContent>

      <ModifierGroupDialog
        open={groupDialog.open}
        group={groupDialog.group}
        groupCount={groups.length}
        onClose={() => setGroupDialog({ open: false, group: null })}
        onSaved={onChanged}
      />
      <ModifierOptionDialog
        open={optionDialog.open}
        groupId={optionDialog.groupId}
        optionCount={optionDialog.optionCount}
        option={optionDialog.option}
        onClose={() =>
          setOptionDialog({
            open: false,
            groupId: "",
            optionCount: 0,
            option: null,
          })
        }
        onSaved={onChanged}
      />
    </Card>
  );
}

function ModifierGroupDialog({
  open,
  group,
  groupCount,
  onClose,
  onSaved,
}: {
  open: boolean;
  group: ModifierGroupWithModifiers | null;
  groupCount: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setMin(String(group?.min_selections ?? 0));
    setMax(String(group?.max_selections ?? 1));
  }, [open, group]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const minN = parseInt(min, 10);
    const maxN = parseInt(max, 10);
    if (!trimmed) {
      toast.error("Group name is required");
      return;
    }
    if (!Number.isInteger(minN) || minN < 0) {
      toast.error("Minimum must be 0 or more");
      return;
    }
    if (!Number.isInteger(maxN) || maxN < 1) {
      toast.error("Maximum must be 1 or more");
      return;
    }
    if (maxN < minN) {
      toast.error("Maximum can't be less than the minimum");
      return;
    }
    setBusy(true);
    try {
      if (group) {
        await updateModifierGroup(group.id, {
          name: trimmed,
          min_selections: minN,
          max_selections: maxN,
        });
      } else {
        await createModifierGroup({
          name: trimmed,
          minSelections: minN,
          maxSelections: maxN,
          sortOrder: groupCount + 1,
        });
      }
      await onSaved();
      toast.success(`Group “${trimmed}” saved`);
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
          <DialogTitle>
            {group ? `Edit ${group.name}` : "New modifier group"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aggiunte"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="group-min">Min selections</Label>
              <Input
                id="group-min"
                className="h-12"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-max">Max selections</Label>
              <Input
                id="group-max"
                className="h-12"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            e.g. min 1 / max 1 forces one choice (dough); min 0 / max 10 allows
            several optional add-ons.
          </p>

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
              {busy ? "Saving…" : group ? "Save changes" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModifierOptionDialog({
  open,
  groupId,
  optionCount,
  option,
  onClose,
  onSaved,
}: {
  open: boolean;
  groupId: string;
  optionCount: number;
  option: Modifier | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0.00");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(option?.name ?? "");
    setPrice((option?.price_adjustment ?? 0).toFixed(2));
  }, [open, option]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const parsed = parseFloat(price);
    if (!trimmed) {
      toast.error("Option name is required");
      return;
    }
    if (!Number.isFinite(parsed)) {
      toast.error("Enter a valid price adjustment (0 for free)");
      return;
    }
    setBusy(true);
    try {
      if (option) {
        await updateModifier(option.id, {
          name: trimmed,
          price_adjustment: parsed,
        });
      } else {
        await createModifier({
          groupId,
          name: trimmed,
          priceAdjustment: parsed,
          sortOrder: optionCount + 1,
        });
      }
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
          <DialogTitle>
            {option ? `Edit ${option.name}` : "New option"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="option-name">Name</Label>
            <Input
              id="option-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bufala"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="option-price">Price adjustment</Label>
            <Input
              id="option-price"
              className="h-12"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              Use 0 for a free choice, or a negative number for a discount.
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
              Cancel
            </Button>
            <Button type="submit" className="h-12 px-6" disabled={busy}>
              {busy ? "Saving…" : option ? "Save changes" : "Create option"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
