"use client";

// Assistente AI — the tables task: "4 persone alle 21, una carrozzina" →
// the best tables, picked by the Gestione Sala Smart engine on the server
// (/api/ai/tables/suggest), with the model's short note on the best one.
// Advice only: seating and booking stay in the Sala and Prenotazioni.

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, LayoutGrid, Search, Sparkles, TriangleAlert, Users } from "lucide-react";
import { useTimeFormat } from "@/components/reservations/format";
import { PartyInputs, parsePartySize } from "@/components/smart-floor/walk-in-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiFetch } from "@/lib/ai/client";
import type {
  TableSuggestion,
  TableSuggestionKind,
  TableSuggestRequest,
  TableSuggestResponse,
} from "@/lib/ai/contracts/tables";
import type { FloorMap, TableTag } from "@/lib/database.types";
import { fetchFloorMaps } from "@/lib/floor/maps";
import { useT } from "@/lib/i18n/use-translation";
import { fetchTablesWithTags, fetchTableTags, type TableWithTags } from "@/lib/settings-api";
import { cn } from "@/lib/utils";
import { TablesMap } from "./tables-map";

const KIND_STYLE: Record<TableSuggestionKind, string> = {
  free: "border-blue-600/40 bg-blue-600/10 text-blue-700 dark:text-blue-400",
  dirty: "border-amber-800/40 bg-amber-800/10 text-amber-800 dark:text-amber-500",
  finishing: "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-400",
  booking: "border-violet-600/40 bg-violet-600/10 text-violet-700 dark:text-violet-400",
};

const optionKey = (o: TableSuggestion) => o.tableIds.join(",");

/** "2026-10-27", local: the day Prenotazioni opens on (?d=) */
function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TablesTab() {
  const t = useT();
  const time = useTimeFormat();
  const [text, setText] = useState("");
  const [party, setParty] = useState("");
  const [hhmm, setHhmm] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TableSuggestResponse | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  const [tags, setTags] = useState<TableTag[]>([]);
  const [maps, setMaps] = useState<FloorMap[]>([]);
  const [tables, setTables] = useState<TableWithTags[]>([]);

  const loadFloor = () =>
    Promise.all([fetchTablesWithTags(), fetchFloorMaps()])
      .then(([tb, fm]) => {
        setTables(tb);
        setMaps(fm);
      })
      .catch(() => {
        // the map is an aid: the list works without it
      });
  useEffect(() => {
    void loadFloor();
    fetchTableTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  const size = parsePartySize(party);
  const canSearch = !busy && (text.trim().length > 0 || size !== null);

  async function search() {
    if (!canSearch) return;
    // only what was set here: the rest comes from the text
    const body: TableSuggestRequest = {};
    if (text.trim()) body.text = text.trim();
    if (size !== null) body.partySize = size;
    if (hhmm) body.time = hhmm;
    if (tagIds.length > 0) body.tagIds = tagIds;
    if (mapId) body.mapId = mapId;
    setBusy(true);
    setError(null);
    try {
      const [res] = await Promise.all([
        aiFetch<TableSuggestResponse>("/api/ai/tables/suggest", body),
        loadFloor(),
      ]);
      setResult(res);
      setPickedKey(res.options[0] ? optionKey(res.options[0]) : null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : t("ai.tables.failed"));
    } finally {
      setBusy(false);
    }
  }

  const options = result?.options ?? [];
  const picked = options.find((o) => optionKey(o) === pickedKey) ?? options[0] ?? null;
  const booking = result?.request.mode === "booking";

  /** "4 persone · alle 21:00 · Accessible · Sala" */
  function understood(r: TableSuggestResponse): string {
    const parts = [t("ai.tables.people", { count: r.request.partySize })];
    if (r.request.time) {
      const d = new Date(r.request.time);
      const sameDay = d.toDateString() === new Date().toDateString();
      const day = sameDay
        ? ""
        : `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} `;
      parts.push(`${day}${t("ai.tables.at", { time: time(d) })}`);
    } else {
      parts.push(t("ai.tables.nowWord"));
    }
    r.request.tagIds.forEach((id) => parts.push(tags.find((tg) => tg.id === id)?.name ?? "?"));
    const room = maps.find((m) => m.id === r.request.mapId)?.name;
    if (room) parts.push(room);
    return parts.join(" · ");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <p className="text-sm text-muted-foreground">{t("ai.tables.intro")}</p>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <Label htmlFor="ai-tables-text">{t("ai.tables.textLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-tables-text"
                  className="h-11"
                  value={text}
                  maxLength={500}
                  placeholder={t("ai.tables.placeholder")}
                  onChange={(e) => setText(e.target.value)}
                />
                <Button type="submit" className="h-11 shrink-0" disabled={!canSearch}>
                  <Search className="mr-2 h-4 w-4" />
                  {busy ? t("ai.thinking") : t("ai.tables.search")}
                </Button>
              </div>
            </form>

            <div className="flex flex-col gap-4 border-t pt-4">
              <span className="text-xs text-muted-foreground">{t("ai.tables.details")}</span>
              <PartyInputs
                idPrefix="ai-tables"
                party={party}
                onParty={setParty}
                tags={tags}
                tagIds={tagIds}
                onTags={setTagIds}
                maps={maps}
                mapId={mapId}
                onMap={setMapId}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-tables-time">{t("ai.tables.time")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ai-tables-time"
                    type="time"
                    className="h-11 w-32"
                    value={hhmm}
                    onChange={(e) => setHhmm(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={!hhmm}
                    onClick={() => setHhmm("")}
                  >
                    {t("ai.tables.now")}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t("ai.tables.timeHint")}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="flex gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {result && (
          <Results
            result={result}
            summary={understood(result)}
            pickedKey={picked ? optionKey(picked) : null}
            onPick={setPickedKey}
          />
        )}
      </div>

      <div className="h-[600px] min-h-0">
        <TablesMap
          maps={maps}
          tables={tables}
          pick={picked}
          label={t("ai.tables.mapLabel", { count: result?.request.partySize ?? 0 })}
          neutral={booking}
        />
      </div>
    </div>
  );
}

function Results({
  result,
  summary,
  pickedKey,
  onPick,
}: {
  result: TableSuggestResponse;
  summary: string;
  pickedKey: string | null;
  onPick: (key: string) => void;
}) {
  const t = useT();
  const time = useTimeFormat();
  const { options } = result;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{t("ai.tables.understood", { summary })}</p>

      {result.explanation ? (
        <div className="flex gap-2 rounded-lg border border-violet-500/40 bg-violet-500/5 p-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <span className="font-medium">{t("ai.aiNote")}: </span>
            {result.explanation}
          </div>
        </div>
      ) : (
        options.length > 0 &&
        result.ai === null && <p className="text-xs text-muted-foreground">{t("ai.unavailable")}</p>
      )}

      {result.notes.map((n) => (
        <p key={n} className="text-sm text-muted-foreground">
          {n}
        </p>
      ))}

      {options.length === 0 ? (
        <p className="flex gap-2 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          {result.reason ?? t("ai.tables.nothing")}
        </p>
      ) : (
        <ul role="radiogroup" aria-label={summary} className="flex flex-col gap-2">
          {options.map((o, i) => {
            const key = optionKey(o);
            const active = key === pickedKey;
            return (
              <li key={key}>
                <div
                  role="radio"
                  aria-checked={active}
                  aria-label={t("ai.tables.optionAria", {
                    tables: o.tableNames.join(" + "),
                    seats: o.seats,
                  })}
                  tabIndex={0}
                  onClick={() => onPick(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(key);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-emerald-600 bg-emerald-500/10" : "hover:bg-accent",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        KIND_STYLE[o.kind],
                      )}
                    >
                      {t(`ai.tables.kind.${o.kind}`)}
                    </span>
                    <span className="text-base font-semibold">{o.tableNames.join(" + ")}</span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {t("ai.tables.seats", { count: o.seats })}
                    </span>
                    {o.mapName && <span className="text-muted-foreground">· {o.mapName}</span>}
                    {i === 0 && (
                      <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-400">
                        {t("ai.tables.best")}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">{o.reason}</span>
                  <span className="text-xs text-muted-foreground">
                    {o.leaveBy
                      ? t("ai.tables.leaveBy", { time: time(o.leaveBy) })
                      : t("ai.tables.allEvening")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11">
          <Link href="/floor-plan">
            <LayoutGrid className="mr-2 h-4 w-4" />
            {t("ai.tables.openFloor")}
          </Link>
        </Button>
        {result.request.mode === "booking" && (
          <Button asChild variant="outline" className="h-11">
            <Link href={`/prenotazioni?new=1${result.request.time ? `&d=${dayKeyOf(result.request.time)}` : ""}`}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              {t("ai.tables.newBooking")}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
