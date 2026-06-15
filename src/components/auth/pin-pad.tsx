"use client";

import { useState } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-translation";

export const PIN_LENGTH = 4;

interface PinPadProps {
  /** Called with the full PIN once 4 digits are entered; return false to shake/reset */
  onComplete: (pin: string) => Promise<boolean>;
  disabled?: boolean;
}

export function PinPad({ onComplete, disabled }: PinPadProps) {
  const t = useT();
  const [digits, setDigits] = useState("");
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(false);

  async function push(d: string) {
    if (checking || disabled) return;
    const next = digits + d;
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      setChecking(true);
      const ok = await onComplete(next);
      setChecking(false);
      if (!ok) {
        setShake(true);
        setTimeout(() => setShake(false), 400);
      }
      setDigits("");
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className={cn("flex gap-3 transition-transform", shake && "animate-pulse")}
        aria-label={t("auth.pinDigits")}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-4 w-4 rounded-full border-2 border-muted-foreground/40",
              i < digits.length && "border-primary bg-primary",
            )}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={checking || disabled}
            onClick={() => push(d)}
            className="h-16 w-16 rounded-full border bg-card text-2xl font-semibold transition-colors hover:bg-accent active:scale-95 disabled:opacity-50"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          type="button"
          disabled={checking || disabled}
          onClick={() => push("0")}
          className="h-16 w-16 rounded-full border bg-card text-2xl font-semibold transition-colors hover:bg-accent active:scale-95 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          aria-label={t("auth.deleteDigit")}
          disabled={checking || disabled}
          onClick={() => setDigits((d) => d.slice(0, -1))}
          className="flex h-16 w-16 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent active:scale-95 disabled:opacity-50"
        >
          <Delete className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
