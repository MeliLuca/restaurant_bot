"use client";

// Visual layout editor for one floor map (Settings → Mappe sala → Modifica
// disposizione). Everything happens on a local draft — drag to move, handles
// to resize, the knob above a table to rotate — and "Salva" writes the whole
// layout in one transaction, so tablets in service never see half a change.
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
  Circle,
  Grid3x3,
  MapPinOff,
  Maximize,
  Minus,
  Plus,
  Redo2,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
} from "lucide-react";
import {
  Scenery,
  useKeepCenterOnZoom,
} from "@/components/floor-plan/floor-map-view";
import { TableRow, runAction } from "@/components/settings/tables-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FloorMap, TableTag } from "@/lib/database.types";
import {
  ROTATE_SNAP_DEG,
  alignGeoms,
  bounds,
  clampToMap,
  dragGeom,
  labelFontSize,
  moveGeom,
  normDeg,
  resizeGeom,
  rotateBy,
  rotateToward,
  toShape,
  type AlignMode,
  type Geom,
  type Handle,
} from "@/lib/floor/geometry";
import {
  compareTableNames,
  defaultPlacement,
  geomOf,
  saveFloorMapLayout,
} from "@/lib/floor/maps";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import {
  setTableTags,
  updateTable,
  type TableWithTags,
} from "@/lib/settings-api";
import { cn } from "@/lib/utils";

/** id → geometry on this map; null = taken off the map in this draft */
type Draft = Record<string, Geom | null>;

const GRID = 10;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const HISTORY_LIMIT = 100;
const HANDLE_PX = 8;
const ROTATE_KNOB_PX = 26;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Gesture =
  | { kind: "move"; ids: string[]; anchor: string; x0: number; y0: number; start: Draft }
  | { kind: "resize"; id: string; handle: Handle; start: Draft }
  | { kind: "rotate"; id: string; start: Draft }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: string[] };

interface FloorMapEditorProps {
  map: FloorMap;
  tables: TableWithTags[];
  tags: TableTag[];
  /** Refetch tables (names/seats/tags changed, or after a save) */
  onChanged: () => Promise<void>;
}

function initialDraft(map: FloorMap, tables: TableWithTags[]): Draft {
  const d: Draft = {};
  for (const tb of tables) if (tb.map_id === map.id) d[tb.id] = geomOf(tb);
  return d;
}

export function FloorMapEditor({ map, tables, tags, onChanged }: FloorMapEditorProps) {
  const t = useT();
  const router = useRouter();
  const [saved, setSaved] = useState<Draft>(() => initialDraft(map, tables));
  const [draft, setDraft] = useState<Draft>(saved);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [snap, setSnap] = useState(true);
  const [step, setStep] = useState(0);
  const [fit, setFit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const byId = useMemo(() => new Map(tables.map((tb) => [tb.id, tb])), [tables]);
  const placedIds = Object.keys(draft)
    .filter((id) => draft[id] && byId.has(id))
    .sort((a, b) => compareTableNames(byId.get(a)!.name, byId.get(b)!.name));
  // Off-map tables, plus the ones this draft took off: ready to (re)place.
  const toPlace = tables.filter(
    (tb) =>
      !draft[tb.id] &&
      (draft[tb.id] === null || tb.map_id === null || tb.map_id === map.id),
  );
  const grid = snap ? GRID : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const scale = fit * ZOOM_STEPS[step];
  const selected = selection.filter((id) => draft[id]);
  useKeepCenterOnZoom(boxRef, scale);
  const single = selected.length === 1 ? selected[0] : null;

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  // History lives beside the draft; a ref gives callbacks the live draft
  // without side effects inside state updaters (dev mode runs those twice).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commit = useCallback((before: Draft, after: Draft) => {
    draftRef.current = after;
    setDraft(after);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), before]);
    setFuture([]);
  }, []);

  const apply = useCallback(
    (fn: (d: Draft) => Draft) => commit(draftRef.current, fn(draftRef.current)),
    [commit],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const cur = draftRef.current;
    setFuture((f) => [cur, ...f]);
    draftRef.current = past[past.length - 1];
    setDraft(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }, [past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const cur = draftRef.current;
    setPast((p) => [...p, cur]);
    draftRef.current = future[0];
    setDraft(future[0]);
    setFuture(future.slice(1));
  }, [future]);

  /** Apply fn to every selected table's geometry (one history step). */
  const updateSelected = useCallback(
    (fn: (g: Geom, id: string) => Geom | null) =>
      apply((d) => {
        const next = { ...d };
        for (const id of selection) {
          const g = d[id];
          if (g) next[id] = fn(g, id);
        }
        return next;
      }),
    [apply, selection],
  );

  const nudge = useCallback(
    (dx: number, dy: number) =>
      updateSelected((g) => clampToMap(moveGeom(g, dx, dy), map.width, map.height)),
    [updateSelected, map.width, map.height],
  );

  function align(mode: AlignMode) {
    apply((d) => {
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
    apply((d) => {
      const others = Object.values(d).filter((g): g is Geom => !!g);
      // a table taken off in this draft comes back where it was
      const prev = saved[id] ?? (tb.map_id === map.id ? geomOf(tb) : null);
      const g =
        prev ??
        (defaultPlacement(map, others, tb.shape === "circle" ? "circle" : "rect") as Geom);
      return { ...d, [id]: g };
    });
    setSelection([id]);
  }

  // ---------------------------------------------------------------------------
  // Fit + keyboard + unload guard
  // ---------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () =>
      setFit(0.98 * Math.min(el.clientWidth / map.width, el.clientHeight / map.height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map.width, map.height]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(placedIds);
      } else if (e.key === "Escape") {
        setSelection([]);
      } else if (selection.length > 0) {
        const stepPx = e.shiftKey ? GRID * 5 : snap ? GRID : 1;
        const moves: Record<string, [number, number]> = {
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
          updateSelected(() => null);
          setSelection([]);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, nudge, updateSelected, selection, placedIds, snap]);

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

  function toMap(e: React.PointerEvent): [number, number] {
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
    setGesture({ kind: "move", ids, anchor: id, x0, y0, start: draft });
  }

  function onPointerMove(e: React.PointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const [px, py] = toMap(e);
    const free = e.altKey; // Alt: no snapping for this gesture
    if (gesture.kind === "move") {
      const a = gesture.start[gesture.anchor]!;
      // snap the grabbed table, move the rest by the same amount
      const moved = dragGeom(a, px - gesture.x0, py - gesture.y0, free ? null : grid);
      const dx = moved.x - a.x;
      const dy = moved.y - a.y;
      const next = { ...gesture.start };
      for (const id of gesture.ids) {
        const g = gesture.start[id];
        if (g) next[id] = moveGeom(g, dx, dy);
      }
      setDraft(next);
    } else if (gesture.kind === "resize") {
      const g = gesture.start[gesture.id]!;
      setDraft({
        ...gesture.start,
        [gesture.id]: resizeGeom(g, gesture.handle, px, py, free ? null : grid),
      });
    } else if (gesture.kind === "rotate") {
      const g = gesture.start[gesture.id]!;
      setDraft({
        ...gesture.start,
        [gesture.id]: rotateToward(g, px, py, free ? null : ROTATE_SNAP_DEG),
      });
    } else {
      setGesture({ ...gesture, x1: px, y1: py });
    }
  }

  function onPointerUp() {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "marquee") {
      const x1 = Math.min(gesture.x0, gesture.x1);
      const x2 = Math.max(gesture.x0, gesture.x1);
      const y1 = Math.min(gesture.y0, gesture.y1);
      const y2 = Math.max(gesture.y0, gesture.y1);
      const hit =
        x2 - x1 < 3 && y2 - y1 < 3
          ? []
          : placedIds.filter((id) => {
              const b = bounds(draft[id]!);
              return b.x2 >= x1 && b.x1 <= x2 && b.y2 >= y1 && b.y1 <= y2;
            });
      setSelection(Array.from(new Set([...gesture.additive, ...hit])));
    } else {
      // keep everything on the sheet, then record one undo step
      const next = { ...draft };
      const ids = gesture.kind === "move" ? gesture.ids : [gesture.id];
      for (const id of ids) {
        const g = next[id];
        if (g) next[id] = clampToMap(g, map.width, map.height);
      }
      commit(gesture.start, next);
    }
    setGesture(null);
  }

  // ---------------------------------------------------------------------------
  // Save / leave
  // ---------------------------------------------------------------------------

  async function save() {
    const ids = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    const changes = Array.from(ids)
      .filter((id) => JSON.stringify(saved[id] ?? null) !== JSON.stringify(draft[id] ?? null))
      .map((id) => ({ id, geom: draft[id] ?? null }));
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await saveFloorMapLayout(map.id, changes);
      const clean = Object.fromEntries(
        Object.entries(draft).filter(([, g]) => g !== null),
      );
      setSaved(clean);
      setDraft(clean);
      toast.success(t("floorMapEditor.saved", { count: changes.length }));
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
    setSaved(draft); // disarm the beforeunload guard for this navigation
    router.push("/settings/floor-maps");
  }

  const run = (action: () => Promise<void>, success: string) =>
    runAction(setBusy, action, success, onChanged, t("common.somethingWrong"));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const px = scale > 0 ? 1 / scale : 1; // one screen pixel in map units
  const singleGeom = single ? draft[single]! : null;
  const singleTable = single ? byId.get(single)! : null;

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

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-4 lg:p-6">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-10 px-2">
          <Link href="/settings/floor-maps" onClick={leave}>
            <ArrowLeft className="h-4 w-4" /> {t("floorMapEditor.back")}
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">
          {t("floorMapEditor.title", { name: map.name })}
        </h1>
        <div className="ml-auto flex items-center gap-3">
          {dirty && (
            <span className="text-sm text-amber-700">{t("floorMapEditor.unsaved")}</span>
          )}
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
        <span className="mx-1 h-6 w-px bg-border" />
        {toolButton(
          "floorMapEditor.snap",
          <Grid3x3 className="h-4 w-4" />,
          () => setSnap((s) => !s),
          false,
          snap,
        )}
        <span className="mx-1 h-6 w-px bg-border" />
        {toolButton("floorMapEditor.rotateLeft", <RotateCcw className="h-4 w-4" />, () => updateSelected((g) => rotateBy(g, -90)), selected.length === 0)}
        {toolButton("floorMapEditor.rotateRight", <RotateCw className="h-4 w-4" />, () => updateSelected((g) => rotateBy(g, 90)), selected.length === 0)}
        <span className="mx-1 h-6 w-px bg-border" />
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
        <div className="ml-auto flex gap-1">
          {toolButton("floorMap.zoomOut", <Minus className="h-4 w-4" />, () => setStep((s) => Math.max(0, s - 1)), step === 0)}
          {toolButton("floorMap.zoomFit", <Maximize className="h-4 w-4" />, () => setStep(0), step === 0)}
          {toolButton("floorMap.zoomIn", <Plus className="h-4 w-4" />, () => setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1)), step === ZOOM_STEPS.length - 1)}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Canvas */}
        <div
          ref={boxRef}
          className="min-h-[360px] flex-1 overflow-auto rounded-xl border bg-card"
        >
          {fit > 0 && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${map.width} ${map.height}`}
              width={map.width * scale}
              height={map.height * scale}
              className="mx-auto block touch-none select-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <defs>
                <pattern id="editor-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <circle cx={0} cy={0} r={0.9} opacity={0.45} className="fill-muted-foreground" />
                </pattern>
              </defs>
              {/* sheet: background clicks start a marquee selection */}
              <rect
                width={map.width}
                height={map.height}
                className="fill-background"
                onPointerDown={(e) => {
                  capture(e);
                  const [x, y] = toMap(e);
                  const additive = e.shiftKey ? selection : [];
                  if (!e.shiftKey) setSelection([]);
                  setGesture({ kind: "marquee", x0: x, y0: y, x1: x, y1: y, additive });
                }}
              />
              {snap && (
                <rect
                  width={map.width}
                  height={map.height}
                  fill="url(#editor-grid)"
                  className="pointer-events-none"
                />
              )}
              <g className="pointer-events-none opacity-70">
                {map.elements.map((el, i) => (
                  <Scenery key={i} el={el} />
                ))}
              </g>

              {placedIds.map((id) => (
                <EditorTable
                  key={id}
                  name={byId.get(id)!.name}
                  geom={draft[id]!}
                  selected={selected.includes(id)}
                  onPointerDown={(e) => startMove(e, id)}
                />
              ))}

              {/* bounds of every selected table */}
              {selected.length > 1 &&
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

              {/* handles on a single selection */}
              {singleGeom && single && (
                <SelectionHandles
                  geom={singleGeom}
                  px={px}
                  onResize={(e, handle) => {
                    capture(e);
                    setGesture({ kind: "resize", id: single, handle, start: draft });
                  }}
                  onRotate={(e) => {
                    capture(e);
                    setGesture({ kind: "rotate", id: single, start: draft });
                  }}
                />
              )}

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
          {singleGeom && singleTable ? (
            <>
              <h2 className="font-semibold">
                {t("floorMapsMgr.selectedTable", { name: singleTable.name })}
              </h2>
              <GeometryFields
                geom={singleGeom}
                onChange={(g) =>
                  apply((d) => ({ ...d, [single!]: clampToMap(g, map.width, map.height) }))
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
                <MapPinOff className="mr-2 h-4 w-4" /> {t("floorMapsMgr.removeFromMap")}
              </Button>
              <div className="flex flex-col gap-1 border-t pt-3">
                <h3 className="text-sm font-medium">{t("floorMapEditor.details")}</h3>
                <p className="text-xs text-muted-foreground">{t("floorMapEditor.detailsHelp")}</p>
                <TableRow
                  table={singleTable}
                  tags={tags}
                  busy={busy}
                  onSave={(fields) =>
                    run(
                      () => updateTable(singleTable.id, fields),
                      t("tablesMgr.tableUpdated", { name: singleTable.name }),
                    )
                  }
                  onToggleTag={(tagId) => {
                    const cur = singleTable.table_tags.map((g) => g.id);
                    const next = cur.includes(tagId)
                      ? cur.filter((x) => x !== tagId)
                      : [...cur, tagId];
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
              <h2 className="font-semibold">
                {t("floorMapEditor.multiSelected", { count: selected.length })}
              </h2>
              <p className="text-sm text-muted-foreground">{t("floorMapEditor.multiHelp")}</p>
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
            </>
          ) : (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <h2 className="font-semibold text-foreground">{t("floorMapEditor.howTo")}</h2>
              <ul className="list-disc space-y-1 pl-4">
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
        </aside>
      </div>
    </div>
  );
}

function EditorTable({
  name,
  geom: g,
  selected,
  onPointerDown,
}: {
  name: string;
  geom: Geom;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const shapeClass = cn(
    "transition-colors",
    selected
      ? "fill-blue-500/35 stroke-blue-800"
      : "fill-blue-500/15 stroke-blue-600 hover:fill-blue-500/30",
  );
  return (
    <g
      transform={g.rotation ? `rotate(${g.rotation} ${cx} ${cy})` : undefined}
      className="cursor-move"
      onPointerDown={onPointerDown}
    >
      {g.shape === "circle" ? (
        <circle cx={cx} cy={cy} r={Math.min(g.w, g.h) / 2} strokeWidth={1.75} className={shapeClass} />
      ) : g.shape === "path" && g.path ? (
        <path d={g.path} strokeWidth={1.75} className={shapeClass} />
      ) : (
        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={2} strokeWidth={1.75} className={shapeClass} />
      )}
      <text
        x={cx}
        y={cy}
        fontSize={labelFontSize(name, g.w, g.h)}
        textAnchor="middle"
        dominantBaseline="central"
        className="pointer-events-none fill-foreground font-semibold"
      >
        {name}
      </text>
    </g>
  );
}

const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

function SelectionHandles({
  geom: g,
  px,
  onResize,
  onRotate,
}: {
  geom: Geom;
  px: number;
  onResize: (e: React.PointerEvent, h: Handle) => void;
  onRotate: (e: React.PointerEvent) => void;
}) {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const hs = HANDLE_PX * px;
  const knobY = g.y - ROTATE_KNOB_PX * px;
  return (
    <g transform={g.rotation ? `rotate(${g.rotation} ${cx} ${cy})` : undefined}>
      <rect
        x={g.x}
        y={g.y}
        width={g.w}
        height={g.h}
        strokeWidth={1.5 * px}
        strokeDasharray={`${4 * px} ${3 * px}`}
        className="pointer-events-none fill-none stroke-blue-600"
      />
      <line x1={cx} y1={g.y} x2={cx} y2={knobY} strokeWidth={1.5 * px} className="stroke-blue-600" />
      <circle
        cx={cx}
        cy={knobY}
        r={hs * 0.7}
        strokeWidth={1.5 * px}
        className="cursor-grab fill-background stroke-blue-600"
        onPointerDown={onRotate}
      />
      {HANDLES.map((h) => {
        const [fx, fy] = HANDLE_POS[h];
        return (
          <rect
            key={h}
            x={g.x + g.w * fx - hs / 2}
            y={g.y + g.h * fy - hs / 2}
            width={hs}
            height={hs}
            strokeWidth={1.5 * px}
            style={{ cursor: HANDLE_CURSOR[h] }}
            className="fill-background stroke-blue-600"
            onPointerDown={(e) => onResize(e, h)}
          />
        );
      })}
    </g>
  );
}

/** Exact numbers for the selected table; commit on blur / Enter. */
function GeometryFields({ geom, onChange }: { geom: Geom; onChange: (g: Geom) => void }) {
  const t = useT();
  const fields = [
    ["x", "floorMapEditor.fieldX"],
    ["y", "floorMapEditor.fieldY"],
    ["w", "floorMapEditor.fieldW"],
    ["h", "floorMapEditor.fieldH"],
    ["rotation", "floorMapEditor.fieldRotation"],
  ] as const;
  const [vals, setVals] = useState(() => fieldValues(geom));
  useEffect(() => setVals(fieldValues(geom)), [geom]);

  function commitField(key: (typeof fields)[number][0]) {
    const n = Number(vals[key].replace(",", "."));
    if (!Number.isFinite(n)) {
      setVals(fieldValues(geom));
      return;
    }
    if (key === "x" || key === "y") {
      onChange(moveGeom(geom, key === "x" ? n - geom.x : 0, key === "y" ? n - geom.y : 0));
    } else if (key === "rotation") {
      onChange({ ...geom, rotation: normDeg(n) });
    } else {
      // resize from the top-left corner through the matching handle
      const v = Math.max(12, n);
      const target = key === "w" ? { w: v, h: geom.shape === "circle" ? v : geom.h } : { h: v, w: geom.shape === "circle" ? v : geom.w };
      const unrotated = { ...geom, rotation: 0 };
      const resized = resizeGeom(unrotated, "se", geom.x + target.w, geom.y + target.h, null);
      // keep the centre where it was, as rotation is applied around it
      const [ocx, ocy] = [geom.x + geom.w / 2, geom.y + geom.h / 2];
      const dx = ocx - (resized.x + resized.w / 2);
      const dy = ocy - (resized.y + resized.h / 2);
      onChange({ ...moveGeom(resized, dx, dy), rotation: geom.rotation });
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map(([key, labelKey]) => (
        <label key={key} className={cn("flex flex-col gap-1 text-xs text-muted-foreground", key === "rotation" && "col-span-2")}>
          {t(labelKey)}
          <Input
            value={vals[key]}
            inputMode="decimal"
            className="h-10"
            onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))}
            onBlur={() => commitField(key)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
      ))}
    </div>
  );
}

function fieldValues(g: Geom) {
  const f = (v: number) => String(Math.round(v * 10) / 10);
  return { x: f(g.x), y: f(g.y), w: f(g.w), h: f(g.h), rotation: f(g.rotation) };
}
