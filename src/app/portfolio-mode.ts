// Global portfolio storage mode + the last-selected Turso project id.
// File mode uses the Phase 1 localStorage ProjectsRegistry; Turso mode treats
// the shared DB's `projects` table as the source of truth and only caches which
// project was last selected. IO is guarded like projects-registry.ts /
// contacts.ts (typeof-window guard + try/catch).

import { isSafeMode } from "./safe-mode";

export type PortfolioMode = "file" | "turso";

export const MODE_KEY = "lop-app:portfolio-mode";
export const CURRENT_TURSO_PROJECT_KEY = "lop-app:turso-current-project";

export function loadPortfolioMode(): PortfolioMode {
  if (isSafeMode()) return "file";
  if (typeof window === "undefined") return "file";
  try {
    return window.localStorage.getItem(MODE_KEY) === "turso" ? "turso" : "file";
  } catch {
    return "file";
  }
}

export function savePortfolioMode(mode: PortfolioMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Quota / disabled storage — silently drop.
  }
}

export function loadCurrentTursoProjectId(): string | null {
  if (isSafeMode()) return null;
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(CURRENT_TURSO_PROJECT_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveCurrentTursoProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, id);
    else window.localStorage.removeItem(CURRENT_TURSO_PROJECT_KEY);
  } catch {
    // Quota / disabled storage — silently drop.
  }
}
