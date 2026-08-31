# Nine defect closures — design

**Date:** 2026-08-30
**Branch:** `fix/nine-defect-closures`, cut from `main` at `0fd21fb1` (0.267.0 "Nagamatsu").
**Register entries closed:** §36(b) · §88 · §109 (sub-item) · §120 · §128 · §148 · §271 · §276 · §296.
**This slice BUMPS** — every unit is a user-visible defect.

---

## Goal

Close nine independently-verified defects from `docs/open-followups.md`. Each is bounded to one or
two source files plus its existing test file. No unit shares a source file with another, so the nine
are commit-independent and can be built in parallel batches.

## How these nine were chosen, and what "verified" means here

The register holds 291 entries, 174 open. Three triage passes over disjoint line ranges examined all
291 and returned 38 candidates meeting a bounded-and-user-visible bar. Nine were selected.

★★★ **Every one of the nine was then re-verified against the source, and the register was wrong or
incomplete about four of them.** A register entry is a lead, not a fact. The corrections are recorded
per-unit below and are part of this slice's deliverable — an entry that closes while still carrying a
false claim leaves the false claim behind in the record.

## Non-goals

Stated explicitly so a later reader does not read their absence as an oversight:

- **Not** translating the export section headers. Every register section's `columns` array is raw
  field keys (`noteLog`, `dueDate`), while `ExportSection.columns` documents itself as "display
  labels". That is a real inaccuracy across every section; translating one column's header while its
  neighbours stay raw would be worse than leaving it. Recorded in the register, not fixed here.
- **Not** closing the visible-duplicate residue in the version-diff view. Two rows whose
  `recordLabel` matches render identical visible text; only the accessible name disambiguates. This
  is pre-existing and general (it already applies to same-named tasks and documents) and is not
  introduced by §271's fix.
- **Not** adding an unmount-abort to `use-timelog-sync.ts`. It has none, but that is not what §128
  describes.
- **Not** adding a user-facing Stop control for §120. Unmount-abort only.
- **Not** touching `encodeNoteLog`, `fieldToString`, or any `*_CSV_COLUMNS` constant. See §36(b)'s
  trap — that path is storage, and a change there is silent data loss.
- **Not** widening §276 to the non-archived project rows. Their controls are guarded by `isCurrent`
  and do not collide.

---

## Unit A — names people read

Five entries. Every one is fixed by a shared primitive that already exists and is currently unused at
the call site. No hand-rolled disambiguation anywhere in this unit.

### A1 — §271: document-version rows are labelled `#<id>`

**Verified.** `COLLECTION_SPECS` in `version-diff.ts` gives `documents` a `nameField: "title"` and
gives `documentVersions` no name source at all. `recordLabel` falls through to `` `#${id}` `` when
neither `nameOf` nor `nameField` yields a non-blank string. `DocVersion` carries `title: string`.

**Change:** add `nameField: "title"` to the `documentVersions` row of `COLLECTION_SPECS`.

★ That is the whole fix. `version-diff-view.tsx` already runs `buildRowTokens` over `recordLabel` and
feeds `rowLabel(...)` into every per-row `aria-label`, so several versions of one document — which
share a title by construction — auto-disambiguate to ` (1)`/` (2)` in the accessible names with no
further work. Do not add tokenising here; it is already there.

**Test** (`version-diff.test.ts`, exists): a `documentVersions` change renders `recordLabel` as the
version's title. Red today (it reads `#<id>`).

### A2 — §276: every archived-project control carries the bare verb

**Verified.** In `projects-panel.tsx`, the `archivedProjects` map renders a Restore `Button` and a
"Delete permanently" `Button`, neither with an `aria-label`, so each one's accessible name falls back
to its text content.

★★ **This collides unconditionally, not only on duplicate project names** — every archived row emits
the identical `"Restore"`. That is stronger than the usual instance of this defect class and it
changes the test design: the primary regression pin uses rows with *distinct* names.

**Change:** `useRowTokens` over the archived list, `rowLabel(verb, token)` into both buttons'
`aria-label`.

★★★ The accessor passed to `useRowTokens` MUST be declared at module scope. An inline
`(p) => p.name` is a fresh closure per render: it defeats the hook's `useMemo` and trips
`react-hooks/exhaustive-deps`, which is fatal here under `--max-warnings=0`.

**Tests** (`projects-panel.test.tsx`, exists), two separate `it()` blocks:
1. two archived projects with **distinct** names → both controls carry a row-unique name.
   `expectRowUniqueNames` with `requireCollisionSeed: false` — the names differ, so the guard would
   throw against correct code.
2. two archived projects with the **same** name → occurrence suffixes appear.
   `requireCollisionSeed: true`.

### A3 — §296: one column label heads up to four columns in one view

**Verified.** `nameContext` appears zero times in `raid-report-panel.tsx` and `resources-report.tsx`.
`ByGroupTable` is rendered three times in `resources-report.tsx` and `resourcesCapacityDays` also
heads the by-period table, so that single label names four columns in one view. `RaidCountHead` is
rendered twice, and a third header block repeats `raidReportColOpen` / `raidReportColClosed` /
`raidReportColOverdue`.

**Change:** pass `nameContext` at the repeated call sites. No new i18n keys — the disambiguating
context is already in scope at both: `RaidCountHead` receives `firstLabelKey`
(`raidReportBySeverity` / `raidReportByOwner`), and `ByGroupTable` receives a `title` prop. Both are
the tables' own localized titles.

★ `SortHeaderButton` composes `aria-label={`${label} – ${nameContext}`}` (EN DASH U+2013) internally,
so WCAG 2.5.3 containment holds by construction and no call site can defeat it.

**Tests** (`raid-report-panel.test.tsx`, `resources-report.test.tsx`, both exist):
`expectRowUniqueNames` over the rendered panel.

★★★ `requireCollisionSeed` MUST be `false` here. The guard strips only the occurrence suffix ` (N)`;
`nameContext` disambiguates with ` – <context>`, so the guard throws against *correct* code. This is
the opposite setting from A2 and getting it backwards costs a debug cycle.

### A4 — §109 (sub-item): collapse chevron has no `aria-label`

**Verified.** The button in `workspace-section-chrome.tsx` carries `type`, `onClick`,
`aria-expanded`, `aria-controls`, and a `title`, with an `aria-hidden` `ChevronDownIcon` as its only
child. No `aria-label`, no text content.

★★ **CORRECTION TO THE REGISTER.** §109 frames this as the button having no accessible name. It has
one: `title` is the accname algorithm's last resort, so axe's `button-name` (tagged `wcag2a`, inside
the gate's four requested tags) **passes** this control. The defect is real — `title` is hover-only,
unreachable on touch, and handled inconsistently across voice-control stacks — but it is *poor*, not
*broken*. Fix the entry's wording when closing it.

**Change:** add `aria-label` using the existing `workspaceExpand` / `workspaceCollapse` strings.
Keep `title`. No new i18n keys.

**Test** (`workspace-section-chrome.test.tsx`, exists): the button is reachable by
`getByRole("button", { name })` in both collapsed and expanded states.

### A5 — §88: the Settings "AI Assistant" sub-heading is a styled `<span>`

**Verified.** In `settings-sections/ai-section.tsx` the title renders as a styled `<span>`, so
heading navigation skips it. The prescribed fix already exists **in the same file**: the "Assistant
behaviour" block uses `useId()` + `role="group"` + `aria-labelledby` on a `<p>`, with a comment
explaining why not `<h3>`.

`AiSection` has exactly four mount surfaces — `backend-setup-wizard.tsx`, `project-empty-state.tsx`,
`settings-menu.tsx`, `settings-view.tsx` — and only `settings-view.tsx` supplies an `<h2>` ancestor.
So a bare `<h3>` really would break the document outline on three of the four.

★★ **CORRECTION TO THE REGISTER.** §88 warns that an `<h3>` would trip axe's `heading-order` rule.
`heading-order` is tagged `cat.semantics,best-practice` only, and the gate requests
`wcag2a wcag2aa wcag21a wcag21aa` — so it never runs and CI would stay green either way. The
recommendation survives on the real screen-reader argument alone; the gate-risk framing is wrong.

**Change:** copy the sibling block's pattern verbatim. Keep the `InfoTooltip` alongside.

**Test** (`settings-sections/ai-section.test.tsx`, exists): the section is reachable as
`getByRole("group", { name })`.

---

## Unit B — silent losses

Four entries. Each loses something the user cares about: their data, their money, or the truth of
what the UI is telling them.

★★★ All four files are **coverage-gated** — none is in `vitest.config.ts` `coverage.exclude`. Note
`use-insight-recommendations.ts` IS excluded and is a **different file** from
`use-insight-recommend-runner.ts`, which is not. Every fix here ships with tests or it drags the
global floors.

### B1 — §128: Timelog sync reports "idle" while a superseded run is still in flight

**Verified.** `runGuarded` in `use-timelog-sync.ts` supersedes by aborting the prior controller,
minting a fresh one, assigning `abortRef.current`, and calling `setBusy(true)`. Its `finally` reads:

```ts
} finally {
  if (abortRef.current === controller) abortRef.current = null;
  setBusy(false);
}
```

`setBusy(false)` sits **outside** the identity guard. The superseded run's abort rejection settles a
microtask after the successor has already set busy, so the superseded `finally` switches busy off
while the successor is still running. There is exactly one `setBusy(true)` and one `setBusy(false)`
in the file, so nothing re-raises it.

**Change:** move `setBusy(false)` inside the existing `if (abortRef.current === controller)` block.

★ Sufficient, and no generation counter is needed: the identity test *is* the generation check. The
only writers of `abortRef.current` are `runGuarded`'s own assignment and that guarded null, and
`cancel()` aborts without nulling the ref — so a user-cancelled (not superseded) run still satisfies
the identity and clears busy. A superseded run that skips clearing is always followed by a successor
whose own `finally` clears it.

**Test** (`use-timelog-sync.test.ts`, exists).

★★★ **VACUITY TRAP.** The successor's own `setBusy(true)` makes `busy === true` regardless of the
fix. The assertion must be made **after** the superseded run's rejection has flushed and **while**
the successor is still pending; otherwise it passes with the fix reverted. The first run's `work`
must genuinely settle on abort — a mock that ignores the signal never reaches the `finally` and the
test proves nothing. Resolve the successor at the end, so the opposite failure (busy stuck on) is
also covered.

### B2 — §148: Retry after a failed load wipes a message the user just sent

**Verified.** The mount-fetch `useEffect` in `use-chat-threads.ts` captures
`const startedOn = threadIdRef.current` before `loadThreads(...)` and guards **both** settle branches
with `threadIdRef.current !== startedOn`. `retryLoad`'s reload branch has **neither** guard: past the
`pendingRetryRef.current.size > 0` early return it calls `loadThreads(...)` and unconditionally does
`setThreads(loaded)` / `setActiveThreadId(loaded[0]?.id ?? null)` / `setHistory(...)` / `setDisplay(...)`,
with a `.catch` that blanks all four.

**The drop path, precisely:** initial fetch fails → `pendingRetryRef` is empty → Retry falls through
to the reload. A send begun between the click and the resolve calls `ensureThreadForSend`, which
mints an id, writes `threadIdRef.current` **synchronously**, and inserts the row to Turso. The
resolving reload's `loaded` cannot contain that row, so `setThreads(loaded)` drops it;
`setActiveThreadId` then changes the active id, which makes the `threadIdRef` sync effect abort the
in-flight send; `setHistory`/`setDisplay` replace the user's turn. The `.catch` path is worse.

**Change:** capture `startedOn` before `loadThreads` in the reload branch and apply the same
merge / no-reset the effect uses when the ref has moved. Factor as a helper taking `startedOn`, shared
with the effect, so the two cannot drift.

★★ Do **not** close this by reusing the effect's body wholesale — it also clears `pendingRetryRef`
and `latestSeqRef` as project-switch semantics, which `retryLoad` must not do.

**Test** (`use-chat-threads.test.tsx`, exists). Both settle branches pinned in **separate** `it()`
blocks; the `.catch` is the destructive one and a `.then`-only test leaves it open.

★★★ **VACUITY TRAP.** The failed-initial-fetch precondition must be set up explicitly. Any fixture
leaving `pendingRetryRef` non-empty returns at the first branch, and the test then passes whichever
way the reload is written. The mid-flight mint must move `threadIdRef.current`, not just
`activeThreadId` state — the ref is what the guard reads.

### B3 — §120: navigating away does not stop up to three billed AI calls

**Verified.** `use-insight-recommend-runner.ts` contains **zero** occurrences of `AbortController`
or `signal`. Its tick awaits `runInsightRecommendation({ apiKey, model, context, index, today })` —
no signal — inside `for (const insight of candidates)`, where `candidates` is
`.slice(0, MAX_BG_RECS_PER_TICK)` and `MAX_BG_RECS_PER_TICK = 3` (`insights/insight.ts`). The loop is
serial, so "up to three billed calls, none cancellable" is exact. Both effect cleanups only remove a
`visibilitychange` listener and clear an interval.

★ This is a missing **thread**, not a missing capability: `RecommendCallArgs` already declares
`signal?: AbortSignal` and `runInsightRecommendation` forwards it to `runForcedToolCall`.

**Change:** add `abortRef`, mint a controller per tick, pass `signal: controller.signal`, and add
`useEffect(() => () => abortRef.current?.abort(), [])`. Copy the shape from `use-abortable-ai.ts`
(the same shape is in `use-alloc-plan.tsx`, `use-action-analysis.ts`, `use-inline-entity-edit.ts`,
`use-raci-suggest.tsx`, `use-tasks-dedup.tsx`).

★★★ **The signal alone is not the fix.** The per-candidate `catch` currently swallows anything that
is not a limit/auth `AiHttpError` and **continues**. Without a `break` on abort, the loop walks
candidates 2 and 3 after unmount; they reject immediately so nothing is billed, but
`applyRecommendationRef.current` is still a post-unmount state write for any call that resolved
before the abort landed. Fix the loop exit, not just the signal.

★ `isRunningRef` is cleared only in the `finally`, which still runs — so no deadlock. But a fix that
returns early from the tick without passing through that `finally` would leave the overlap guard
armed forever.

**Test** (`use-insight-recommend-runner.test.ts`, exists).

★★★ **VACUITY TRAP.** Asserting on the argument object handed to a mocked
`runInsightRecommendation` proves only that a `signal` key was spelled. Capture the signal and assert
`aborted === false` before unmount and `true` after — the shape `use-tasks-dedup.tsx`'s test was
mutation-proved with. The mount effect fires a tick immediately, so the test must hold the first call
pending before unmounting, or the abort lands after the loop finished and the test passes with the
cleanup deleted.

### B4 — §36(b): a note log exports as a raw JSON blob

**Verified.** `buildExportSections` (`export-sections.ts`) builds each register section from
`<ENTITY>_CSV_COLUMNS` and maps each cell through `richCell(fieldToString(row, col), col, <ENTITY>_RICH_COLUMNS)`.
`noteLog` is a member of those column lists; `fieldToString` and its RAID/change siblings return
`encodeNoteLog(...)`; and `encodeNoteLog` is literally `JSON.stringify(log)` (returning `""` when
empty). `noteLog` is correctly in none of the `*_RICH_COLUMNS` sets, so `richCell` passes the JSON
string straight through. The user sees the serialized array in a cell.

Reachable through plain UI — `NoteLogPanel` is mounted from the task form and notes window, the RAID
edit modal and rows, and the change edit modal and panel. `sample-workspace-small.json` carries 18
`noteLog` occurrences, so the shipped sample reproduces it.

★★ **TWO CORRECTIONS TO THE REGISTER.** §36 says "a task or RAID row" and names four formats.
1. **Three registers, not two** — `ChangeItem.noteLog` is in `CHANGES_CSV_COLUMNS` and
   `changesSection` has the identical shape.
2. **Five surfaces, not four.** The four formats do all route through the one builder (PDF via
   `buildPdfHtml`, which is the HTML renderer's standalone mode, not a fourth renderer) — but
   `doc-data-section.ts` `resolveDataSection` is a **second consumer**, so a `dataSection` block
   inside a project Document shows the blob too. The entry misses that surface entirely.

CSV and Markdown export do **not** go through this builder; they carry the blob by design and it
round-trips through `decodeNoteLog`.

**Change (decided):** project to readable text — one line per entry, `author · date · text` — in
`export-sections.ts` only, for all three register sections.

★★ **The date is the ISO date part of `NoteLogEntry.timestamp` (`slice(0, 10)`), NOT a localized
display timestamp.** The UI renders these with `formatDisplayTimestamp(entry.timestamp, tz, lang)`,
but `buildExportSections(ws, cfg, lang)` receives **no timezone** — reaching that helper would mean a
signature change across both of its consumers, which is scope creep. ISO is also the *consistent*
choice: every neighbouring date column in these sections (`dueDate`, `createdDate`) is already an ISO
string straight from the CSV serializers, and a deterministic date keeps the test free of any
timezone or locale dependency. Do not "improve" this to a localized format without threading `tz`
properly and changing every sibling column with it.

★★★ **THE TRAP THAT MAKES AN OBVIOUS FIX A DATA-LOSS BUG.** Do **not** fix this in `encodeNoteLog`,
`fieldToString`, or `CSV_COLUMNS`. Those are the storage serializers for CSV, Markdown **and both
Turso layouts**. Emitting readable text there makes `decodeNoteLog` unable to parse it back — silent
note-log loss on the next load — and would force a golden regeneration to mask a real format
regression. The fix lives in `export-sections.ts`.

★★ Project from `NoteLogEntry.text`, never `.html`. `.text` is the maintained plain projection,
re-derived after sanitising (§36(a)); feeding `.html` into a flat cell puts raw markup into XLSX and
PPTX.

★ `RichCell` cannot absorb this. It is `{html, text}` for **one** field; `noteLog` is N dated entries
each with their own html plus author metadata. Making it a `RichCell` would mean synthesizing a
wrapper html, and the structural renderers would emit N unlabelled paragraphs with author and date
silently dropped.

★ i18n: `export-sections.ts` already receives `lang` and calls `t(...)`, and `noteLogNoAuthor`
already exists for the missing-author case. Prefer composing from existing keys. **If a new key
proves necessary**, it lands in both `i18n.ts` and `i18n.de.ts`, and `i18n.de.ts` must be patched by
an anchored node utf8 write matching `\r\n` — never the Edit tool, which corrupts umlauts and curls
quotes.

**Not a blocker, worth knowing:** `export-xlsx.ts` has no cell-length cap (its only truncation is
sheet names to 31 chars), and XLSX's own limit is 32,767 characters. A long note log could exceed it
— but today's JSON blob is *longer* than any text projection of the same log, so this fix strictly
shortens the cell and cannot make it worse.

**Goldens, storage and baselines are all unaffected.** `golden-workspace.test` pins
`workspaceToCsv`/`workspaceToMarkdown`, which never reach this builder;
`docs/baselines/ooxml-parts.json` is built from synthetic minimal XML, not from a workspace. No
existing test pins today's behaviour — `grep noteLog` over `export-sections.test.ts`,
`export-ooxml.test.ts`, `export.test.ts` and `doc-render-html.test.ts` returns nothing.

**Test** (`export-sections.test.ts`, exists): a task, a RAID item and a change each carrying a
two-entry note log export as readable lines, not as `[{`. Assert on all three registers — one is not
evidence for the others, since each has its own `fieldToString`.

---

## Unit C — register and record

Not optional and not cosmetic: the register is the record of what is true.

1. **Nine four-place closures.** Each of §36(b) · §88 · §109 · §120 · §128 · §148 · §271 · §276 ·
   §296 needs: the `##` heading marked, the summary-table status cell, the table anchor (derived from
   the heading, so it moves when the heading does), and the `**Status:**` witness. A body line must
   never contain the word CLOSED.
   ★★ **The two halves-entries resolve in OPPOSITE directions — read each heading, do not
   pattern-match.** §36's heading is `(a) FIXED 2026-08-28; (b) still open, small`, so closing (b)
   closes the **whole** entry and it DOES take `— CLOSED`. §109's heading is `open, ratchet` and its
   main body is a large tooltip inventory that stays open, so it must NOT carry `— CLOSED` — say what
   landed in other words and keep the open part in the heading. Writing `CLOSED` on an entry with
   work left is the one mistake that breaks every count in the register.
2. **The three factual corrections** established above: §36's register/surface under-scope, §109's
   "no accessible name" (axe passes it), §88's `heading-order` gate-risk framing.
3. **§163's heading**, shipped by the previous slice. It reads
   `— denominator FIXED …, numerator CLOSED …`. It is the only heading in the file containing CLOSED
   outside the `— CLOSED` marker shape, so the register's own partial-listing command mislists a
   fully-closed entry as an open partial while `isClosed()` counts it closed. Both halves are fixed;
   give it the marker shape. Heading + table row + anchor.
4. **Two new entries** for the deferred items named under Non-goals: the raw field-key export headers,
   and the visible-duplicate labels in the version-diff view. Mint numbers only against
   `origin/main` — a register number is reserved only once it is there.

---

## Constraints

- Every `src/app/*.ts(x)` is **CRLF**. Never the `Write` tool on an existing source file (it re-lines
  to LF invisibly to `git diff`; `Edit` does not). `docs/**` and `CHANGELOG.md` are LF.
- `npm run lint` is `--max-warnings=0` — every warning is fatal, including unused params from an
  extract and `react-hooks/exhaustive-deps` on an `obj.member` dep.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1.
- Never read a gate's exit code through a pipe. Redirect, check unpiped, read the file. Logs go in
  the session scratchpad, never `/tmp` (shared across sessions).
- Never run two vitest processes at once. A vitest red carrying `Failed to start forks worker` is
  contention — retry, do not debug.
- The full suite exceeds the local 10-minute cap. Run a named risk-surface file list plus
  `npm run test:shuffle`; leave the full suite and the coverage floors to CI.
- Release bump is six places — `npm run version:sync`, never a hand-edit. `version-sync-check` is
  blocking (exit 1 = drift, exit 2 = cannot scan).

## Execution

Nine units, nine commits, on `fix/nine-defect-closures`. Every unit is red-first: write the failing
test, run it, confirm it fails for the stated reason, then fix.

The nine are file-disjoint, so they build in parallel batches. Only B4 may touch `i18n.ts` /
`i18n.de.ts`, and no other unit does — so nothing needs serializing against it.

After all nine: one cold review of the whole branch, then a **deletion-only** correction round. That
is the shape that converged on the previous slice (5 → 11 → 13 findings, then 0 introduced), and the
reason is structural — an unrestricted correction round writes new claims that need their own review,
while a deletion cannot introduce one.

★★★ **The release task is separate and is gated on the user saying "release".** This plan does not
authorise push, MR or merge.
