"use client";

// Above the Sala: map or grid, the search, and the table states. The states
// are the legend and the filter at once, each with how many tables are in it,
// so the colours on the map are explained by the chips that also count them.

import { LayoutGrid, Map as MapIcon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { FloorFilters } from "@/hooks/use-floor-filters";
import { DISPLAY_STATUSES, STATUS_CONFIG } from "@/lib/floor/status";
import type { FloorView } from "@/lib/floor/view-pref";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

const chip = (active: boolean) =>
  cn(
    "flex items-center rounded-full border transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "text-muted-foreground hover:bg-accent",
  );

export function FloorToolbar({
  view,
  onView,
  filters,
}: {
  /** null: no drawn map, the grid is the only view */
  view: FloorView | null;
  onView: (view: FloorView) => void;
  filters: FloorFilters;
}) {
  const t = useT();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {view !== null && (
          <div
            role="group"
            aria-label={t("floor.viewAria")}
            className="flex h-11 items-center rounded-lg border p-1"
          >
            {(
              [
                ["map", MapIcon, "floor.viewMap"],
                ["grid", LayoutGrid, "floor.viewGrid"],
              ] as const
            ).map(([v, Icon, labelKey]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => onView(v)}
                className={cn(
                  "flex h-full items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            placeholder={t("floor.searchTables")}
            className="h-11 w-44 pl-9"
            aria-label={t("floor.searchTablesAria")}
          />
        </div>
        <div
          role="group"
          aria-label={t("floor.statusFilterAria")}
          className="flex flex-wrap items-center gap-2"
        >
          {DISPLAY_STATUSES.map((s) => {
            const active = filters.status === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => filters.toggleStatus(s)}
                className={cn(chip(active), "h-11 gap-2 px-4 text-sm")}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-3 w-3 rounded-full",
                    STATUS_CONFIG[s].dot,
                    active && "ring-2 ring-primary-foreground",
                  )}
                />
                {t(STATUS_CONFIG[s].labelKey)}
                <span className="font-semibold tabular-nums">{filters.counts[s]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feature tags (TV screen, accessible…) on their own row */}
      {filters.allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.allTags.map((tag) => {
            const active = filters.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() => filters.toggleTag(tag.id)}
                className={cn(chip(active), "h-9 px-3 text-sm")}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
