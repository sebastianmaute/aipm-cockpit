// src/app/version-history.ts
// Types for per-project data version history (Turso-only). A version is a full
// JSON copy of a project's workspace at a point in time. See the spec.

export type VersionTrigger = "auto" | "manual";

/** Timeline metadata for one version (payload loaded separately/on demand). */
export interface ProjectVersionMeta {
  id: string;
  projectId: string;
  capturedAt: string; // ISO
  trigger: VersionTrigger;
  label: string | null; // manual checkpoint name; null for auto
  summary: string | null; // human caption; null until Slice 2's diff engine
}

/** A version with its serialized-workspace payload. */
export interface ProjectVersion extends ProjectVersionMeta {
  payload: string; // workspaceToJson(...) output
}

/** Default auto-version retention. Slice 4 replaces this with a Settings value. */
export const DEFAULT_VERSION_RETENTION = 50;

/** Min auto-version retention; the configurable setting cannot go below this. */
export const MIN_VERSION_RETENTION = 50;
export const MAX_VERSION_RETENTION = 1000;
export const VERSION_RETENTION_STEP = 10;

/** Clamp a retention value to [50, 1000] and snap to the nearest 10. Bad input → 50. */
export function sanitizeVersionRetention(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_VERSION_RETENTION;
  const snapped = Math.round(n / VERSION_RETENTION_STEP) * VERSION_RETENTION_STEP;
  return Math.max(MIN_VERSION_RETENTION, Math.min(MAX_VERSION_RETENTION, snapped));
}
