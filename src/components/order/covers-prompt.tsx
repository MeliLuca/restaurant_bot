"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Users } from "lucide-react";
import { fetchCoverCharge } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";

/** Big enough for a long table, small enough that a fat-fingered 200 is caught */
const MAX_COVERS = 30;
const QUICK_PICKS = [1, 2, 3, 4, 5, 6];

/**
 * Asks how many guests a check is for.
 *
 * A presentational card with no positioning of its own: the phone drops it
 * into a full-screen overlay, the desktop into a dialog. Shared because the
 * question, its bounds, and the price it implies must read identically on both
 * — a waiter moving between the handheld and the till is answering the same
 * question, and a second implementation is a second set of bounds to get wrong.
 *
 * The count is never locked. This card is also the *edit* path, opened later
 * from the covers chip with the current value pre-filled, which is what makes
 * it fair to insist on an answer up front.
 */
export function CoversPrompt({
  initial,
  busy = false,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  /** Pre-filled answer — the table's capacity when opening, the current count when editing */
  initial: number;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: (covers: number) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [covers, setCovers] = useState(() =>
    Math.min(MAX_COVERS, Math.max(0, Math.round(initial))),
  );
  const [coverPrice, setCoverPrice] = useState<number | null>(null);

  // Re-seed when the question changes underneath us — a different table, or
  // the same one after its count was edited elsewhere. Without this the card
  // shows whatever was picked last time, which is only invisible because the
  // dialog usually unmounts on close: correctness should not depend on the
  // parent's unmount timing.
  useEffect(() => {
    setCovers(Math.min(MAX_COVERS, Math.max(0, Math.round(initial))));
  }, [initial]);

  // Best-effort: the charge preview is a courtesy, so a failed lookup just
  // hides it rather than blocking the answer.
  useEffect(() => {
    let alive = true;
    void fetchCoverCharge()
      .then((p) => {
        if (alive) setCoverPrice(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const clamp = (n: number) => Math.min(MAX_COVERS, Math.max(0, n));

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-card p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-muted-foreground" />
          {t("pos.coversTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pos.coversBody")}
        </p>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          aria-label="-1"
          disabled={covers <= 0}
          onClick={() => setCovers((c) => clamp(c - 1))}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 disabled:opacity-30"
        >
          <Minus className="h-6 w-6" />
        </button>
        <span className="min-w-[3ch] text-center text-5xl font-bold tabular-nums">
          {covers}
        </span>
        <button
          type="button"
          aria-label="+1"
          disabled={covers >= MAX_COVERS}
          onClick={() => setCovers((c) => clamp(c + 1))}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 disabled:opacity-30"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>

      {/* Most tables are small: one tap beats four presses of "+" */}
      <div className="grid grid-cols-6 gap-2">
        {QUICK_PICKS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setCovers(n)}
            className={cn(
              "flex h-12 items-center justify-center rounded-lg border text-base font-semibold tabular-nums",
              covers === n
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            {n}
          </button>
        ))}
      </div>

      {/* What the number costs, so a mistyped count is visible before it lands */}
      <p className="text-center text-sm text-muted-foreground">
        {coverPrice == null || covers === 0
          ? t("pos.coversNone")
          : t("pos.coversCharge", {
              price: formatMoney(coverPrice),
              count: covers,
              total: formatMoney(coverPrice * covers),
            })}
      </p>

      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-14 flex-1 rounded-xl border text-base font-semibold disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(covers)}
          className="min-h-14 flex-[2] rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {confirmLabel ?? t("common.confirm")}
        </button>
      </div>
    </div>
  );
}

/**
 * The always-available way back into the question: shows the current count and
 * opens the prompt again. Rendered wherever a waiter can see the check.
 */
export function CoversChip({
  covers,
  onClick,
  className,
}: {
  covers: number | null;
  onClick: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("pos.coversEditAria")}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium hover:bg-accent",
        covers == null && "border-dashed text-muted-foreground",
        className,
      )}
    >
      <Users className="h-4 w-4" />
      <span className="tabular-nums">
        {covers == null ? t("pos.coversAsk") : covers}
      </span>
    </button>
  );
}
