# Refactor Plan — lop-app

**Date:** 2026-06-10 · **Baseline:** `main` @ `f62dbda` (v0.60.0 "Stephenson") · **Status:** PLAN ONLY — no changes made yet.

Produced from a five-track parallel audit (architecture/complexity, security, performance, reliability, dead code). Key findings were spot-checked against source (`workspace-context.tsx:217`, `turso-pipeline.ts:28`, `turso-schema.ts:144`).

## Audit snapshot

- ~626 tracked files, ~90k LOC under `src/app/` (flat layout, no subdirectories except `api/` and `dashboard-sections/`).
- Layering is a clean DAG (no circular deps): types/domain → serialization/storage → hooks/contexts → UI. The problems are **god modules**, not cycles.
- Top hotspots: `storage.ts` (3,467 LOC, 8 responsibilities, 58 importers), `task-manager.tsx` (1,639 LOC, 88 imports, ~80 hooks), `gantt.tsx` (1,967 LOC, pure algorithms mixed into a React file), `raid-panel.tsx` (1,493 LOC, contains an unextracted 675-line edit modal), `sanitize.ts` (1,165 LOC of repeated per-entity structure).
- Security posture is largely solid (parameterized SQL, nonce CSP with `strict-dynamic`, SSRF-hardened Jira proxy, safe markdown renderer) — findings below are targeted, not systemic.
- Reliability has one critical theme: **no network call in the persistence path has a timeout**, and several fire-and-forget async flows swallow errors.

---

## 1. Architecture changes

### 1.1 Split `storage.ts` (3,467 LOC → ~6 focused modules) — the single highest-leverage change

`storage.ts` currently owns: the `Workspace` type + migrations, the IDB wrapper, CSV codecs (×15 entities), Markdown codecs (×15 entities), File System Access helpers, `BrowserBackend`, `LocalFileBackend`, and the backend factory. Split along the measured seams:

| New module | Source lines (approx) | Contents |
|---|---|---|
| `workspace.ts` | storage.ts:69–171 | `Workspace` type, `emptyWorkspace`, migrations V5–V8 |
| `idb.ts` | storage.ts:172–386 | IDB schema, `openIdb`, KV + bulk helpers |
| `csv-codecs.ts` | storage.ts:387–1968 | CSV column defs + encoders/decoders |
| `markdown-codecs.ts` | storage.ts:1969–2848 | Markdown encoders/decoders |
| `fs-access.ts` | storage.ts:2849–3001 | File System Access API helpers |
| `browser-backend.ts` / `local-file-backend.ts` | storage.ts:3002–3366 | The two backend classes |
| `storage.ts` (rump) | storage.ts:3367–3467 | `createBackend` factory + re-exports for compat |

Coupling win: ~30 of the 58 `from './storage'` importers only need the `Workspace` type or `emptyWorkspace` — after the split they import `workspace.ts` and stop transitively depending on IDB/FS/codec code. **Keep `storage.ts` re-exporting everything during the pass** so the ~55 importing files (incl. tests) don't all churn at once; tighten imports opportunistically.

⚠ **Byte-stability constraint:** the CSV/Markdown serializers are dual-use (storage round-trip AND export). Moving code must not change a single emitted byte — the existing round-trip tests are the guard; add a golden-file test on `sample-workspace.md`/`.csv` before moving anything.

### 1.2 Eliminate the `settings-menu.tsx` barrel

`settings-menu.tsx` re-exports all of `settings-types.ts` while also containing the `SettingsMenu` React component; ~30 files import types through it and drag the component's React subtree into their graph. Change: all type/constant imports point at `settings-types.ts` directly; `settings-menu.tsx` keeps only the component and drops the re-exports.

### 1.3 Merge the two Turso backends

`turso-backend.ts` (81 LOC) and `turso-tenant-backend.ts` (63 LOC) differ only by `project_id` scoping. Merge into one backend parameterized by an optional `projectId` (schema modules stay separate; they already share `ENTITY_SPECS`). ~50 LOC removed, one save/load path to harden instead of two (matters for §4/§5 fixes).

### 1.4 Do NOT (this pass) genericize the 15× CSV/Markdown codec pairs

The audit found ~1,200 LOC of structural repetition that a generic `encodeSection(spec, …)` registry (modeled on `ENTITY_SPECS`) could collapse to ~5 functions. This is the biggest LOC prize in the repo, but each hand-written codec has subtle field-specific encoding (`\|` escaping, enum serialization, null/empty byte-stability) and the storage format is the user's data-at-rest. **Deferred** — see §6. The split in 1.1 stages the ground for it.

### 1.5 Module-level decomposition of `task-manager.tsx` — bounded extraction only

Full decomposition of the 1,519-line `TaskManagerInner` is out of scope (§6). In scope: extract the Turso project-lifecycle handlers (`handleCreateProjectByMode`, `handleUpdateCurrentProjectByMode`, `handleArchiveTursoProject`, `handleHardDeleteTursoProject`, `repointAfterRemoval`, task-manager.tsx:974–1055 + 1019–1023) into a `use-turso-projects.ts` hook. This is the same code that needs error handling added (§5, F-7/F-8), so the extraction and the reliability fix are one change. Also extract the feature-mode redirect logic into `feature-modules.ts` so `feature-mode-redirect.test.ts` stops testing a hand-copied duplicate of the real algorithm.

---

## 2. Specific file-level changes (before → after intent)

| # | File(s) | Before | After | Net LOC |
|---|---|---|---|---|
| 2.1 | `storage.ts` | 3,467-line god module | Split per §1.1; rump factory + re-exports | ±0 (moves), −58-importer fan-in |
| 2.2 | `raid-panel.tsx` | Panel + inline `RaidEditModal` (lines 729–1403) | Extract to `raid-edit-modal.tsx`, matching every other entity's pattern | panel 1,493 → ~820 |
| 2.3 | `gantt.tsx` | Pure logic (prefs, date helpers, bar derivation, `computeCriticalPath` DAG, lines 37–504) inside the React file | Extract to `gantt-engine.ts`; unit-test the critical-path algorithm without React | gantt 1,967 → ~1,500 |
| 2.4 | `turso-backend.ts` + `turso-tenant-backend.ts` | Two near-identical classes | One parameterized backend | −50 |
| 2.5 | `settings-menu.tsx` + ~30 importers | Barrel re-exporting `settings-types.ts` | Component-only file; direct type imports | −20, big graph cleanup |
| 2.6 | `task-manager.tsx` | Inline `void (async () => …)()` Turso project handlers, no try/catch | `use-turso-projects.ts` hook with error reporting via `reportStorageOutcome` | tm −~90 |
| 2.7 | `version.ts` | 841 lines, 771 of which are a comment-form changelog | Move the changelog comment block into `CHANGELOG.md` (already exists); keep the ~68 code lines | −770 |
| 2.8 | Dead code (HIGH confidence) | `dashboard-sections/health-pill.tsx` (0 importers), `siteByPathUrl` in `sharepoint-graph.ts:61` (0 callers, superseded by `siteDefaultDriveRootChildrenUrl`), 23 unused i18n keys in `i18n.ts`/`i18n.de.ts` (grep-verified zero references; incl. `address-book`/`resource-report` leftovers from v0.38) | Deleted | −74 |
| 2.9 | `app-shell.tsx` + test | 11-line ternary wrapper with one call site | Inline into `task-manager.tsx`; delete file + trivial test | −26 |
| 2.10 | `feature-mode-redirect.test.ts` | Tests an inline *copy* of the redirect algorithm (drift risk) | Import the real function after §1.5 extraction | test now meaningful |
| 2.11 | `milestones-panel.tsx:92`, `use-task-submit.ts`, `task-manager.tsx` | 3 inline `nextId()` duplicates | Import `nextId` from `resource-foundation.ts:80` | −9 |

⚠ i18n.de.ts gotcha (from project memory): the Edit tool has corrupted ASCII quotes to curly quotes in this file before — verify with a grep after editing, prefer Write/byte-patch.

---

## 3. Performance changes (with expected measurable impact)

Ranked by user-perceived impact. "Already done well" (confirmed, do not re-fix): panel code-splitting via `next/dynamic`, lazy `export-ooxml` import, memoized derived data in `workspace-context`, 150 ms search debounce, 500 ms autosave debounce, `BrowserBackend.diff()` minimal-delta writes, `React.memo` on task rows.

| # | Change | File:line | Mechanism | Expected impact |
|---|---|---|---|---|
| P1 | **Turso dirty-table save** — only DELETE+INSERT tables whose entity array changed (reference-compare against last-saved workspace, same trick `BrowserBackend.diff()` already uses) | `turso-schema.ts:141–167`, `turso-backend.ts` | Today every 500 ms autosave sends BEGIN + 15 DDL + 15 DELETE + one INSERT per row across the whole workspace (~615 statements / ~600 KB for a 500-task workspace) | Typical single-entity edit: ~615 → ~30 statements, ~600 KB → ~25 KB body; save round-trip from ~800–1500 ms to <100 ms. **Measure:** statement count + body bytes per save, logged before/after |
| P2 | **Memoize context `value` objects** | `workspace-context.tsx:217`, `task-form-context.tsx:106`, `filters-context.tsx:112` | Plain object literal = new identity every render → all ~30 `useWorkspace()` consumers re-render on any of 17 state slices changing | Keystroke in search/task form stops re-rendering unrelated panels. **Measure:** React Profiler commit count while typing 20 chars: expect ~30 component trees → ~3 |
| P3 | **Gantt row-index map** | `gantt.tsx:1408,1481` | `findIndex` over all placeable rows per dependency arrow inside render flatMap → O(n²)/frame | 200 tasks × 200 deps: 40,000 comparisons → 200 Map lookups per frame. **Measure:** Profiler frame time on Gantt scroll with the 200-task sample |
| P4 | **Parallelize `BrowserBackend.save`/`load`** with `Promise.all` (17 sequential awaits on save, 16 on load; baseline-map updates stay after the join) | `storage.ts:3175–3206`, `storage.ts:3060–3075` | Independent IDB transactions serialized | Autosave ~85 ms → ~10 ms; initial load ~160 ms → ~20 ms. **Measure:** `performance.now()` around save/load before/after |

P1 pairs with reliability fix R2 (rollback) and R4 (multi-tab) — do them as one Turso-save hardening change on the merged backend from §1.3.

---

## 4. Security fixes (ranked)

CLEAN areas confirmed by the audit (no action): Turso SQL fully parameterized incl. `project_id` scoping; markdown renderer XSS-safe; `isSafeHttpUrl` link guard; Jira proxy SSRF allowlist + private-IP guard + field allowlist; no hardcoded secrets; CSP `script-src` nonce + `strict-dynamic`.

| Sev | ID | Finding | File:line | Fix |
|---|---|---|---|---|
| CRITICAL | S1 | Anthropic API key sent from the browser (`x-api-key` + `anthropic-dangerous-direct-browser-access`), key in localStorage | `chat-panel.tsx:86–93` | Add `/api/ai/chat` server proxy route (same pattern as the Jira proxy: rate-limited, key from server env, streaming pass-through). Browser sends conversation only. *If* user-supplied-key-in-browser is an intentional product decision (BYO-key app), downgrade to HIGH and instead: document the threat model in the AI consent screen and keep the key out of exports/logs. **Decision needed from owner before implementing.** |
| HIGH | S2 | Jira/Turso/AI tokens in plaintext `localStorage` | `use-settings.ts:16,165` | Same architectural question as S1. Minimum this pass: prominent security note in settings UI + README. Full fix (server-side secret handling or session-PIN wrapping) only if S1 goes the proxy route. |
| HIGH | S3 | Graph IDs interpolated into URLs unencoded (path-pivot under the bearer token if a Graph response is spoofed) | `sharepoint-graph.ts:49,53,57` | `encodeURIComponent()` on `siteId`/`driveId`/`itemId` — consistent with `searchSitesUrl` which already does it. One-line fixes + test |
| HIGH | S4 | `@odata.nextLink` origin check exists in Outlook hooks but not in `readList` (SharePoint) | `sharepoint-graph.ts:116` | Add the same `startsWith("https://graph.microsoft.com/")` guard at the `readList` infrastructure level |
| HIGH | S5 | `/api/ecb` has no rate limit (the Jira routes do) | `api/ecb/route.ts` | Apply the existing `rateLimit()` helper |
| HIGH | S6 | No `Strict-Transport-Security` header | `next.config.ts` securityHeaders | Add HSTS `max-age=31536000; includeSubDomains` (production-gated) |
| MEDIUM | S7 | Rate limiter trusts spoofable `X-Forwarded-For` | `api/jira/_rate-limit.ts:11–16` | Document as deployment caveat; only trust XFF behind a known proxy |
| MEDIUM | S8 | `Permissions-Policy` leaves `microphone` unrestricted | `next.config.ts:17` | `microphone=(self)` — voice feature is top-level only |
| MEDIUM | S9 | `style-src-attr 'unsafe-inline'`; `*.turso.io` wildcard in connect-src | `proxy.ts:57,60` | Accepted trade-offs (React style props; user-configured Turso URL). Add code comments documenting why; no code change |
| LOW | S10 | Static inline theme script via `dangerouslySetInnerHTML`; CSV formula neutralization export-only | `layout.tsx:33`, `storage.ts:877` | Both intentional and safe today. Add "must stay a pure static literal" comment on the theme script; the CSV split is already documented in tests |

---

## 5. Reliability improvements

Confirmed SOLID (no re-fix): Turso BEGIN/COMMIT batching, `tursoErrorKind` + storage banner, SharePoint backend typed errors, `jsonToWorkspace` parse guard, registry parse guard, popout `canSend=false` + `lastSeenRef` guard, Jira per-task error isolation, chat Stop/AbortSignal.

| Sev | ID | Gap | File:line | Fix |
|---|---|---|---|---|
| CRITICAL | R1 | **No timeout on the Turso pipeline fetch** — a hung save leaves the promise pending forever, banner never fires, tab close = silent data loss | `turso-pipeline.ts:28` | `AbortController` + 15 s (save) / 10 s (load) deadline; abort → `StorageNotReadyError("storage-unreachable")` so the existing banner mechanism fires |
| HIGH | R2 | Mid-pipeline statement error leaves the Turso transaction open (no ROLLBACK); concurrent reader can see a half-written workspace | `turso-pipeline.ts:47–50` | Best-effort `ROLLBACK` pipeline call on the error path |
| HIGH | R3 | `saveRegistry` silently swallows localStorage quota errors — project list can vanish on next load with zero feedback | `projects-registry.ts:207–213` | Propagate to caller → route through the existing toast/banner infra |
| MEDIUM | R4 | Two full tabs on the same Turso DB = concurrent full-overwrite writers, last-write-wins data loss | `broadcast-sync.ts:64–71`, `use-storage-backend.ts:258–274` | `navigator.locks` single-writer mutex (popouts already read-only); document the limitation in README |
| MEDIUM | R5 | Debounced save lost on tab close (no `beforeunload`/`visibilitychange` flush) | `use-storage-backend.ts` | Flush pending save on `visibilitychange === "hidden"` (+ best-effort `beforeunload`) |
| MEDIUM | R6 | Turso project lifecycle handlers are fire-and-forget with no try/catch (create/update/archive/delete/repoint) | `task-manager.tsx:974–1055` | Fixed by the §1.5 extraction — every handler reports via `reportStorageOutcome`/toast |
| MEDIUM | R7 | No timeout on Jira upstream fetch (server) or ECB fetch | `api/jira/_helpers.ts:158`, `api/ecb/route.ts:10` | `AbortSignal.timeout(10_000)` / `(8_000)` |
| LOW | R8 | `jira-settings.tsx` `.catch(() => setUserResults([]))` makes failure indistinguishable from empty | `jira-settings.tsx:77,110` | Separate error state + inline message |
| LOW | R9 | MSAL init failure silently sets `ready: true` | `use-ms-auth.ts:108–110` | `console.error` + distinct error state |

Retries: add a single retry with short backoff to the Turso save path only (idempotent full-state write, safe to retry once R1's timeout exists). No retry framework — YAGNI.

---

## 6. Explicitly OUT OF SCOPE for this pass

1. **Generic codec registry replacing the 15× CSV/Markdown codec pairs** (~1,000 LOC prize) — too risky against the byte-stable storage format; revisit after §1.1 lands with golden-file tests in place.
2. **Full decomposition of `TaskManagerInner`** (1,519 lines) — only the §1.5 bounded extraction; the rest needs its own design pass.
3. **Removing the classic layout** (~110 LOC dual path + scattered conditionals) — it's a live user-facing Settings toggle; removal is a product decision, not cleanup.
4. **Generic `buildSanitizer` abstraction in `sanitize.ts`** (~420 LOC of repetition) — sanitizers are the input-validation security boundary; per-field explicitness is a feature. Not worth the risk for the LOC.
5. **Edit-modal framework** unifying the 7 modal files (~540 LOC of boilerplate) — extracting `RaidEditModal` (2.2) brings consistency first; a shared framework is speculative generality until then.
6. **i18n key-by-key audit beyond the 23 verified keys** — diminishing returns.
7. **S1/S2 full server-side secret architecture** if the product answer is "BYO key by design" — then only the documentation/consent changes ship.
8. **Renaming `proxy.ts` → `middleware.ts`**, snapshot/trends storage changes, any Next.js version work.
9. **New features of any kind.**

---

## 7. End-to-end verification

Per-phase gates (run after every batch, all must pass before the next batch):

```powershell
npm run lint        # --max-warnings=0 policy
npx tsc --noEmit
npx vitest run      # full suite (~3.5k tests), coverage gate 70%
npm run build
```

Refactor-specific proofs:

1. **Byte-stability (the §1.1/2.x guard):** before any change, generate golden copies — serialize `sample-workspace.json` through `workspaceToCsv` and `workspaceToMarkdown` (no export config) and commit the outputs as test fixtures. After every storage-touching change: re-serialize and `git diff --exit-code` the fixtures. Zero byte drift allowed.
2. **Round-trip property:** existing CSV/MD/JSON round-trip tests must stay green; add one for the merged Turso backend (`workspaceToStatements` → `rowObjects` → deep-equal workspace).
3. **Dead-code safety:** after deletions (2.8/2.9), `npx tsc --noEmit` + full vitest + `grep` zero references to each deleted symbol.
4. **Performance benchmark (before/after, same 500-task sample workspace):**
   - P1: log statement count + JSON body bytes per Turso save (instrument `runTursoPipeline` temporarily). Target: >90% reduction on single-task edit.
   - P2: React DevTools Profiler — commits while typing 20 chars into task search. Target: unrelated panels (Gantt, Reports, Budget) show zero re-renders.
   - P3: Profiler frame time on Gantt scroll with 200 linked tasks. Target: arrow pass no longer visible in flame graph.
   - P4: `performance.now()` around `BrowserBackend.save`/`load`. Target: save <20 ms, load <40 ms.
   - Record numbers in this file under a "Results" section when done.
5. **Security verification:** `proxy.test.ts` extended for HSTS + microphone policy; new tests for Graph-ID encoding (S3) and `readList` nextLink guard (S4); `rateLimit` test for `/api/ecb`; if S1 proxy route ships, a test that no `x-api-key` leaves the browser bundle (`grep` the client chunk).
6. **Reliability verification:** unit tests with mocked hung fetch proving R1 aborts and surfaces the banner; mocked mid-pipeline error proving R2 sends ROLLBACK; mocked quota error proving R3 toasts; jsdom `visibilitychange` test proving R5 flushes.
7. **E2E:** GitLab CI pipeline (install → quality → build → e2e) green on `main` after merge (e2e runs main-only).
8. **LOC accounting:** `git diff --stat` per batch; expected net across the pass ≈ **−1,000 LOC** (version.ts changelog −770, dead code −74, app-shell −26, Turso merge −50, barrel/duplicates/misc −80) with zero behavior change outside the listed fixes.

### Suggested execution order (each batch independently shippable)

1. **Batch A — Reliability criticals + cheap security:** R1, R2, R7, S3, S4, S5, S6, S8 (small, high-value, no structural risk). ✅ **DONE** (v0.60.1, branch `refactor-batch-a-reliability-security`). Owner decision recorded: BYO-key stays → S1/S2 are documentation-only (Batch E).
2. **Batch B — Dead code + low-risk moves:** 2.7, 2.8, 2.9, 2.11, golden-file fixtures (verification prerequisite for everything after). ✅ **DONE** (v0.60.2, branch `refactor-batch-b-cleanup`, net −491 LOC). Finding: CHANGELOG.md already covered all 97 versions from version.ts's comment (zero ported); CSV serializer emits CRLF (RFC 4180), MD emits LF — fixtures are `-text` in .gitattributes.
3. **Batch C — Structural splits:** 2.1 (storage split), 2.2 (raid modal), 2.3 (gantt engine), 2.5 (barrel), 1.3+2.4 (Turso merge). ✅ **DONE** (v0.60.3, branch `refactor-batch-c-structure`). storage.ts 3,466→126-line facade over 7 modules; golden fixtures stayed green at every stage. CORRECTION to §3 of this plan: the audit's "no circular dependencies" claim was wrong — 6 value-import cycles pre-existed; Batch C dissolved 4 of them (storage↔settings-types, storage↔backends, settings-menu↔jira-settings ×2) and added none.
4. **Batch D — Performance:** P1–P4 (P1 on the merged backend), R3, R4, R5, 1.5/2.6/R6. ✅ **DONE** (v0.60.4, branch `refactor-batch-d-performance`). Measured: status-only Turso save 535→20 statements; zero-change saves skip HTTP; dirty granularity is per-table (a task edit still rewrites the tasks table — row-level diffing stays out of scope). R4 shipped as Web Locks serialization (LWW-per-table documented in README). Follow-up candidates from review: double `listProjects` in repointAfterRemoval; readonly Workspace section types to enforce the immutability the dirty-diff relies on.
5. **Batch E — S1/S2** pending the owner's BYO-key decision.
