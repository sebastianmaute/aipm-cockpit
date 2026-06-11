// Portfolio registry — tracks the ordered list of projects and which one is
// current. Persisted to localStorage at REGISTRY_KEY.
//
// Pure functions (addProject, removeProject, setCurrentProject, renameProject,
// emptyRegistry, getCurrentEntry) take values as arguments and return new
// objects with NO side-effects: no crypto, no Date.now, no Math.random.
// Callers are responsible for supplying ids.
//
// IO wrappers (loadRegistry, saveRegistry) follow the same guarded pattern as
// src/app/contacts.ts: typeof-window guard + try/catch around every
// localStorage access.

import type { StorageConfig } from "./storage";
import { isPlainObject } from "./sanitize";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectRegistryEntry = {
  id: string;
  name: string;
  code: string;
  storageConfig: StorageConfig;
};

export type ProjectsRegistry = {
  projects: ProjectRegistryEntry[];
  currentProjectId: string | null;
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Returns a fresh, empty registry. Every call produces a distinct object. */
export function emptyRegistry(): ProjectsRegistry {
  return { projects: [], currentProjectId: null };
}

/**
 * Append `entry` to the registry immutably.
 *
 * De-duplication: if an entry with the same id already exists it is replaced
 * in-place (preserving list order) rather than duplicated or silently ignored.
 * This keeps the list stable when callers regenerate entries.
 *
 * Selection: `currentProjectId` is updated to `entry.id` only when
 * `select === true`. The first-project auto-select rule is deliberately
 * omitted — the test "adding without select keeps currentProjectId null"
 * requires strict respect of the `select` flag even for the very first entry.
 */
export function addProject(
  reg: ProjectsRegistry,
  entry: ProjectRegistryEntry,
  select: boolean,
): ProjectsRegistry {
  const exists = reg.projects.some((p) => p.id === entry.id);
  const projects = exists
    ? reg.projects.map((p) => (p.id === entry.id ? entry : p))
    : [...reg.projects, entry];
  return {
    projects,
    currentProjectId: select ? entry.id : reg.currentProjectId,
  };
}

/**
 * Remove the entry with the given id immutably.
 *
 * If the removed entry was the current project, `currentProjectId` is set to
 * the id of the first remaining entry, or `null` when none are left.
 * If `id` is not found the original registry is returned unchanged.
 */
export function removeProject(
  reg: ProjectsRegistry,
  id: string,
): ProjectsRegistry {
  if (!reg.projects.some((p) => p.id === id)) return reg;
  const projects = reg.projects.filter((p) => p.id !== id);
  const currentProjectId =
    reg.currentProjectId === id
      ? (projects[0]?.id ?? null)
      : reg.currentProjectId;
  return { projects, currentProjectId };
}

/**
 * Switch the active project to `id`.
 *
 * Returns the registry unchanged (SAME reference) when `id` is not found in
 * `projects` — unknown ids are silently ignored per spec, mirroring
 * `removeProject`'s not-found path.
 */
export function setCurrentProject(
  reg: ProjectsRegistry,
  id: string,
): ProjectsRegistry {
  if (!reg.projects.some((p) => p.id === id)) return reg;
  return { ...reg, currentProjectId: id };
}

/**
 * Update the `name` and `code` of the entry identified by `id` immutably.
 *
 * Entries for other ids are carried over unchanged (same object references).
 * If `id` is not found the registry is returned unchanged.
 */
export function renameProject(
  reg: ProjectsRegistry,
  id: string,
  name: string,
  code: string,
): ProjectsRegistry {
  if (!reg.projects.some((p) => p.id === id)) return reg;
  return {
    ...reg,
    projects: reg.projects.map((p) =>
      p.id === id ? { ...p, name, code } : p,
    ),
  };
}

/** Convenience: look up the current entry, or `null` when none is selected. */
export function getCurrentEntry(
  reg: ProjectsRegistry,
): ProjectRegistryEntry | null {
  if (!reg.currentProjectId) return null;
  return reg.projects.find((p) => p.id === reg.currentProjectId) ?? null;
}

// ---------------------------------------------------------------------------
// IO — localStorage
// ---------------------------------------------------------------------------

const REGISTRY_KEY = "lop-app:projects";

/**
 * Validate a single raw entry from the parsed JSON.
 * Each entry must have string id/name/code and a plain-object storageConfig
 * with a non-empty string `kind`. Malformed entries are dropped.
 */
function parseEntry(v: unknown): ProjectRegistryEntry | null {
  if (!isPlainObject(v)) return null;
  const { id, name, code, storageConfig } = v;
  if (typeof id !== "string" || !id) return null;
  if (typeof name !== "string" || !name) return null;
  if (typeof code !== "string") return null;
  if (!isPlainObject(storageConfig)) return null;
  if (typeof storageConfig.kind !== "string" || !storageConfig.kind)
    return null;
  return {
    id,
    name,
    code,
    storageConfig: storageConfig as unknown as StorageConfig,
  };
}

/**
 * Load the registry from localStorage.
 *
 * Validation rules:
 *   • Outer value must be a plain object with an array `projects`.
 *   • Each entry is individually validated; malformed entries are silently
 *     dropped (tolerant of partial corruption).
 *   • `currentProjectId` must reference an id that exists in the surviving
 *     entries; otherwise it is coerced to `null`.
 *
 * Returns `emptyRegistry()` on any parse/access failure.
 */
export function loadRegistry(): ProjectsRegistry {
  if (typeof window === "undefined") return emptyRegistry();
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (!raw) return emptyRegistry();
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return emptyRegistry();

    const rawProjects = parsed.projects;
    if (!Array.isArray(rawProjects)) return emptyRegistry();

    const projects: ProjectRegistryEntry[] = [];
    for (const item of rawProjects) {
      const entry = parseEntry(item);
      if (entry) projects.push(entry);
    }

    const rawCurrent = parsed.currentProjectId;
    const currentProjectId =
      typeof rawCurrent === "string" &&
      projects.some((p) => p.id === rawCurrent)
        ? rawCurrent
        : null;

    return { projects, currentProjectId };
  } catch {
    return emptyRegistry();
  }
}

/**
 * Persist the registry to localStorage.
 *
 * Returns `false` when the write was attempted but failed (quota exceeded /
 * storage disabled) so callers can surface the failure — localStorage is the
 * ONLY persistence for the project registry, so a silent drop would make the
 * project list vanish on the next load with zero feedback. The SSR no-op
 * returns `true` (nothing to report — no write was attempted).
 */
export function saveRegistry(reg: ProjectsRegistry): boolean {
  if (typeof window === "undefined") return true;
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
    return true;
  } catch {
    // Quota / disabled storage — report to the caller for user-visible surfacing.
    return false;
  }
}
