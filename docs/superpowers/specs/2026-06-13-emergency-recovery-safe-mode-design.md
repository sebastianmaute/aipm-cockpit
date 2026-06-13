# Emergency Recovery / Safe Mode — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete)

## Goal

Give the app an emergency switch that recovers it into a clean, blank
configuration slate **without deleting any data or files**. Recovers from
config-driven bricks (bad Turso URL, stuck portfolio mode, dangling project id)
and from thrown render crashes — while preserving every byte of project data.

## Why

The app is a **client browser app**. Its bricking configuration lives in browser
`localStorage`, not on disk, so a CLI flag cannot reach it. The recovery
mechanism must therefore live in the browser and be reachable even when the main
app tree is broken. Recent incidents (Turso split-brain, region-qualified URL
kicking to the empty state, blank-page render loops) motivate this.

## Scope decisions (locked during brainstorming)

1. **Robustness:** Both a transient `?safe=1` boot flag AND a standalone
   `/recovery` route that never mounts the main app tree.
2. **Reset scope:** Config keys only — `lop-app:settings`,
   `lop-app:portfolio-mode`, `lop-app:turso-current-project`. All data (tasks,
   projects, registry, IndexedDB workspace, Turso cloud DB) and UI-layout prefs
   are preserved.
3. **Reversibility:** Quarantine (rename to backup keys) + Restore (undo) +
   Export (download config JSON on demand).
4. **Trigger:** Manual (`?safe=1` / `/recovery`, documented) PLUS a top-level
   error boundary that shows a "Recover" link on a thrown render crash. No
   auto-reset; the user always confirms. **Error boundary is in v1.**

## Architecture

### Route isolation (verified)

Root `layout.tsx` mounts only `ThemeProvider` (reads `lop-theme`, harmless). All
heavy providers (workspace / settings / storage) live inside `<TaskManager/>` in
`page.tsx`. A sibling `/recovery` route inherits only `ThemeProvider`, so it is
isolated from anything that can brick. Accepted residual risk: a corrupt
`lop-theme` value could affect `ThemeProvider` and therefore `/recovery` too;
theme is a short enum string, so this is negligible and out of scope.

### One safe-mode flag, three honoring readers

`safe-mode.ts` exposes `isSafeMode(): boolean` — parses the URL **once**
(memoized) and is true when any of `?safe=1`, `?safe`, or `#safe` is present.
Three existing readers honor it, returning defaults **in memory, writing
nothing**:

| Reader | Normal | Safe mode |
|---|---|---|
| `useSettings` mount-load | parse `lop-app:settings` | `defaultSettings` |
| `loadPortfolioMode()` | read `lop-app:portfolio-mode` | `"file"` |
| `loadCurrentTursoProjectId()` | read `lop-app:turso-current-project` | `null` |

Effect: `?safe=1` boots the app on the browser/file backend at the empty state,
storage untouched. Dropping the flag restores the previous (possibly broken)
config. Pure read-only escape hatch.

## Components

### `src/app/safe-mode.ts`

```ts
let cached: boolean | null = null;

/** True when the page was loaded with the safe-mode escape flag
 *  (?safe=1, ?safe, or #safe). Memoized: the URL does not change without a
 *  navigation/reload, and every honoring reader must agree within a session. */
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

/** Test-only: reset the memoized value between cases. */
export function __resetSafeModeCache(): void {
  cached = null;
}
```

### `src/app/recovery-config.ts`

Pure module, no React. All `localStorage` access wrapped in `try/catch`
(quota / disabled / private mode) — never throws to callers; returns a result
flag instead.

- `CONFIG_KEYS = ["lop-app:settings", "lop-app:portfolio-mode", "lop-app:turso-current-project"]`
- `RECOVERY_BACKUP_PREFIX = "lop-app:recovery-backup:"`
- `RECOVERY_INDEX_KEY = "lop-app:recovery-backups"`
- `BackupMeta = { id: string; at: string; keys: string[] }`
- `quarantineConfig(): { ok: boolean; id: string | null }` — generate
  `id = String(Date.now())`; for each present `CONFIG_KEY`, copy its value to
  `${RECOVERY_BACKUP_PREFIX}${id}:${key}`, then **remove the live key** (so
  defaults load next boot). Append `{ id, at: new Date().toISOString(), keys }`
  to the index. The copy-before-remove ordering means the value is preserved as
  a renamed key — a move, not a deletion; every byte is recoverable.
- `restoreConfig(id: string): boolean` — read the index entry; for each key,
  write the backed-up value back to the live `CONFIG_KEY`. Returns false if the
  backup id is unknown or any write fails.
- `listBackups(): BackupMeta[]` — parse the index (newest first); `[]` on
  missing/corrupt.
- `exportConfig(): string` — JSON of the current live config keys, with
  `integrations.turso.authToken` and `jira.token` **redacted** to
  `"***REDACTED***"`. Used by the Download button.

Backups are tiny (< 10 KB total) and are **retained, never auto-pruned** — this
honors the "no deletions" requirement. A manual "clear backups" control is out
of scope for v1.

### `src/app/recovery/page.tsx`

Standalone Next App-Router route. AIPM-palette styled (green dominant, dark-blue
headers, no gradients/shadows). Renders its own minimal tree — does **not**
import `TaskManager`. Sections:

- **Config summary (read-only):** storage backend kind, portfolio mode, Turso
  configured (yes/no). Token never displayed.
- **Buttons:**
  - **Download config (JSON)** → `exportConfig()` as a file download.
  - **Reset to clean config** → `quarantineConfig()`, then navigate to `/`
    (clean boot). Confirmation inline ("Data is preserved; config is reset.").
  - **Restore last config** → lists `listBackups()`; restoring writes the chosen
    backup back and navigates to `/`.
- All `localStorage` failures surfaced inline; the page never throws.

### `src/app/error-boundary.tsx`

Top-level React class error boundary wrapping `<TaskManager/>` in `page.tsx`. On
a thrown render error it renders a minimal fallback (no white screen): a short
message plus a **Recover** link to `/recovery` and a **Reset config & reload**
button (calls `quarantineConfig()` then reloads `/`). Documented limitation: it
catches **thrown** errors only, not silent render loops — those are handled by
`?safe=1` / `/recovery` directly.

### `src/app/recovery-banner.tsx`

When `isSafeMode()` is true, renders a sticky banner in the main shell: "Safe
mode — configuration not loaded" plus "Open recovery" (→ `/recovery`) and "Reset
config now" (→ `quarantineConfig()` + reload). Mounted in the app shell where
other banners live.

## Data flow

- **Config brick:** user appends `?safe=1` → app boots clean in memory → banner
  → "Reset config now" (quarantine) → reload clean & persisted → reconfigure.
  Alternatively navigate `/recovery` directly → Reset → back to `/`.
- **Thrown render crash:** error boundary fallback → Recover link → `/recovery`.
- **Undo:** `/recovery` → Restore last config → original config returns.

## Error handling

- Every `localStorage` read/write is `try/catch`-guarded; failures degrade to a
  safe default (read) or an inline error message (write). Nothing throws to the
  React tree from recovery code.
- Restore with no/invalid backup → button disabled / empty state.
- `isSafeMode()` failure (no `window`, parse error) → `false` (normal boot).

## Testing

- `recovery-config.test.ts` — quarantine copies to backup keys AND removes live
  keys; restore round-trips values back; export shape + token/jira redaction;
  `listBackups` ordering + corrupt-index guard; localStorage-disabled guard
  (no throw).
- `safe-mode.test.ts` — flag parsing for `?safe=1`, `?safe`, `#safe`, and
  absent; `useSettings` / `loadPortfolioMode` / `loadCurrentTursoProjectId`
  honor it (return defaults, write nothing). Uses `__resetSafeModeCache()`.
- `recovery-page.test.tsx` — renders summary, buttons fire the right calls,
  token redacted in the summary, Restore lists backups.
- `error-boundary.test.tsx` — a throwing child renders the fallback with a
  Recover link; Reset button calls `quarantineConfig`.

## i18n

New EN + DE keys for the banner, recovery page, and boundary fallback. DE uses
**real umlauts** (the `i18n-encoding` test bans ASCII substitutions).

## Docs

- README: "Emergency recovery" section (how to use `?safe=1` and `/recovery`).
- CHANGELOG entry + `version.ts` bump.

## File summary

**New (6 + tests):** `safe-mode.ts`, `recovery-config.ts`, `recovery/page.tsx`,
`recovery-banner.tsx`, `error-boundary.tsx`, and the four test files.

**Edited:** `use-settings.ts` (honor safe mode in load), `portfolio-mode.ts`
(honor safe mode in both readers), `page.tsx` (wrap `TaskManager` in the error
boundary; mount the banner), `i18n.ts` + `i18n.de.ts` (new keys), README +
CHANGELOG + `version.ts`.

## Out of scope (YAGNI)

- Crash-loop auto-detection (boot counter).
- Resetting UI-layout prefs (`*-size`, `hidden-cols`, sidebar, gantt-prefs).
- Tiered reset severity.
- Manual "clear backups" UI.
