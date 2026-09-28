"use client";

// Left column of the template editor: the ordered block list. Reorder by
// dragging the handle (dnd-kit, works with mouse and touch) or with the ↑↓
// buttons; each row can be hidden, duplicated or removed.

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Braces,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  List,
  Minus,
  MoveVertical,
  Plus,
  Sigma,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PrintTemplateKind } from "@/lib/database.types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { TFn } from "@/lib/i18n/use-translation";
import { useT } from "@/lib/i18n/use-translation";
import type { BlockType, TemplateBlock } from "@/lib/printing/template";
import { cn } from "@/lib/utils";

export const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  text: Type,
  row: Braces,
  separator: Minus,
  space: MoveVertical,
  items: List,
  totals: Sigma,
};

const SINGLETONS: BlockType[] = ["items", "totals"];

function blockSummary(block: TemplateBlock, t: TFn): string {
  switch (block.type) {
    case "text":
      return block.label || block.text.split("\n")[0] || "…";
    case "row":
      return [block.left, block.right].filter(Boolean).join("  ⟷  ") || "…";
    case "separator":
      return (block.char === " " ? "␣" : block.char).repeat(16);
    case "space":
      return `× ${block.lines}`;
    default:
      return t(`printTemplates.typeHint.${block.type}` as TranslationKey);
  }
}

function visibilityBadges(block: TemplateBlock, t: TFn): string[] {
  const badges: string[] = [];
  const { variants, service } = block.visibility;
  if (variants) {
    const names: Record<string, TranslationKey> = {
      CONTO: "printTemplates.variantConto",
      PRECONTO: "printTemplates.variantPreconto",
      PARZIALE: "printTemplates.variantParziale",
    };
    badges.push(variants.map((v) => t(names[v])).join(" + "));
  }
  if (service === "table") badges.push(t("printTemplates.serviceTable"));
  if (service === "takeaway") badges.push(t("printTemplates.serviceTakeaway"));
  return badges;
}

function BlockRow({
  block,
  index,
  count,
  selected,
  onSelect,
  onMove,
  onToggleHidden,
  onDuplicate,
  onRemove,
}: {
  block: TemplateBlock;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (to: number) => void;
  onToggleHidden: () => void;
  onDuplicate: (() => void) | null;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const Icon = BLOCK_ICONS[block.type];
  const badges = visibilityBadges(block, t);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1 rounded-lg border bg-card pr-1 transition-shadow",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30",
        isDragging && "relative z-10 shadow-lg",
        block.hidden && "opacity-60",
      )}
    >
      <button
        type="button"
        className="flex h-12 w-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        aria-label={t("printTemplates.dragHandle")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(`printTemplates.type.${block.type}` as TranslationKey)}
            {block.hidden && ` · ${t("printTemplates.hiddenBadge")}`}
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              (block.type === "row" || block.type === "separator") && "font-mono",
            )}
          >
            {blockSummary(block, t)}
          </span>
          {badges.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {badges.map((b) => (
                <span key={b} className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
                  {b}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={t("printTemplates.moveUp")}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            className="flex h-6 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("printTemplates.moveDown")}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
            className="flex h-6 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          aria-label={block.hidden ? t("printTemplates.show") : t("printTemplates.hide")}
          title={block.hidden ? t("printTemplates.show") : t("printTemplates.hide")}
          onClick={onToggleHidden}
          className="flex h-10 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent"
        >
          {block.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        {onDuplicate && (
          <button
            type="button"
            aria-label={t("printTemplates.duplicateBlock")}
            title={t("printTemplates.duplicateBlock")}
            onClick={onDuplicate}
            className="flex h-10 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label={t("printTemplates.removeBlock")}
          title={t("printTemplates.removeBlock")}
          onClick={onRemove}
          className="flex h-10 w-9 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export function BlockList({
  blocks,
  kind,
  selectedId,
  onSelect,
  onReorder,
  onToggleHidden,
  onDuplicate,
  onRemove,
  onAdd,
}: {
  blocks: TemplateBlock[];
  kind: PrintTemplateKind;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (blocks: TemplateBlock[]) => void;
  onToggleHidden: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (type: BlockType) => void;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = blocks.findIndex((b) => b.id === e.active.id);
    const to = blocks.findIndex((b) => b.id === e.over!.id);
    onReorder(arrayMove(blocks, from, to));
  }

  const types: BlockType[] =
    kind === "CONTO"
      ? ["text", "row", "separator", "space", "items", "totals"]
      : ["text", "row", "separator", "space", "items"];
  const present = new Set(blocks.map((b) => b.type));

  return (
    <div className="flex flex-col gap-3">
      {blocks.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("printTemplates.emptyBlocks")}
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {blocks.map((block, i) => (
              <BlockRow
                key={block.id}
                block={block}
                index={i}
                count={blocks.length}
                selected={block.id === selectedId}
                onSelect={() => onSelect(block.id)}
                onMove={(to) => onReorder(arrayMove(blocks, i, to))}
                onToggleHidden={() => onToggleHidden(block.id)}
                onDuplicate={SINGLETONS.includes(block.type) ? null : () => onDuplicate(block.id)}
                onRemove={() => onRemove(block.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {adding ? (
        <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/30 p-2">
          {types.map((type) => {
            const Icon = BLOCK_ICONS[type];
            const taken = SINGLETONS.includes(type) && present.has(type);
            return (
              <button
                key={type}
                type="button"
                disabled={taken}
                onClick={() => {
                  onAdd(type);
                  setAdding(false);
                }}
                className="flex items-start gap-2 rounded-md border bg-card p-2 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`printTemplates.type.${type}` as TranslationKey)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {taken
                      ? t("printTemplates.onlyOnce")
                      : t(`printTemplates.typeHint.${type}` as TranslationKey)}
                  </span>
                </span>
              </button>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2"
            onClick={() => setAdding(false)}
          >
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" className="h-11" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> {t("printTemplates.addBlock")}
        </Button>
      )}
    </div>
  );
}
