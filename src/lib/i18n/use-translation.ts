"use client";

import { useCallback } from "react";
import { useLangStore } from "./store";
import { it, en, type TranslationKey } from "./dictionaries";

const dicts = { it, en };

function lookup(dict: unknown, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (obj, part) =>
        obj && typeof obj === "object"
          ? (obj as Record<string, unknown>)[part]
          : undefined,
      dict,
    );
  return typeof value === "string" ? value : undefined;
}

export type TFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

/** Returns a `t(key, vars?)` translator bound to the current language.
 * Falls back to Italian, then to the raw key. Supports `{name}` interpolation. */
export function useT(): TFn {
  const lang = useLangStore((s) => s.lang);
  return useCallback<TFn>(
    (key, vars) => {
      const raw = lookup(dicts[lang], key) ?? lookup(it, key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
        name in vars ? String(vars[name]) : `{${name}}`,
      );
    },
    [lang],
  );
}

export { useLangStore } from "./store";
export type { Lang } from "./store";
