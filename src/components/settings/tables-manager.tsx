"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Armchair, Plus, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  createTable,
  createTableTag,
  deleteTable,
  deleteTableTag,
  setTableTags,
  updateTable,
  type TableWithTags,
} from "@/lib/settings-api";
import type { TableTag } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

interface TablesManagerProps {
  tables: TableWithTags[];
  tags: TableTag[];
  onChanged: () => Promise<void>;
}

export async function runAction(
  setBusy: (b: boolean) => void,
  action: () => Promise<void>,
  success: string,
  onChanged: () => Promise<void>,
  errorMsg: string,
) {
  setBusy(true);
  try {
    await action();
    await onChanged();
    toast.success(success);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : errorMsg);
  } finally {
    setBusy(false);
  }
}

export function TablesManager({ tables, tags, onChanged }: TablesManagerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCapacity, setNewCapacity] = useState("4");

  const run = (action: () => Promise<void>, success: string) =>
    runAction(setBusy, action, success, onChanged, t("common.somethingWrong"));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const capacity = parseInt(newCapacity, 10);
    if (!name) return;
    if (!Number.isFinite(capacity) || capacity < 1) {
      toast.error(t("tablesMgr.capacityMin"));
      return;
    }
    await run(
      () => createTable(name, capacity, []),
      t("tablesMgr.tableAdded", { name }),
    );
    setNewName("");
    setNewCapacity("4");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Armchair className="h-5 w-5" /> {t("tablesMgr.tablesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {tables.map((tbl, i) => (
          <div key={tbl.id}>
            {i > 0 && <Separator className="my-1" />}
            <TableRow
              table={tbl}
              tags={tags}
              busy={busy}
              onSave={(fields) =>
                run(
                  () => updateTable(tbl.id, fields),
                  t("tablesMgr.tableUpdated", { name: tbl.name }),
                )
              }
              onToggleTag={(tagId) => {
                const current = tbl.table_tags.map((g) => g.id);
                const next = current.includes(tagId)
                  ? current.filter((x) => x !== tagId)
                  : [...current, tagId];
                void run(
                  () => setTableTags(tbl.id, next),
                  t("tablesMgr.tagsUpdated", { name: tbl.name }),
                );
              }}
              onDelete={() =>
                run(
                  () => deleteTable(tbl.id),
                  t("tablesMgr.tableDeleted", { name: tbl.name }),
                )
              }
            />
          </div>
        ))}

        <form onSubmit={handleCreate} className="mt-3 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("tablesMgr.newTablePlaceholder")}
            className="h-12"
            aria-label={t("tablesMgr.newTableAria")}
          />
          <Input
            value={newCapacity}
            onChange={(e) => setNewCapacity(e.target.value)}
            type="number"
            min={1}
            inputMode="numeric"
            className="h-12 w-24"
            aria-label={t("tablesMgr.newCapacityAria")}
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newName.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("tablesMgr.addTable")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function TableRow({
  table,
  tags,
  busy,
  onSave,
  onToggleTag,
  onDelete,
}: {
  table: TableWithTags;
  tags: TableTag[];
  busy: boolean;
  onSave: (fields: { name?: string; capacity?: number }) => Promise<void>;
  onToggleTag: (tagId: string) => void;
  /** Omit to hide the delete button */
  onDelete?: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(table.name);
  const [capacity, setCapacity] = useState(String(table.capacity));

  useEffect(() => {
    setName(table.name);
    setCapacity(String(table.capacity));
  }, [table.name, table.capacity]);

  function commit() {
    const trimmed = name.trim();
    const parsed = parseInt(capacity, 10);
    if (!trimmed || !Number.isFinite(parsed) || parsed < 1) {
      setName(table.name);
      setCapacity(String(table.capacity));
      return;
    }
    if (trimmed === table.name && parsed === table.capacity) return;
    void onSave({ name: trimmed, capacity: parsed });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className="h-11 w-24 font-semibold"
        aria-label={t("tablesMgr.nameOfTable", { name: table.name })}
        disabled={busy}
      />
      <Input
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        onBlur={commit}
        type="number"
        min={1}
        inputMode="numeric"
        className="h-11 w-20"
        aria-label={t("tablesMgr.capacityOfTable", { name: table.name })}
        disabled={busy}
      />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {tags.map((tag) => {
          const active = table.table_tags.some((g) => g.id === tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              disabled={busy}
              onClick={() => onToggleTag(tag.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground"
          aria-label={t("tablesMgr.deleteTableAria", { name: table.name })}
          disabled={busy}
          onClick={() => void onDelete()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

interface TagsManagerProps {
  tags: TableTag[];
  tables: TableWithTags[];
  onChanged: () => Promise<void>;
}

export function TagsManager({ tags, tables, onChanged }: TagsManagerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState("");

  const run = (action: () => Promise<void>, success: string) =>
    runAction(setBusy, action, success, onChanged, t("common.somethingWrong"));

  const usageCount = (id: string) =>
    tables.filter((tbl) => tbl.table_tags.some((g) => g.id === id)).length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newTag.trim();
    if (!name) return;
    await run(
      () => createTableTag(name),
      t("tablesMgr.tagCreated", { name }),
    );
    setNewTag("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Tags className="h-5 w-5" /> {t("tablesMgr.featureTags")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("tablesMgr.tagsHelp")}
        </p>
        <div className="flex flex-wrap gap-2">
          {tags.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("tablesMgr.noTags")}</p>
          )}
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm"
            >
              {tag.name}
              <span className="text-xs text-muted-foreground">
                {usageCount(tag.id)}
              </span>
              <button
                type="button"
                aria-label={t("tablesMgr.deleteTagAria", { name: tag.name })}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() =>
                  run(
                    () => deleteTableTag(tag.id),
                    t("tablesMgr.tagDeleted", { name: tag.name }),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder={t("tablesMgr.newTagPlaceholder")}
            className="h-12"
            aria-label={t("tablesMgr.newTagAria")}
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newTag.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("tablesMgr.addTag")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
