"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Euro,
  Minus,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-translation";

/** The bill's edit commands, always on screen at the top of the list and
 * enabled by the selection (one line or many). An action without a handler
 * stays visible but disabled, so the bar never changes shape under the hand:
 * the caller decides what the selection and this user may do. */
export interface SelectionToolbarProps {
  /** Selected bill rows (0 = nothing selected, everything disabled) */
  count: number;
  busy?: boolean;
  onClear: () => void;
  onDecrease?: () => void;
  onIncrease?: () => void;
  /** Ingredients / notes editor: one unsent line only */
  onEditLine?: () => void;
  /** Explains a disabled "Varianti" (e.g. several lines selected) */
  editLineHint?: string;
  onEditPrice?: () => void;
  onMove?: () => void;
  onRemove?: () => void;
}

export function SelectionToolbar({
  count,
  busy = false,
  onClear,
  onDecrease,
  onIncrease,
  onEditLine,
  editLineHint,
  onEditPrice,
  onMove,
  onRemove,
}: SelectionToolbarProps) {
  const t = useT();
  const none = count === 0;
  const off = (handler?: () => void) => none || busy || !handler;

  // One line always: the labels show only when the bill column is wide
  // enough for them (it is not the viewport that decides: the bill can be a
  // wide column, a phone sheet or anything between); icons and aria-labels
  // carry the meaning otherwise.
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= 580),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const label = wide ? "inline" : "hidden";

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("cassa.lines.toolbarAria")}
      className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 flex items-center gap-2 border-b bg-card/95 px-4 py-2 backdrop-blur"
    >
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
        {none ? (
          <span className="text-sm text-muted-foreground">
            {t("cassa.lines.selectHint")}
          </span>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 h-11 w-9 shrink-0"
              aria-label={t("cassa.lines.clearSelection")}
              onClick={onClear}
            >
              <X />
            </Button>
            <span className="text-sm font-semibold">
              {count === 1
                ? t("cassa.lines.selectedOne")
                : t("cassa.lines.selectedCount", { count })}
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label={t("cassa.lines.decreaseSelected")}
          disabled={off(onDecrease)}
          onClick={onDecrease}
        >
          <Minus />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label={t("cassa.lines.increaseSelected")}
          disabled={off(onIncrease)}
          onClick={onIncrease}
        >
          <Plus />
        </Button>
        <Button
          variant="outline"
          className="h-11 px-2.5"
          aria-label={t("cassa.lines.variations")}
          title={!none && !onEditLine ? editLineHint : undefined}
          disabled={off(onEditLine)}
          onClick={onEditLine}
        >
          <SlidersHorizontal />
          <span className={label}>{t("cassa.lines.variations")}</span>
        </Button>
        <Button
          variant="outline"
          className="h-11 px-2.5"
          aria-label={t("cassa.lines.price")}
          disabled={off(onEditPrice)}
          onClick={onEditPrice}
        >
          <Euro />
          <span className={label}>{t("cassa.lines.price")}</span>
        </Button>
        <Button
          variant="outline"
          className="h-11 px-2.5"
          aria-label={t("cassa.lines.move")}
          disabled={off(onMove)}
          onClick={onMove}
        >
          <ArrowRightLeft />
          <span className={label}>{t("cassa.lines.move")}</span>
        </Button>
        <Button
          variant="outline"
          className={cn(
            "h-11 px-2.5",
            "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
          )}
          aria-label={t("cassa.lines.remove")}
          disabled={off(onRemove)}
          onClick={onRemove}
        >
          <Trash2 />
          <span className={label}>{t("cassa.lines.remove")}</span>
        </Button>
      </div>
    </div>
  );
}
