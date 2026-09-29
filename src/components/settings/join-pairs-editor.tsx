"use client";

// Settings → Mappe sala → Tavoli unibili: which tables Gestione Sala Smart may
// push together. The map proposes every pair drawn close enough; here a pair
// is kept apart (a bench, a pillar) or joined although drawn far.

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, Undo2 } from "lucide-react";
import { FloorMapView } from "@/components/floor-map/floor-map-view";
import { Button } from "@/components/ui/button";
import type { FloorMap, TableJoinRule } from "@/lib/database.types";
import { compareTableNames } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import type { TableWithTags } from "@/lib/settings-api";
import { buildAdjacency } from "@/lib/smart-floor/adjacency";
import { toFloorTable } from "@/lib/smart-floor/context";
import { clearJoinRules, setJoinRule } from "@/lib/smart-floor/data";
import { joinSegment } from "@/lib/smart-floor/join-lines";
import { cn } from "@/lib/utils";

const NONE = new Map<string, never[]>();
const NOTHING = new Set<string>();

type PairState = "auto" | "added" | "removed";

const LINE_STYLE: Record<PairState, { className: string; width: number; dash?: string }> = {
  auto: { className: "stroke-zinc-500", width: 3 },
  added: { className: "stroke-emerald-600", width: 4 },
  removed: { className: "stroke-red-600", width: 3, dash: "5 4" },
};

interface Pair {
  a: string;
  b: string;
  state: PairState;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function JoinPairsEditor({
  map,
  tables,
  rules,
  joinDistance,
  moduleOn,
  onChanged,
}: {
  map: FloorMap;
  /** Every table (the map's are picked out here) */
  tables: TableWithTags[];
  rules: TableJoinRule[];
  joinDistance: number;
  moduleOn: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onMap = useMemo(() => tables.filter((tb) => tb.map_id === map.id), [tables, map.id]);
  const floorTables = useMemo(() => onMap.map(toFloorTable), [onMap]);
  const byId = useMemo(() => new Map(floorTables.map((ft) => [ft.id, ft])), [floorTables]);
  const name = (id: string) => byId.get(id)?.name ?? "?";

  // what the map alone says, then the exceptions on top
  const auto = useMemo(
    () => buildAdjacency(floorTables, joinDistance, []),
    [floorTables, joinDistance],
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

  async function toggle(a: string, b: string) {
    const next = !joinable(a, b);
    const byMap = !!auto.get(a)?.has(b);
    setBusy(true);
    try {
      await setJoinRule(a, b, next === byMap ? null : next);
      await onChanged();
      toast.success(
        t(next ? "joinPairs.nowJoinable" : "joinPairs.nowApart", {
          a: name(a),
          b: name(b),
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

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

  const overlay = (
    <g>
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
            onClick={() => void toggle(p.a, p.b)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void toggle(p.a, p.b);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6 lg:flex-row">
      <aside className="flex min-h-0 flex-col gap-4 lg:w-80 lg:shrink-0">
        <Button asChild variant="ghost" className="h-10 w-fit px-2">
          <Link href="/settings/floor-maps">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> {t("joinPairs.back")}
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{t("joinPairs.title", { map: map.name })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("joinPairs.intro", { distance: joinDistance })}
          </p>
          {!moduleOn && (
            <p className="mt-2 text-sm text-amber-700">{t("joinPairs.moduleOff")}</p>
          )}
        </div>

        <ul className="flex flex-col gap-1.5 text-sm">
          {(["auto", "added", "removed"] as const).map((s) => (
            <li key={s} className="flex items-center gap-2">
              <svg width="28" height="8" aria-hidden>
                <line
                  x1="2"
                  y1="4"
                  x2="26"
                  y2="4"
                  strokeWidth={LINE_STYLE[s].width}
                  strokeDasharray={LINE_STYLE[s].dash}
                  strokeLinecap="round"
                  className={LINE_STYLE[s].className}
                />
              </svg>
              {t(`joinPairs.legend.${s}`)}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t("joinPairs.howTo")}</p>

        {selected && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{t("joinPairs.selected", { name: selected.name })}</p>
            <p className="mt-1 text-muted-foreground">
              {neighbours.length > 0
                ? t("joinPairs.joinsWith", { tables: neighbours.map(name).join(", ") })
                : t("joinPairs.joinsNone")}
            </p>
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

        <div className="flex min-h-0 flex-1 flex-col gap-2">
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
            <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
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
      </aside>

      <div className="min-h-[360px] flex-1">
        <FloorMapView
          map={map}
          tables={onMap}
          splitsByTable={NONE}
          linkedByTable={NONE}
          dimmed={NOTHING}
          neutral
          selectedId={selectedId}
          overlay={overlay}
          onSelect={(tb) => {
            if (busy) return;
            if (!selectedId || selectedId === tb.id) {
              setSelectedId(selectedId === tb.id ? null : tb.id);
            } else {
              void toggle(selectedId, tb.id);
            }
          }}
        />
      </div>
    </div>
  );
}
