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
import { useT, type TFn } from "@/lib/i18n/use-translation";
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
  const t = useT();
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

  async function handleAddCategory(e: React.FormEvent) {
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
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UtensilsCrossed className="h-5 w-5" /> {t("menu.menuTitle")}
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
                      <Plus className="mr-1 h-4 w-4" /> {t("menu.addItem")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-muted-foreground"
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

                {categoryItems.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">
                    {t("menu.noItems")}
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
                        onClick={() => openEdit(item)}
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
                  </div>
                ))}
              </div>
            );
          })}

          <form onSubmit={handleAddCategory} className="flex gap-2">
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
  const t = useT();
  const [newIngredient, setNewIngredient] = useState("");

  const usageCount = (id: string) =>
    items.filter((i) => i.ingredients.some((g) => g.id === id)).length;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newIngredient.trim();
    if (!name) return;
    await run(() => createIngredient(name), t("menu.ingredientAdded", { name }));
    setNewIngredient("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Carrot className="h-5 w-5" /> {t("menu.ingredientsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {ingredients.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("menu.noIngredientsYet")}
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
        </div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={newIngredient}
            onChange={(e) => setNewIngredient(e.target.value)}
            placeholder={t("menu.newIngredientPlaceholder")}
            className="h-12"
            aria-label={t("menu.newIngredientAria")}
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newIngredient.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("common.add")}
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
  const t = useT();
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
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {ingredients.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("menu.noIngredientsDefinedYet")}
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
            <Label>{t("menu.variations")}</Label>
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {modifierGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("menu.noModifierGroupsYet2")}
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

function adjustmentLabel(amount: number, t: TFn): string {
  if (amount === 0) return t("menu.free");
  return `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}

function ruleLabel(min: number, max: number, t: TFn): string {
  if (min === max)
    return min === 1 ? t("pos.ruleChoose1") : t("pos.ruleChooseN", { count: min });
  if (min === 0)
    return max === 1 ? t("pos.ruleOptional") : t("pos.ruleUpToN", { count: max });
  return t("pos.ruleChooseRange", { min, max });
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
  const t = useT();
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
          <SlidersHorizontal className="h-5 w-5" /> {t("menu.modifierGroups")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("menu.noModifierGroupsYet")}
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
                    {ruleLabel(g.min_selections, g.max_selections, t)} ·{" "}
                    {used === 0
                      ? t("menu.unused")
                      : used === 1
                        ? t("stats.itemCountOne", { count: used })
                        : t("stats.itemCountMany", { count: used })}
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
                    <Plus className="mr-1 h-4 w-4" /> {t("menu.addOption")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={t("menu.editGroupAria", { name: g.name })}
                    disabled={busy}
                    onClick={() => setGroupDialog({ open: true, group: g })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground"
                    aria-label={t("menu.deleteGroupAria", { name: g.name })}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => deleteModifierGroup(g.id),
                        t("menu.groupDeleted", { name: g.name }),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {g.modifiers.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {t("menu.noOptionsYet")}
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
                        {adjustmentLabel(m.price_adjustment, t)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        aria-label={t("menu.editOptionAria", { name: m.name })}
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
                        aria-label={t("menu.deleteOptionAria", { name: m.name })}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => deleteModifier(m.id),
                            t("menu.nameDeleted", { name: m.name }),
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
          <Plus className="mr-1 h-4 w-4" /> {t("menu.addGroup")}
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
  const t = useT();
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
      toast.error(t("menu.groupNameRequired"));
      return;
    }
    if (!Number.isInteger(minN) || minN < 0) {
      toast.error(t("menu.minMustBe0"));
      return;
    }
    if (!Number.isInteger(maxN) || maxN < 1) {
      toast.error(t("menu.maxMustBe1"));
      return;
    }
    if (maxN < minN) {
      toast.error(t("menu.maxLessThanMin"));
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
      toast.success(t("menu.groupSaved", { name: trimmed }));
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
            {group
              ? t("menu.editGroupTitle", { name: group.name })
              : t("menu.newGroup")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="group-name">{t("menu.name")}</Label>
            <Input
              id="group-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("menu.groupNamePlaceholder")}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="group-min">{t("menu.minSelections")}</Label>
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
              <Label htmlFor="group-max">{t("menu.maxSelections")}</Label>
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
          <p className="text-xs text-muted-foreground">{t("menu.minMaxHelp")}</p>

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
                : group
                  ? t("printers.saveChanges")
                  : t("menu.createGroup")}
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
  const t = useT();
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
      toast.error(t("menu.optionNameRequired"));
      return;
    }
    if (!Number.isFinite(parsed)) {
      toast.error(t("menu.validPriceAdjustment"));
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
            {option
              ? t("menu.editOptionTitle", { name: option.name })
              : t("menu.newOption")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="option-name">{t("menu.name")}</Label>
            <Input
              id="option-name"
              className="h-12"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("menu.optionNamePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="option-price">{t("menu.priceAdjustment")}</Label>
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
              {t("menu.priceAdjustmentHelp")}
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
                : option
                  ? t("printers.saveChanges")
                  : t("menu.createOption")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
