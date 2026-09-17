"use client";

import { useEffect, useState } from "react";

/** Below this, the change is browser chrome hiding, not a keyboard. */
const KEYBOARD_MIN_HEIGHT = 60;

/**
 * How much of the layout the on-screen keyboard is covering, in CSS pixels.
 *
 * The phone shell is a fixed `h-dvh` column, and `dvh` does not shrink when the
 * keyboard opens — so a bar pinned to the bottom ends up behind it. Applied as
 * padding-bottom on a border-box column, this number shrinks the content box
 * and lifts the bar back into view.
 *
 * Android is handled upstream by `interactive-widget=resizes-content` in the
 * viewport meta, which shrinks the layout viewport itself; there `innerHeight`
 * has already shrunk and this returns 0, so the two never stack.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(covered > KEYBOARD_MIN_HEIGHT ? covered : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
