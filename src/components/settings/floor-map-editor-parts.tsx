"use client";

// Drawing pieces and side panels of the floor map editor
// (floor-map-editor.tsx holds the state, gestures and toolbar).

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  ImagePlus,
  Trash2,
  X,
} from "lucide-react";
import { Scenery } from "@/components/floor-map/floor-map-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  FloorMapElement,
  FloorMapElementStyle,
  TableTag,
} from "@/lib/database.types";
import {
  labelFontSize,
  moveGeom,
  normDeg,
  resizeGeom,
  type Geom,
  type Handle,
  type RepeatDir,
} from "@/lib/floor/geometry";
import type { Box } from "@/lib/floor/scenery";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const HANDLE_PX = 8;
const ROTATE_KNOB_PX = 26;
const HIT_PX = 12;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

// ---------------------------------------------------------------------------
// Canvas pieces
// ---------------------------------------------------------------------------

export function EditorTable({
  name,
  geom: g,
  selected,
  locked,
  passive = false,
  onPointerDown,
}: {
  name: string;
  geom: Geom;
  selected: boolean;
  /** Other layer is being edited: drawn faded, not interactive */
  locked: boolean;
  /** A drawing tool is active: clicks go through to the sheet */
  passive?: boolean;
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
      className={cn(
        "cursor-move",
        locked && "pointer-events-none opacity-30",
        passive && "pointer-events-none",
      )}
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

/** A copy "Ripeti in fila" is about to add: dashed, with its future name. */
export function GhostTable({ name, geom: g, px }: { name: string; geom: Geom; px: number }) {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const common = {
    strokeWidth: 1.5 * px,
    strokeDasharray: `${4 * px} ${3 * px}`,
    className: "fill-blue-500/10 stroke-blue-600",
  };
  return (
    <g
      transform={g.rotation ? `rotate(${g.rotation} ${cx} ${cy})` : undefined}
      className="pointer-events-none"
    >
      {g.shape === "circle" ? (
        <circle cx={cx} cy={cy} r={Math.min(g.w, g.h) / 2} {...common} />
      ) : g.shape === "path" && g.path ? (
        <path d={g.path} {...common} />
      ) : (
        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={2} {...common} />
      )}
      <text
        x={cx}
        y={cy}
        fontSize={labelFontSize(name, g.w, g.h)}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-blue-700 font-semibold"
      >
        {name}
      </text>
    </g>
  );
}

/**
 * A scenery element in the editor: drawn as usual plus an invisible, fatter
 * copy on top so a 1.5-unit wall can still be grabbed with a finger.
 */
export function EditorElement({
  el,
  px,
  interactive,
  onPointerDown,
}: {
  el: FloorMapElement;
  px: number;
  interactive: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const solid = el.kind === "text" || ("style" in el && el.style === "area");
  return (
    <g className={cn(!interactive && "pointer-events-none")}>
      <g className="pointer-events-none">
        <Scenery el={el} />
      </g>
      {interactive && (
        // the copy's paint and width come from CSS, which beats the
        // presentation attributes Scenery sets
        <g
          className="cursor-move [&_*]:![fill:transparent] [&_*]:![stroke:transparent] [&_*]:![stroke-width:inherit]"
          style={{
            strokeWidth: HIT_PX * px,
            pointerEvents: solid ? "all" : "stroke",
          }}
          onPointerDown={onPointerDown}
        >
          <Scenery el={el} />
        </g>
      )}
    </g>
  );
}

/**
 * Dashed outline + resize handles (+ rotate knob when `onRotate` is given).
 * `rotation` turns the whole frame around the box centre (tables only).
 */
export function SelectionHandles({
  box: g,
  rotation = 0,
  px,
  onResize,
  onRotate,
}: {
  box: Box;
  rotation?: number;
  px: number;
  onResize: (e: React.PointerEvent, h: Handle) => void;
  onRotate?: (e: React.PointerEvent) => void;
}) {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const hs = HANDLE_PX * px;
  const knobY = g.y - ROTATE_KNOB_PX * px;
  return (
    <g transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}>
      <rect
        x={g.x}
        y={g.y}
        width={g.w}
        height={g.h}
        strokeWidth={1.5 * px}
        strokeDasharray={`${4 * px} ${3 * px}`}
        className="pointer-events-none fill-none stroke-blue-600"
      />
      {onRotate && (
        <>
          <line x1={cx} y1={g.y} x2={cx} y2={knobY} strokeWidth={1.5 * px} className="stroke-blue-600" />
          <circle
            cx={cx}
            cy={knobY}
            r={hs * 0.7}
            strokeWidth={1.5 * px}
            className="cursor-grab fill-background stroke-blue-600"
            onPointerDown={onRotate}
          />
        </>
      )}
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

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

/**
 * Seats and tags for several selected tables at once. A field the tables
 * disagree on shows as mixed: seats blank ("misti"), a tag dashed with how
 * many of them have it. Clicking a tag gives it to all, or takes it from all
 * when every one already has it.
 */
export function BulkDetails({
  count,
  capacities,
  tags,
  tagCounts,
  busy,
  onCapacity,
  onTag,
}: {
  /** tables selected */
  count: number;
  capacities: number[];
  tags: TableTag[];
  /** tag id → how many of the selected tables have it */
  tagCounts: Map<string, number>;
  busy: boolean;
  onCapacity: (capacity: number) => void;
  onTag: (tagId: string, add: boolean) => void;
}) {
  const t = useT();
  const common = capacities.every((c) => c === capacities[0]) ? capacities[0] : null;
  const [seats, setSeats] = useState(common === null ? "" : String(common));
  // The field is disabled while the save runs, which blurs it a second time
  // if it still had focus: remember what was sent so it goes out once.
  const sent = useRef<number | null>(null);
  useEffect(() => {
    setSeats(common === null ? "" : String(common));
    sent.current = null;
  }, [common]);

  function commit() {
    const n = parseInt(seats, 10);
    if (!Number.isFinite(n) || n < 1) {
      setSeats(common === null ? "" : String(common));
      return;
    }
    if (n === common || n === sent.current) return;
    sent.current = n;
    onCapacity(n);
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("floorMapEditor.bulkSeats")}
        <Input
          value={seats}
          type="number"
          min={1}
          inputMode="numeric"
          placeholder={t("floorMapEditor.bulkMixed")}
          className="h-10 w-28"
          disabled={busy}
          onChange={(e) => setSeats(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      {tags.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{t("floorMapEditor.bulkTags")}</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const n = tagCounts.get(tag.id) ?? 0;
              const all = n === count;
              const some = n > 0 && !all;
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={all ? true : some ? "mixed" : false}
                  title={
                    all
                      ? t("floorMapEditor.bulkTagRemove", { tag: tag.name })
                      : t("floorMapEditor.bulkTagAdd", { tag: tag.name })
                  }
                  onClick={() => onTag(tag.id, !all)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                    all
                      ? "border-primary bg-primary text-primary-foreground"
                      : some
                        ? "border-dashed border-primary text-foreground hover:bg-accent"
                        : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {tag.name}
                  {some && <span className="ml-1 text-muted-foreground">{n}/{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export interface RepeatSettings {
  dir: RepeatDir;
  /** copies of the selection to add */
  count: number;
  /** empty space between one copy and the next, in map units */
  gap: number;
}

export const REPEAT_MAX = 50;

const REPEAT_DIRS: [RepeatDir, React.ComponentType<{ className?: string }>, TranslationKey][] = [
  ["right", ArrowRight, "floorMapEditor.dirRight"],
  ["down", ArrowDown, "floorMapEditor.dirDown"],
  ["left", ArrowLeft, "floorMapEditor.dirLeft"],
  ["up", ArrowUp, "floorMapEditor.dirUp"],
];

/**
 * "Ripeti in fila": copies of the selected table(s), one after the other in
 * a direction. The copies are previewed on the map while this is open.
 */
export function RepeatPanel({
  settings,
  fits,
  tablesToAdd,
  onChange,
  onApply,
  onClose,
}: {
  settings: RepeatSettings;
  /** copies that fit on the sheet in this direction */
  fits: number;
  /** tables the button will add (copies × selected tables) */
  tablesToAdd: number;
  /** merged into the current settings */
  onChange: (patch: Partial<RepeatSettings>) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [count, setCount] = useState(String(settings.count));
  const [gap, setGap] = useState(String(settings.gap));
  const num = (v: string) => Number(v.replace(",", "."));

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("floorMapEditor.repeatTitle")}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("floorMapEditor.repeatHelp")}</p>
      <div
        role="group"
        aria-label={t("floorMapEditor.repeatDirection")}
        className="grid h-10 grid-cols-4 gap-1 rounded-lg border bg-background p-1"
      >
        {REPEAT_DIRS.map(([dir, Icon, key]) => (
          <button
            key={dir}
            type="button"
            title={t(key)}
            aria-label={t(key)}
            aria-pressed={settings.dir === dir}
            onClick={() => onChange({ dir })}
            className={cn(
              "flex items-center justify-center rounded-md",
              settings.dir === dir
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("floorMapEditor.repeatCount")}
          <Input
            value={count}
            inputMode="numeric"
            className="h-10"
            onChange={(e) => {
              setCount(e.target.value);
              const n = parseInt(e.target.value, 10);
              if (n >= 1 && n <= REPEAT_MAX) onChange({ count: n });
            }}
            onBlur={() => setCount(String(settings.count))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("floorMapEditor.repeatGap")}
          <Input
            value={gap}
            inputMode="decimal"
            className="h-10"
            onChange={(e) => {
              setGap(e.target.value);
              const n = num(e.target.value);
              if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1000)
                onChange({ gap: n });
            }}
            onBlur={() => setGap(String(settings.gap))}
          />
        </label>
      </div>
      {fits === 0 ? (
        <p className="text-xs text-amber-700">{t("floorMapEditor.repeatNoRoom")}</p>
      ) : fits < settings.count ? (
        <p className="text-xs text-amber-700">{t("floorMapEditor.repeatOnlyFit", { count: fits })}</p>
      ) : null}
      <Button className="h-10" disabled={tablesToAdd === 0} onClick={onApply}>
        <Copy className="mr-2 h-4 w-4" />
        {tablesToAdd === 1
          ? t("floorMapEditor.repeatApplyOne")
          : t("floorMapEditor.repeatApply", { count: tablesToAdd })}
      </Button>
    </div>
  );
}

/** Exact numbers for the selected table; commit on blur / Enter. */
export function GeometryFields({ geom, onChange }: { geom: Geom; onChange: (g: Geom) => void }) {
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
      // resize through the bottom-right handle, then put the centre back
      // (rotation is applied around it)
      const v = Math.max(12, n);
      const target =
        key === "w"
          ? { w: v, h: geom.shape === "circle" ? v : geom.h }
          : { h: v, w: geom.shape === "circle" ? v : geom.w };
      const unrotated = { ...geom, rotation: 0 };
      const resized = resizeGeom(unrotated, "se", geom.x + target.w, geom.y + target.h, null);
      const dx = geom.x + geom.w / 2 - (resized.x + resized.w / 2);
      const dy = geom.y + geom.h / 2 - (resized.y + resized.h / 2);
      onChange({ ...moveGeom(resized, dx, dy), rotation: geom.rotation });
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map(([key, labelKey]) => (
        <label
          key={key}
          className={cn(
            "flex flex-col gap-1 text-xs text-muted-foreground",
            key === "rotation" && "col-span-2",
          )}
        >
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

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | undefined;
  options: { value: T; labelKey: TranslationKey }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const t = useT();
  return (
    <div role="group" aria-label={label} className="flex h-10 items-center rounded-lg border p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-full flex-1 items-center justify-center rounded-md px-2 text-sm",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  );
}

const KIND_KEY: Record<FloorMapElement["kind"], TranslationKey> = {
  rect: "floorMapEditor.kindRect",
  circle: "floorMapEditor.kindCircle",
  ellipse: "floorMapEditor.kindEllipse",
  path: "floorMapEditor.kindLine",
  text: "floorMapEditor.kindText",
};

/** Properties of one selected scenery element. Text fields commit on blur. */
export function ElementPanel({
  el,
  onChange,
  onDuplicate,
  onDelete,
}: {
  el: FloorMapElement;
  onChange: (el: FloorMapElement) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(el.kind === "text" ? el.text : el.kind === "ellipse" ? (el.label ?? "") : "");
  const [size, setSize] = useState(el.kind === "text" ? String(el.size ?? 18) : "");
  const [rot, setRot] = useState(
    el.kind === "text" || el.kind === "ellipse" ? String(el.rotate ?? 0) : "",
  );
  useEffect(() => {
    setText(el.kind === "text" ? el.text : el.kind === "ellipse" ? (el.label ?? "") : "");
    setSize(el.kind === "text" ? String(el.size ?? 18) : "");
    setRot(el.kind === "text" || el.kind === "ellipse" ? String(el.rotate ?? 0) : "");
  }, [el]);

  const num = (v: string) => Number(v.replace(",", "."));
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold">{t(KIND_KEY[el.kind])}</h2>

      {el.kind === "text" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("floorMapEditor.textContent")}
            <Input
              autoFocus
              value={text}
              onFocus={(e) => e.currentTarget.select()}
              className="h-10"
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text.trim() && text !== el.text && onChange({ ...el, text: text.trim() })}
              onKeyDown={blurOnEnter}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("floorMapEditor.textSize")}
              <Input
                value={size}
                inputMode="decimal"
                className="h-10"
                onChange={(e) => setSize(e.target.value)}
                onBlur={() => {
                  const n = num(size);
                  if (Number.isFinite(n) && n >= 6) onChange({ ...el, size: Math.round(n * 10) / 10 });
                  else setSize(String(el.size ?? 18));
                }}
                onKeyDown={blurOnEnter}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("floorMapEditor.fieldRotation")}
              <Input
                value={rot}
                inputMode="decimal"
                className="h-10"
                onChange={(e) => setRot(e.target.value)}
                onBlur={() => {
                  const n = num(rot);
                  if (Number.isFinite(n)) onChange({ ...el, rotate: normDeg(n) || undefined });
                  else setRot(String(el.rotate ?? 0));
                }}
                onKeyDown={blurOnEnter}
              />
            </label>
          </div>
          <Segmented<"serif" | "hand">
            label={t("floorMapEditor.textFont")}
            value={el.font ?? "serif"}
            options={[
              { value: "serif", labelKey: "floorMapEditor.fontPrint" },
              { value: "hand", labelKey: "floorMapEditor.fontHand" },
            ]}
            onChange={(font) => onChange({ ...el, font: font === "serif" ? undefined : font })}
          />
        </>
      ) : (
        <>
          <Segmented<FloorMapElementStyle>
            label={t("floorMapEditor.style")}
            value={el.style ?? "wall"}
            options={[
              { value: "wall", labelKey: "floorMapEditor.styleWall" },
              { value: "area", labelKey: "floorMapEditor.styleArea" },
              { value: "arrow", labelKey: "floorMapEditor.styleArrow" },
            ]}
            onChange={(style) => onChange({ ...el, style: style === "wall" ? undefined : style })}
          />
          {el.kind === "ellipse" && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("floorMapEditor.ellipseLabel")}
              <Input
                value={text}
                className="h-10"
                onChange={(e) => setText(e.target.value)}
                onBlur={() => onChange({ ...el, label: text.trim() || undefined })}
                onKeyDown={blurOnEnter}
              />
            </label>
          )}
        </>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="h-10 flex-1" onClick={onDuplicate}>
          <Copy className="mr-2 h-4 w-4" /> {t("floorMapEditor.duplicate")}
        </Button>
        <Button variant="outline" className="h-10 flex-1 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tracing photo + SVG import
// ---------------------------------------------------------------------------

export interface TracePhoto {
  url: string;
  /** natural pixel size, for fitting the sheet to the photo */
  w: number;
  h: number;
}

/**
 * A photo of a paper plan shown under the drawing while editing. It lives
 * only in this browser tab (an object URL) and is never saved.
 */
export function TracePanel({
  photo,
  opacity,
  onPhoto,
  onOpacity,
  onFitSheet,
}: {
  photo: TracePhoto | null;
  opacity: number;
  onPhoto: (p: TracePhoto | null) => void;
  onOpacity: (o: number) => void;
  onFitSheet: () => void;
}) {
  const t = useT();

  async function pick(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      return;
    }
    if (photo) URL.revokeObjectURL(photo.url);
    onPhoto({ url, w: img.naturalWidth, h: img.naturalHeight });
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">{t("floorMapEditor.traceTitle")}</h3>
      {!photo ? (
        <>
          <p className="text-xs text-muted-foreground">{t("floorMapEditor.traceHelp")}</p>
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm hover:bg-accent">
            <ImagePlus className="h-4 w-4" />
            {t("floorMapEditor.tracePick")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("floorMapEditor.traceOpacity", { value: Math.round(opacity * 100) })}
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={Math.round(opacity * 100)}
              onChange={(e) => onOpacity(Number(e.target.value) / 100)}
              className="h-8 accent-primary"
            />
          </label>
          <Button variant="outline" className="h-10" onClick={onFitSheet}>
            {t("floorMapEditor.traceFit")}
          </Button>
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => {
              URL.revokeObjectURL(photo.url);
              onPhoto(null);
            }}
          >
            {t("floorMapEditor.traceRemove")}
          </Button>
        </>
      )}
    </div>
  );
}

export interface ImportOptions {
  replaceScenery: boolean;
  createMissing: boolean;
  removeOthers: boolean;
  fitSheet: boolean;
}

/** Summary of an SVG about to be imported, with what to do about it. */
export function ImportDialog({
  open,
  summary,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  summary: {
    tables: number;
    matched: number;
    missing: string[];
    others: number;
    elements: number;
    size: string;
    sizeDiffers: boolean;
  } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (o: ImportOptions) => void;
}) {
  const t = useT();
  const [opts, setOpts] = useState<ImportOptions>({
    replaceScenery: true,
    createMissing: true,
    removeOthers: false,
    fitSheet: true,
  });
  const check = (key: keyof ImportOptions, labelKey: TranslationKey, vars?: Record<string, string | number>) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={opts[key]}
        onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))}
        className="mt-0.5 h-4 w-4 accent-primary"
      />
      <span>{t(labelKey, vars)}</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("floorMapEditor.importTitle")}</DialogTitle>
          <DialogDescription>{t("floorMapEditor.importDraftNote")}</DialogDescription>
        </DialogHeader>
        {summary && (
          <div className="flex flex-col gap-3">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>{t("floorMapEditor.importTables", { count: summary.tables, matched: summary.matched })}</li>
              {summary.missing.length > 0 && (
                <li>
                  {t("floorMapEditor.importMissing", { count: summary.missing.length })}{" "}
                  <span className="text-muted-foreground">{summary.missing.slice(0, 12).join(", ")}{summary.missing.length > 12 ? "…" : ""}</span>
                </li>
              )}
              <li>{t("floorMapEditor.importElements", { count: summary.elements })}</li>
            </ul>
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              {check("replaceScenery", "floorMapEditor.importReplaceScenery")}
              {summary.missing.length > 0 && check("createMissing", "floorMapEditor.importCreateMissing")}
              {summary.others > 0 && check("removeOthers", "floorMapEditor.importRemoveOthers", { count: summary.others })}
              {summary.sizeDiffers && check("fitSheet", "floorMapEditor.importFitSheet", { size: summary.size })}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onConfirm(opts)} disabled={busy}>
            {busy ? t("floorMapEditor.importing") : t("floorMapEditor.importApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
