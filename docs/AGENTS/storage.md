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
  [`activity-log.md`](activity-log.md), including the §510 internal audit download in Settings → Storage
  (expert mode), the one read of the stored logs that is not a load: on a multi-project Turso database it
  SELECTs every project's `activityLog` `meta` row (`readPortfolioActivityLogs`), changes no data, and is
  NOT access control;
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
| `workspace.ts` | The `Workspace` type, the `migrateWorkspaceV5`…`V10` chain, `StorageKind`, the `StorageBackend` interface, and the JSON codec `workspaceToJson` / `jsonToWorkspace`. Re-exports `StorageConfig` and `defaultStorageConfig`, which live in the import-free leaf `storage-config-kind.ts` (§92). |
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
   decode failure of that load. The incoming workspace counts as empty when it holds nothing the
   user made (`hasAuthoredRecords`, §601: the seeded preset lists do not count), while the
   workspace in scope still counts as populated by `isWorkspaceEmpty`.
   Reload project uses the same two predicates but asks (`reloadEmptyConfirm`) instead of
   refusing: confirming replaces the project; declining keeps it and still publishes that load's
   decode failures (`raiseDecodeFailuresFor`).
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
| IndexedDB | `BrowserBackend.load`, 12 keys via `noteIfDropped` (`grep -c 'noteIfDropped("' src/app/browser-backend.ts`); `status` is read verbatim there (`status = idbStatus ?? {}`), unsanitized, and no register entry owns it | a documents or versions throw: `logDiag` + `noteDecodeFailure` |
| JSON file, SharePoint JSON | `jsonToWorkspace(text, { strict: true, diag })` (`grep -rn "strict: true, diag" src/app | grep -v test`) | sanitized-to-nothing: 13 keys via `noteIfDropped`; a documents or versions THROW: `logDiag` + `noteDecodeFailure` (§635, below) |
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
- **Journals under other keys (§632).** Once per page, after the first load has applied, journals
  under other keys that are older than 30 days (`UNLOAD_JOURNAL_MAX_AGE_MS`) are removed and announced
  in `ExpiredJournalsBanner`, which still offers each one for download until it is closed. The rest are
  listed in `OtherJournalsBanner` (both in `notifications.tsx`) with Download (the record's workspace
  JSON, which the Step 0 import reads) and Discard. The key in scope is never expired, and the list
  leaves out a key whose restore already ran on this page and records this page wrote itself
  (`use-other-journals.ts`).

★★ **What is verified, exactly as the register says.** §629 is MEASURED only on Chromium with
IndexedDB (`e2e/pagehide-draft-persist.spec.ts`). The packaged desktop window close and real-browser
runs of the file, SharePoint and Turso backends are "never machine-verified". §629 also records a
known loop: a restore that is a mass deletion is refused by the guard, and a page reload re-applies
it. Read §629 before touching either file.

★ The journal key starts `aipm-cockpit:`, so the factory reset's prefix sweep deletes any pending
journal (`grep -n "UNLOAD_JOURNAL_PREFIX =" src/app/unload-journal.ts`).

### Pending edits (§626)

The unload journal holds workspaces; `pending-edits.ts` holds the drafts of the three Turso-only
async editors that a workspace save never carries: a chat thread rename, a template name and a
template body.
- **What.** `{ v, kind, id, base, value, savedAt }` per edit, where `base` is the last value the
  server CONFIRMED (loaded, or a save that landed), never the optimistic one on screen.
- **Scope.** One key per scope: `PENDING_EDITS_PREFIX` + a hash of the Turso `httpUrl`
  (`hashForStorageKey`) + `:chat:<projectId>` or `:templates`. Neither the URL nor the token is in the
  key or the record.
- **When.** Live edits stay in memory until `pagehide`, which writes each touched scope with one
  synchronous `setItem`, merged with what other tabs stored: only entries this tab tracked or
  settled are replaced. An edit is settled when its save lands with the same value.
- **Replay.** After a successful load of that project (or the templates), once per scope per page
  lifetime: an edit younger than `UNLOAD_JOURNAL_MAX_AGE_MS` is re-applied through the normal
  commit only when the stored value still equals `base`; otherwise it is dropped and logged
  (`storage.pendingEditDropped`, `reason` `missing` or `changed`, kind and id only).
- The speech-to-text key is not in the outbox: `dictation-section.tsx` seals it on every change.
- ★ Proven in jsdom only: that the write happens inside `pagehide`, not that a real browser keeps
  it across a close.

### Concurrency

- **Turso** saves run inside `withWriteLock`: an exclusive cross-tab Web Lock per database and
  project, bounded by a wait timeout that fails with `TursoLockTimeoutError`. Where
  `navigator.locks` is missing (or no config is set) it runs the save UNLOCKED
  (`grep -n "if (!locks || !this.config) return fn();" src/app/turso-backend.ts`).
- **Every full save to one backend** (autosave, the pre-switch flush, `guardedWrite`) goes through
  `enqueueSave` (`save-queue.ts`, §627): one at a time, a newer save replacing a waiting one, and a
  stalled save released after `SAVE_STALL_MS` (30 s). Before, several `pagehide` commits could
  start overlapping full saves on a local file or SharePoint, and an older snapshot that finished
  last overwrote a newer one.
- **Reads wait for queued saves (§641).** `reloadCurrentProject` and the picker's load-instead
  branch wait for `whenSaved(backend)` (`save-queue.ts`) before reading or re-binding. The reload
  reads again, at most twice more (`RELOAD_REREAD_LIMIT`), if a save started while it read. If the
  backend was replaced while it waited (`isSupersededBackend`), the read is skipped and the §588
  guard drops the click.
- **IndexedDB** orders its transactions (§627).

### Conflicts (§4, §645)

Two windows, tabs or devices that write the same storage no longer overwrite each other silently.
Each backend instance remembers the revision it last loaded or wrote (`revision()` on
`StorageBackend`, `workspace.ts`). A save whose stored revision has moved throws
`SaveConflictError` (`storage-error.ts`) and writes nothing.

| Storage | Revision | Checked |
|---|---|---|
| Browser storage | an integer in the `kv` store, key `"revision"` | inside ONE readwrite IndexedDB transaction over `kv` and every record store (`idbTransaction`, `idb.ts`): read, compare, write, bump, then an explicit `commit()`. No Web Lock: readwrite transactions over the same stores run one at a time across tabs, which keeps the compare-and-set atomic; and a closing tab's pagehide save must not wait for a lock (below) |
| Local file (`local-*`) | `${lastModified}:${size}` of the bound file | under the Web Lock `aipm-cockpit:save:<kind>`: re-read the file and compare |
| SharePoint (`sp-*`) | the driveItem eTag | by Graph: the upload carries `If-Match`, and a create after a 404 load carries `conflictBehavior=fail`; 409 and 412 map to `SaveConflictError` |
| Turso (single and tenant) | a `meta` row, key `REVISION_KEY` (per `project_id` in tenant) | inside the §637 conditional batch: `withRevision` puts `revisionGuardStatement` after `BEGIN` and the DDL, before the data statements (none when the save is blind), which raises an SQL error on a mismatch, so every later step is skipped and the batch rolls back |

- **The close-time save (browser storage, §4 round 7).** A save started by a CLOSING tab's pagehide
  flush must request its IndexedDB work at once and commit it explicitly. Measured in Chromium
  (`e2e/pagehide-draft-persist.spec.ts`, "a tab close whose own IndexedDB write also landed"): a Web
  Lock wait, or a revision read in a transaction of its own, in front of the writes lost the save; and
  a transaction left to auto-commit did not commit at the close once it wrote more than one store,
  while `tx.commit()` right after the last write lands it. So `BrowserBackend.save` opens one
  connection in the caller's turn, runs everything in one transaction and commits it. Three known
  limits, each recovered by the unload journal rather than by IndexedDB:
  - (a) A local-file save that has to wait on its Web Lock (`withSaveLock`) at tab close is lost, by the
    browser-storage measurement above that a lock wait loses the close-time save. That is unverified for
    files: no e2e closes a tab on a local-file project.
  - (b) A pagehide save queued behind a save that is already running (`save-queue.ts`) starts in a later
    task and is lost the same way.
  - (c) The load's `migrateWorkspaceV10` backfill writes (`idbBulkUpdate` in `BrowserBackend.load`) skip
    the revision, so they are neither checked nor bumped. This predates the branch.
- **Fail closed.** An instance that knows no revision (never loaded, or its load failed) refuses
  its first save. The one exception is a SharePoint file loaded without an eTag, which saves without
  `If-Match` as before. A SharePoint PUT whose response carries no eTag (the `ETag` header is not
  CORS-exposed) reads the stored one with a metadata GET; if that fails too, the next save refuses. A Turso conflict is recognised by WHICH step failed (`isRevisionGuard`),
  never by the error text.
- **Hand-over.** A project op (switch, open, create, demo, conversion) loads or writes through an
  instance of its own and then points the app at that target, and the live instance skips its load.
  The op stores its instance in `handOverFromRef` (seven sites: five in `use-storage-file-ops.ts`,
  two in `use-storage-turso-ops.ts`, `grep -n "handOverFromRef.current = " src/app/use-storage-*-ops.ts`),
  and the live instance takes it over through `handOverRevision` (`storage-handover.ts`): `adoptFrom`
  for the same class, else `adoptRevision`. Without this the live instance would refuse its first save.
- **§645, a handle per window.** `LocalFileBackend` keeps the handle it was bound with
  (`boundHandle`: taken from the shared slot `file-handle:<kind>` the first time it needs one,
  replaced only by its own `setHandle` or a pick) and writes to it; the slot only tells a newly
  created instance which file to open, and with which tab-sync binding (below). So another tab's
  project switch cannot redirect this window's save.
  `adoptFrom` carries the bound handle across the hand-over.
- **Sync scope per storage.** A main window mirrors only windows whose `syncScopeKey`
  (`sync-scope.ts`) equals its own. A local file is keyed by the file the WINDOW is bound to
  (`fileBinding`, final review C1). The binding is stored WITH the handle: the shared slot
  `file-handle:<kind>` holds `{ handle, binding }`, and every binder names one, through
  `setBackendFileHandle` or `pickFileForBackend`: a project op (switch, create, open-project) its
  registry id, and a pick, an open or a conversion a fresh `picked:<uuid>`. The op also sets the
  window's own binding in the same tick. A window reads its instance's binding
  (`LocalFileBackend.fileBinding`) ONLY where a load of it is APPLIED: the load effect's success
  path and "Reload project"; never the registry's current project. A window whose screen does not
  show the file's content must not share the file's key (re-review 4 RI4): a load REFUSED as empty
  keeps the previous content, and a load that FAILED keeps the boot workspace or the previous
  project, so both set the binding to unknown; the write-access grant loads nothing, so it binds
  nothing either, and "Reload project" gives the binding once it has applied the file (not when its empty-load confirm is declined, which keeps the previous content). An old slot holding a BARE handle (written before
  the binding was stored, or by a tab still on old code) is upgraded by the first load that reads
  it: written back as a record with the id of the registered project whose stored handle is the
  same file (`isSameEntry`), else a fresh `picked:<uuid>`; the slot is read again just before the
  write, and a record another tab wrote meanwhile is adopted. ★★ An UNKNOWN binding is never the
  kind alone: it keys on a token of the window's own (`isolationToken`, `use-workspace-sync.ts`),
  so that window syncs with NOBODY, which errs toward a visible pause, never toward mirroring
  another file. So local-file windows on different files neither mirror nor adopt each other, and
  windows on one file do once each knows the same binding.
  ★ Where that isolation, or two bindings for one file, gives a FALSE PAUSE (visible, no loss): a
  load that failed (until "Reload project" applies one); a refused empty load
  (above); picking or opening the file a REGISTERED project already uses (the picker gets a
  `picked:` binding while that project's windows hold its id); two windows that each picked the same
  file on their own (two `picked:` ids); two tabs booting on one bare slot at the same moment (both
  still find it bare on the re-read, both write, the later write wins, and the earlier tab stays
  isolated until it reloads); and tabs still running old code, which write bare handles again (their
  own windows mirror on the kind alone among themselves; a new window upgrades the slot afresh and
  so does not share a binding with the windows that upgraded it before). Browser storage is
  still ONE store per origin (`new BrowserBackend()` takes no project) and is keyed by the kind
  alone: browser windows showing different registry projects mirror each other's slices, adopt
  each other's revisions and converge on one workspace. The revision check pauses only a writer
  that is not mirroring: its epoch differs, it is already paused, or it edited a part the peer also
  changed within one delivery (a contested part, below).
- **Tab sync.** All 29 workspace slices are mirrored (`useBroadcastSync`, one call each in
  `use-workspace-sync.ts`, which `useStorageBackend` calls). After an autosave or the pre-switch
  flush lands, `postRevision` sends the new revision and the one it replaced over `aipm-cockpit:sync`.
  ★ `guardedWrite` and the project-creating file ops do NOT post, deliberately (§656). A main window on the same scope and epoch
  (`useRevisionSync`) adopts it when its own base equals the sender's base and nothing is queued for
  its backend (`whenSaved` is `null`). ★★ With a save of its own queued or running it DEFERS it
  instead (§666, `peer-revision-deferral.ts`): the deferral bumps `peerSeq`, a STATE dep of the
  save effect, so a fresh snapshot follows that holds the peer's slices. A queued job whose snapshot
  predates the message is skipped, a fresh one adopts and writes, and a running one refused by
  exactly that revision is retried by the fresh one instead of pausing. A contested part opts out of
  both, so a crossing edit is still a reported conflict, never retried away. Both bases are read through `announcedRevision`, so a SharePoint file loaded as absent has
  one (`ABSENT_REVISION`), and a second window adopts the first window's create (§656 m2).
  The mirror ledger (`createMirrorLedger`, `mirror-ledger.ts`) stops a window re-saving a slice it
  only received from a peer. ★ A peer value with the SAME CONTENT as an own unsaved one (two windows
  running the insights reconcile on the same load) is a tie, not a contest: `tieVerdict` lets the
  window with the smaller id save it and the other mirror it (§656).
- **The pause.** A refused save sets `savesPaused` with `reason: "conflict"`, which shuts the save
  gate, and the banner `SavingPausedCause` `{ kind: "conflict" }` (`notifications.tsx`, copy
  `storageSavePausedConflict`) offers three actions (`use-conflict-resolution.ts`):
  **Reload** (`resolveConflictReload`) reads the stored version and drops the unsaved one;
  **Overwrite** (`resolveConflictOverwrite`) arms `forceNextSave(expected)` inside the next save job,
  a full rewrite that is refused if storage has moved on from the version the banner reported;
  **Download my version** (`downloadConflictVersion`) saves the live workspace as a file and keeps
  the pause. The blind `forceNextSave()` with no argument is a one-shot write that skips the compare.
- **A switch away from a conflict.** The pre-switch flush that meets a conflict, or finds a pause
  standing, keeps the edits (below) and the op switches. When that kept write FAILS (over
  `UNLOAD_JOURNAL_MAX_CHARS`, a quota error, a codec throw), `keepNotSavedOnSwitch` raises the pause
  and rethrows the `SaveConflictError`; every op's flush catch stops on it, so the user stays on the
  project behind the banner (toast `storageConflictSwitchBlocked`), whose Download works at any size.
  A settings rebuild cannot be refused; its toast says `storageConflictNotKeptOnRebuild` instead.
- **Kept versions.** A version left behind while its saves were refused (a switch away, a rebuild)
  goes to a kept journal slot, `keptProjectKey` (`aipm-cockpit:unload-journal:<key>:kept`, then
  `…:kept:<savedAt>`). `OtherJournalsBanner` lists it as "not saved (conflict)" with Download and
  Discard, and — for a kept version of the project IN SCOPE only (`isRestorable` in
  `use-other-journals.ts`) — Restore, behind a confirm (§655). `restoreKeptJournal`
  (`use-storage-backend.ts`) refuses while a load is in flight (`unloadJournalKeptRestoreLoading`, read through
  `loadPendingRef`) or over a shut save gate, runs through `restoreKeptJournalRef` so the handler the banner
  holds across its awaited confirm acts on the LATEST render (the live workspace it keeps first is current), decodes the record STRICTLY, KEEPS the live
  workspace first through `keepLive` (and restores nothing when that keep is not written), then applies
  the kept one like "Restore anyway" and saves it by the normal path, and removes the restored slot. The
  version that was open is then itself a kept version in the same notice, so a restore can be undone
  there. ★★ `journalWorkspace` decodes STRICTLY on every path (§668): lenient, `jsonToWorkspace` answers
  unparseable text with an EMPTY workspace, not a throw, and a corrupt journal used to be applied as an
  empty project by the load restore (no click) and by "Restore anyway". An undecodable journal is now
  never applied: the load restore raises no conflict notice for it, toasts `unloadJournalUnreadable`, and
  leaves its key OUT of `restoredKeys`, so the other-journals notice lists it with Download and Discard —
  nothing else would remove it (a confirmed save clears only this tab's records; the key in scope never
  expires). It is marked through `unreadableKeys` (entry text `unloadJournalUnreadableEntry`, hint
  `unloadJournalUnreadableHint`), since the notice's general "reload to restore" advice would only fail again.
  ★ This tab's own next journal write under the same key replaces the record. Accepted: it is corrupt, and
  the toast and notice say so at once. The decode passes a `diag`, so a documents/documentVersions
  sanitizer throw drops those slices (§97/§635) rather than refusing the whole journal. ★ An EMPTY but readable journal is NOT refused
  — a Clear all journals exactly that — and goes through the save-path mass-deletion guard like any edit.

★★ **What is verified.** Unit, hook and `node:sqlite` tests throughout, and
`e2e/two-tab-conflict.spec.ts` (browser storage, two pages of one context). Nothing has run on a
live SharePoint tenant (§652) or a live Turso database (§654); those entries list the owed checks.

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
- **Batch commit**: a statement list that starts with `BEGIN` and ends with `COMMIT` goes out
  as ONE Hrana `batch` request. Each step runs only if the step before it succeeded, and a
  trailing `ROLLBACK` step runs whenever `COMMIT` did not, so a failed save writes nothing
  (§637; per the Hrana protocol, live-database check owed). Anything before `BEGIN`, or a `BEGIN`
  without a trailing `COMMIT`, is refused before sending. `runTursoPipeline` maps the step results back to one result per statement and throws
  the first statement error. Any other list is sent as separate `execute` requests, which do not
  stop at a failing statement.

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
- **§637** — a Turso save whose batch hit a failing statement still committed the rest, then
  reported failure.
