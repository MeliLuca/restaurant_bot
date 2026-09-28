/** Map vs grid/list is a per-device preference (a phone may prefer the list). */
const VIEW_STORAGE_KEY = "rms.floor.view";

export type FloorView = "map" | "grid";

export function readStoredView(): FloorView | null {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === "map" || v === "grid" ? v : null;
  } catch {
    return null;
  }
}

export function storeView(v: FloorView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  } catch {
    // private mode / blocked storage: the choice just won't persist
  }
}
