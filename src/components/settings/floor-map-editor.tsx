"use client";

// Visual layout editor for one floor map (Settings → Mappe sala → Modifica
// disposizione). Two layers, edited one at a time so a wall can't be nudged
// while arranging tables: "Tavoli" (drag, resize, rotate, align) and
// "Sfondo" (draw and edit walls, areas, arrows and labels). Everything lands
// in one local draft with one undo history; "Salva" writes tables and scenery
// in a single transaction, so tablets in service never see half a change.
// Names, seats and tags are not part of the draft: they save immediately,
// exactly as in the Mappe sala page.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowLeft,
  ArrowUpRight,
  Circle,
  Copy,
  FileDown,
  FileUp,
  Grid3x3,
  ImageDown,
  MapPinOff,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Save,
  Slash,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useKeepCenterOnZoom } from "@/components/floor-map/floor-map-view";
import {
  BulkDetails,
  EditorElement,
  EditorTable,
  ElementPanel,
  GeometryFields,
  GhostTable,
  ImportDialog,
  RepeatPanel,
  SelectionHandles,
  TracePanel,
  type ImportOptions,
  type RepeatSettings,
  type TracePhoto,
} from "@/components/settings/floor-map-editor-parts";
import { TableRow, runAction } from "@/components/settings/tables-manager";
import { Button } from "@/components/ui/button";
import type { FloorMap, FloorMapElement, TableTag } from "@/lib/database.types";
import {
  ROTATE_SNAP_DEG,
  alignGeoms,
  bounds,
  center,
  clampToMap,
  dragGeom,
  moveGeom,
  repeatLayout,
  resizeGeom,
  rotateBy,
  rotateToward,
  snapTo,
  toShape,
  type AlignMode,
  type Geom,
  type Handle,
} from "@/lib/floor/geometry";
import {
  DEFAULT_TABLE_SIZE,
  MAP_MAX_SIZE,
  MAP_MIN_SIZE,
  compareTableNames,
  defaultPlacement,
  geomOf,
  nextTableName,
  nextTableNameLike,
  saveFloorMapLayout,
} from "@/lib/floor/maps";
import {
  arrowPath,
  constrain45,
  elementBounds,
  freehandPath,
  moveElement,
  polylinePath,
  resizeElement,
  type Box,
} from "@/lib/floor/scenery";
import {
  downloadBlob,
  estimateSeats,
  mapToSvg,
  parseMapSvg,
  svgToPng,
  type ImportedMap,
} from "@/lib/floor/svg-io";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import {
  addTagToTables,
  createTable,
  removeTagFromTables,
  setTableTags,
  setTablesCapacity,
  updateTable,
  type TableWithTags,
} from "@/lib/settings-api";
import { cn } from "@/lib/utils";

/** table id → geometry on this map; null = taken off the map in this draft */
type TablesDraft = Record<string, Geom | null>;
/** A table drawn in this draft: it only becomes a real table on "Salva" */
interface DraftTable {
  name: string;
  capacity: number;
  tagIds: string[];
}
/** Everything the editor can change; one undo step = one Doc */
interface Doc {
  tables: TablesDraft;
  /** draft key (also a key of `tables`) → tables drawn in this draft */
  created: Record<string, DraftTable>;
  elements: FloorMapElement[];
  /** sheet size in map units (fit to a traced photo or an imported SVG) */
  width: number;
  height: number;
}
type Layer = "tables" | "scenery";
type TableTool = "tableRect" | "tableCircle";
type DrawTool = TableTool | "line" | "rect" | "circle" | "arrow";
type Tool = "select" | DrawTool | "wall" | "freehand" | "text";
type Pt = [number, number];

const GRID = 10;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const HISTORY_LIMIT = 100;
/** Smallest side of a table drawn by dragging */
const MIN_TABLE = 20;
/** New scenery pasted/duplicated this far from the original */
const DUPLICATE_OFFSET = 20;

type Gesture =
  | { kind: "move"; ids: string[]; anchor: string; x0: number; y0: number; start: Doc }
  | { kind: "resize"; id: string; handle: Handle; start: Doc }
  | { kind: "rotate"; id: string; start: Doc }
  | { kind: "elmove"; idxs: number[]; box: Box; x0: number; y0: number; start: Doc }
  | { kind: "elresize"; idx: number; handle: Handle; box: Box; start: Doc }
  | { kind: "draw"; tool: DrawTool; x0: number; y0: number; x1: number; y1: number }
  | { kind: "freehand"; pts: Pt[] }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: string[] | number[] };

interface FloorMapEditorProps {
  map: FloorMap;
  tables: TableWithTags[];
  tags: TableTag[];
  /** Refetch tables (names/seats/tags changed, or after a save) */
  onChanged: () => Promise<void>;
}

function initialDoc(map: FloorMap, tables: TableWithTags[]): Doc {
  const t: TablesDraft = {};
  for (const tb of tables) if (tb.map_id === map.id) t[tb.id] = geomOf(tb);
  return { tables: t, created: {}, elements: map.elements, width: map.width, height: map.height };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isTableTool = (tool: Tool): tool is TableTool =>
  tool === "tableRect" || tool === "tableCircle";

/** A drawn table taken off the map is simply gone: it never existed. */
function prune(d: Doc): Doc {
  const gone = Object.keys(d.created).filter((k) => !d.tables[k]);
  if (gone.length === 0) return d;
  const tables = { ...d.tables };
  const created = { ...d.created };
  for (const k of gone) {
    delete tables[k];
    delete created[k];
  }
  return { ...d, tables, created };
}

/** After a save: drawn tables now have real ids (draft key → id). */
function remapDoc(d: Doc, ids: Record<string, string>): Doc {
  if (!Object.keys(d.created).some((k) => ids[k])) return d;
  const tables: TablesDraft = {};
  for (const [id, g] of Object.entries(d.tables)) tables[ids[id] ?? id] = g;
  const created = Object.fromEntries(Object.entries(d.created).filter(([k]) => !ids[k]));
  return { ...d, tables, created };
}

function boxesMeet(b: Box, x1: number, y1: number, x2: number, y2: number) {
  return b.x + b.w >= x1 && b.x <= x2 && b.y + b.h >= y1 && b.y <= y2;
}

export function FloorMapEditor({ map, tables, tags, onChanged }: FloorMapEditorProps) {
  const t = useT();
  const router = useRouter();
  const [saved, setSaved] = useState<Doc>(() => initialDoc(map, tables));
  const [doc, setDoc] = useState<Doc>(saved);
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [layer, setLayer] = useState<Layer>("tables");
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [elSel, setElSel] = useState<number[]>([]);
  const [wall, setWall] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [snap, setSnap] = useState(true);
  const [step, setStep] = useState(0);
  const [fit, setFit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<TracePhoto | null>(null);
  const [photoOpacity, setPhotoOpacity] = useState(0.4);
  const [imported, setImported] = useState<ImportedMap | null>(null);
  const [importing, setImporting] = useState(false);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  // Pointer handlers read the ref: a move can arrive before React re-renders
  // with the gesture that pointerdown just started.
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = (g: Gesture | null) => {
    gestureRef.current = g;
    setGestureState(g);
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const draft = doc.tables;
  const created = doc.created;
  const elements = doc.elements;
  const W = doc.width;
  const H = doc.height;
  const byId = useMemo(() => new Map(tables.map((tb) => [tb.id, tb])), [tables]);
  const nameOf = (id: string) => byId.get(id)?.name ?? created[id]?.name ?? "";
  const placedIds = Object.keys(draft)
    .filter((id) => draft[id] && (byId.has(id) || created[id]))
    .sort((a, b) => compareTableNames(nameOf(a), nameOf(b)));
  // Draft keys of drawn tables; never reused, so undo/redo can't mix them up.
  const drawnCount = useRef(0);
  // Bumped to reset the side panel's name field after a rejected rename.
  const [rowKey, setRowKey] = useState(0);
  // "Ripeti in fila": settings persist while editing, the panel closes
  // whenever the selection changes
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeat, setRepeat] = useState<RepeatSettings>({ dir: "right", count: 3, gap: 20 });
  // Off-map tables, plus the ones this draft took off: ready to (re)place.
  const toPlace = tables.filter(
    (tb) =>
      !draft[tb.id] &&
      (draft[tb.id] === null || tb.map_id === null || tb.map_id === map.id),
  );
  const grid = snap ? GRID : null;
  const dirty = !same(doc, saved);
  const scale = fit * ZOOM_STEPS[step];
  const selected = selection.filter((id) => draft[id]);
  const selectedEls = elSel.filter((i) => i < elements.length);
  useKeepCenterOnZoom(boxRef, scale);
  const single = selected.length === 1 ? selected[0] : null;
  const singleEl = selectedEls.length === 1 ? selectedEls[0] : null;
  const selectionKey = selected.join(",");
  useEffect(() => setRepeatOpen(false), [selectionKey, layer]);
  const snapPt = (x: number, y: number, free = false): Pt =>
    free || !grid ? [x, y] : [snapTo(x, grid), snapTo(y, grid)];

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  // A ref gives callbacks the live doc without side effects inside state
  // updaters (dev mode runs those twice).
  const docRef = useRef(doc);
  docRef.current = doc;

  const commit = useCallback((before: Doc, next: Doc) => {
    const after = prune(next);
    docRef.current = after;
    setDoc(after);
    if (same(before, after)) return;
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), before]);
    setFuture([]);
  }, []);

  const apply = useCallback(
    (fn: (d: Doc) => Doc) => commit(docRef.current, fn(docRef.current)),
    [commit],
  );
  const applyTables = useCallback(
    (fn: (d: TablesDraft) => TablesDraft) => apply((d) => ({ ...d, tables: fn(d.tables) })),
    [apply],
  );
  const applyElements = useCallback(
    (fn: (els: FloorMapElement[]) => FloorMapElement[]) =>
      apply((d) => ({ ...d, elements: fn(d.elements) })),
    [apply],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const cur = docRef.current;
    setFuture((f) => [cur, ...f]);
    docRef.current = past[past.length - 1];
    setDoc(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }, [past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const cur = docRef.current;
    setPast((p) => [...p, cur]);
    docRef.current = future[0];
    setDoc(future[0]);
    setFuture(future.slice(1));
  }, [future]);

  /** Apply fn to every selected table's geometry (one history step). */
  const updateSelected = useCallback(
    (fn: (g: Geom, id: string) => Geom | null) =>
      applyTables((d) => {
        const next = { ...d };
        for (const id of selection) {
          const g = d[id];
          if (g) next[id] = fn(g, id);
        }
        return next;
      }),
    [applyTables, selection],
  );

  const deleteElements = useCallback(
    (idxs: number[]) => {
      applyElements((els) => els.filter((_, i) => !idxs.includes(i)));
      setElSel([]);
    },
    [applyElements],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (layer === "tables") {
        updateSelected((g) => clampToMap(moveGeom(g, dx, dy), W, H));
      } else {
        applyElements((els) =>
          els.map((el, i) => (elSel.includes(i) ? moveElement(el, dx, dy) : el)),
        );
      }
    },
    [layer, updateSelected, applyElements, elSel, W, H],
  );

  function align(mode: AlignMode) {
    applyTables((d) => {
      const ids = selection.filter((id) => d[id]);
      const out = alignGeoms(ids.map((id) => d[id]!), mode);
      const next = { ...d };
      ids.forEach((id, i) => (next[id] = out[i]));
      return next;
    });
  }

  function place(id: string) {
    const tb = byId.get(id);
    if (!tb) return;
    applyTables((d) => {
      const others = Object.values(d).filter((g): g is Geom => !!g);
      // a table taken off in this draft comes back where it was
      const prev = saved.tables[id] ?? (tb.map_id === map.id ? geomOf(tb) : null);
      const g =
        prev ??
        (defaultPlacement({ width: W, height: H }, others, tb.shape === "circle" ? "circle" : "rect") as Geom);
      return { ...d, [id]: g };
    });
    setSelection([id]);
  }

  function duplicateElements(idxs: number[]) {
    const copies = idxs.map((i) => moveElement(elements[i], DUPLICATE_OFFSET, DUPLICATE_OFFSET));
    applyElements((els) => [...els, ...copies]);
    setElSel(copies.map((_, k) => elements.length + k));
  }

  function addElement(el: FloorMapElement) {
    applyElements((els) => [...els, el]);
    setElSel([elements.length]);
    setTool("select");
  }

  /** Is `name` free for a table (ignoring the table `self`)? */
  function nameFree(name: string, self: string) {
    const key = name.trim().toLowerCase();
    const existing = byName.get(key);
    if (existing && existing.id !== self) return false;
    return !Object.entries(docRef.current.created).some(
      ([k, c]) => k !== self && c.name.trim().toLowerCase() === key,
    );
  }

  /**
   * A table drawn with a table tool: a click drops one of the standard size
   * centred there, a drag sets its size (rectangle corner to corner, circle
   * from the centre out). It gets the next free number and seats estimated
   * from its size, and is only created for real on "Salva".
   */
  function addTable(tl: TableTool, x0: number, y0: number, x1: number, y1: number, click: boolean) {
    const shape = tl === "tableCircle" ? "circle" : "rect";
    let g: Geom;
    if (click) {
      const { w, h } = DEFAULT_TABLE_SIZE[shape];
      g = { shape, x: snapTo(x0 - w / 2, grid), y: snapTo(y0 - h / 2, grid), w, h, rotation: 0, path: null };
    } else if (shape === "circle") {
      const r = Math.max(MIN_TABLE / 2, snapTo(Math.hypot(x1 - x0, y1 - y0), grid));
      g = { shape, x: x0 - r, y: y0 - r, w: 2 * r, h: 2 * r, rotation: 0, path: null };
    } else {
      g = {
        shape,
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.max(MIN_TABLE, Math.abs(x1 - x0)),
        h: Math.max(MIN_TABLE, Math.abs(y1 - y0)),
        rotation: 0,
        path: null,
      };
    }
    const geom = clampToMap(g, W, H);
    const key = `new-${++drawnCount.current}`;
    const name = nextTableName([
      ...tables.map((tb) => tb.name),
      ...Object.values(docRef.current.created).map((c) => c.name),
    ]);
    const capacity = estimateSeats(shape, geom.w, geom.h);
    apply((d) => ({
      ...d,
      tables: { ...d.tables, [key]: geom },
      created: { ...d.created, [key]: { name, capacity, tagIds: [] } },
    }));
    setSelection([key]);
    setTool("select");
  }

  /**
   * The copies "Ripeti in fila" would add: every selected table shifted by
   * one step per copy, named after it in its series (G1 → G6…), in reading
   * order so a row copied downwards is numbered left to right.
   */
  function planRepeat() {
    if (!repeatOpen || layer !== "tables" || selected.length === 0) return null;
    const geoms = selected.map((id) => draft[id]!);
    const { dx, dy, fits } = repeatLayout(geoms, repeat.dir, repeat.gap, W, H);
    const order = [...selected].sort((a, b) => {
      const [ax, ay] = center(draft[a]!);
      const [bx, by] = center(draft[b]!);
      return Math.round(ay / GRID) - Math.round(by / GRID) || ax - bx;
    });
    const names = [...tables.map((tb) => tb.name), ...Object.values(created).map((c) => c.name)];
    const items: { source: string; geom: Geom; name: string }[] = [];
    for (let k = 1; k <= Math.min(repeat.count, fits); k++) {
      for (const id of order) {
        const name = nextTableNameLike(nameOf(id), names);
        names.push(name);
        items.push({ source: id, geom: moveGeom(draft[id]!, dx * k, dy * k), name });
      }
    }
    return { fits, items };
  }

  /** Add the planned copies as drawn tables: same shape, seats and tags. */
  function applyRepeat() {
    const plan = planRepeat();
    if (!plan || plan.items.length === 0) return;
    const addTables: TablesDraft = {};
    const addCreated: Record<string, DraftTable> = {};
    for (const it of plan.items) {
      const key = `new-${++drawnCount.current}`;
      const src = byId.get(it.source);
      addTables[key] = it.geom;
      addCreated[key] = {
        name: it.name,
        capacity: src?.capacity ?? created[it.source].capacity,
        tagIds: src ? src.table_tags.map((g) => g.id) : [...created[it.source].tagIds],
      };
    }
    apply((d) => ({
      ...d,
      tables: { ...d.tables, ...addTables },
      created: { ...d.created, ...addCreated },
    }));
    // originals + copies stay selected: repeat again the other way for a grid
    setSelection([...selected, ...Object.keys(addTables)]);
    toast.success(t("floorMapEditor.repeatDone", { count: plan.items.length }));
  }

  /** Does this table (saved or drawn) carry the tag? */
  function hasTag(id: string, tagId: string) {
    const tb = byId.get(id);
    return tb ? tb.table_tags.some((g) => g.id === tagId) : !!created[id]?.tagIds.includes(tagId);
  }

  /**
   * Seats or a tag for every selected table. Saved tables are written at
   * once, like the single-table details; drawn ones change in the draft.
   */
  function editSelected(
    draftFn: (c: DraftTable) => DraftTable,
    save: (savedIds: string[]) => Promise<void>,
  ) {
    const drawn = selected.filter((id) => created[id]);
    const savedIds = selected.filter((id) => byId.has(id));
    if (drawn.length > 0) {
      apply((d) => {
        const next = { ...d.created };
        for (const id of drawn) if (next[id]) next[id] = draftFn(next[id]);
        return { ...d, created: next };
      });
    }
    const msg = t("floorMapEditor.bulkUpdated", { count: selected.length });
    if (savedIds.length > 0) void run(() => save(savedIds), msg);
    else toast.success(msg);
  }

  function setSelectedCapacity(capacity: number) {
    editSelected(
      (c) => ({ ...c, capacity }),
      (ids) => setTablesCapacity(ids, capacity),
    );
  }

  function setSelectedTag(tagId: string, add: boolean) {
    editSelected(
      (c) => ({
        ...c,
        tagIds: add
          ? c.tagIds.includes(tagId) ? c.tagIds : [...c.tagIds, tagId]
          : c.tagIds.filter((x) => x !== tagId),
      }),
      (ids) => (add ? addTagToTables(tagId, ids) : removeTagFromTables(tagId, ids)),
    );
  }

  /** Name / seats / tags of a drawn table live in the draft (one undo step). */
  function updateDrawn(key: string, fields: Partial<DraftTable>) {
    if (fields.name !== undefined && !nameFree(fields.name, key)) {
      toast.error(t("floorMapEditor.nameTaken", { name: fields.name.trim() }));
      setRowKey((k) => k + 1);
      return;
    }
    apply((d) =>
      d.created[key]
        ? { ...d, created: { ...d.created, [key]: { ...d.created[key], ...fields } } }
        : d,
    );
  }

  const finishWall = useCallback(() => {
    // a double click lands two identical points: drop repeats
    const pts = wall.filter((p, i) => i === 0 || p[0] !== wall[i - 1][0] || p[1] !== wall[i - 1][1]);
    setWall([]);
    if (pts.length < 2) return;
    applyElements((els) => [...els, { kind: "path", d: polylinePath(pts) }]);
    setElSel([docRef.current.elements.length - 1]);
    setTool("select");
  }, [wall, applyElements]);

  function switchLayer(l: Layer) {
    setLayer(l);
    setTool("select");
    setSelection([]);
    setElSel([]);
    setWall([]);
  }

  // ---------------------------------------------------------------------------
  // Fit + keyboard + unload guard
  // ---------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () =>
      setFit(0.98 * Math.min(el.clientWidth / W, el.clientHeight / H));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"))
        return;
      const mod = e.metaKey || e.ctrlKey;
      const any = layer === "tables" ? selection.length > 0 : elSel.length > 0;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (layer === "tables") setSelection(placedIds);
        else setElSel(elements.map((_, i) => i));
      } else if (e.key === "Enter" && tool === "wall") {
        e.preventDefault();
        finishWall();
      } else if (e.key === "Escape") {
        if (wall.length > 0) setWall([]);
        else if (tool !== "select") setTool("select");
        else {
          setSelection([]);
          setElSel([]);
        }
      } else if (any) {
        const stepPx = e.shiftKey ? GRID * 5 : snap ? GRID : 1;
        const moves: Record<string, Pt> = {
          ArrowLeft: [-stepPx, 0],
          ArrowRight: [stepPx, 0],
          ArrowUp: [0, -stepPx],
          ArrowDown: [0, stepPx],
        };
        if (moves[e.key]) {
          e.preventDefault();
          nudge(...moves[e.key]);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          if (layer === "tables") {
            updateSelected(() => null);
            setSelection([]);
          } else deleteElements(elSel);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, nudge, updateSelected, deleteElements, finishWall, selection, elSel, placedIds, elements, snap, layer, tool, wall]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ---------------------------------------------------------------------------
  // Pointer gestures
  // ---------------------------------------------------------------------------

  function toMap(e: React.PointerEvent | React.MouseEvent): Pt {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM()?.inverse();
    const p = m ? pt.matrixTransform(m) : pt;
    return [p.x, p.y];
  }

  function capture(e: React.PointerEvent) {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function startMove(e: React.PointerEvent, id: string) {
    capture(e);
    let ids = selection;
    if (e.shiftKey) {
      ids = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
      setSelection(ids);
      if (!ids.includes(id)) return;
    } else if (!selection.includes(id)) {
      ids = [id];
      setSelection(ids);
    }
    const [x0, y0] = toMap(e);
    setGesture({ kind: "move", ids, anchor: id, x0, y0, start: doc });
  }

  function startElementMove(e: React.PointerEvent, idx: number) {
    if (tool !== "select") return; // let the sheet handle drawing
    capture(e);
    let idxs = elSel;
    if (e.shiftKey) {
      idxs = elSel.includes(idx) ? elSel.filter((x) => x !== idx) : [...elSel, idx];
      setElSel(idxs);
      if (!idxs.includes(idx)) return;
    } else if (!elSel.includes(idx)) {
      idxs = [idx];
      setElSel(idxs);
    }
    const [x0, y0] = toMap(e);
    setGesture({ kind: "elmove", idxs, box: elementBounds(elements[idx]), x0, y0, start: doc });
  }

  function onSheetDown(e: React.PointerEvent) {
    capture(e);
    const free = e.altKey;
    const [x, y] = toMap(e);
    if (tool !== "select") {
      if (tool === "freehand") {
        setGesture({ kind: "freehand", pts: [[x, y]] });
      } else if (tool === "wall") {
        let p = snapPt(x, y, free);
        const last = wall[wall.length - 1];
        if (last && e.shiftKey) p = snapPt(...constrain45(last[0], last[1], p[0], p[1]), true);
        setWall((w) => [...w, p]);
      } else if (tool === "text") {
        const [tx, ty] = snapPt(x, y, free);
        addElement({ kind: "text", x: tx, y: ty, text: t("floorMapEditor.newText"), size: 18 });
      } else {
        const [sx, sy] = snapPt(x, y, free);
        setGesture({ kind: "draw", tool, x0: sx, y0: sy, x1: sx, y1: sy });
      }
      return;
    }
    const additive = e.shiftKey ? (layer === "tables" ? selection : elSel) : [];
    if (!e.shiftKey) {
      setSelection([]);
      setElSel([]);
    }
    setGesture({ kind: "marquee", x0: x, y0: y, x1: x, y1: y, additive });
  }

  function onPointerMove(e: React.PointerEvent) {
    const gesture = gestureRef.current;
    const [px, py] = toMap(e);
    const free = e.altKey; // Alt: no snapping for this gesture
    if (!gesture) {
      if (tool === "wall" && wall.length > 0) {
        const last = wall[wall.length - 1];
        let p = snapPt(px, py, free);
        if (e.shiftKey) p = snapPt(...constrain45(last[0], last[1], p[0], p[1]), true);
        setHover(p);
      }
      return;
    }
    const setTables = (tablesDraft: TablesDraft, start: Doc) =>
      setDoc({ ...start, tables: tablesDraft });
    switch (gesture.kind) {
      case "move": {
        const a = gesture.start.tables[gesture.anchor]!;
        // snap the grabbed table, move the rest by the same amount
        const moved = dragGeom(a, px - gesture.x0, py - gesture.y0, free ? null : grid);
        const dx = moved.x - a.x;
        const dy = moved.y - a.y;
        const next = { ...gesture.start.tables };
        for (const id of gesture.ids) {
          const g = gesture.start.tables[id];
          if (g) next[id] = moveGeom(g, dx, dy);
        }
        setTables(next, gesture.start);
        break;
      }
      case "resize": {
        const g = gesture.start.tables[gesture.id]!;
        setTables(
          { ...gesture.start.tables, [gesture.id]: resizeGeom(g, gesture.handle, px, py, free ? null : grid) },
          gesture.start,
        );
        break;
      }
      case "rotate": {
        const g = gesture.start.tables[gesture.id]!;
        setTables(
          { ...gesture.start.tables, [gesture.id]: rotateToward(g, px, py, free ? null : ROTATE_SNAP_DEG) },
          gesture.start,
        );
        break;
      }
      case "elmove": {
        // snap the grabbed element's box corner, move the rest alike
        const b = gesture.box;
        const [nx, ny] = snapPt(b.x + px - gesture.x0, b.y + py - gesture.y0, free);
        const dx = nx - b.x;
        const dy = ny - b.y;
        setDoc({
          ...gesture.start,
          elements: gesture.start.elements.map((el, i) =>
            gesture.idxs.includes(i) ? moveElement(el, dx, dy) : el,
          ),
        });
        break;
      }
      case "elresize": {
        const b = gesture.box;
        const g = resizeGeom(
          { shape: "rect", x: b.x, y: b.y, w: Math.max(b.w, 1), h: Math.max(b.h, 1), rotation: 0, path: null },
          gesture.handle,
          px,
          py,
          free ? null : grid,
        );
        // a straight wall has no height (or width): keep that side flat
        const to = { x: g.x, y: b.h === 0 ? b.y : g.y, w: g.w, h: b.h === 0 ? 0 : g.h };
        if (b.w === 0) {
          to.x = b.x;
          to.w = 0;
        }
        setDoc({
          ...gesture.start,
          elements: gesture.start.elements.map((el, i) =>
            i === gesture.idx ? resizeElement(el, b, to) : el,
          ),
        });
        break;
      }
      case "draw": {
        let [x1, y1] = snapPt(px, py, free);
        if ((gesture.tool === "arrow" || gesture.tool === "line") && e.shiftKey) {
          [x1, y1] = constrain45(gesture.x0, gesture.y0, x1, y1);
        }
        setGesture({ ...gesture, x1, y1 });
        break;
      }
      case "freehand": {
        // one sample every couple of screen pixels is plenty
        const last = gesture.pts[gesture.pts.length - 1];
        if (Math.hypot(px - last[0], py - last[1]) < 2 / (scale || 1)) break;
        setGesture({ kind: "freehand", pts: [...gesture.pts, [px, py]] });
        break;
      }
      case "marquee":
        setGesture({ ...gesture, x1: px, y1: py });
    }
  }

  function onPointerUp() {
    const gesture = gestureRef.current;
    if (!gesture) return;
    setGesture(null);
    if (gesture.kind === "marquee") {
      const x1 = Math.min(gesture.x0, gesture.x1);
      const x2 = Math.max(gesture.x0, gesture.x1);
      const y1 = Math.min(gesture.y0, gesture.y1);
      const y2 = Math.max(gesture.y0, gesture.y1);
      const tiny = x2 - x1 < 3 && y2 - y1 < 3;
      if (layer === "tables") {
        const hit = tiny
          ? []
          : placedIds.filter((id) => {
              const b = bounds(draft[id]!);
              return b.x2 >= x1 && b.x1 <= x2 && b.y2 >= y1 && b.y1 <= y2;
            });
        setSelection(Array.from(new Set([...(gesture.additive as string[]), ...hit])));
      } else {
        const hit = tiny
          ? []
          : elements.map((el, i) => i).filter((i) => boxesMeet(elementBounds(elements[i]), x1, y1, x2, y2));
        setElSel(Array.from(new Set([...(gesture.additive as number[]), ...hit])));
      }
      return;
    }
    if (gesture.kind === "freehand") {
      // tolerance in screen pixels, so a stroke looks the same at any zoom;
      // the pencil stays in hand for the next stroke
      const unit = 1 / (scale || 1);
      const d = freehandPath(gesture.pts, 1.5 * unit, 12 * unit);
      if (d) applyElements((els) => [...els, { kind: "path", d }]);
      return;
    }
    if (gesture.kind === "draw") {
      const { x0, y0, x1, y1 } = gesture;
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      const click = Math.hypot(w, h) < 4;
      if (isTableTool(gesture.tool)) {
        addTable(gesture.tool, x0, y0, x1, y1, click);
        return;
      }
      if (click) return; // a click, not a drag
      if (gesture.tool === "rect") {
        addElement({ kind: "rect", x: Math.min(x0, x1), y: Math.min(y0, y1), w, h });
      } else if (gesture.tool === "circle") {
        addElement({ kind: "circle", cx: x0, cy: y0, r: Math.round(Math.hypot(w, h) * 100) / 100 });
      } else if (gesture.tool === "line") {
        addElement({ kind: "path", d: polylinePath([[x0, y0], [x1, y1]]) });
      } else {
        addElement({ kind: "path", d: arrowPath(x0, y0, x1, y1), style: "arrow" });
      }
      return;
    }
    // keep tables on the sheet, then record one undo step
    const next = { ...doc, tables: { ...doc.tables } };
    if (gesture.kind === "move" || gesture.kind === "resize" || gesture.kind === "rotate") {
      const ids = gesture.kind === "move" ? gesture.ids : [gesture.id];
      for (const id of ids) {
        const g = next.tables[id];
        if (g) next.tables[id] = clampToMap(g, W, H);
      }
    }
    commit(gesture.start, next);
  }

  // ---------------------------------------------------------------------------
  // Tracing photo, SVG import / export
  // ---------------------------------------------------------------------------

  const clampSize = (v: number) => Math.min(MAP_MAX_SIZE, Math.max(MAP_MIN_SIZE, Math.round(v)));

  /** Give the sheet the photo's proportions (keeping its width). */
  function fitSheetToPhoto() {
    if (!photo) return;
    apply((d) => ({ ...d, height: clampSize((d.width * photo.h) / photo.w) }));
  }

  async function pickSvg(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseMapSvg(await file.text());
      if (parsed.tables.length === 0 && parsed.elements.length === 0) {
        toast.error(t("floorMapEditor.importEmpty"));
        return;
      }
      setImported(parsed);
    } catch {
      toast.error(t("floorMapEditor.importInvalid"));
    }
  }

  const byName = useMemo(
    () => new Map(tables.map((tb) => [tb.name.trim().toLowerCase(), tb])),
    [tables],
  );
  const importSummary = useMemo(() => {
    if (!imported) return null;
    const names = new Set(imported.tables.map((it) => it.name.trim().toLowerCase()));
    const missing = imported.tables.filter((it) => !byName.has(it.name.trim().toLowerCase())).map((it) => it.name);
    return {
      tables: imported.tables.length,
      matched: imported.tables.length - missing.length,
      missing,
      others: placedIds.filter(
        (id) => !names.has((byId.get(id)?.name ?? created[id]?.name ?? "").trim().toLowerCase()),
      ).length,
      elements: imported.elements.length,
      size: `${imported.width} × ${imported.height}`,
      sizeDiffers: imported.width !== W || imported.height !== H,
    };
  }, [imported, byName, placedIds, byId, created, W, H]);

  async function applyImport(o: ImportOptions) {
    if (!imported) return;
    setImporting(true);
    try {
      // Missing tables must exist before the draft can place them: create
      // them now (off the map), the layout itself still waits for "Salva".
      const ids = new Map<string, string>();
      const seen = new Set<string>();
      let created = 0;
      for (const it of imported.tables) {
        const key = it.name.trim().toLowerCase();
        if (seen.has(key)) continue; // first occurrence wins
        seen.add(key);
        const existing = byName.get(key);
        if (existing) ids.set(key, existing.id);
        else if (o.createMissing) {
          const seats = it.seats ?? estimateSeats(it.geom.shape, it.geom.w, it.geom.h);
          ids.set(key, await createTable(it.name.trim(), seats, []));
          created++;
        }
      }
      if (created > 0) await onChanged();

      const width = o.fitSheet ? clampSize(imported.width) : W;
      const height = o.fitSheet ? clampSize(imported.height) : H;
      apply((d) => {
        const next: TablesDraft = { ...d.tables };
        if (o.removeOthers) for (const id of Object.keys(next)) next[id] = null;
        for (const it of imported.tables) {
          const id = ids.get(it.name.trim().toLowerCase());
          if (id) next[id] = clampToMap(it.geom, width, height);
        }
        return {
          tables: next,
          created: d.created,
          elements: o.replaceScenery ? imported.elements : [...d.elements, ...imported.elements],
          width,
          height,
        };
      });
      setImported(null);
      setSelection([]);
      setElSel([]);
      toast.success(t("floorMapEditor.imported"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setImporting(false);
    }
  }

  function exportTables() {
    return placedIds.map((id) => ({
      name: nameOf(id),
      capacity: byId.get(id)?.capacity ?? created[id].capacity,
      geom: draft[id]!,
    }));
  }
  const fileBase = map.name.trim().replace(/[^\w-]+/g, "_") || "mappa";

  function exportSvg() {
    const svg = mapToSvg({ name: map.name, width: W, height: H }, elements, exportTables());
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${fileBase}.svg`);
  }

  async function exportPng() {
    try {
      const svg = mapToSvg({ name: map.name, width: W, height: H }, elements, exportTables());
      downloadBlob(await svgToPng(svg, W, H, 2), `${fileBase}.png`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    }
  }

  // ---------------------------------------------------------------------------
  // Save / leave
  // ---------------------------------------------------------------------------

  async function save() {
    const ids = new Set([...Object.keys(saved.tables), ...Object.keys(draft)]);
    const changes = Array.from(ids)
      .filter((id) => !created[id] && !same(saved.tables[id] ?? null, draft[id] ?? null))
      .map((id) => ({ id, geom: draft[id] ?? null }));
    const drawn = Object.entries(created)
      .filter(([key]) => draft[key])
      .map(([key, c]) => ({ key, ...c, name: c.name.trim(), geom: draft[key]! }));
    const sceneryChanged = !same(saved.elements, elements);
    const sizeChanged = saved.width !== W || saved.height !== H;
    if (changes.length === 0 && drawn.length === 0 && !sceneryChanged && !sizeChanged) return;
    // a clash would only fail inside the save: point at the table instead
    const clash = drawn.find((c) => !nameFree(c.name, c.key));
    if (clash) {
      setLayer("tables");
      setSelection([clash.key]);
      toast.error(t("floorMapEditor.nameTaken", { name: clash.name }));
      return;
    }
    setSaving(true);
    try {
      const newIds = await saveFloorMapLayout(
        map.id,
        changes,
        sceneryChanged ? elements : undefined,
        sizeChanged ? { width: W, height: H } : undefined,
        drawn,
      );
      const clean = remapDoc(
        {
          tables: Object.fromEntries(Object.entries(draft).filter(([, g]) => g !== null)),
          created,
          elements,
          width: W,
          height: H,
        },
        newIds,
      );
      // the history keeps working with the real ids
      setPast((p) => p.map((d) => remapDoc(d, newIds)));
      setFuture((f) => f.map((d) => remapDoc(d, newIds)));
      setSelection((sel) => sel.map((id) => newIds[id] ?? id));
      docRef.current = clean;
      setSaved(clean);
      setDoc(clean);
      toast.success(t("floorMapEditor.saved"));
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function leave(e: React.MouseEvent) {
    if (!dirty) return;
    e.preventDefault();
    if (!window.confirm(t("floorMapEditor.unsavedConfirm"))) return;
    setSaved(doc); // disarm the beforeunload guard for this navigation
    router.push("/settings/floor-maps");
  }

  const run = (action: () => Promise<void>, success: string) =>
    runAction(setBusy, action, success, onChanged, t("common.somethingWrong"));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const px = scale > 0 ? 1 / scale : 1; // one screen pixel in map units
  const singleGeom = single ? draft[single]! : null;
  const repeatPlan = planRepeat();
  const singleDrawn = single ? created[single] : undefined;
  // a drawn table shown through the same row as a saved one
  const singleTable: TableWithTags | null = single
    ? (byId.get(single) ??
      (singleDrawn
        ? {
            id: single,
            name: singleDrawn.name,
            capacity: singleDrawn.capacity,
            table_tags: tags.filter((tag) => singleDrawn.tagIds.includes(tag.id)),
          } as TableWithTags
        : null))
    : null;
  const onTables = layer === "tables";

  const toolButton = (
    labelKey: TranslationKey,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
    pressed?: boolean,
  ) => (
    <Button
      variant={pressed ? "default" : "ghost"}
      size="icon"
      className="h-10 w-10"
      title={t(labelKey)}
      aria-label={t(labelKey)}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
  const divider = <span className="mx-1 h-6 w-px bg-border" />;

  type ToolDef = [Tool, React.ComponentType<{ className?: string }>, TranslationKey];
  const TABLE_TOOLS: ToolDef[] = [
    ["select", MousePointer2, "floorMapEditor.toolSelect"],
    ["tableRect", RectangleHorizontal, "floorMapEditor.toolTableRect"],
    ["tableCircle", Circle, "floorMapEditor.toolTableCircle"],
  ];
  const TOOLS: ToolDef[] = [
    ["select", MousePointer2, "floorMapEditor.toolSelect"],
    ["line", Slash, "floorMapEditor.toolLine"],
    ["wall", Spline, "floorMapEditor.toolWall"],
    ["freehand", Pencil, "floorMapEditor.toolFreehand"],
    ["rect", Square, "floorMapEditor.toolRect"],
    ["circle", Circle, "floorMapEditor.toolCircle"],
    ["arrow", ArrowUpRight, "floorMapEditor.toolArrow"],
    ["text", Type, "floorMapEditor.toolText"],
  ];
  const TOOL_HELP: Partial<Record<Tool, TranslationKey>> = {
    tableRect: "floorMapEditor.tableToolHelp",
    tableCircle: "floorMapEditor.tableToolHelp",
    line: "floorMapEditor.lineHelp",
    freehand: "floorMapEditor.freehandHelp",
    text: "floorMapEditor.textHelp",
  };
  // Tools with a visible name: the table ones always (they are how tables
  // are added), the drawing ones where the toolbar has room.
  const toolButtons = (defs: ToolDef[], labelled: "always" | "wide") =>
    defs.map(([tl, Icon, key]) => (
      <Button
        key={tl}
        variant={tool === tl ? "default" : "ghost"}
        className={cn("h-10 gap-1.5", tl === "select" ? "w-10 px-0" : labelled === "always" ? "px-3" : "w-10 px-0 xl:w-auto xl:px-3")}
        title={t(key)}
        aria-label={t(key)}
        aria-pressed={tool === tl}
        onClick={() => {
          setWall([]);
          setTool(tl);
          if (tl !== "select") {
            setSelection([]);
            setElSel([]);
          }
        }}
      >
        <Icon className="h-4 w-4" />
        {tl !== "select" && (
          <span className={cn(labelled === "wide" && "hidden xl:inline")}>{t(key)}</span>
        )}
      </Button>
    ));

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-4 lg:p-6">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-10 px-2">
          <Link href="/settings/floor-maps" onClick={leave}>
            <ArrowLeft className="h-4 w-4" /> {t("floorMapEditor.back")}
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{t("floorMapEditor.title", { name: map.name })}</h1>
        <div
          role="group"
          aria-label={t("floorMapEditor.layer")}
          className="flex h-10 items-center rounded-lg border p-1"
        >
          {(
            [
              ["tables", "floorMapEditor.layerTables"],
              ["scenery", "floorMapEditor.layerScenery"],
            ] as const
          ).map(([l, key]) => (
            <button
              key={l}
              type="button"
              aria-pressed={layer === l}
              onClick={() => switchLayer(l)}
              className={cn(
                "flex h-full items-center rounded-md px-3 text-sm",
                layer === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* always laid out: appearing mid-drag, it wrapped the title bar
              on narrow screens and slid the canvas under the pointer */}
          <span className={cn("text-sm text-amber-700", !dirty && "invisible")} aria-hidden={!dirty}>
            {t("floorMapEditor.unsaved")}
          </span>
          <Button className="h-10 px-5" onClick={() => void save()} disabled={saving || !dirty}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-muted/30 p-1">
        {toolButton("floorMapEditor.undo", <Undo2 className="h-4 w-4" />, undo, past.length === 0)}
        {toolButton("floorMapEditor.redo", <Redo2 className="h-4 w-4" />, redo, future.length === 0)}
        {divider}
        {toolButton("floorMapEditor.snap", <Grid3x3 className="h-4 w-4" />, () => setSnap((s) => !s), false, snap)}
        {divider}
        {onTables ? (
          <>
            {toolButtons(TABLE_TOOLS, "always")}
            {divider}
            {toolButton("floorMapEditor.rotateLeft", <RotateCcw className="h-4 w-4" />, () => updateSelected((g) => rotateBy(g, -90)), selected.length === 0)}
            {toolButton("floorMapEditor.rotateRight", <RotateCw className="h-4 w-4" />, () => updateSelected((g) => rotateBy(g, 90)), selected.length === 0)}
            {divider}
            {(
              [
                ["left", AlignStartVertical, "floorMapEditor.alignLeft"],
                ["hcenter", AlignCenterVertical, "floorMapEditor.alignHCenter"],
                ["right", AlignEndVertical, "floorMapEditor.alignRight"],
                ["top", AlignStartHorizontal, "floorMapEditor.alignTop"],
                ["vmiddle", AlignCenterHorizontal, "floorMapEditor.alignVMiddle"],
                ["bottom", AlignEndHorizontal, "floorMapEditor.alignBottom"],
              ] as const
            ).map(([mode, Icon, key]) => (
              <span key={mode}>
                {toolButton(key, <Icon className="h-4 w-4" />, () => align(mode), selected.length < 2)}
              </span>
            ))}
            {toolButton("floorMapEditor.distributeH", <AlignHorizontalDistributeCenter className="h-4 w-4" />, () => align("hdistribute"), selected.length < 3)}
            {toolButton("floorMapEditor.distributeV", <AlignVerticalDistributeCenter className="h-4 w-4" />, () => align("vdistribute"), selected.length < 3)}
          </>
        ) : (
          toolButtons(TOOLS, "wide")
        )}
        {divider}
        <label
          title={t("floorMapEditor.importSvg")}
          aria-label={t("floorMapEditor.importSvg")}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md hover:bg-accent"
        >
          <FileUp className="h-4 w-4" />
          <input
            type="file"
            accept=".svg,image/svg+xml"
            className="sr-only"
            onChange={(e) => {
              void pickSvg(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {toolButton("floorMapEditor.exportSvg", <FileDown className="h-4 w-4" />, exportSvg)}
        {toolButton("floorMapEditor.exportPng", <ImageDown className="h-4 w-4" />, () => void exportPng())}
        <div className="ml-auto flex gap-1">
          {toolButton("floorMap.zoomOut", <Minus className="h-4 w-4" />, () => setStep((s) => Math.max(0, s - 1)), step === 0)}
          {toolButton("floorMap.zoomFit", <Maximize className="h-4 w-4" />, () => setStep(0), step === 0)}
          {toolButton("floorMap.zoomIn", <Plus className="h-4 w-4" />, () => setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1)), step === ZOOM_STEPS.length - 1)}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Canvas */}
        <div ref={boxRef} className="min-h-[360px] flex-1 overflow-auto rounded-xl border bg-card">
          {fit > 0 && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width={W * scale}
              height={H * scale}
              className={cn(
                "mx-auto block touch-none select-none",
                tool !== "select" && "cursor-crosshair",
              )}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => tool === "wall" && finishWall()}
            >
              <defs>
                <pattern id="editor-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <circle cx={0} cy={0} r={0.9} opacity={0.45} className="fill-muted-foreground" />
                </pattern>
              </defs>
              {/* sheet: marquee selection, or drawing with a scenery tool */}
              <rect width={W} height={H} className="fill-background" onPointerDown={onSheetDown} />
              {photo && (
                <image
                  href={photo.url}
                  width={W}
                  height={H}
                  preserveAspectRatio="xMidYMid meet"
                  opacity={photoOpacity}
                  className="pointer-events-none"
                />
              )}
              {snap && (
                <rect width={W} height={H} fill="url(#editor-grid)" className="pointer-events-none" />
              )}

              <g className={cn(onTables && "opacity-70")}>
                {elements.map((el, i) => (
                  <EditorElement
                    key={i}
                    el={el}
                    px={px}
                    interactive={!onTables && tool === "select"}
                    onPointerDown={(e) => startElementMove(e, i)}
                  />
                ))}
              </g>

              {placedIds.map((id) => (
                <EditorTable
                  key={id}
                  geom={draft[id]!}
                  name={nameOf(id)}
                  selected={onTables && selected.includes(id)}
                  locked={!onTables}
                  passive={tool !== "select"}
                  onPointerDown={(e) => startMove(e, id)}
                />
              ))}

              {repeatPlan?.items.map((it, i) => (
                <GhostTable key={i} name={it.name} geom={it.geom} px={px} />
              ))}

              {/* outlines of a multiple selection */}
              {onTables &&
                selected.length > 1 &&
                selected.map((id) => {
                  const b = bounds(draft[id]!);
                  return (
                    <rect
                      key={id}
                      x={b.x1 - 3 * px}
                      y={b.y1 - 3 * px}
                      width={b.x2 - b.x1 + 6 * px}
                      height={b.y2 - b.y1 + 6 * px}
                      strokeWidth={1.5 * px}
                      strokeDasharray={`${4 * px} ${3 * px}`}
                      className="pointer-events-none fill-none stroke-blue-600"
                    />
                  );
                })}
              {!onTables &&
                selectedEls.length > 1 &&
                selectedEls.map((i) => {
                  const b = elementBounds(elements[i]);
                  return (
                    <rect
                      key={i}
                      x={b.x - 3 * px}
                      y={b.y - 3 * px}
                      width={b.w + 6 * px}
                      height={b.h + 6 * px}
                      strokeWidth={1.5 * px}
                      strokeDasharray={`${4 * px} ${3 * px}`}
                      className="pointer-events-none fill-none stroke-blue-600"
                    />
                  );
                })}

              {/* handles on a single selection */}
              {onTables && singleGeom && single && (
                <SelectionHandles
                  box={singleGeom}
                  rotation={singleGeom.rotation}
                  px={px}
                  onResize={(e, handle) => {
                    capture(e);
                    setGesture({ kind: "resize", id: single, handle, start: doc });
                  }}
                  onRotate={(e) => {
                    capture(e);
                    setGesture({ kind: "rotate", id: single, start: doc });
                  }}
                />
              )}
              {!onTables && singleEl !== null && (
                <SelectionHandles
                  box={elementBounds(elements[singleEl])}
                  px={px}
                  onResize={(e, handle) => {
                    capture(e);
                    setGesture({
                      kind: "elresize",
                      idx: singleEl,
                      handle,
                      box: elementBounds(elements[singleEl]),
                      start: doc,
                    });
                  }}
                />
              )}

              {/* drawing previews */}
              {wall.length > 0 && (
                <path
                  d={polylinePath(hover ? [...wall, hover] : wall)}
                  strokeWidth={1.5}
                  strokeDasharray={`${4 * px} ${3 * px}`}
                  className="pointer-events-none fill-none stroke-blue-600"
                />
              )}
              {gesture?.kind === "freehand" && (
                <path
                  d={polylinePath(gesture.pts)}
                  strokeWidth={1.5}
                  className="pointer-events-none fill-none stroke-blue-600"
                />
              )}
              {gesture?.kind === "draw" &&
                (gesture.tool === "rect" || gesture.tool === "tableRect" ? (
                  <rect
                    x={Math.min(gesture.x0, gesture.x1)}
                    y={Math.min(gesture.y0, gesture.y1)}
                    width={Math.abs(gesture.x1 - gesture.x0)}
                    height={Math.abs(gesture.y1 - gesture.y0)}
                    strokeWidth={1.5}
                    className="pointer-events-none fill-none stroke-blue-600"
                  />
                ) : gesture.tool === "circle" || gesture.tool === "tableCircle" ? (
                  <circle
                    cx={gesture.x0}
                    cy={gesture.y0}
                    r={Math.hypot(gesture.x1 - gesture.x0, gesture.y1 - gesture.y0)}
                    strokeWidth={1.5}
                    className="pointer-events-none fill-none stroke-blue-600"
                  />
                ) : (
                  <path
                    d={
                      gesture.tool === "line"
                        ? polylinePath([[gesture.x0, gesture.y0], [gesture.x1, gesture.y1]])
                        : arrowPath(gesture.x0, gesture.y0, gesture.x1, gesture.y1)
                    }
                    strokeWidth={gesture.tool === "line" ? 1.5 : 3}
                    className="pointer-events-none fill-none stroke-blue-600"
                  />
                ))}

              {gesture?.kind === "marquee" && (
                <rect
                  x={Math.min(gesture.x0, gesture.x1)}
                  y={Math.min(gesture.y0, gesture.y1)}
                  width={Math.abs(gesture.x1 - gesture.x0)}
                  height={Math.abs(gesture.y1 - gesture.y0)}
                  strokeWidth={px}
                  className="pointer-events-none fill-blue-500/10 stroke-blue-600"
                />
              )}
            </svg>
          )}
        </div>

        {/* Side panel */}
        {/* fixed height when stacked: a panel that grew/shrank with the selection
            would resize the canvas mid-gesture */}
        <aside className="flex h-64 w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border p-4 lg:h-auto lg:max-h-full lg:w-80">
          {onTables ? (
            renderTablesPanel()
          ) : tool === "wall" ? (
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <h2 className="font-semibold text-foreground">{t("floorMapEditor.toolWall")}</h2>
              <p>{t("floorMapEditor.wallHelp")}</p>
              <Button className="h-10" disabled={wall.length < 2} onClick={finishWall}>
                {t("floorMapEditor.wallFinish")}
              </Button>
            </div>
          ) : tool !== "select" ? (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <h2 className="font-semibold text-foreground">
                {t(TOOLS.find(([tl]) => tl === tool)![2])}
              </h2>
              <p>{t(TOOL_HELP[tool] ?? "floorMapEditor.dragHelp")}</p>
            </div>
          ) : singleEl !== null ? (
            <ElementPanel
              key={singleEl}
              el={elements[singleEl]}
              onChange={(el) => applyElements((els) => els.map((x, i) => (i === singleEl ? el : x)))}
              onDuplicate={() => duplicateElements([singleEl])}
              onDelete={() => deleteElements([singleEl])}
            />
          ) : selectedEls.length > 1 ? (
            <>
              <h2 className="font-semibold">
                {t("floorMapEditor.multiElements", { count: selectedEls.length })}
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" className="h-10 flex-1" onClick={() => duplicateElements(selectedEls)}>
                  {t("floorMapEditor.duplicate")}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 flex-1 text-destructive hover:text-destructive"
                  onClick={() => deleteElements(selectedEls)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <h2 className="font-semibold text-foreground">{t("floorMapEditor.howTo")}</h2>
              <ul className="list-disc space-y-1 pl-4">
                <li>{t("floorMapEditor.helpScenery")}</li>
                <li>{t("floorMapEditor.helpSceneryTools")}</li>
                <li>{t("floorMapEditor.helpSelect")}</li>
                <li>{t("floorMapEditor.helpKeys")}</li>
              </ul>
            </div>
          )}
          <TracePanel
            photo={photo}
            opacity={photoOpacity}
            onPhoto={setPhoto}
            onOpacity={setPhotoOpacity}
            onFitSheet={fitSheetToPhoto}
          />
        </aside>
      </div>
      <ImportDialog
        key={imported ? "open" : "closed"}
        open={!!imported}
        summary={importSummary}
        busy={importing}
        onCancel={() => setImported(null)}
        onConfirm={(o) => void applyImport(o)}
      />
    </div>
  );

  function renderRepeat() {
    return repeatOpen && repeatPlan ? (
      <RepeatPanel
        settings={repeat}
        fits={repeatPlan.fits}
        tablesToAdd={repeatPlan.items.length}
        onChange={(patch) => setRepeat((r) => ({ ...r, ...patch }))}
        onApply={applyRepeat}
        onClose={() => setRepeatOpen(false)}
      />
    ) : (
      <Button variant="outline" className="h-10" onClick={() => setRepeatOpen(true)}>
        <Copy className="mr-2 h-4 w-4" /> {t("floorMapEditor.repeatOpen")}
      </Button>
    );
  }

  // The tables layer's side panel. A render function, not a component: an
  // inner component would remount on every render and drop input focus.
  function renderTablesPanel() {
    return (
      <>
        {isTableTool(tool) ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <h2 className="font-semibold text-foreground">
              {t(TABLE_TOOLS.find(([tl]) => tl === tool)![2])}
            </h2>
            <p>{t("floorMapEditor.tableToolHelp")}</p>
          </div>
        ) : singleGeom && singleTable ? (
          <>
            <h2 className="font-semibold">{t("floorMapsMgr.selectedTable", { name: singleTable.name })}</h2>
            {renderRepeat()}
            <GeometryFields
              geom={singleGeom}
              onChange={(g) =>
                applyTables((d) => ({ ...d, [single!]: clampToMap(g, W, H) }))
              }
            />
            {singleGeom.shape !== "path" ? (
              <div className="flex h-10 items-center rounded-lg border p-1" role="group" aria-label={t("floorMapsMgr.shape")}>
                {(
                  [
                    ["rect", RectangleHorizontal, "floorMapsMgr.shapeRect"],
                    ["circle", Circle, "floorMapsMgr.shapeCircle"],
                  ] as const
                ).map(([shape, Icon, key]) => (
                  <button
                    key={shape}
                    type="button"
                    aria-pressed={singleGeom.shape === shape}
                    onClick={() => updateSelected((g) => toShape(g, shape))}
                    className={cn(
                      "flex h-full flex-1 items-center justify-center gap-1.5 rounded-md text-sm",
                      singleGeom.shape === shape
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="h-4 w-4" /> {t(key)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("floorMapEditor.freeShape")}</p>
            )}
            <Button
              variant="outline"
              className="h-10"
              onClick={() => {
                updateSelected(() => null);
                setSelection([]);
              }}
            >
              {singleDrawn ? (
                <>
                  <Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}
                </>
              ) : (
                <>
                  <MapPinOff className="mr-2 h-4 w-4" /> {t("floorMapsMgr.removeFromMap")}
                </>
              )}
            </Button>
            <div className="flex flex-col gap-1 border-t pt-3">
              <h3 className="text-sm font-medium">{t("floorMapEditor.details")}</h3>
              <p className="text-xs text-muted-foreground">
                {t(singleDrawn ? "floorMapEditor.drawnHelp" : "floorMapEditor.detailsHelp")}
              </p>
              <TableRow
                key={`${singleTable.id}-${rowKey}`}
                table={singleTable}
                tags={tags}
                busy={busy}
                onSave={async (fields) => {
                  if (singleDrawn) updateDrawn(singleTable.id, fields);
                  else
                    await run(
                      () => updateTable(singleTable.id, fields),
                      t("tablesMgr.tableUpdated", { name: singleTable.name }),
                    );
                }}
                onToggleTag={(tagId) => {
                  const cur = singleTable.table_tags.map((g) => g.id);
                  const next = cur.includes(tagId) ? cur.filter((x) => x !== tagId) : [...cur, tagId];
                  if (singleDrawn) updateDrawn(singleTable.id, { tagIds: next });
                  else
                    void run(
                      () => setTableTags(singleTable.id, next),
                      t("tablesMgr.tagsUpdated", { name: singleTable.name }),
                    );
                }}
              />
            </div>
          </>
        ) : selected.length > 1 ? (
          <>
            <h2 className="font-semibold">{t("floorMapEditor.multiSelected", { count: selected.length })}</h2>
            <p className="text-sm text-muted-foreground">{t("floorMapEditor.multiHelp")}</p>
            {renderRepeat()}
            <Button
              variant="outline"
              className="h-10"
              onClick={() => {
                updateSelected(() => null);
                setSelection([]);
              }}
            >
              <MapPinOff className="mr-2 h-4 w-4" /> {t("floorMapsMgr.removeFromMap")}
            </Button>
            <div className="flex flex-col gap-2 border-t pt-3">
              <h3 className="text-sm font-medium">{t("floorMapEditor.details")}</h3>
              <p className="text-xs text-muted-foreground">{t("floorMapEditor.bulkHelp")}</p>
              <BulkDetails
                key={selectionKey}
                count={selected.length}
                capacities={selected.map((id) => byId.get(id)?.capacity ?? created[id]?.capacity ?? 0)}
                tags={tags}
                tagCounts={
                  new Map(tags.map((tag) => [tag.id, selected.filter((id) => hasTag(id, tag.id)).length]))
                }
                busy={busy}
                onCapacity={setSelectedCapacity}
                onTag={setSelectedTag}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <h2 className="font-semibold text-foreground">{t("floorMapEditor.howTo")}</h2>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t("floorMapEditor.helpAddTable")}</li>
              <li>{t("floorMapEditor.helpMove")}</li>
              <li>{t("floorMapEditor.helpResize")}</li>
              <li>{t("floorMapEditor.helpSelect")}</li>
              <li>{t("floorMapEditor.helpKeys")}</li>
              <li>{t("floorMapEditor.helpAlt")}</li>
            </ul>
          </div>
        )}

        {toPlace.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <h3 className="text-sm font-medium">{t("floorMapEditor.toPlace")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {toPlace.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => place(tb.id)}
                  className="flex h-9 items-center gap-1 rounded-full border border-dashed px-3 text-sm hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="font-semibold">{tb.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }
}
