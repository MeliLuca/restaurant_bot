"use client";

import { useEffect, useState } from "react";

/**
 * Phone = coarse pointer AND a short screen edge below Tailwind's `sm`.
 *
 * `pointer: coarse` is the half that guarantees a desktop user is never
 * bounced — no mouse-driven browser reports coarse, so a laptop with a narrow
 * window stays put. Width alone would fail that.
 *
 * The short *screen* edge (not the viewport width) is what makes this
 * orientation-independent: a phone turned sideways has a >=640px viewport
 * (iPhone 14 landscape is 844), and a width test would throw the waiter back
 * to the desktop UI mid-shift. An iPad's 820 short edge stays on desktop,
 * which is correct — the w-24 rail is already tablet-tuned.
 *
 * Deliberately not user-agent sniffing: UA misclassifies iPadOS, which
 * requests desktop sites by default.
 */
export function isPhone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) < 640
  );
}

/**
 * True on a phone, whatever UI it chose to show ("Versione desktop" included):
 * Gestione Sala Smart plans tables from a computer only. False until mounted.
 */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhone()), []);
  return phone;
}
