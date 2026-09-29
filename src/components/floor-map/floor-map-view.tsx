"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link2, Maximize, Minus, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  FloorMap,
  FloorMapElement,
  RestaurantTable,
} from "@/lib/database.types";
import { labelFontSize } from "@/lib/floor/geometry";
import { STATUS_CONFIG, displayStatus } from "@/lib/floor/status";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Zoom on top of "fit to screen" (1 = whole map visible) */
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.5;
/** Per device and per map: how far the map is turned (0/90/180/270). */
const rotationKey = (mapId: string) => `rms.floor.rotation.${mapId}`;

type ViewRotation = 0 | 90 | 180 | 270;

function readRotation(mapId: string): ViewRotation {
  try {
    const v = Number(localStorage.getItem(rotationKey(mapId)));
    return v === 90 || v === 180 || v === 270 ? v : 0;
  } catch {
    return 0;
  }
}

/** Content transform + outer size for a map turned clockwise by `rot`. */
function turned(rot: ViewRotation, w: number, h: number) {
  switch (rot) {
    case 90:
      return { vw: h, vh: w, transform: `translate(${h} 0) rotate(90)` };
    case 180:
      return { vw: w, vh: h, transform: `translate(${w} ${h}) rotate(180)` };
    case 270:
      return { vw: h, vh: w, transform: `translate(0 ${w}) rotate(270)` };
    default:
      return { vw: w, vh: h, transform: undefined };
  }
}

/** How a table is marked on top of its status (Gestione Sala Smart previews) */
export type TableMarkTone = "proposed" | "picked" | "moved" | "held";
export interface TableMark {
  tone: TableMarkTone;
  /** Short text drawn above the table (a party's name) */
  label?: string;
}

const MARK_SHAPE: Record<TableMarkTone, string> = {
  proposed: "fill-emerald-500/30 stroke-emerald-600",
  picked: "fill-violet-500/30 stroke-violet-600",
  moved: "fill-amber-400/40 stroke-amber-500",
  held: "fill-zinc-400/30 stroke-zinc-500",
};
/** Neutral look when the current status doesn't matter (planning ahead) */
const NEUTRAL_SHAPE = "fill-background stroke-zinc-400 group-hover:fill-zinc-100";

interface FloorMapViewProps {
  map: FloorMap;
  /** Tables placed on this map */
  tables: RestaurantTable[];
  splitsByTable: Map<string, (string | null)[]>;
  linkedByTable: Map<string, string[]>;
  /** Tables filtered out by search/status/tags: drawn faded, not clickable */
  dimmed: Set<string>;
  onSelect: (table: RestaurantTable) => void;
  /** Extra controls shown left of the zoom buttons (e.g. room picker) */
  toolbar?: ReactNode;
  /** Table outlined as selected (Settings → Mappe sala) */
  selectedId?: string | null;
  /** Draw tables without their live status colours */
  neutral?: boolean;
  /** Tables to highlight, by id */
  marks?: Map<string, TableMark>;
}

export function FloorMapView({
  map,
  tables,
  splitsByTable,
  linkedByTable,
  dimmed,
  onSelect,
  toolbar,
  selectedId = null,
  neutral = false,
  marks,
}: FloorMapViewProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [rotation, setRotation] = useState<ViewRotation>(0);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const { vw, vh, transform } = turned(rotation, map.width, map.height);

  useEffect(() => setRotation(readRotation(map.id)), [map.id]);

  function rotate() {
    const next = ((rotation + 90) % 360) as ViewRotation;
    setRotation(next);
    setZoom(MIN_ZOOM);
    try {
      localStorage.setItem(rotationKey(map.id), String(next));
    } catch {
      // blocked storage: the turn just won't be remembered
    }
  }

  // "Fit" = largest scale at which the whole (turned) map fits the box.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // A hair under the exact fit so sub-pixel rounding never adds scrollbars.
    const measure = () =>
      setFit(0.995 * Math.min(el.clientWidth / vw, el.clientHeight / vh));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vw, vh]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Two-finger pinch. Phones run with page zoom disabled, so the map zooms
  // itself; one finger still scrolls natively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (e: TouchEvent) =>
      Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        start = { dist: dist(e), zoom: zoomRef.current };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      anchor.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
      };
      const z = (start.zoom * dist(e)) / start.dist;
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const scale = fit * zoom;
  useKeepCenterOnZoom(containerRef, scale, anchor);

  const iconButton = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Button
      size="icon"
      variant="ghost"
      className="h-10 w-10"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="flex shrink-0 gap-1 rounded-lg border p-1">
          {iconButton(t("floorMap.rotate"), <RotateCw className="h-4 w-4" />, rotate)}
          {iconButton(
            t("floorMap.zoomOut"),
            <Minus className="h-4 w-4" />,
            () => setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_STEP)),
            zoom <= MIN_ZOOM,
          )}
          {iconButton(
            t("floorMap.zoomFit"),
            <Maximize className="h-4 w-4" />,
            () => setZoom(MIN_ZOOM),
            zoom <= MIN_ZOOM,
          )}
          {iconButton(
            t("floorMap.zoomIn"),
            <Plus className="h-4 w-4" />,
            () => setZoom((z) => Math.min(MAX_ZOOM, z * ZOOM_STEP)),
            zoom >= MAX_ZOOM,
          )}
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border bg-card"
      >
        {fit > 0 && (
          <svg
            viewBox={`0 0 ${vw} ${vh}`}
            width={vw * scale}
            height={vh * scale}
            className="mx-auto block select-none"
            role="group"
            aria-label={map.name}
          >
            <g transform={transform}>
              <g aria-hidden>
                {map.elements.map((el, i) => (
                  <Scenery key={i} el={el} viewRotation={rotation} />
                ))}
              </g>
              {tables.map((tb) => (
                <MapTable
                  key={tb.id}
                  table={tb}
                  splits={splitsByTable.get(tb.id) ?? []}
                  linkedTo={linkedByTable.get(tb.id) ?? []}
                  dimmed={dimmed.has(tb.id)}
                  selected={tb.id === selectedId}
                  viewRotation={rotation}
                  onSelect={onSelect}
                  neutral={neutral}
                  mark={marks?.get(tb.id)}
                />
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

/**
 * Keep a point of a scroll box in place when zooming: the pinch midpoint when
 * `anchor` holds one (box-relative px, consumed once), else the box centre.
 */
export function useKeepCenterOnZoom(
  boxRef: React.RefObject<HTMLElement>,
  scale: number,
  anchor?: React.MutableRefObject<{ x: number; y: number } | null>,
) {
  const prev = useRef(scale);
  useLayoutEffect(() => {
    const el = boxRef.current;
    const old = prev.current;
    prev.current = scale;
    const at = anchor?.current ?? null;
    if (anchor) anchor.current = null;
    if (!el || !old || old === scale) return;
    const k = scale / old;
    const ax = at?.x ?? el.clientWidth / 2;
    const ay = at?.y ?? el.clientHeight / 2;
    const cx = el.scrollLeft + ax;
    const cy = el.scrollTop + ay;
    el.scrollLeft = cx * k - ax;
    el.scrollTop = cy * k - ay;
  }, [boxRef, scale, anchor]);
}

const SCENERY_STYLE = {
  // Theme colours are plain CSS vars, so no /opacity modifiers here.
  wall: "fill-none stroke-muted-foreground",
  area: "fill-muted stroke-muted-foreground",
  arrow: "fill-none stroke-foreground",
} as const;

/** Would text at this on-screen angle read upside down? */
function upsideDown(deg: number): boolean {
  const d = ((deg % 360) + 360) % 360;
  return d > 90.5 && d < 269.5;
}

const FLIP_ANCHOR = { start: "end", middle: "middle", end: "start" } as const;

export function Scenery({
  el,
  viewRotation = 0,
}: {
  el: FloorMapElement;
  /** Map turn in the view: text flips so it never reads upside down */
  viewRotation?: number;
}) {
  if (el.kind === "text") {
    const flip = upsideDown((el.rotate ?? 0) + viewRotation);
    const rotate = (el.rotate ?? 0) + (flip ? 180 : 0);
    const anchor = el.anchor ?? "start";
    return (
      <text
        x={el.x}
        y={el.y}
        fontSize={el.size ?? 18}
        textAnchor={flip ? FLIP_ANCHOR[anchor] : anchor}
        transform={rotate ? `rotate(${rotate} ${el.x} ${el.y})` : undefined}
        className={cn(
          "fill-muted-foreground",
          el.font === "hand" ? "italic" : "font-serif",
        )}
      >
        {el.text}
      </text>
    );
  }
  const style = el.style ?? "wall";
  const common = {
    className: SCENERY_STYLE[style],
    strokeWidth: style === "arrow" ? 3 : 1.5,
  };
  switch (el.kind) {
    case "rect":
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} {...common} />;
    case "circle":
      return <circle cx={el.cx} cy={el.cy} r={el.r} {...common} />;
    case "path":
      return <path d={el.d} {...common} />;
    case "ellipse":
      return (
        <g transform={`translate(${el.cx} ${el.cy}) rotate(${el.rotate ?? 0})`}>
          <ellipse rx={el.rx} ry={el.ry} {...common} />
          {el.label && (
            <text
              fontSize={11}
              textAnchor="middle"
              dominantBaseline="central"
              transform={
                upsideDown((el.rotate ?? 0) + 90 + viewRotation)
                  ? "rotate(270)"
                  : "rotate(90)"
              }
              className="fill-muted-foreground"
            >
              {el.label}
            </text>
          )}
        </g>
      );
  }
}

interface MapTableProps {
  table: RestaurantTable;
  splits: (string | null)[];
  linkedTo: string[];
  dimmed: boolean;
  selected?: boolean;
  /** How far the whole map is turned: labels counter-rotate to stay upright */
  viewRotation?: number;
  onSelect: (table: RestaurantTable) => void;
  neutral?: boolean;
  mark?: TableMark;
}

function MapTable({
  table,
  splits,
  linkedTo,
  dimmed,
  selected = false,
  viewRotation = 0,
  onSelect,
  neutral = false,
  mark,
}: MapTableProps) {
  const t = useT();
  const pathRef = useRef<SVGPathElement>(null);
  const x = Number(table.x);
  const y = Number(table.y);
  const w = Number(table.w);
  const h = Number(table.h);
  const [pathCenter, setPathCenter] = useState<{ x: number; y: number } | null>(
    null,
  );

  // A free-form shape's box centre can fall outside the shape (a curved
  // counter), so centre its label on the outline's average point instead.
  useLayoutEffect(() => {
    const p = pathRef.current;
    if (!p) return;
    const len = p.getTotalLength();
    let sx = 0;
    let sy = 0;
    const n = 48;
    for (let i = 0; i < n; i++) {
      const pt = p.getPointAtLength((len * i) / n);
      sx += pt.x;
      sy += pt.y;
    }
    setPathCenter({ x: sx / n, y: sy / n });
  }, [table.path]);

  const status = STATUS_CONFIG[displayStatus(table.status, splits.length > 0)];
  const shapeClass = cn(
    "table-shape transition-colors",
    mark ? MARK_SHAPE[mark.tone] : neutral ? NEUTRAL_SHAPE : status.shape,
  );
  const strokeWidth = mark && mark.tone !== "held" ? 3 : 1.75;
  const dash = mark?.tone === "held" ? "4 3" : undefined;
  const rotate = Number(table.rotation) || 0;
  // Numbers read upright whatever the table's and the view's rotation; a
  // table that ends up standing on screen sizes its label on swapped sides.
  const onScreen = (((rotate + viewRotation) % 180) + 180) % 180;
  const standing = onScreen > 45 && onScreen < 135;
  const fontSize = standing
    ? labelFontSize(table.name, h, w)
    : labelFontSize(table.name, w, h);
  const upright = (px: number, py: number) =>
    rotate + viewRotation
      ? `rotate(${-(rotate + viewRotation)} ${px} ${py})`
      : undefined;
  const label =
    table.shape === "path" && pathCenter
      ? pathCenter
      : { x: x + w / 2, y: y + h / 2 };

  return (
    <g
      role="button"
      tabIndex={dimmed ? -1 : 0}
      aria-label={`${t("floorMap.tableAria", { name: table.name })}: ${t(status.labelKey)}`}
      aria-disabled={dimmed || undefined}
      transform={
        rotate ? `rotate(${rotate} ${x + w / 2} ${y + h / 2})` : undefined
      }
      className={cn(
        "group cursor-pointer outline-none [&:focus-visible_.table-shape]:stroke-[3.5px]",
        dimmed && "pointer-events-none opacity-20",
      )}
      onClick={() => onSelect(table)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(table);
        }
      }}
    >
      <title>
        {linkedTo.length > 0
          ? `${table.name} · 🔗 ${linkedTo.join(", ")}`
          : table.name}
      </title>
      {table.shape === "circle" ? (
        <circle
          cx={x + w / 2}
          cy={y + h / 2}
          r={Math.min(w, h) / 2}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          className={shapeClass}
        />
      ) : table.shape === "path" && table.path ? (
        <path
          ref={pathRef}
          d={table.path}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          className={shapeClass}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={2}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          className={shapeClass}
        />
      )}
      {selected && (
        <rect
          x={x - 5}
          y={y - 5}
          width={w + 10}
          height={h + 10}
          rx={4}
          strokeWidth={2}
          strokeDasharray="5 3"
          className="pointer-events-none fill-none stroke-primary"
        />
      )}
      <text
        x={label.x}
        y={label.y}
        transform={upright(label.x, label.y)}
        fontSize={fontSize}
        textAnchor="middle"
        dominantBaseline="central"
        className="pointer-events-none fill-foreground font-semibold"
      >
        {table.name}
      </text>

      {mark?.label && (
        <text
          x={x + w / 2}
          y={y - 5}
          transform={upright(x + w / 2, y - 5)}
          fontSize={14}
          textAnchor="middle"
          className="pointer-events-none fill-foreground stroke-background font-semibold"
          strokeWidth={3}
          style={{ paintOrder: "stroke" }}
        >
          {mark.label}
        </text>
      )}
      {splits.length > 1 && (
        <g className="pointer-events-none">
          <circle cx={x + w} cy={y} r={8} className="fill-foreground" />
          <text
            x={x + w}
            y={y}
            transform={upright(x + w, y)}
            fontSize={10}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-background font-bold"
          >
            {splits.length}
          </text>
        </g>
      )}
      {linkedTo.length > 0 && (
        <g className="pointer-events-none">
          <circle
            cx={x}
            cy={y}
            r={8}
            className="fill-background stroke-muted-foreground"
          />
          <Link2
            x={x - 5.5}
            y={y - 5.5}
            width={11}
            height={11}
            className="text-foreground"
          />
        </g>
      )}
    </g>
  );
}
