# Convert-and-Write on Storage-Format Switch — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.27.0-storage-convert-switch`
**Context:** Sub-project **B** of the storage rework (A = relational Turso schema, shipped 0.26.0). Today, changing the storage format **loads from** the newly-selected backend and replaces the live workspace. This inverts that: changing the format **converts the live in-memory workspace to the chosen format and writes it to the new backend**, after a confirmation — then switches. Ships as **0.27.0**.

## Goal

Make switching the storage format a **migrate-my-current-data** action rather than an adopt-whatever's-there action: pick a format → confirm → the current workspace is serialized to that format and written to the new backend (overwriting it) → that backend becomes the live one.

## Decisions (from brainstorming)

- **Confirm immediately on select** — picking a different format in the Storage dropdown opens a `window.confirm` (matching the existing `storageConfirmOverwrite` pattern); confirm proceeds, cancel reverts the dropdown.
- **Overwrite target with current** — convert-and-write always overwrites the target with the current workspace (no load-or-merge branch).
- **All formats uniform** — browser / local-json / local-csv / local-md / sp-json / sp-csv / turso are all two-way; **Markdown round-trips** (`markdownToWorkspace` + `LocalFileBackend.load` md branch), so no special-casing and no separate Markdown button.

## Non-goals

- No change to **startup load** — on app open (hydrate), the configured backend is still loaded to restore the persisted workspace. Only **mid-session user-initiated format switches** change behavior.
- No change to `onOpenStorageFile` — the explicit "open a file and load its data" action (pull direction) stays as the way to import data from a file.
- No backend internals change — every backend already has `save(workspace)` that serializes its format; B drives that on switch.
- No load-or-merge / conflict UI (the "overwrite" decision).
- No new storage formats.

## Architecture

The change is concentrated in two files; no new modules, no backend changes.

### `use-storage-backend.ts` — the switch orchestrator

Today the **load effect** (fires when the `backend` memo rebuilds, i.e. when `storageConfig` changes) replaces the live workspace with `backend.load()`. B keeps that for **startup** but routes **user switches** through a new confirmed convert-and-write, and suppresses the load that a config change would otherwise trigger.

- Add `suppressNextLoadRef` (mirrors the existing `suppressNextSaveRef`). The load effect early-returns (without replacing state) when it's set — used right after a confirmed switch so we keep the just-written current data instead of reloading.
- New exported handler:
  ```ts
  async function onRequestStorageSwitch(newKind: StorageKind): Promise<void>
  ```
  Orchestration:
  1. If `newKind === settings.storageConfig.kind` → no-op.
  2. Build the new config (`{ kind: newKind }` for browser/local/turso; sp-* carry their existing `hostname/sitePath/itemPath` from current settings if present, else the storage-config URL flow supplies them) and the target backend via `createBackend(newConfig, deps)`.
  3. `window.confirm(t(lang, "storageConvertConfirm", count, formatLabel))` — e.g. *"Convert your current workspace (42 tasks) to JSON and write it to {target}, overwriting any data there?"*. Cancel → return (dropdown reverts).
  4. Ensure target writable:
     - **local-json/local-csv/local-md:** call the file picker (the confirm-button click is the required user gesture) to choose the destination file — reuse the existing `pickFileForBackend` path.
     - **sp-json/sp-csv:** require M365 signed-in + the file URL configured; if not ready → toast the existing not-ready hint + abort (revert).
     - **turso:** require resolved config; if not ready → not-ready hint + abort.
     - **browser:** always ready.
  5. `await newBackend.save(currentWorkspace)` — convert + write (overwrite).
  6. `suppressNextLoadRef.current = true;` then commit `onChangeSettings({ ...settings, storageConfig: newConfig })`. The backend memo rebuilds; the load effect sees the suppress flag and keeps current data. `refreshBackendStatus()`. Toast `storageConvertedToast`.
  7. On any error (write fails, picker dismissed, not ready) → toast + **do not** change `storageConfig` (stay on the working backend); the dropdown reverts.
- The existing `onPickStorageFile` / `onOpenStorageFile` / `onGrantWriteAccess` are retained unchanged (re-pick file on the current backend; explicit pull-load; permission grant).

### `storage-config.tsx` — the dropdown

- The kind `<select>` `onChange` calls `onRequestStorageSwitch(newKind)` instead of `onChange({ kind })`. The `<select>` stays **controlled** by `config.kind`, so if the switch is cancelled/aborted (config unchanged) the dropdown snaps back to the current value automatically.
- A new prop `onRequestSwitch: (kind: StorageKind) => void` (fire-and-forget; the handler is async internally).
- The existing per-backend UI (local file pick/open buttons, sp URL input, turso/sp gating hints) stays. The sp URL input still commits via its own `onChange` (configuring the target before switching) — unchanged.

### Data flow

```
pick format in dropdown
  -> onRequestStorageSwitch(newKind)
  -> window.confirm(convert+overwrite warning)
      confirm -> [local: pick destination file] -> ensure target ready
              -> newBackend.save(currentWorkspace)            // convert + overwrite
              -> suppressNextLoadRef = true
              -> commit storageConfig = newConfig             // backend switches; load suppressed
              -> toast "Converted & switched to {format}"
      cancel/not-ready/error -> toast (if error) ; storageConfig unchanged ; dropdown reverts
startup (hydrate) -> load configured backend  (UNCHANGED)
```

### Error handling

- **Picker dismissed** (local) → treated as cancel; no change, no error toast (matches existing picker-abort handling).
- **Target not ready** (sp not signed-in / no URL; turso not configured) → the existing not-ready hint toast; abort; dropdown reverts.
- **Write failure** → `storageSaveFailed` toast; `storageConfig` untouched (you remain on the previous working backend); dropdown reverts.
- **Popout windows** never switch storage (single-writer rule) — the control is already read-only / `onRequestStorageSwitch` is a no-op in popouts.

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `storageConvertConfirm` | "Convert your current workspace ({0} tasks) to {1} and write it to this storage, overwriting any data already there?" | "Aktuellen Workspace ({0} Aufgaben) nach {1} konvertieren und in diesen Speicher schreiben? Vorhandene Daten dort werden überschrieben." |
| `storageConvertedToast` | "Converted and switched to {0}." | "Konvertiert und zu {0} gewechselt." |
| `versionHighlightStorageConvert` | "Switching storage format now converts your current data and writes it to the new format (JSON, CSV, Markdown, SharePoint, or Turso) — after a confirmation — instead of loading whatever was there." | "Beim Wechsel des Speicherformats werden jetzt Ihre aktuellen Daten konvertiert und in das neue Format (JSON, CSV, Markdown, SharePoint oder Turso) geschrieben – nach einer Bestätigung – statt vorhandene Daten zu laden." |

(`{1}` is the human format label, reusing the existing `storageBrowser`/`storageLocalJson`/… labels. Existing `storageNotReady`/`storagePermissionGestureNeeded`/`storageSaveFailed` toasts are reused for the abort/error paths.)

## Testing

- **`use-storage-backend` switch logic** (extract `onRequestStorageSwitch` so it's testable, or test via the hook): mock `window.confirm`, `createBackend`, and a fake backend.
  - Confirm=true, target ready → calls `newBackend.save(currentWorkspace)`, commits `storageConfig`, sets the suppress flag, toasts converted. The load effect does **not** replace data afterward.
  - Confirm=false → no save, no config change.
  - Target not ready (save throws `StorageNotReadyError`) → no config change, not-ready toast, dropdown effectively reverts.
  - Write failure → no config change, error toast.
  - Switching to the same kind → no-op (no confirm).
- **`storage-config.test.tsx`**: changing the `<select>` calls `onRequestSwitch(kind)` (not `onChange`); the select is controlled by `config.kind` (renders the current kind; reverts when config unchanged).
- **Startup unchanged:** existing load-on-hydrate tests still pass.
- Gates: tsc 0, lint 0, full suite green.

## Release

Minor → **0.27.0**. `version.ts` bump + top comment + append `"versionHighlightStorageConvert"` to `APP_HIGHLIGHT_KEYS`. i18n EN/DE. `CHANGELOG.md` `[0.27.0]` — Changed (switching storage format converts current data and writes it to the new backend after confirmation, overwriting the target; replaces load-on-switch; all formats incl. Markdown two-way). No new deps.

## Plan shape (preview — `writing-plans` expands)

1. `use-storage-backend.ts`: add `suppressNextLoadRef` + load-effect guard; add `onRequestStorageSwitch(newKind)` (confirm → ready-check/file-pick → save current → suppress-load → commit config → toast; revert on cancel/error). Tests.
2. `storage-config.tsx`: dropdown `onChange` → `onRequestSwitch`; add prop; controlled-select revert. Tests.
3. Wire `onRequestSwitch` from the settings/storage container down to `StorageConfigSection`.
4. i18n EN + DE.
5. Release 0.27.0.

## What this closes

After 0.27.0, switching storage format migrates the current workspace into the chosen format (with a confirm) rather than replacing it with the target's contents — completing the two-part storage rework (A relational Turso + B convert-on-switch).
