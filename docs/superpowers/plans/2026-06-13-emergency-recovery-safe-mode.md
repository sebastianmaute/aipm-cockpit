# Emergency Recovery / Safe Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an emergency switch that boots the app into a clean, blank configuration slate without deleting any data — via a transient `?safe=1` flag, an isolated `/recovery` route, and a top-level error boundary.

**Architecture:** A single memoized `isSafeMode()` flag (read from the URL) is honored by the three config readers (`useSettings` load, `loadPortfolioMode`, `loadCurrentTursoProjectId`), which return defaults in memory and write nothing. A pure `recovery-config.ts` module quarantines (copy-to-backup-key then remove-live-key — a reversible move, never a delete), restores, and exports the three config keys. A standalone `/recovery` route (inherits only `ThemeProvider`, so it survives any brick in the main tree) and a class error boundary surface the controls.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Vitest 4 + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-13-emergency-recovery-safe-mode-design.md`

**Conventions (read before coding):**
- All `localStorage` access is `try/catch`-guarded with a `typeof window === "undefined"` guard (see `portfolio-mode.ts` for the canonical pattern).
- Lint runs with `--max-warnings=0`. Typecheck with `npx tsc --noEmit`.
- DE i18n in `i18n.de.ts` MUST use real umlauts (ä ö ü ß) — the `i18n-encoding` test bans ASCII substitutions (`ae`, `oe`, `ue`, `ss`, `fuer`, …).
- AIPM palette only: green dominant, dark-blue headers, no gradients/shadows. Use existing token classes (`text-AIPM-dark-blue`, `bg-AIPM-green`, `border-line`, `bg-surface`, `text-muted-foreground`, `text-AIPM-pink`).
- Test localStorage runs in jsdom (real). Drive `window.location` in tests with `window.history.replaceState({}, "", "/?safe=1")`.

---

## File Structure

**New files:**
- `src/app/safe-mode.ts` — `isSafeMode()` URL-flag reader (memoized) + `__resetSafeModeCache()`.
- `src/app/safe-mode.test.ts`
- `src/app/recovery-config.ts` — pure quarantine/restore/list/export + `readPersistedLang()`.
- `src/app/recovery-config.test.ts`
- `src/app/error-boundary.tsx` — class error boundary + fallback with Recover link.
- `src/app/error-boundary.test.tsx`
- `src/app/recovery-panel.tsx` — `"use client"` recovery UI (the actual logic).
- `src/app/recovery/page.tsx` — server route wrapper rendering `<RecoveryPanel/>`.
- `src/app/recovery-panel.test.tsx`
- `src/app/recovery-banner.tsx` — safe-mode banner (self-hides unless `isSafeMode()`).
- `src/app/recovery-banner.test.tsx`

**Modified files:**
- `src/app/portfolio-mode.ts` — export `MODE_KEY`/`CURRENT_TURSO_PROJECT_KEY`; honor safe mode in both load readers.
- `src/app/use-settings.ts` — honor safe mode in the load effect AND guard the persist effect.
- `src/app/page.tsx` — render `<RecoveryBanner/>` and wrap `<TaskManager/>` in `<ErrorBoundary/>`.
- `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- `README.md`, `CHANGELOG.md`, `src/app/version.ts` — docs + version bump to `0.75.0 "Nagata"`.

---

## Task 1: `safe-mode.ts` — the flag reader

**Files:**
- Create: `src/app/safe-mode.ts`
- Test: `src/app/safe-mode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/safe-mode.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSafeMode, __resetSafeModeCache } from "./safe-mode";

describe("isSafeMode", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });

  it("is false on a normal URL", () => {
    expect(isSafeMode()).toBe(false);
  });

  it("is true with ?safe=1", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    expect(isSafeMode()).toBe(true);
  });

  it("is true with a bare ?safe", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe");
    expect(isSafeMode()).toBe(true);
  });

  it("is true with #safe", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/#safe");
    expect(isSafeMode()).toBe(true);
  });

  it("memoizes the first read (URL change after first call is ignored)", () => {
    expect(isSafeMode()).toBe(false);
    window.history.replaceState({}, "", "/?safe=1");
    expect(isSafeMode()).toBe(false); // cached
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/safe-mode.test.ts`
Expected: FAIL — cannot find module `./safe-mode`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/safe-mode.ts
//
// Single source of truth for the emergency safe-mode flag. When the page is
// loaded with ?safe=1 (or ?safe / #safe), the three config readers
// (useSettings load, loadPortfolioMode, loadCurrentTursoProjectId) return
// DEFAULTS in memory and write nothing — booting the app onto the browser/file
// backend at the empty state without touching stored config.

let cached: boolean | null = null;

/** True when the page was loaded with the safe-mode escape flag.
 *  Memoized: the URL does not change without a navigation/reload, and every
 *  honoring reader must agree within a session. */
export function isSafeMode(): boolean {
  if (cached !== null) return cached;
  try {
    if (typeof window === "undefined") return (cached = false);
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, "");
    cached = params.has("safe") || hash === "safe";
  } catch {
    cached = false;
  }
  return cached;
}

/** Test-only: clear the memoized value between cases. */
export function __resetSafeModeCache(): void {
  cached = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/safe-mode.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/safe-mode.ts src/app/safe-mode.test.ts
git commit -m "feat: safe-mode URL flag reader"
```

---

## Task 2: `portfolio-mode.ts` — honor safe mode + export keys

**Files:**
- Modify: `src/app/portfolio-mode.ts`
- Test: `src/app/portfolio-mode.test.ts` (existing — append a describe block)

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
// src/app/portfolio-mode.test.ts — append at the end
import { isSafeMode as _isSafeMode } from "./safe-mode"; // ensure module resolves
import { __resetSafeModeCache } from "./safe-mode";
import { MODE_KEY, CURRENT_TURSO_PROJECT_KEY } from "./portfolio-mode";

describe("portfolio-mode — safe mode", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("loadPortfolioMode returns 'file' in safe mode even when 'turso' is stored", () => {
    window.localStorage.setItem(MODE_KEY, "turso");
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    expect(loadPortfolioMode()).toBe("file");
    // stored value is untouched
    expect(window.localStorage.getItem(MODE_KEY)).toBe("turso");
  });

  it("loadCurrentTursoProjectId returns null in safe mode even when an id is stored", () => {
    window.localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, "p1");
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    expect(loadCurrentTursoProjectId()).toBeNull();
    expect(window.localStorage.getItem(CURRENT_TURSO_PROJECT_KEY)).toBe("p1");
  });
});
```

> Note: `loadPortfolioMode` and `loadCurrentTursoProjectId` are already imported at the top of the existing test file. If not, add them to the existing import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/portfolio-mode.test.ts`
Expected: FAIL — `MODE_KEY`/`CURRENT_TURSO_PROJECT_KEY` not exported, and safe-mode branch returns stored value.

- [ ] **Step 3: Edit `portfolio-mode.ts`**

Change the two key consts to named exports and add the import + safe-mode guard:

```ts
// near the top, replace the import block start:
import { isSafeMode } from "./safe-mode";

export type PortfolioMode = "file" | "turso";

export const MODE_KEY = "lop-app:portfolio-mode";
export const CURRENT_TURSO_PROJECT_KEY = "lop-app:turso-current-project";
```

In `loadPortfolioMode`, add the guard as the first line of the body:

```ts
export function loadPortfolioMode(): PortfolioMode {
  if (isSafeMode()) return "file";
  if (typeof window === "undefined") return "file";
  try {
    return window.localStorage.getItem(MODE_KEY) === "turso" ? "turso" : "file";
  } catch {
    return "file";
  }
}
```

In `loadCurrentTursoProjectId`, add the guard as the first line of the body:

```ts
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
```

Leave `savePortfolioMode` / `saveCurrentTursoProjectId` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/portfolio-mode.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/portfolio-mode.ts src/app/portfolio-mode.test.ts
git commit -m "feat: portfolio-mode honors safe mode; export config keys"
```

---

## Task 3: `use-settings.ts` — honor safe mode (load + persist guard)

**Files:**
- Modify: `src/app/use-settings.ts`
- Test: `src/app/use-settings.test.ts` (existing — append a describe block)

- [ ] **Step 1: Write the failing test (append)**

```ts
// src/app/use-settings.test.ts — append
import { renderHook, waitFor } from "@testing-library/react";
import { __resetSafeModeCache } from "./safe-mode";
// `useSettings`, `SETTINGS_KEY`, `defaultSettings` are already imported in this file.

describe("useSettings — safe mode", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("boots defaults and does NOT read or write SETTINGS_KEY in safe mode", async () => {
    const stored = JSON.stringify({ ...defaultSettings, language: "de" });
    window.localStorage.setItem(SETTINGS_KEY, stored);
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    // defaults in memory (NOT the stored "de")
    expect(result.current.settings.language).toBe(defaultSettings.language);
    // stored config is untouched (no persist over it)
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(stored);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: FAIL — in safe mode the hook currently parses + persists, so `language` becomes `"de"` and the stored value is rewritten.

- [ ] **Step 3: Edit `use-settings.ts`**

Add the import near the other imports:

```ts
import { isSafeMode } from "./safe-mode";
```

In the mount load effect, add a short-circuit as the FIRST statement inside the effect body (before `let resolvedLang = ...` / the `try`):

```ts
  useEffect(() => {
    let cancelled = false;
    // Safe mode: ignore persisted settings entirely. Boot the default settings
    // in memory and load the default-language dict. Nothing is read into or
    // written from SETTINGS_KEY, so a broken config can't re-brick the boot.
    if (isSafeMode()) {
      Promise.resolve().then(() => {
        if (!cancelled) setHydrated(true);
      });
      loadI18n(defaultSettings.language).finally(() => {
        if (!cancelled) setI18nReady(true);
      });
      return () => {
        cancelled = true;
      };
    }
    let resolvedLang: Lang = defaultSettings.language;
    // ... unchanged existing body ...
```

In the persist effect, add the safe-mode guard so a safe-mode session never writes config:

```ts
  // Persist settings on every change, guarded by hydration so mount doesn't overwrite.
  useEffect(() => {
    if (!hydrated || isSafeMode()) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // quota exceeded / storage disabled — degrade gracefully, keep in-memory settings
    }
  }, [settings, hydrated]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/use-settings.ts src/app/use-settings.test.ts
git commit -m "feat: useSettings honors safe mode (no read, no persist)"
```

---

## Task 4: `recovery-config.ts` — quarantine / restore / list / export

**Files:**
- Create: `src/app/recovery-config.ts`
- Test: `src/app/recovery-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/recovery-config.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_KEYS,
  quarantineConfig,
  restoreConfig,
  listBackups,
  exportConfig,
  readPersistedLang,
} from "./recovery-config";
import { SETTINGS_KEY } from "./use-settings";
import { MODE_KEY, CURRENT_TURSO_PROJECT_KEY } from "./portfolio-mode";

describe("recovery-config", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("CONFIG_KEYS matches the real config key constants (drift guard)", () => {
    expect(CONFIG_KEYS).toEqual([SETTINGS_KEY, MODE_KEY, CURRENT_TURSO_PROJECT_KEY]);
  });

  it("quarantine copies each present key to a backup key, then removes the live key", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"a":1}');
    window.localStorage.setItem(MODE_KEY, "turso");
    const { ok, id } = quarantineConfig();
    expect(ok).toBe(true);
    expect(id).toBeTruthy();
    // live keys gone
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(MODE_KEY)).toBeNull();
    // backup keys hold the original values (a move, not a delete)
    expect(window.localStorage.getItem(`lop-app:recovery-backup:${id}:${SETTINGS_KEY}`)).toBe('{"a":1}');
    expect(window.localStorage.getItem(`lop-app:recovery-backup:${id}:${MODE_KEY}`)).toBe("turso");
  });

  it("restore writes the backed-up values back to the live keys", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"a":1}');
    window.localStorage.setItem(MODE_KEY, "turso");
    const { id } = quarantineConfig();
    expect(restoreConfig(id!)).toBe(true);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe('{"a":1}');
    expect(window.localStorage.getItem(MODE_KEY)).toBe("turso");
  });

  it("restore returns false for an unknown backup id", () => {
    expect(restoreConfig("nope")).toBe(false);
  });

  it("listBackups returns entries newest-first and survives a corrupt index", () => {
    window.localStorage.setItem(SETTINGS_KEY, "{}");
    const a = quarantineConfig().id!;
    window.localStorage.setItem(SETTINGS_KEY, "{}");
    const b = quarantineConfig().id!;
    const ids = listBackups().map((x) => x.id);
    expect(ids[0]).toBe(b);
    expect(ids).toContain(a);
    window.localStorage.setItem("lop-app:recovery-backups", "{not json");
    expect(listBackups()).toEqual([]);
  });

  it("exportConfig emits the live config keys with secrets redacted", () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ integrations: { turso: { authToken: "SECRET" } }, jira: { token: "JSECRET" } }),
    );
    const out = JSON.parse(exportConfig());
    expect(out[SETTINGS_KEY].integrations.turso.authToken).toBe("***REDACTED***");
    expect(out[SETTINGS_KEY].jira.token).toBe("***REDACTED***");
  });

  it("readPersistedLang returns a valid Lang, defaulting to en-US", () => {
    expect(readPersistedLang()).toBe("en-US");
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "de" }));
    expect(readPersistedLang()).toBe("de");
  });

  it("does not throw when localStorage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() => quarantineConfig()).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/recovery-config.test.ts`
Expected: FAIL — cannot find module `./recovery-config`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/recovery-config.ts
//
// Non-destructive recovery of the three config keys that can brick the app.
// "Quarantine" copies each live key to a timestamped backup key and then
// removes the live key (so defaults load next boot) — a reversible MOVE, never
// a delete. Restore reverses it. Export downloads the current config (secrets
// redacted). All localStorage access is guarded; nothing throws to callers.

import { type Lang, migrateLang } from "./i18n";

// Literal copies of the real key names (asserted equal to the source consts in
// recovery-config.test.ts, so they can't drift). Kept literal so this pure
// module doesn't import the React-bearing use-settings/portfolio-mode modules.
const SETTINGS_KEY = "lop-app:settings";
const MODE_KEY = "lop-app:portfolio-mode";
const CURRENT_TURSO_PROJECT_KEY = "lop-app:turso-current-project";

export const CONFIG_KEYS = [SETTINGS_KEY, MODE_KEY, CURRENT_TURSO_PROJECT_KEY] as const;

const BACKUP_PREFIX = "lop-app:recovery-backup:";
const INDEX_KEY = "lop-app:recovery-backups";
const REDACTED = "***REDACTED***";

export interface BackupMeta {
  id: string;
  at: string;
  keys: string[];
}

function ls(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): BackupMeta[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BackupMeta[]) : [];
  } catch {
    return [];
  }
}

/** Move each present config key to a timestamped backup key, then remove the
 *  live key. Returns the backup id (null if nothing was backed up or storage
 *  is unavailable). */
export function quarantineConfig(): { ok: boolean; id: string | null } {
  const store = ls();
  if (!store) return { ok: false, id: null };
  try {
    const id = String(Date.now());
    const movedKeys: string[] = [];
    for (const key of CONFIG_KEYS) {
      const value = store.getItem(key);
      if (value === null) continue;
      store.setItem(`${BACKUP_PREFIX}${id}:${key}`, value); // copy first
      store.removeItem(key); // then drop the live key (recoverable move)
      movedKeys.push(key);
    }
    if (movedKeys.length === 0) return { ok: true, id: null };
    const index = readIndex(store);
    index.unshift({ id, at: new Date().toISOString(), keys: movedKeys });
    store.setItem(INDEX_KEY, JSON.stringify(index));
    return { ok: true, id };
  } catch {
    return { ok: false, id: null };
  }
}

/** Write a backup's values back to the live config keys. */
export function restoreConfig(id: string): boolean {
  const store = ls();
  if (!store) return false;
  try {
    const entry = readIndex(store).find((b) => b.id === id);
    if (!entry) return false;
    for (const key of entry.keys) {
      const value = store.getItem(`${BACKUP_PREFIX}${id}:${key}`);
      if (value !== null) store.setItem(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

/** All backups, newest first. */
export function listBackups(): BackupMeta[] {
  const store = ls();
  if (!store) return [];
  return readIndex(store);
}

function redactSettings(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...parsed };
    const integrations = out.integrations as { turso?: { authToken?: string } } | undefined;
    if (integrations?.turso?.authToken) {
      out.integrations = {
        ...integrations,
        turso: { ...integrations.turso, authToken: REDACTED },
      };
    }
    const jira = out.jira as { token?: string } | undefined;
    if (jira?.token) out.jira = { ...jira, token: REDACTED };
    return out;
  } catch {
    return raw;
  }
}

/** JSON of the current live config keys, with secrets redacted. For download. */
export function exportConfig(): string {
  const store = ls();
  const out: Record<string, unknown> = {};
  if (store) {
    for (const key of CONFIG_KEYS) {
      const value = store.getItem(key);
      if (value === null) continue;
      out[key] = key === SETTINGS_KEY ? redactSettings(value) : value;
    }
  }
  return JSON.stringify(out, null, 2);
}

/** Best-effort read of the persisted UI language (for the recovery surfaces,
 *  which render outside the settings provider). Defaults to en-US. */
export function readPersistedLang(): Lang {
  const store = ls();
  if (!store) return "en-US";
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return "en-US";
    const parsed = JSON.parse(raw) as { language?: unknown };
    return migrateLang(parsed.language);
  } catch {
    return "en-US";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/recovery-config.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/recovery-config.ts src/app/recovery-config.test.ts
git commit -m "feat: recovery-config quarantine/restore/export (non-destructive)"
```

---

## Task 5: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Test: `src/app/i18n-encoding.test.ts` (existing — run, do not edit)

- [ ] **Step 1: Add the EN keys to `src/app/i18n.ts`**

Add these entries inside the EN dictionary object (place them after the existing `snapshotNeedsTursoFirst` line for locality):

```ts
  // Emergency recovery / safe mode
  recoveryBannerTitle: "Safe mode — configuration not loaded",
  recoveryOpen: "Open recovery",
  recoveryResetNow: "Reset config now",
  recoveryPageTitle: "Emergency recovery",
  recoveryPageIntro:
    "Reset the app to a clean configuration. Your data (projects, tasks, registry, and any Turso cloud database) is preserved — only the stored configuration is moved aside, and it can be restored.",
  recoveryCurrentConfig: "Current configuration",
  recoveryBackendKind: "Storage backend",
  recoveryPortfolioMode: "Portfolio mode",
  recoveryTursoConfigured: "Turso configured",
  recoveryYes: "Yes",
  recoveryNo: "No",
  recoveryDownload: "Download config (JSON)",
  recoveryReset: "Reset to clean config",
  recoveryResetDone: "Configuration reset. Reopening the app…",
  recoveryRestore: "Restore last config",
  recoveryRestoreDone: "Configuration restored. Reopening the app…",
  recoveryNoBackups: "No saved configurations to restore.",
  recoveryBackToApp: "Back to app",
  recoveryError: "Storage is unavailable in this browser; recovery actions can't run.",
  errorBoundaryTitle: "Something went wrong",
  errorBoundaryBody: "The app hit an unexpected error. You can recover into a clean configuration without losing data.",
  errorBoundaryRecover: "Recover",
  errorBoundaryReset: "Reset config & reload",
```

- [ ] **Step 2: Add the DE keys to `src/app/i18n.de.ts` (real umlauts)**

Add the matching entries (place after the existing `snapshotNeedsTursoFirst` line):

```ts
  // Notfall-Wiederherstellung / Sicherer Modus
  recoveryBannerTitle: "Sicherer Modus — Konfiguration nicht geladen",
  recoveryOpen: "Wiederherstellung öffnen",
  recoveryResetNow: "Konfiguration jetzt zurücksetzen",
  recoveryPageTitle: "Notfall-Wiederherstellung",
  recoveryPageIntro:
    "Setzen Sie die App auf eine saubere Konfiguration zurück. Ihre Daten (Projekte, Aufgaben, Registry und jede Turso-Cloud-Datenbank) bleiben erhalten — nur die gespeicherte Konfiguration wird beiseitegelegt und kann wiederhergestellt werden.",
  recoveryCurrentConfig: "Aktuelle Konfiguration",
  recoveryBackendKind: "Speicher-Backend",
  recoveryPortfolioMode: "Portfolio-Modus",
  recoveryTursoConfigured: "Turso konfiguriert",
  recoveryYes: "Ja",
  recoveryNo: "Nein",
  recoveryDownload: "Konfiguration herunterladen (JSON)",
  recoveryReset: "Auf saubere Konfiguration zurücksetzen",
  recoveryResetDone: "Konfiguration zurückgesetzt. App wird neu geöffnet…",
  recoveryRestore: "Letzte Konfiguration wiederherstellen",
  recoveryRestoreDone: "Konfiguration wiederhergestellt. App wird neu geöffnet…",
  recoveryNoBackups: "Keine gespeicherten Konfigurationen zum Wiederherstellen.",
  recoveryBackToApp: "Zurück zur App",
  recoveryError: "Der Speicher ist in diesem Browser nicht verfügbar; Wiederherstellungsaktionen können nicht ausgeführt werden.",
  errorBoundaryTitle: "Etwas ist schiefgelaufen",
  errorBoundaryBody: "Die App hat einen unerwarteten Fehler festgestellt. Sie können eine saubere Konfiguration wiederherstellen, ohne Daten zu verlieren.",
  errorBoundaryRecover: "Wiederherstellen",
  errorBoundaryReset: "Konfiguration zurücksetzen & neu laden",
```

- [ ] **Step 3: Typecheck + run i18n tests**

Run: `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts`
Expected: PASS — keys present in both dicts, no ASCII-umlaut substitutions, EN/DE key sets match.
(If `i18n.test.ts` does not exist, run only `i18n-encoding.test.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: i18n keys for recovery + error boundary (EN/DE)"
```

---

## Task 6: `error-boundary.tsx`

**Files:**
- Create: `src/app/error-boundary.tsx`
- Test: `src/app/error-boundary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/error-boundary.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";
import * as recovery from "./recovery-config";

function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(getByText("hello")).toBeTruthy();
  });

  it("renders the fallback with a Recover link when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByText, getByRole } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(getByText(/Something went wrong/i)).toBeTruthy();
    const link = getByRole("link", { name: /Recover/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/recovery");
    spy.mockRestore();
  });

  it("Reset button quarantines config", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const q = vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: true, id: "1" });
    // jsdom location.reload is a noop; just assert quarantine ran.
    const { getByText } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(getByText(/Reset config & reload/i));
    expect(q).toHaveBeenCalledTimes(1);
    q.mockRestore();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/error-boundary.test.tsx`
Expected: FAIL — cannot find module `./error-boundary`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/error-boundary.tsx
"use client";

import { Component, type ReactNode } from "react";
import { t } from "./i18n";
import { quarantineConfig, readPersistedLang } from "./recovery-config";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Top-level boundary: on a THROWN render error it shows a recovery fallback
 *  instead of a white screen. (Silent render loops are not caught — those use
 *  ?safe=1 / /recovery directly.) */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface for diagnostics; the fallback handles user recovery.
    console.error("App crashed (caught by ErrorBoundary)", error);
  }

  private handleReset = (): void => {
    quarantineConfig();
    try {
      window.location.assign("/");
    } catch {
      /* noop */
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const lang = readPersistedLang();
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "errorBoundaryTitle")}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">{t(lang, "errorBoundaryBody")}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="/recovery"
            className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t(lang, "errorBoundaryRecover")}
          </a>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "errorBoundaryReset")}
          </button>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/error-boundary.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/error-boundary.tsx src/app/error-boundary.test.tsx
git commit -m "feat: top-level error boundary with recovery fallback"
```

---

## Task 7: `recovery-panel.tsx` + `recovery/page.tsx`

**Files:**
- Create: `src/app/recovery-panel.tsx`
- Create: `src/app/recovery/page.tsx`
- Test: `src/app/recovery-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/recovery-panel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { RecoveryPanel } from "./recovery-panel";
import * as recovery from "./recovery-config";
import { SETTINGS_KEY } from "./use-settings";

describe("RecoveryPanel", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the current backend kind and never reveals the token", () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ storageConfig: { kind: "turso" }, integrations: { turso: { authToken: "SECRET" } } }),
    );
    const { getByText, queryByText } = render(<RecoveryPanel />);
    expect(getByText(/turso/i)).toBeTruthy();
    expect(queryByText(/SECRET/)).toBeNull();
  });

  it("Reset button calls quarantineConfig", () => {
    const q = vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: true, id: "1" });
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Reset to clean config/i));
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("lists backups for restore", () => {
    vi.spyOn(recovery, "listBackups").mockReturnValue([
      { id: "111", at: "2026-06-13T00:00:00.000Z", keys: [SETTINGS_KEY] },
    ]);
    const restore = vi.spyOn(recovery, "restoreConfig").mockReturnValue(true);
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Restore last config/i));
    expect(restore).toHaveBeenCalledWith("111");
  });

  it("Download triggers an export", () => {
    const exp = vi.spyOn(recovery, "exportConfig").mockReturnValue("{}");
    // jsdom: stub URL.createObjectURL used by the download path
    const createURL = vi.fn(() => "blob:x");
    // @ts-expect-error jsdom lacks createObjectURL
    URL.createObjectURL = createURL;
    // @ts-expect-error jsdom lacks revokeObjectURL
    URL.revokeObjectURL = vi.fn();
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Download config/i));
    expect(exp).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/recovery-panel.test.tsx`
Expected: FAIL — cannot find module `./recovery-panel`.

- [ ] **Step 3: Write `recovery-panel.tsx`**

```tsx
// src/app/recovery-panel.tsx
"use client";

import { useState } from "react";
import { t } from "./i18n";
import {
  exportConfig,
  listBackups,
  quarantineConfig,
  readPersistedLang,
  restoreConfig,
} from "./recovery-config";
import { SETTINGS_KEY } from "./use-settings";
import { MODE_KEY } from "./portfolio-mode";

interface ConfigSummary {
  backendKind: string;
  portfolioMode: string;
  tursoConfigured: boolean;
}

function readSummary(): ConfigSummary {
  let backendKind = "browser";
  let tursoConfigured = false;
  let portfolioMode = "file";
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as {
        storageConfig?: { kind?: string };
        integrations?: { turso?: { databaseUrl?: string; authToken?: string } };
      };
      backendKind = s.storageConfig?.kind ?? "browser";
      tursoConfigured = !!(s.integrations?.turso?.databaseUrl && s.integrations.turso.authToken);
    }
    portfolioMode = window.localStorage.getItem(MODE_KEY) === "turso" ? "turso" : "file";
  } catch {
    /* defaults */
  }
  return { backendKind, portfolioMode, tursoConfigured };
}

function downloadJson(filename: string, json: string): void {
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    /* download unavailable — ignore */
  }
}

export function RecoveryPanel() {
  const lang = readPersistedLang();
  const [summary] = useState<ConfigSummary>(() => readSummary());
  const [message, setMessage] = useState<string | null>(null);
  const backups = listBackups();

  const reopen = () => {
    try {
      window.location.assign("/");
    } catch {
      /* noop */
    }
  };

  const onReset = () => {
    quarantineConfig();
    setMessage(t(lang, "recoveryResetDone"));
    reopen();
  };

  const onRestore = () => {
    const latest = backups[0];
    if (!latest) {
      setMessage(t(lang, "recoveryNoBackups"));
      return;
    }
    restoreConfig(latest.id);
    setMessage(t(lang, "recoveryRestoreDone"));
    reopen();
  };

  const onDownload = () => downloadJson("lop-config.json", exportConfig());

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {t(lang, "recoveryPageTitle")}
      </h1>
      <p className="text-sm text-muted-foreground">{t(lang, "recoveryPageIntro")}</p>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "recoveryCurrentConfig")}
        </h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t(lang, "recoveryBackendKind")}</dt>
          <dd className="text-foreground">{summary.backendKind}</dd>
          <dt className="text-muted-foreground">{t(lang, "recoveryPortfolioMode")}</dt>
          <dd className="text-foreground">{summary.portfolioMode}</dd>
          <dt className="text-muted-foreground">{t(lang, "recoveryTursoConfigured")}</dt>
          <dd className="text-foreground">
            {t(lang, summary.tursoConfigured ? "recoveryYes" : "recoveryNo")}
          </dd>
        </dl>
      </section>

      {message && <p className="text-sm text-AIPM-green">{message}</p>}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onDownload}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          {t(lang, "recoveryDownload")}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {t(lang, "recoveryReset")}
        </button>
        <button
          type="button"
          onClick={onRestore}
          disabled={backups.length === 0}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
        >
          {t(lang, "recoveryRestore")}
        </button>
        <a href="/" className="mt-2 text-center text-xs text-muted-foreground underline">
          {t(lang, "recoveryBackToApp")}
        </a>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Write `recovery/page.tsx` (server route wrapper)**

```tsx
// src/app/recovery/page.tsx
import { connection } from "next/server";
import { RecoveryPanel } from "../recovery-panel";

export default async function RecoveryRoute() {
  // Match the home route: opt into dynamic rendering so the per-request CSP
  // nonce in src/proxy.ts is consistent. The panel itself reads localStorage
  // on the client only.
  await connection();
  return (
    <div className="flex flex-1 flex-col bg-surface-muted dark:bg-black">
      <RecoveryPanel />
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/recovery-panel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/recovery-panel.tsx src/app/recovery/page.tsx src/app/recovery-panel.test.tsx
git commit -m "feat: /recovery route + panel (reset/restore/export)"
```

---

## Task 8: `recovery-banner.tsx` + wire into `page.tsx`

**Files:**
- Create: `src/app/recovery-banner.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/app/recovery-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/recovery-banner.test.tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RecoveryBanner } from "./recovery-banner";
import { __resetSafeModeCache } from "./safe-mode";

describe("RecoveryBanner", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });

  it("renders nothing when not in safe mode", () => {
    const { container } = render(<RecoveryBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the safe-mode banner with an Open recovery link when ?safe=1", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    const { getByText, getByRole } = render(<RecoveryBanner />);
    expect(getByText(/Safe mode/i)).toBeTruthy();
    const link = getByRole("link", { name: /Open recovery/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/recovery");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/recovery-banner.test.tsx`
Expected: FAIL — cannot find module `./recovery-banner`.

- [ ] **Step 3: Write `recovery-banner.tsx`**

```tsx
// src/app/recovery-banner.tsx
"use client";

import { t } from "./i18n";
import { isSafeMode } from "./safe-mode";
import { quarantineConfig, readPersistedLang } from "./recovery-config";

/** Sticky banner shown only in safe mode (?safe=1). Self-hides otherwise. */
export function RecoveryBanner() {
  if (!isSafeMode()) return null;
  const lang = readPersistedLang();

  const onResetNow = () => {
    quarantineConfig();
    try {
      window.location.assign("/");
    } catch {
      /* noop */
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-AIPM-dark-blue px-4 py-2 text-sm text-white"
    >
      <span className="font-medium">{t(lang, "recoveryBannerTitle")}</span>
      <span className="flex items-center gap-3">
        <a href="/recovery" className="underline hover:opacity-90">
          {t(lang, "recoveryOpen")}
        </a>
        <button
          type="button"
          onClick={onResetNow}
          className="rounded border border-white/40 px-2 py-1 hover:bg-white/10"
        >
          {t(lang, "recoveryResetNow")}
        </button>
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `page.tsx`**

Replace the body of `src/app/page.tsx` with:

```tsx
import { connection } from "next/server";
import TaskManager from "./task-manager";
import { ErrorBoundary } from "./error-boundary";
import { RecoveryBanner } from "./recovery-banner";

export default async function Home() {
  // Opt into dynamic rendering so the per-request CSP nonce in `src/proxy.ts`
  // matches the nonce Next.js attaches to SSR'd scripts and <style> blocks.
  await connection();
  // Plain wrapper — NOT a <main> landmark. Each layout renders its own single
  // <main> around its content region, so wrapping here too would nest a second
  // main landmark (a WCAG "no duplicate main" violation).
  return (
    <div className="flex flex-1 flex-col bg-surface-muted dark:bg-black">
      <RecoveryBanner />
      <ErrorBoundary>
        <TaskManager />
      </ErrorBoundary>
    </div>
  );
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/app/recovery-banner.test.tsx && npx tsc --noEmit`
Expected: PASS (2 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/recovery-banner.tsx src/app/page.tsx src/app/recovery-banner.test.tsx
git commit -m "feat: safe-mode banner + wire error boundary into page"
```

---

## Task 9: Docs + version bump

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Bump `version.ts`**

```ts
export const APP_VERSION = "0.75.0";
export const APP_BUILD_DATE = "2026-06-13"; // 0.75.0 emergency recovery / safe mode — ?safe=1 boot, /recovery route, non-destructive config quarantine/restore, error boundary
```

```ts
export const APP_MILESTONE = "Nagata";
```

Add one highlight key to the END of the `APP_HIGHLIGHT_KEYS` array:

```ts
  "versionHighlightTemplateSuggest",
  "versionHighlightRecovery",
] as const;
```

Then add the highlight i18n key to both dicts (EN `i18n.ts`, DE `i18n.de.ts`) next to the other `versionHighlight*` keys:

```ts
// i18n.ts (EN)
  versionHighlightRecovery: "Emergency recovery: ?safe=1 boot and a /recovery page reset config without losing data",
```
```ts
// i18n.de.ts (DE)
  versionHighlightRecovery: "Notfall-Wiederherstellung: ?safe=1-Start und eine /recovery-Seite setzen die Konfiguration zurück, ohne Daten zu verlieren",
```

- [ ] **Step 2: Add a CHANGELOG entry**

Insert below the `# Changelog` preamble, above `## [0.74.0]`:

```markdown
## [0.75.0] - 2026-06-13 "Nagata"

### Added
- **Emergency recovery / safe mode.** Boot the app into a clean configuration
  without losing data:
  - `?safe=1` (also `?safe` / `#safe`) boots on the browser/file backend at the
    empty state, ignoring stored config in memory — nothing is read or written.
  - A standalone `/recovery` page (isolated from the main app tree) to download
    the current config, reset to a clean slate, or restore the last config.
  - Reset is **non-destructive**: the three config keys (`settings`,
    `portfolio-mode`, `turso-current-project`) are moved to timestamped backup
    keys, never deleted. Project data, the registry, IndexedDB, and any Turso
    cloud database are untouched.
  - A top-level error boundary replaces white-screen crashes with a recovery
    fallback.

### Fixed
- Turso portfolio: "Move to Turso" and the Integrations portfolio switch now
  persist `storageConfig.kind="turso"`, so the workspace backend follows the
  portfolio instead of staying on the local file (which broke snapshot capture).
```

- [ ] **Step 3: Add a README section**

Add an "Emergency recovery" subsection under the most relevant existing section (e.g. after the storage/configuration docs):

```markdown
### Emergency recovery

If a configuration change ever leaves the app stuck (for example a bad Turso
URL or a portfolio mode that won't load), you can recover without losing data:

- **Safe-mode boot:** open the app with `?safe=1` appended to the URL
  (e.g. `https://…/?safe=1`). The app boots on the local browser/file backend
  at the empty state and ignores your stored configuration in memory — nothing
  is changed on disk.
- **Recovery page:** open `/recovery`. From there you can **download** your
  current configuration, **reset** to a clean configuration, or **restore** the
  previous one. Reset only moves the configuration aside (it is recoverable) and
  never touches your projects, tasks, or any Turso cloud database.
- If the app shows an error screen, use its **Recover** button (it links to the
  same recovery page).
```

- [ ] **Step 4: Typecheck + full test sweep**

Run: `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0`
Expected: all PASS, no lint warnings.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md
git commit -m "docs: 0.75.0 Nagata — emergency recovery / safe mode"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vitest run` — all green
- [ ] `npx eslint src/app --max-warnings=0` — clean
- [ ] Manual smoke (dev server): load `/?safe=1` → empty state + safe-mode banner; `/recovery` → summary + buttons; download produces a redacted JSON; reset returns to a clean app with data intact; restore brings config back.
- [ ] Use **superpowers:finishing-a-development-branch**.
