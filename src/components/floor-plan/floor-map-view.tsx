"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link2, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  FloorMap,
  FloorMapElement,
  RestaurantTable,
} from "@/lib/database.types";
import { STATUS_CONFIG, displayStatus } from "@/lib/floor/status";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Zoom steps on top of "fit to screen" (1 = whole map visible) */
const ZOOM_STEPS = [1, 1.5, 2, 3];
const MAX_LABEL_SIZE = 20;

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
}: FloorMapViewProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const [step, setStep] = useState(0);

  // "Fit" = largest scale at which the whole map fits the available box.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // A hair under the exact fit so sub-pixel rounding never adds scrollbars.
    const measure = () =>
      setFit(
        0.995 *
          Math.min(el.clientWidth / map.width, el.clientHeight / map.height),
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map.width, map.height]);

  const scale = fit * ZOOM_STEPS[step];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="flex shrink-0 gap-1 rounded-lg border p-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10"
            aria-label={t("floorMap.zoomOut")}
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10"
            aria-label={t("floorMap.zoomFit")}
            disabled={step === 0}
            onClick={() => setStep(0)}
          >
            <Maximize className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10"
            aria-label={t("floorMap.zoomIn")}
            disabled={step === ZOOM_STEPS.length - 1}
            onClick={() =>
              setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1))
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card"
      >
        {fit > 0 && (
          <svg
            viewBox={`0 0 ${map.width} ${map.height}`}
            width={map.width * scale}
            height={map.height * scale}
            className="mx-auto block select-none"
            role="group"
            aria-label={map.name}
          >
            <g aria-hidden>
              {map.elements.map((el, i) => (
                <Scenery key={i} el={el} />
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
                onSelect={onSelect}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

const SCENERY_STYLE = {
  // Theme colours are plain CSS vars, so no /opacity modifiers here.
  wall: "fill-none stroke-muted-foreground",
  area: "fill-muted stroke-muted-foreground",
  arrow: "fill-none stroke-foreground",
} as const;

function Scenery({ el }: { el: FloorMapElement }) {
  if (el.kind === "text") {
    return (
      <text
        x={el.x}
        y={el.y}
        fontSize={el.size ?? 18}
        textAnchor={el.anchor ?? "start"}
        transform={
          el.rotate ? `rotate(${el.rotate} ${el.x} ${el.y})` : undefined
        }
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
              transform="rotate(90)"
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
  onSelect: (table: RestaurantTable) => void;
}

function MapTable({
  table,
  splits,
  linkedTo,
  dimmed,
  selected = false,
  onSelect,
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
  const shapeClass = cn("table-shape transition-colors", status.shape);
  const fontSize = Math.min(
    MAX_LABEL_SIZE,
    h * 0.55,
    (w * 0.9) / (table.name.length * 0.55),
  );
  const rotate = Number(table.rotation) || 0;
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
          strokeWidth={1.75}
          className={shapeClass}
        />
      ) : table.shape === "path" && table.path ? (
        <path
          ref={pathRef}
          d={table.path}
          strokeWidth={1.75}
          className={shapeClass}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={2}
          strokeWidth={1.75}
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
        fontSize={fontSize}
        textAnchor="middle"
        dominantBaseline="central"
        className="pointer-events-none fill-foreground font-semibold"
      >
        {table.name}
      </text>

      {splits.length > 1 && (
        <g className="pointer-events-none">
          <circle cx={x + w} cy={y} r={8} className="fill-foreground" />
          <text
            x={x + w}
            y={y}
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
