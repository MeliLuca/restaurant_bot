"use client";

// Settings → Mappe sala → Unioni e zone: which tables Gestione Sala Smart may
// push together. The map proposes every pair drawn close enough, in the same
// zone, with no line or divider between them. "Unioni": a pair is kept apart
// (a bench, a pillar) or joined although drawn far, and dividers are taken
// away for an evening or put back. "Zone": tables are grouped into zones,
// which never join each other.

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Check, Pencil, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { FloorMapView } from "@/components/floor-map/floor-map-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FloorMap, FloorMapElement, FloorZone, TableJoinRule } from "@/lib/database.types";
import { compareTableNames } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { buildAdjacency, closePairs, outline, type ApartReason } from "@/lib/smart-floor/adjacency";
import { mapBarriers } from "@/lib/smart-floor/barriers";
import { toFloorTable } from "@/lib/smart-floor/context";
import {
  clearJoinRules,
  createZone,
  deleteZone,
  renameZone,
  setDividerOff,
  setJoinRule,
  setTablesZone,
} from "@/lib/smart-floor/data";
import { joinSegment } from "@/lib/smart-floor/join-lines";
import { cn } from "@/lib/utils";

const NONE = new Map<string, never[]>();
const NOTHING = new Set<string>();

type Tab = "joins" | "zones";
type PairState = "auto" | "added" | "removed";

const LINE_STYLE: Record<PairState, { className: string; width: number; dash?: string }> = {
  auto: { className: "stroke-zinc-500", width: 3 },
  added: { className: "stroke-emerald-600", width: 4 },
  removed: { className: "stroke-red-600", width: 3, dash: "5 4" },
};

/** One colour per zone, in the zones' order (plain hex: works in both themes) */
const ZONE_COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
  "#8b5cf6",
  "#84cc16",
  "#f97316",
  "#06b6d4",
];

interface Pair {
  a: string;
  b: string;
  state: PairState;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The divider's own shape, wide and invisible: what a click lands on */
function DividerHit({ el }: { el: FloorMapElement }) {
  const hit = {
    fill: "none",
    strokeWidth: 16,
    className: "stroke-transparent group-hover:stroke-amber-400/40",
  };
  switch (el.kind) {
    case "rect":
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} {...hit} />;
    case "circle":
      return <circle cx={el.cx} cy={el.cy} r={el.r} {...hit} />;
    case "ellipse":
      return (
        <ellipse
          rx={el.rx}
          ry={el.ry}
          transform={`translate(${el.cx} ${el.cy}) rotate(${el.rotate ?? 0})`}
          {...hit}
        />
      );
    case "path":
      return <path d={el.d} {...hit} />;
    case "text":
      return null;
  }
}

export function JoinPairsEditor({
  map,
  tables,
  rules,
  zones,
  joinDistance,
  moduleOn,
  onChanged,
}: {
  map: FloorMap;
  /** Every table (the map's are picked out here) */
  tables: TableWithTags[];
  rules: TableJoinRule[];
  /** This map's zones, in order */
  zones: FloorZone[];
  joinDistance: number;
  moduleOn: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("joins");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // zones: the one tables are put in by clicking them
  const [brushId, setBrushId] = useState<string | null>(null);
  const [newZone, setNewZone] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // tables clicked into (or out of) a zone, shown before the save comes back
  const [zoneEdits, setZoneEdits] = useState<Map<string, string | null>>(new Map());

  const onMap = useMemo(
    () =>
      tables
        .filter((tb) => tb.map_id === map.id)
        .map((tb) => (zoneEdits.has(tb.id) ? { ...tb, zone_id: zoneEdits.get(tb.id)! } : tb)),
    [tables, map.id, zoneEdits],
  );
  const floorTables = useMemo(() => onMap.map(toFloorTable), [onMap]);
  const byId = useMemo(() => new Map(floorTables.map((ft) => [ft.id, ft])), [floorTables]);
  const name = (id: string) => byId.get(id)?.name ?? "?";
  const zoneColor = new Map(zones.map((z, i) => [z.id, ZONE_COLORS[i % ZONE_COLORS.length]]));
  const zoneCount = (zoneId: string | null) =>
    floorTables.filter((ft) => ft.zoneId === zoneId).length;

  // what the map alone says (distance, zones, lines, dividers), then the
  // exceptions on top
  const barriers = useMemo(() => mapBarriers([map]), [map]);
  const close = useMemo(
    () => closePairs(floorTables, joinDistance, barriers),
    [floorTables, joinDistance, barriers],
  );
  const auto = useMemo(
    () => buildAdjacency(floorTables, joinDistance, [], barriers),
    [floorTables, joinDistance, barriers],
  );
  const ruleByPair = useMemo(() => {
    const m = new Map<string, TableJoinRule>();
    for (const r of rules) {
      if (byId.has(r.table_a) && byId.has(r.table_b)) m.set(pairKey(r.table_a, r.table_b), r);
    }
    return m;
  }, [rules, byId]);

  const pairs: Pair[] = [];
  const seen = new Set<string>();
  auto.forEach((others, a) => {
    others.forEach((b) => {
      const key = pairKey(a, b);
      if (seen.has(key)) return;
      seen.add(key);
      const rule = ruleByPair.get(key);
      pairs.push({ a, b, state: rule && !rule.joinable ? "removed" : "auto" });
    });
  });
  ruleByPair.forEach((rule, key) => {
    if (seen.has(key)) return;
    // an exception the map agrees with anyway (distance changed): nothing to draw
    if (rule.joinable) pairs.push({ a: rule.table_a, b: rule.table_b, state: "added" });
  });

  const joinable = (a: string, b: string) => {
    const rule = ruleByPair.get(pairKey(a, b));
    return rule ? rule.joinable : !!auto.get(a)?.has(b);
  };

  const dividers = map.elements
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => el.kind !== "text" && el.style === "divider");

  async function run(action: () => Promise<unknown>, success: string | null) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  function toggle(a: string, b: string) {
    const next = !joinable(a, b);
    const byMap = !!auto.get(a)?.has(b);
    void run(
      () => setJoinRule(a, b, next === byMap ? null : next),
      t(next ? "joinPairs.nowJoinable" : "joinPairs.nowApart", { a: name(a), b: name(b) }),
    );
  }

  function toggleDivider(index: number, el: FloorMapElement) {
    const off = !(el.kind !== "text" && el.off);
    void run(
      () => setDividerOff(map, index, off),
      t(off ? "joinPairs.dividerRemoved" : "joinPairs.dividerBack"),
    );
  }

  async function paint(tableId: string) {
    if (!brushId) {
      toast.info(t("joinPairs.pickZoneFirst"));
      return;
    }
    const next = byId.get(tableId)?.zoneId === brushId ? null : brushId;
    setZoneEdits((m) => new Map(m).set(tableId, next));
    try {
      await setTablesZone([tableId], next);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setZoneEdits((m) => {
        const copy = new Map(m);
        copy.delete(tableId);
        return copy;
      });
    }
  }

  function addZone() {
    const zoneName = newZone.trim();
    if (!zoneName) return;
    if (zones.some((z) => z.name.toLowerCase() === zoneName.toLowerCase())) {
      toast.error(t("joinPairs.zoneExists", { name: zoneName }));
      return;
    }
    void run(async () => {
      const created = await createZone(map.id, zoneName, zones.length);
      setBrushId(created.id);
      setNewZone("");
    }, null);
  }

  function saveRename() {
    if (!renaming) return;
    const zoneName = renaming.name.trim();
    const current = zones.find((z) => z.id === renaming.id);
    if (!zoneName || zoneName === current?.name) {
      setRenaming(null);
      return;
    }
    if (zones.some((z) => z.id !== renaming.id && z.name.toLowerCase() === zoneName.toLowerCase())) {
      toast.error(t("joinPairs.zoneExists", { name: zoneName }));
      return;
    }
    void run(async () => {
      await renameZone(renaming.id, zoneName);
      setRenaming(null);
    }, null);
  }

  function removeZone(zone: FloorZone) {
    if (!window.confirm(t("joinPairs.zoneDeleteConfirm", { name: zone.name }))) return;
    if (brushId === zone.id) setBrushId(null);
    void run(() => deleteZone(zone.id), t("joinPairs.zoneDeleted", { name: zone.name }));
  }

  const exceptions = Array.from(ruleByPair.values()).sort(
    (x, y) =>
      compareTableNames(name(x.table_a), name(y.table_a)) ||
      compareTableNames(name(x.table_b), name(y.table_b)),
  );
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const neighbours = selected
    ? Array.from(auto.get(selected.id) ?? [])
        .concat(
          exceptions
            .filter((r) => r.joinable && (r.table_a === selected.id || r.table_b === selected.id))
            .map((r) => (r.table_a === selected.id ? r.table_b : r.table_a)),
        )
        .filter((id, i, all) => all.indexOf(id) === i && joinable(selected.id, id))
        .sort((x, y) => compareTableNames(name(x), name(y)))
    : [];
  // close by, but a zone, a line or a divider (and no hand rule) keeps them apart
  const apart: { id: string; reason: ApartReason }[] = selected
    ? close
        .filter((p) => p.apart && (p.a === selected.id || p.b === selected.id))
        .map((p) => ({ id: p.a === selected.id ? p.b : p.a, reason: p.apart! }))
        .filter(({ id }) => !joinable(selected.id, id))
        .sort((x, y) => compareTableNames(name(x.id), name(y.id)))
    : [];

  // zones tint their tables: strongly while painting them, lightly otherwise
  const zoneTint = (
    <g pointerEvents="none">
      {floorTables.map((ft) => {
        const color = ft.zoneId ? zoneColor.get(ft.zoneId) : undefined;
        if (!color || !ft.geom) return null;
        return (
          <polygon
            key={ft.id}
            points={outline(ft.geom)
              .map((p) => p.join(","))
              .join(" ")}
            fill={color}
            fillOpacity={tab === "zones" ? 0.4 : 0.18}
            stroke={color}
            strokeWidth={tab === "zones" ? 3 : 1.5}
          />
        );
      })}
    </g>
  );

  const joinsOverlay = (
    <g>
      {dividers.map(({ el, index }) => {
        const off = el.kind !== "text" && !!el.off;
        const label = t(off ? "joinPairs.dividerAria.off" : "joinPairs.dividerAria.on");
        return (
          <g
            key={`divider-${index}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            className={cn("group cursor-pointer outline-none", busy && "pointer-events-none")}
            onClick={() => toggleDivider(index, el)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleDivider(index, el);
              }
            }}
          >
            <title>{label}</title>
            <DividerHit el={el} />
          </g>
        );
      })}
      {pairs.map((p) => {
        const ga = byId.get(p.a)?.geom;
        const gb = byId.get(p.b)?.geom;
        if (!ga || !gb) return null;
        const [[x1, y1], [x2, y2]] = joinSegment(ga, gb);
        const style = LINE_STYLE[p.state];
        const touchesSelected = selectedId === p.a || selectedId === p.b;
        return (
          <g
            key={pairKey(p.a, p.b)}
            role="button"
            tabIndex={0}
            aria-label={t(`joinPairs.lineAria.${p.state}`, { a: name(p.a), b: name(p.b) })}
            className={cn("cursor-pointer outline-none", busy && "pointer-events-none")}
            onClick={() => toggle(p.a, p.b)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(p.a, p.b);
              }
            }}
          >
            <title>{t(`joinPairs.lineAria.${p.state}`, { a: name(p.a), b: name(p.b) })}</title>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={touchesSelected ? style.width + 2 : style.width}
              strokeDasharray={style.dash}
              strokeLinecap="round"
              className={style.className}
            />
          </g>
        );
      })}
    </g>
  );

  const legendLine = (className: string, width: number, dash?: string, faded = false) => (
    <svg width="28" height="8" aria-hidden className={cn(faded && "opacity-30")}>
      <line
        x1="2"
        y1="4"
        x2="26"
        y2="4"
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
        className={className}
      />
    </svg>
  );

  let panel: ReactNode;
  if (tab === "joins") {
    panel = (
      <>
        <p className="text-sm text-muted-foreground">
          {t("joinPairs.intro", { distance: joinDistance })}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {(["auto", "added", "removed"] as const).map((s) => (
            <li key={s} className="flex items-center gap-2">
              {legendLine(LINE_STYLE[s].className, LINE_STYLE[s].width, LINE_STYLE[s].dash)}
              {t(`joinPairs.legend.${s}`)}
            </li>
          ))}
          <li className="flex items-center gap-2">
            {legendLine("stroke-amber-600", 2.5, "7 5")}
            {t("joinPairs.legend.dividerOn")}
          </li>
          <li className="flex items-center gap-2">
            {legendLine("stroke-amber-600", 2.5, "7 5", true)}
            {t("joinPairs.legend.dividerOff")}
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">{t("joinPairs.howTo")}</p>
        <p className="text-sm text-muted-foreground">
          {t(dividers.length > 0 ? "joinPairs.dividersHelp" : "joinPairs.noDividers")}
        </p>

        {selected && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{t("joinPairs.selected", { name: selected.name })}</p>
            <p className="mt-1 text-muted-foreground">
              {neighbours.length > 0
                ? t("joinPairs.joinsWith", { tables: neighbours.map(name).join(", ") })
                : t("joinPairs.joinsNone")}
            </p>
            {apart.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                {t("joinPairs.apartFrom", {
                  list: apart
                    .map((x) => `${name(x.id)} (${t(`joinPairs.apartReason.${x.reason}`)})`)
                    .join(", "),
                })}
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-9 px-2"
              onClick={() => setSelectedId(null)}
            >
              {t("common.close")}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-sm font-medium text-muted-foreground">
              {t("joinPairs.exceptions", { count: exceptions.length })}
            </h2>
            {exceptions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("joinPairs.resetConfirm", { map: map.name }))) return;
                  void run(
                    () => clearJoinRules(onMap.map((tb) => tb.id)),
                    t("joinPairs.resetDone"),
                  );
                }}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" /> {t("joinPairs.resetAll")}
              </Button>
            )}
          </div>
          {exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("joinPairs.noExceptions")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {exceptions.map((r) => (
                <li
                  key={pairKey(r.table_a, r.table_b)}
                  className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      r.joinable ? "bg-emerald-600" : "bg-red-600",
                    )}
                  />
                  <span className="flex-1">
                    {t(r.joinable ? "joinPairs.ruleJoin" : "joinPairs.ruleApart", {
                      a: name(r.table_a),
                      b: name(r.table_b),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={t("joinPairs.restore", {
                      a: name(r.table_a),
                      b: name(r.table_b),
                    })}
                    title={t("joinPairs.restore", {
                      a: name(r.table_a),
                      b: name(r.table_b),
                    })}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setJoinRule(r.table_a, r.table_b, null),
                        t("joinPairs.restored", { a: name(r.table_a), b: name(r.table_b) }),
                      )
                    }
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  } else {
    panel = (
      <>
        <p className="text-sm text-muted-foreground">{t("joinPairs.zonesIntro")}</p>
        <p className="text-sm text-muted-foreground">{t("joinPairs.zonesHowTo")}</p>

        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("joinPairs.noZones", { map: map.name })}
          </p>
        ) : (
          <ul role="radiogroup" aria-label={t("joinPairs.tabZones")} className="flex flex-col gap-1.5">
            {zones.map((z) => {
              const active = brushId === z.id;
              const count = zoneCount(z.id);
              if (renaming?.id === z.id) {
                return (
                  <li key={z.id} className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      value={renaming.name}
                      aria-label={t("joinPairs.zoneRename", { name: z.name })}
                      className="h-10 flex-1"
                      onChange={(e) => setRenaming({ id: z.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={t("common.save")}
                      disabled={busy}
                      onClick={saveRename}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={t("common.cancel")}
                      onClick={() => setRenaming(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              }
              return (
                <li key={z.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t("joinPairs.zoneAria", { name: z.name, count })}
                    onClick={() => setBrushId(active ? null : z.id)}
                    className={cn(
                      "flex min-h-11 flex-1 items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors",
                      active ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: zoneColor.get(z.id) }}
                    />
                    <span className="flex-1">{z.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("joinPairs.zoneCount", { count })}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={t("joinPairs.zoneRename", { name: z.name })}
                    title={t("joinPairs.zoneRename", { name: z.name })}
                    disabled={busy}
                    onClick={() => setRenaming({ id: z.id, name: z.name })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={t("joinPairs.zoneDelete", { name: z.name })}
                    title={t("joinPairs.zoneDelete", { name: z.name })}
                    disabled={busy}
                    onClick={() => removeZone(z)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {zones.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("joinPairs.noZone", { count: zoneCount(null) })}
          </p>
        )}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addZone();
          }}
        >
          <Input
            value={newZone}
            placeholder={t("joinPairs.zoneNamePlaceholder")}
            aria-label={t("joinPairs.zoneNew")}
            className="h-10 flex-1"
            maxLength={40}
            onChange={(e) => setNewZone(e.target.value)}
          />
          <Button type="submit" variant="outline" className="h-10" disabled={busy || !newZone.trim()}>
            <Plus className="mr-1.5 h-4 w-4" /> {t("joinPairs.zoneAdd")}
          </Button>
        </form>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6 lg:flex-row">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 lg:w-80 lg:shrink-0">
        <Button asChild variant="ghost" className="h-10 w-fit px-2">
          <Link href="/settings/floor-maps">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> {t("joinPairs.back")}
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{t("joinPairs.title", { map: map.name })}</h1>
          {!moduleOn && (
            <p className="mt-2 text-sm text-amber-700">{t("joinPairs.moduleOff")}</p>
          )}
        </div>

        <div role="tablist" className="flex gap-1 rounded-lg border p-1">
          {(["joins", "zones"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value);
                setSelectedId(null);
              }}
              className={cn(
                "flex h-10 flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors",
                tab === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(value === "joins" ? "joinPairs.tabJoins" : "joinPairs.tabZones")}
              {value === "zones" && zones.length > 0 && ` (${zones.length})`}
            </button>
          ))}
        </div>

        {panel}
      </aside>

      <div className="min-h-[360px] flex-1">
        <FloorMapView
          map={map}
          tables={onMap}
          splitsByTable={NONE}
          linkedByTable={NONE}
          dimmed={NOTHING}
          neutral
          selectedId={tab === "joins" ? selectedId : null}
          overlay={
            <>
              {zoneTint}
              {tab === "joins" && joinsOverlay}
            </>
          }
          onSelect={(tb) => {
            if (busy) return;
            if (tab === "zones") {
              void paint(tb.id);
            } else if (!selectedId || selectedId === tb.id) {
              setSelectedId(selectedId === tb.id ? null : tb.id);
            } else {
              toggle(selectedId, tb.id);
            }
          }}
        />
      </div>
    </div>
  );
}
