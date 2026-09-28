# Storage — the facade, the backends, load, save, recovery and reset

Owns the storage layer: the `createBackend` facade (`storage.ts`), the four backend classes
behind it, the codec layer they share, the load and save effects in `use-storage-backend.ts`,
the decode diagnostics that pause saving, the debounced save and its flush-on-hide, the §629
unload journal, the `/recovery` page with its safe-mode banner, and the factory reset.

Does NOT own, and links rather than restates:
- the load hold, `loadPending` and the scope epoch — [`platform.md`](platform.md#the-load-hold-548);
- how `documents` / `documentVersions` ride the write paths —
  [`documents.md`](documents.md#persistence--six-write-paths);
- the activity log's meta-blob persistence and `logMode` —
  [`activity-log.md`](activity-log.md);
- five [`AGENTS.md`](../../AGENTS.md) "Hard constraints" bullets, which stay there because that
  file is always loaded: **New persisted `Workspace` field → SIX write paths**, **New COLUMN on
  existing entity**, **New Turso table NOT workspace data** (with its `idKind` half), **Secrets at
  rest**, and **App config vs project data (reset/clear boundary)**. Also its **Turso-gated
  features** and **Storage namespace** bullets.

One fact, one doc.

★★★ **A LOAD THAT COULD NOT READ EVERYTHING PAUSES SAVING, AND "SAVE ANYWAY" IS WHAT DELETES
THE UNREADABLE DATA.** Every backend overwrites what it stores on save, so a slice the load
dropped is gone once the next save lands. The pause is the only thing between the two. See
"Decode diagnostics" before changing any decoder or any backend's `load`.

## Module map

All paths are under `src/app/`. Most rows reproduce with `ls src/app | grep -v test | grep -E
"^(storage|browser-backend|idb|local-file|fs-access|sharepoint-backend|turso-|debounced-save|unload-journal|use-unload-journal|recovery|app-reset|meta-slice-decode|use-load-truncation)"`; `workspace.ts`,
`use-storage-backend.ts`, `save-guard.ts`, `safe-mode.ts` and the codec files are named by hand, and the grep also
lists a few UI files (`storage-config.tsx`, `turso-project-picker.tsx`) this table leaves out.

| Module | What it does |
|---|---|
| `storage.ts` | The facade: `createBackend` maps a `StorageConfig` kind to a backend, plus the file pick/open/handle helpers. Re-exports `workspace.ts`, `fs-access.ts`, the two codec barrels and the browser and local-file backends. |
| `workspace.ts` | The `Workspace` type, the `migrateWorkspaceV5`…`V10` chain, `StorageKind` / `StorageConfig`, the `StorageBackend` interface, and the JSON codec `workspaceToJson` / `jsonToWorkspace`. |
| `browser-backend.ts` | `BrowserBackend`, kind `browser` (the default, `defaultStorageConfig`). IndexedDB record stores for the id-keyed entities plus KV slots for the rest; saves diff against an in-memory baseline. |
| `idb.ts` | IndexedDB open/upgrade and the store and KV key constants. Database name `aipm-cockpit` (`grep -n "IDB_NAME =" src/app/idb.ts`). |
| `local-file-backend.ts` | `LocalFileBackend`, kinds `local-json` / `local-csv` / `local-md`, through the File System Access API. Keeps the picked handle in the IDB kv store. |
| `fs-access.ts` | Pickers, permission checks, `readHandle` / `writeHandle`. |
| `sharepoint-backend.ts` | `SharePointBackend`, kinds `sp-json` and `sp-csv` only; there is no SharePoint Markdown kind (`grep -n '"sp-' src/app/workspace.ts`). Graph GET/PUT with a caller-supplied token. |
| `turso-backend.ts` | `TursoBackend`: single-tenant when constructed without a project id, multi-tenant (one `project_id` slice of a shared DB) with one. |
| `turso-schema.ts` | Single-tenant relational mapping: `ENTITY_SPECS`, `TABLE_NAMES`, `workspaceToStatements`, `dirtyWorkspaceTables`, `rowsToWorkspace` (the load decoder for BOTH layouts). |
| `turso-tenant-schema.ts` | Multi-tenant DDL and statements (`tenantSchemaDdl`, `tenantWorkspaceToStatements`), built from the same `ENTITY_SPECS`. |
| `turso-migrate.ts` | The column self-heal: PRAGMA diff, then `ALTER … RENAME COLUMN` / `ADD COLUMN`. |
| `turso-pipeline.ts` | `runTursoPipeline`, the HTTP `/v2/pipeline` transport shared by the backend and the non-workspace stores; `testTursoConnection`. |
| `turso-portfolio.ts` | The multi-tenant project list and project create/archive/restore/delete. |
| `turso-config.ts` | Resolves the Turso URL and token (env or settings). |
| `storage-error.ts` · `storage-target-key.ts` | Error-to-banner classification (`tursoErrorKind`); `storageTargetKey`, the "which stored project" identity (§591). |
| `csv-codecs*.ts` · `markdown-codecs*.ts` | CSV and Markdown codecs. `workspaceToCsv` (`csv-codecs-config.ts`), `csvToWorkspace` (`csv-codecs-decode.ts`), `workspaceToMarkdown` (`markdown-codecs-core.ts`), `markdownToWorkspace` (`markdown-codecs-decode.ts`). The entity columns and row codecs in `csv-codecs-core.ts` are reused by both Turso layouts. |
| `meta-slice-decode.ts` | The decode-failure helpers every decoder shares: `noteDecodeFailure`, `sanitizedToNothing`, `noteIfSanitizedToNothing`, `decodeMetaJson`. |
| `use-storage-backend.ts` | `useStorageBackend`: builds the backend, runs the load effect and the save effect, `reloadCurrentProject`, and hands `applyWorkspaceForOp` to the project-op hooks `use-storage-file-ops.ts` and `use-storage-turso-ops.ts`. |
| `use-load-truncation.ts` | `useLoadTruncation`: the three incomplete-load causes and the save pause they raise. |
| `save-guard.ts` | `evaluateSaveGuard`, the full-wipe / mass-deletion refusal. |
| `debounced-save.ts` | `scheduleDebouncedSave`, `SAVE_DEBOUNCE_MS`, the `pageHiding` flag and `isPageHiding`. |
| `unload-journal.ts` · `use-unload-journal.ts` | §629: the journal record, key and fingerprint; and the hook that decides when it is written, cleared and restored. |
| `recovery/page.tsx` · `recovery-client.tsx` · `recovery-panel.tsx` | The `/recovery` route, mounted client-only. |
| `recovery-banner.tsx` · `recovery-banner-client.tsx` · `safe-mode.ts` | The safe-mode banner on the home route and the `?safe` flag. |
| `recovery-config.ts` | `CONFIG_KEYS`, `quarantineConfig`, `restoreConfig`, `listBackups`, `exportConfig`. |
| `app-reset.ts` | `clearAppConfig` and `resetAppToCleanSlate`, the factory reset. |

★ `m365-sharepoint.ts` and `sharepoint-graph.ts` are NOT part of the storage backend, despite
the names. They serve the SharePoint browse picker and knowledge links; `sharepoint-backend.ts`
imports neither (`grep -n "^import" src/app/sharepoint-backend.ts`).

## Load path

**Two load funnels.** Every backend's load, `reloadCurrentProject` and every project op fan a
workspace into React state through `applyWorkspaceFromLoad` (`use-storage-backend.ts`); the ops
reach it through `applyWorkspaceForOp`, which also bumps the scope epoch. The Turso version-history
restore is the second funnel, `applyRestoredWorkspace` (`task-manager.tsx`), which does not go
through the first. The docstring on `backfillTaskResourceFks` (`resource-foundation.ts`) names both
and says a third funnel must call it too. ★ That docstring and several comments call the first
funnel `applyWorkspace`. That name survives as a deps FIELD in two places, one per funnel: the op
hooks' `applyWorkspace` (`grep -n "applyWorkspace:" src/app/use-storage-file-ops.ts`) and
`useVersionHistory`'s optional `applyWorkspace`, which `task-manager.tsx` fills with
`applyRestoredWorkspace` — the SECOND funnel (`grep -n "applyWorkspace?:" src/app/use-version-history.ts`).
Read which one a mention means before relying on it.

**The load effect** (`useEffect` on `[backend, args.hydrated]` in `use-storage-backend.ts`), in order:
1. A project op that armed `suppressNextLoadRef` already applied its workspace: the effect
   re-stamps the backend, reopens the save gate and returns without loading.
2. `backend.load()`. A throw leaves saves paused with reason `"load-failed"` and a sticky
   banner (§586).
3. An EMPTY load over a non-empty live workspace is refused: nothing is applied, saves stay
   paused with reason `"empty-refused"` (§587), and `raiseDecodeFailuresFor` still publishes any
   decode failure of that load.
4. Otherwise the journal restore runs (see "Save path"), then `applyWorkspaceFromLoad`, then
   `truncationOps.reportFor(backend)`, which raises or lowers the incomplete-load pause.

`applyWorkspaceFromLoad` takes a `logMode` that defaults to `"replace"`; `activity-log.md` owns
why, and why the load effect asks `resolveLogModeAndStamp` instead.

### Decode diagnostics — "Saving paused" / "Save anyway"

`StorageBackend` carries optional per-load diagnostics. Three of them pause saving; read
`lastLoadWasIncomplete` (`use-load-truncation.ts`) for the exact test:
- `lastLoadTruncation` — entries and blocks the document caps discarded;
- `lastDecodeFailures` — meta slices the load could not keep;
- `lastImportMalformedQuotes` — CSV quoting violations.

`lastDecodeFailures` is filled from the decode accumulator's `decodeFailedSlices`, and all four
backends publish it (`grep -rn "lastDecodeFailures = " src/app --include=*.ts | grep -v test`).
A key lands there when a stored slice **throws** on parse or sanitize, or when it **carried
content but sanitized to nothing** (`sanitizedToNothing`, the §617 rule). A stored `[]`, `{}` or
Simple-mode `features: []` carries no content and stays silent. `reportDecodeFailures` then shows
the `documentsUnreadableWarning` toast and raises the `storageSavingPaused` banner; the banner's
"Save anyway" (`documentsTruncatedSaveAnyway`, wired in `notifications.tsx`) calls
`allowIncompleteSave`, and the next save writes the workspace WITHOUT the unreadable slice.

Per path, verified in the code (register §617, §620, §630):

| Load path | Decoder | What records a failure |
|---|---|---|
| Turso relational (both layouts) | `rowsToWorkspace` → local `decodeMeta`, 13 slices (`grep -c 'decodeMeta("' src/app/turso-schema.ts`) | `reportUnreadableSlice`: `logDiag` + `noteDecodeFailure` |
| Turso single-tenant legacy blob | `jsonToWorkspace(blob, { diag })`, NON-strict | as JSON non-strict, below |
| IndexedDB | `BrowserBackend.load`, 12 keys via `noteIfDropped` (`grep -c 'noteIfDropped("' src/app/browser-backend.ts`); `status` is not sanitized there (§470) | a documents or versions throw: `logDiag` + `noteDecodeFailure` |
| JSON file, SharePoint JSON | `jsonToWorkspace(text, { strict: true, diag })` (`grep -rn "strict: true, diag" src/app`) | sanitized-to-nothing: 13 keys via `noteIfDropped`; a documents or versions THROW: `logDiag` + `noteDecodeFailure` (§635, below) |
| CSV / Markdown file, SharePoint CSV | `csvToWorkspace` / `markdownToWorkspace` → `decodeMetaJson` per slice | `noteDecodeFailure` only, no `logDiag` (`grep -n logDiag src/app/meta-slice-decode.ts` prints nothing) |

★★ **`strict` stays loud only without an accumulator (§635).** `jsonToWorkspace`'s documents and
`documentVersions` blocks catch a rich-field throw and rethrow it only when `strict` is set AND no
`diag` was passed (`grep -n "strict && !opts?.diag" src/app/workspace.ts`); the outer catch then
turns it into `WorkspaceParseError`. The local JSON file and SharePoint JSON pass both, so the throw
is recorded and pauses saving like on every other path. Callers with no `diag` — the sample
generator, demo data, native import and version-history restore — still fail loudly, which is
why `strict` exists. Before §635 the two file backends failed the whole load instead.

★★ **Browser versus no DOM.** `logDiag` returns at once when `typeof window === "undefined"`
(`grep -n 'typeof window' src/app/diagnostics.ts`), so outside a browser every "logged" cell above
logs nothing, and `noteDecodeFailure` is a no-op without a `diag`. In the browser both run, and the
slice key reaches the pause. The documents rich-field pass needs DOMPurify, so its throw is the
no-DOM case in practice; register §624 tracks the scripts that reach it without a DOM.

★ Partial loss stays silent on every path. A slice whose sanitizer keeps some entries is not
reported; `steeringCommittee` and `timelogLinks` always sanitize to an object with fixed keys, so
`sanitizedToNothing` never fires for them (§620's "Limit"). A CSV section with no `config` row or
a Markdown fence the decoder's regex misses reads as absent (§630's "Known limits").

## Save path

**The save effect** (`use-storage-backend.ts`) re-runs on every slice change. It returns early,
in order: before hydration; in a popout (a popout never saves); while the save gate is shut for
this backend (also before any load has succeeded, silently; for `"load-failed"` / `"empty-refused"`
it toasts once); on the one render a load just
applied (`suppressNextSaveRef`, which resyncs the destructive-guard baselines); while an incomplete
load holds (`mayCommitAfterIncompleteLoad`); and when `evaluateSaveGuard` (`save-guard.ts`) refuses
a full wipe or a mass deletion. Past all of them it builds `doSave` and hands it to
`scheduleDebouncedSave(doSave, SAVE_DEBOUNCE_MS, …)`. `doSave` checks the save gate once more,
then calls `backend.save`.

**Debounce and flush** (`debounced-save.ts`). `SAVE_DEBOUNCE_MS` is 500 (`grep -n
"SAVE_DEBOUNCE_MS = " src/app/debounced-save.ts`). A pending save flushes early on
`visibilitychange` → hidden and on `pagehide`. `pageHiding` is set by a capture `pagehide` listener
registered at module load and cleared on `pageshow`; while it is true, `scheduleDebouncedSave`
starts a save AT ONCE, because nothing later will flush it (§185). Those saves come from drafts
committed on `pagehide` through `useCommitOnPageHide`. A cleanup flushes only when its third
argument returns `true`; the save effect passes "the backend changed" (§589).

★★★ **Starting a save at `pagehide` does not make it land.** Every backend's save is asynchronous.
Register §629 measured IndexedDB in Chromium losing such a save on a real reload; the unload
journal exists because of that.

### The unload journal (§629)

A synchronous localStorage copy of the unconfirmed outgoing workspace:
- **Key** `UNLOAD_JOURNAL_PREFIX` + a project key from `journalProjectKey` (the Turso project id,
  else `"turso"`; otherwise the registry's current project id, else `"browser"`). It never carries
  a credential.
- **Record** `{ v, projectKey, tabId, savedAt, baseFingerprint, workspace }`, where `workspace` is
  `workspaceToJson` of the outgoing state. A record over `UNLOAD_JOURNAL_MAX_CHARS` is not written.
- **Written** by `noteSaveStarted` (called from `doSave`, past every guard) when the page is hiding
  or hidden, and by the hook's own `pagehide` listener for the latest unconfirmed save.
- **Cleared** by `noteSaveConfirmed` in the save's `.then`, for this tab's record of that save or
  an older one; by `dropUnconfirmed` from "Reload project" and the picker's "load the file
  instead".
- **On load**, `restoreOnLoad` runs only in the load effect, after the failed-load and
  empty-refusal returns, and not at all when `lastLoadWasIncomplete` is true. A journal whose
  content fingerprints as the loaded workspace is cleared silently (its save landed). A journal
  whose `baseFingerprint` equals the loaded one is applied and saved back through every guard.
  Anything else raises the `unloadJournalConflict` notice: Restore anyway (`restoreConflict`, from
  an in-memory copy) or Discard (`discardConflict`).
- A popout never journals or restores.

★★ **What is verified, exactly as the register says.** §629 is MEASURED only on Chromium with
IndexedDB (`e2e/pagehide-draft-persist.spec.ts`). The packaged desktop window close and real-browser
runs of the file, SharePoint and Turso backends are "never machine-verified". §629 also records a
known loop: a restore that is a mass deletion is refused by the guard, and a page reload re-applies
it. Read §629 before touching either file.

★ The journal key starts `aipm-cockpit:`, so the factory reset's prefix sweep deletes any pending
journal (`grep -n "UNLOAD_JOURNAL_PREFIX =" src/app/unload-journal.ts`).

### Concurrency

- **Turso** saves run inside `withWriteLock`: an exclusive cross-tab Web Lock per database and
  project, bounded by a wait timeout that fails with `TursoLockTimeoutError`. Where
  `navigator.locks` is missing (or no config is set) it runs the save UNLOCKED
  (`grep -n "if (!locks || !this.config) return fn();" src/app/turso-backend.ts`).
- **Local file and SharePoint** saves are NOT serialised (§627, open): several `pagehide` commits
  can start overlapping full saves, and an older snapshot that finishes last overwrites a newer
  one. The journal covers the reload case; the in-session race is unchanged. The register states
  the race "was never machine-verified".
- **IndexedDB** orders its transactions (§627).

## The six write paths

The rule and its warnings live in `AGENTS.md` **New persisted `Workspace` field → SIX write
paths**. Who writes what:

| Path | Entity collections | Meta-blob slices |
|---|---|---|
| JSON (`local-json`) | `workspaceToJson` | `workspaceToJson` (one key per slice) |
| JSON (`sp-json`) | `workspaceToJson` in `SharePointBackend.save` (§634; it used `JSON.stringify` before) | same |
| CSV (`local-csv`, `sp-csv`) | `workspaceToCsv`: one hand-written section per entity, rows from the `csv-codecs-core.ts` column codecs | `workspaceToCsv` config sections (`csv-codecs-config.ts`) |
| Markdown (`local-md`) | `workspaceToMarkdown` | `workspaceToMarkdown` fenced JSON blocks |
| Turso single-tenant | `workspaceToStatements`, one table per `ENTITY_SPECS` row | rows of the `meta` table, same function |
| Turso multi-tenant | `tenantWorkspaceToStatements`, same specs plus `project_id` | `meta` rows scoped by `project_id` |
| IndexedDB | `BrowserBackend.save`: record stores (`idbBulkUpdate`) for tasks, RAID, absences, shifts, resources, roles, disciplines, grades and budgets; KV slots (`idbSet`) for milestones, changes, stakeholders, calendar events and document assets | KV slots |

That is seven rows for six paths: both JSON rows are "JSON". ★ An `ENTITY_SPECS` row buys both
Turso layouts, which iterate the specs; the CSV and Markdown sections are hand-written per entity
(`grep -rn "ENTITY_SPECS" src/app/csv-codecs*.ts src/app/markdown-codecs*.ts` finds one comment
and no code). What CSV and Turso share is the column list and row codec the spec reuses.

## Turso

Kept short: `AGENTS.md` owns each rule.
- **`TABLE_NAMES`** is `ENTITY_SPECS` tables plus `plan`, `fx_rates` and `meta`, and a save
  emits `DELETE FROM` for every dirty one. Non-workspace tables (snapshots, version history,
  chat threads, templates, …) stay out, or a workspace save would wipe them. Each such store pins
  that with its own test: `grep -rln "TABLE_NAMES).not.toContain" src/app`. Rule: **New Turso table
  NOT workspace data**.
- **`idKind`**: a spec with a string id must declare `idKind: "text"`; one does today (`grep -n
  'idKind: "' src/app/turso-schema.ts`). Same bullet.
- **Self-heal**: `ensureColumns` runs once per backend instance (retried after a failure, which
  clears the memo), inside the write lock, before
  the save pipeline — a PRAGMA read, then renames (`columnRenameAlters`) before adds, in one
  `BEGIN`…`COMMIT`. Rule: **New COLUMN on existing entity**.
- **Partial saves**: `dirtyWorkspaceTables` diffs against the last saved workspace by reference;
  any meta slice change rewrites the whole `meta` table.
- **Batch commit**: `runTursoPipeline` scans the results, calls `rollbackBestEffort` for a
  transactional batch, then throws. `AGENTS.md`'s `idKind` bullet records that the batch has
  already committed by then, measured, so the ROLLBACK normally changes nothing (§636); making a
  failed save write nothing is §637.

## Recovery and reset

**Safe mode.** Loading the app with `?safe` (or `#safe`) makes `isSafeMode` true. The config
readers then return defaults in memory and write nothing (`safe-mode.ts` header;
`grep -rn "isSafeMode()" src/app --include=*.ts --include=*.tsx | grep -v test`). The home route
mounts `RecoveryBannerClient`, which renders only in safe mode, with a link to `/recovery` and a
"reset now" button that calls `quarantineConfig` and reloads `/`.

**`/recovery`** mounts `RecoveryPanel` client-only (`ssr: false`), so it works when the app is
bricked. It probes localStorage, summarises the config, and offers reset (`quarantineConfig`),
restore of the newest backup (`restoreConfig`), a config download (`exportConfig`, secrets
redacted) and the diagnostics panel.

**`CONFIG_KEYS`** are the three keys that can brick the app: settings, portfolio mode and the
current Turso project (`grep -n "CONFIG_KEYS =" src/app/recovery-config.ts`). Quarantine COPIES
each to a timestamped backup key, indexes it, then removes the live key: a move, never a delete.

**Factory reset.** `resetAppToCleanSlate` (Settings → General) calls `clearAppConfig` and
reloads. `clearAppConfig` removes every `aipm-cockpit:*` localStorage key and fire-and-forget
deletes the two config IndexedDB databases, `aipm-cockpit-secrets` and
`aipm-cockpit-project-handles` (`grep -n "CONFIG_DBS" src/app/app-reset.ts`). It never deletes the
workspace database `aipm-cockpit`, files or Turso data. Rule: `AGENTS.md` **App config vs project
data (reset/clear boundary)**.

## Follow-ups found while writing this page

Filed in `docs/open-followups.md` on 2026-09-28. The first three are closed on
`fix/storage-followups`; the fourth is open.
- **§634** — SharePoint JSON was saved with `JSON.stringify`, so it had no `schemaVersion`.
- **§635** — a documents rich-field throw failed the whole strict JSON load instead of pausing
  saving.
- **§636** — the comment above `rollbackBestEffort` said the ROLLBACK protects readers.
- **§637** (open) — a Turso save whose batch hits a failing statement still commits the rest.
