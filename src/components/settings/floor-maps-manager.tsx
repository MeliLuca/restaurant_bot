"use client";

// Settings → Mappe sala: the rooms (maps) themselves, plus what sits on each
// one — which tables, their name, seats (coperti), tags and shape. Moving and
// resizing tables by hand is the layout editor's job (floor-map-editor.tsx,
// "Modifica disposizione"); here new tables land on a default spot.

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  CalendarOff,
  Circle,
  Combine,
  Map as MapIcon,
  MapPinOff,
  Move,
  Plus,
  RectangleHorizontal,
  Trash2,
} from "lucide-react";
import { FloorMapView } from "@/components/floor-map/floor-map-view";
import { TableRow, runAction } from "@/components/settings/tables-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchReservationsBetween } from "@/lib/api";
import type { FloorMap, Reservation, TableTag } from "@/lib/database.types";
import {
  MAP_MAX_SIZE,
  MAP_MIN_SIZE,
  createFloorMap,
  defaultPlacement,
  deleteFloorMap,
  placeTable,
  reorderFloorMaps,
  setTableShape,
  unplaceTable,
  updateFloorMap,
} from "@/lib/floor/maps";
import { useLangStore, useT } from "@/lib/i18n/use-translation";
import {
  createTable,
  deleteTable,
  setTableTags,
  updateTable,
  type TableWithTags,
} from "@/lib/settings-api";
import { cn } from "@/lib/utils";
import { useSmartFloor } from "@/stores/smart-floor-store";

const NEW_MAP_SIZE = { width: 1000, height: 700 };
const EMPTY = new Map<string, never[]>();
const NO_DIMMED = new Set<string>();
/** Bookings named in the "close to bookings" warning; the rest are counted */
const CLOSE_LIST_MAX = 10;

interface FloorMapsManagerProps {
  maps: FloorMap[];
  tables: TableWithTags[];
  tags: TableTag[];
  onChanged: () => Promise<void>;
}

function parseSize(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= MAP_MIN_SIZE && n <= MAP_MAX_SIZE
    ? n
    : null;
}

export function FloorMapsManager({
  maps,
  tables,
  tags,
  onChanged,
}: FloorMapsManagerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const smartFloor = useSmartFloor().enabled;
  const lang = useLangStore((s) => s.lang);

  const map = maps.find((m) => m.id === selectedMapId) ?? maps[0] ?? null;
  const onMap = map ? tables.filter((tb) => tb.map_id === map.id) : [];
  const offMap = tables.filter(
    (tb) => tb.map_id === null || !maps.some((m) => m.id === tb.map_id),
  );
  const selected = onMap.find((tb) => tb.id === selectedTableId) ?? null;

  const run = (action: () => Promise<void>, success: string) =>
    runAction(setBusy, action, success, onChanged, t("common.somethingWrong"));

  function selectMap(id: string) {
    setSelectedMapId(id);
    setSelectedTableId(null);
  }

  function move(index: number, delta: number) {
    const ids = maps.map((m) => m.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    void run(() => reorderFloorMaps(ids), t("floorMapsMgr.reordered"));
  }

  // closing a room to bookings: say which bookings already sit there (they stay)
  async function setBookable(m: FloorMap, bookable: boolean) {
    if (!bookable) {
      const ids = new Set(tables.filter((tb) => tb.map_id === m.id).map((tb) => tb.id));
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const until = new Date(from);
      until.setFullYear(until.getFullYear() + 2);
      let there: Reservation[];
      try {
        there = (await fetchReservationsBetween(from, until)).filter(
          (r) => r.status === "booked" && r.table_ids.some((id) => ids.has(id)),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
        return;
      }
      if (there.length > 0) {
        const when = new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        const list = there
          .slice(0, CLOSE_LIST_MAX)
          .map((r) => `• ${when.format(new Date(r.reserved_at))} ${r.customer_name} (${r.party_size})`)
          .concat(
            there.length > CLOSE_LIST_MAX
              ? [t("floorMapsMgr.andMore", { count: there.length - CLOSE_LIST_MAX })]
              : [],
          )
          .join("\n");
        if (
          !window.confirm(
            t("floorMapsMgr.closeConfirm", { name: m.name, count: there.length, list }),
          )
        ) {
          return;
        }
      }
    }
    void run(
      () => updateFloorMap(m.id, { bookable }),
      t(bookable ? "floorMapsMgr.bookableOn" : "floorMapsMgr.bookableOff", { name: m.name }),
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MapIcon className="h-5 w-5" /> {t("floorMapsMgr.mapsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {maps.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("floorMapsMgr.noMaps")}
              </p>
            )}
            {maps.map((m, i) => {
              const count = tables.filter((tb) => tb.map_id === m.id).length;
              const active = m.id === map?.id;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-center gap-1 rounded-lg border p-1 pl-3",
                    active && "border-primary bg-primary/5",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectMap(m.id)}
                    className="flex min-h-10 min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {t("floorMapsMgr.tablesCount", { count })}
                      {!m.bookable && (
                        <>
                          {" · "}
                          <CalendarOff className="h-3 w-3" />
                          {t("floorMapsMgr.notBookable")}
                        </>
                      )}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={t("floorMapsMgr.moveUp", { name: m.name })}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label={t("floorMapsMgr.moveDown", { name: m.name })}
                    disabled={busy || i === maps.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <NewMapForm
              busy={busy}
              onCreate={async (name, width, height) => {
                let created: FloorMap | null = null;
                await run(async () => {
                  created = await createFloorMap(name, width, height, maps.length);
                }, t("floorMapsMgr.mapCreated", { name }));
                if (created) selectMap((created as FloorMap).id);
              }}
            />
          </CardContent>
        </Card>

        {map && (
          <MapSettingsCard
            key={map.id}
            map={map}
            tableCount={onMap.length}
            busy={busy}
            onBookableChange={(bookable) => void setBookable(map, bookable)}
            onSave={(fields) =>
              run(
                () => updateFloorMap(map.id, fields),
                t("floorMapsMgr.mapUpdated", { name: fields.name ?? map.name }),
              )
            }
            onDelete={() => {
              if (
                !window.confirm(
                  t("floorMapsMgr.confirmDelete", {
                    name: map.name,
                    count: onMap.length,
                  }),
                )
              )
                return;
              setSelectedMapId(null);
              void run(
                () => deleteFloorMap(map.id),
                t("floorMapsMgr.mapDeleted", { name: map.name }),
              );
            }}
          />
        )}
      </div>

      {map && (
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardContent className="flex h-[60vh] min-h-[360px] flex-col gap-3 pt-6">
              {/* above the map, not in its toolbar: there it covered the
                  rotate button on narrower screens */}
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild className="h-11 shrink-0">
                  <Link href={`/settings/floor-maps/${map.id}/edit`}>
                    <Move className="mr-2 h-4 w-4" />
                    {t("floorMapsMgr.editLayout")}
                  </Link>
                </Button>
                {smartFloor && (
                  <Button asChild variant="outline" className="h-11 shrink-0">
                    <Link href={`/settings/floor-maps/${map.id}/joins`}>
                      <Combine className="mr-2 h-4 w-4" />
                      {t("joinPairs.open")}
                    </Link>
                  </Button>
                )}
                <p className="text-sm text-muted-foreground">
                  {t("floorMapsMgr.tapToEdit")}
                </p>
              </div>
              <div className="min-h-0 flex-1">
                <FloorMapView
                  map={map}
                  tables={onMap}
                  splitsByTable={EMPTY}
                  linkedByTable={EMPTY}
                  dimmed={NO_DIMMED}
                  selectedId={selected?.id}
                  onSelect={(tb) =>
                    setSelectedTableId((cur) => (cur === tb.id ? null : tb.id))
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {selected
                  ? t("floorMapsMgr.selectedTable", { name: selected.name })
                  : t("floorMapsMgr.tablesOnMap", { name: map.name })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {selected ? (
                <>
                  <TableRow
                    table={selected}
                    tags={tags}
                    busy={busy}
                    onSave={(fields) =>
                      run(
                        () => updateTable(selected.id, fields),
                        t("tablesMgr.tableUpdated", { name: selected.name }),
                      )
                    }
                    onToggleTag={(tagId) => {
                      const current = selected.table_tags.map((g) => g.id);
                      const next = current.includes(tagId)
                        ? current.filter((x) => x !== tagId)
                        : [...current, tagId];
                      void run(
                        () => setTableTags(selected.id, next),
                        t("tablesMgr.tagsUpdated", { name: selected.name }),
                      );
                    }}
                    onDelete={async () => {
                      if (
                        !window.confirm(
                          t("floorMapsMgr.confirmDeleteTable", {
                            name: selected.name,
                          }),
                        )
                      )
                        return;
                      await run(
                        () => deleteTable(selected.id),
                        t("tablesMgr.tableDeleted", { name: selected.name }),
                      );
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <ShapePicker
                      value={selected.shape}
                      disabled={busy}
                      onChange={(shape) =>
                        run(
                          () => setTableShape(selected, shape),
                          t("tablesMgr.tableUpdated", { name: selected.name }),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      className="h-11"
                      disabled={busy}
                      onClick={() => {
                        setSelectedTableId(null);
                        void run(
                          () => unplaceTable(selected.id),
                          t("floorMapsMgr.tableUnplaced", {
                            name: selected.name,
                          }),
                        );
                      }}
                    >
                      <MapPinOff className="mr-2 h-4 w-4" />
                      {t("floorMapsMgr.removeFromMap")}
                    </Button>
                    <Button
                      variant="ghost"
                      className="ml-auto h-11"
                      onClick={() => setSelectedTableId(null)}
                    >
                      {t("common.close")}
                    </Button>
                  </div>
                </>
              ) : onMap.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("floorMapsMgr.emptyMap")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {onMap.map((tb) => (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => setSelectedTableId(tb.id)}
                      className="flex h-9 items-center gap-1 rounded-full border px-3 text-sm hover:bg-accent"
                    >
                      <span className="font-semibold">{tb.name}</span>
                      <span className="text-xs text-muted-foreground">
                        · {tb.capacity}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <NewTableCard
            key={map.id}
            tags={tags}
            busy={busy}
            onCreate={(name, capacity, tagIds, shape) =>
              run(
                async () => {
                  await createTable(name, capacity, tagIds, {
                    map_id: map.id,
                    ...defaultPlacement(map, onMap, shape),
                  });
                },
                t("floorMapsMgr.tableAddedToMap", { name, map: map.name }),
              )
            }
          />

          {offMap.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {t("floorMapsMgr.offMapTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("floorMapsMgr.offMapHelp", { map: map.name })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {offMap.map((tb) => (
                    <button
                      key={tb.id}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            placeTable(
                              tb.id,
                              map.id,
                              defaultPlacement(
                                map,
                                onMap,
                                tb.shape === "circle" ? "circle" : "rect",
                              ),
                            ),
                          t("floorMapsMgr.tableAddedToMap", {
                            name: tb.name,
                            map: map.name,
                          }),
                        )
                      }
                      className="flex h-9 items-center gap-1 rounded-full border border-dashed px-3 text-sm hover:bg-accent disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="font-semibold">{tb.name}</span>
                      <span className="text-xs text-muted-foreground">
                        · {tb.capacity}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function NewMapForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string, width: number, height: number) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed, NEW_MAP_SIZE.width, NEW_MAP_SIZE.height);
    setName("");
  }

  return (
    <form onSubmit={submit} className="mt-2 flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("floorMapsMgr.newMapPlaceholder")}
        aria-label={t("floorMapsMgr.newMapAria")}
        className="h-11"
      />
      <Button type="submit" className="h-11" disabled={busy || !name.trim()}>
        <Plus className="mr-1 h-4 w-4" /> {t("common.add")}
      </Button>
    </form>
  );
}

function MapSettingsCard({
  map,
  tableCount,
  busy,
  onBookableChange,
  onSave,
  onDelete,
}: {
  map: FloorMap;
  tableCount: number;
  busy: boolean;
  onBookableChange: (bookable: boolean) => void;
  onSave: (fields: {
    name?: string;
    width?: number;
    height?: number;
  }) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(map.name);
  const [width, setWidth] = useState(String(map.width));
  const [height, setHeight] = useState(String(map.height));

  useEffect(() => {
    setName(map.name);
    setWidth(String(map.width));
    setHeight(String(map.height));
  }, [map.name, map.width, map.height]);

  function commit() {
    const trimmed = name.trim();
    const w = parseSize(width);
    const h = parseSize(height);
    if (!trimmed || w === null || h === null) {
      setName(map.name);
      setWidth(String(map.width));
      setHeight(String(map.height));
      return;
    }
    if (trimmed === map.name && w === map.width && h === map.height) return;
    void onSave({ name: trimmed, width: w, height: h });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t("floorMapsMgr.mapSettings")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("floorMapsMgr.mapName")}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            className="h-11"
            disabled={busy}
          />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            {t("floorMapsMgr.width")}
            <Input
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              onBlur={commit}
              type="number"
              inputMode="numeric"
              min={MAP_MIN_SIZE}
              max={MAP_MAX_SIZE}
              className="h-11"
              disabled={busy}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            {t("floorMapsMgr.height")}
            <Input
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              onBlur={commit}
              type="number"
              inputMode="numeric"
              min={MAP_MIN_SIZE}
              max={MAP_MAX_SIZE}
              className="h-11"
              disabled={busy}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("floorMapsMgr.sizeHelp", { min: MAP_MIN_SIZE, max: MAP_MAX_SIZE })}
        </p>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            checked={map.bookable}
            disabled={busy}
            onChange={(e) => onBookableChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t("floorMapsMgr.bookable")}</span>
            <span className="text-xs text-muted-foreground">
              {t(map.bookable ? "floorMapsMgr.bookableHelp" : "floorMapsMgr.notBookableHelp")}
            </span>
          </span>
        </label>
        <Button
          variant="outline"
          className="h-11 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("floorMapsMgr.deleteMap")}
          {tableCount > 0 && ` (${tableCount})`}
        </Button>
      </CardContent>
    </Card>
  );
}

function ShapePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (shape: "rect" | "circle") => void;
}) {
  const t = useT();
  const options = [
    ["rect", RectangleHorizontal, "floorMapsMgr.shapeRect"],
    ["circle", Circle, "floorMapsMgr.shapeCircle"],
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("floorMapsMgr.shape")}
      className="flex h-11 items-center rounded-lg border p-1"
    >
      {options.map(([shape, Icon, labelKey]) => (
        <button
          key={shape}
          type="button"
          disabled={disabled || value === shape}
          aria-pressed={value === shape}
          onClick={() => onChange(shape)}
          className={cn(
            "flex h-full items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
            value === shape
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent disabled:opacity-50",
          )}
        >
          <Icon className="h-4 w-4" />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

function NewTableCard({
  tags,
  busy,
  onCreate,
}: {
  tags: TableTag[];
  busy: boolean;
  onCreate: (
    name: string,
    capacity: number,
    tagIds: string[],
    shape: "rect" | "circle",
  ) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [shape, setShape] = useState<"rect" | "circle">("rect");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const seats = parseInt(capacity, 10);
    if (!trimmed || !Number.isFinite(seats) || seats < 1) return;
    await onCreate(trimmed, seats, tagIds, shape);
    setName("");
    setCapacity("4");
    setTagIds([]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("floorMapsMgr.newTable")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("floorMapsMgr.newTableName")}
              aria-label={t("tablesMgr.newTableAria")}
              className="h-11 w-40"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("floorMapsMgr.seats")}
              <Input
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                type="number"
                min={1}
                inputMode="numeric"
                className="h-11 w-20"
                aria-label={t("tablesMgr.newCapacityAria")}
              />
            </label>
            <ShapePicker value={shape} disabled={busy} onChange={setShape} />
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setTagIds((ids) =>
                        active
                          ? ids.filter((x) => x !== tag.id)
                          : [...ids, tag.id],
                      )
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
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
          )}
          <Button
            type="submit"
            className="h-11 w-fit"
            disabled={busy || !name.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> {t("floorMapsMgr.addToMap")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("floorMapsMgr.newTableHelp")}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
