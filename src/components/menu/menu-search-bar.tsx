"use client";

import { useRef } from "react";
import { LayoutList, Search, X } from "lucide-react";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/**
 * Search, pinned to the bottom edge.
 *
 * It sat at the top until the listino got real, which put it at the far end of
 * a reach on a phone and at the far end of the screen from the ticket at the
 * till. At the bottom it is under the thumb, the way iOS moved its own search
 * fields — and because results now filter the list above rather than dropping
 * down over it, nothing has to open upward.
 */

interface MenuSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Shown while a query is active, so a wide match reads as a number */
  resultCount: number;
  /** Opens the category jump; hidden while searching, where it has no job */
  onBrowse: () => void;
  className?: string;
}

export function MenuSearchBar({
  query,
  onQueryChange,
  resultCount,
  onBrowse,
  className,
}: MenuSearchBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;

  return (
    <div className={cn("shrink-0 border-t bg-card", className)}>
      {searching && (
        <p className="px-4 pt-2 text-xs tabular-nums text-muted-foreground">
          {t("pos.resultsCount", { count: resultCount })}
        </p>
      )}
      <div className="flex items-center gap-2 p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          {/* a raw input, because text-base is what stops iOS zooming the
              whole page when the field takes focus */}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onQueryChange("");
            }}
            placeholder={t("pos.searchMenuPlaceholder")}
            aria-label={t("pos.searchMenuAria")}
            className="h-12 w-full rounded-lg border bg-background pl-10 pr-12 text-base outline-none focus:ring-2 focus:ring-ring"
          />
          {searching && (
            <button
              type="button"
              aria-label={t("pos.clearSearch")}
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {!searching && (
          <button
            type="button"
            onClick={onBrowse}
            aria-label={t("pos.jumpToCategory")}
            className="flex h-12 shrink-0 items-center gap-2 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[420px]:px-4"
          >
            <LayoutList className="h-5 w-5" />
            {/* the label costs a phone more input width than it is worth; the
                aria-label carries it for anyone who needs it */}
            <span className="hidden min-[420px]:inline">
              {t("pos.browseMenu")}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
