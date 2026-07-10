// src/app/modal-geometry.ts
// Pure, DOM-free geometry helpers for the draggable/resizable shared Modal.
export interface ModalGeom { x: number; y: number; w: number; h: number; }
export interface Viewport { width: number; height: number; }

const MIN_VISIBLE = 40; // keep at least this much of the header on-screen/grabbable

/** Clamp size to the viewport, then clamp position so the header stays reachable. */
export function clampToViewport(g: ModalGeom, vp: Viewport): ModalGeom {
  const w = Math.min(Math.max(g.w, 120), vp.width);
  const h = Math.min(Math.max(g.h, 80), vp.height);
  const x = Math.min(Math.max(g.x, MIN_VISIBLE - w), vp.width - MIN_VISIBLE);
  const y = Math.min(Math.max(g.y, 0), vp.height - MIN_VISIBLE);
  return { x, y, w, h };
}

export function serializeGeom(g: ModalGeom): string { return JSON.stringify(g); }

/** Parse+validate a persisted geometry string; null on missing/garbage/invalid. */
export function loadGeom(raw: string | null): ModalGeom | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number))) {
      return { x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number };
    }
  } catch { /* ignore */ }
  return null;
}
