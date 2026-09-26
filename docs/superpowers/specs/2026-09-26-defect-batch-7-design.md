# Defect batch 7 — design

**Date:** 2026-09-26
**Branch:** `fix/defect-batch-7` (worktree `C:/Projects/aipm-wt-b`), based on `origin/main` once PR #429 (the §617/§618 register entries) has merged.
**Issues:** #428 (§618) · #244 (§338) · #217 (§277) · #427 (§617) · #75 (§463) · #229 (§304) · #235 (§320) · #117 (§64) · #174 (§185)

## Intent

Close nine user-visible defects in one PR. Each was re-verified against `origin/main` at `b4d38c42b` on 2026-09-26 by a read-only verdict pass: seven STILL-OPEN, #75 and #117 PARTIALLY-FIXED (only the remaining half is in scope).

Success = each defect is gone for the user; each fix is pinned by a test that is red on the unfixed code and mutation-checked; layout fixes are measured in a real browser; the nine register entries and GitHub issues are closed; `gate:local` passes.

## Constraints

- Peer session `cockpit-main` owns `scripts/**` (quality-gate tooling slice), the §617/§618 register PR #429, and the release flow. Do not touch `scripts/**` or `AGENTS.md` without telling it first.
- CPU lock: vitest / Playwright / builds / dev servers only while holding the `LOCK vitest` token agreed with `cockpit-main`.
- No `APP_VERSION` / `CHANGELOG.md` change.
- Commits cite `§NNN` only; `Closes #NN` only in the PR description; no `Claude-Session:` trailer or other attribution; `git commit --only`; never `--amend`.
- `src/app/*` files are CRLF; `i18n.de.ts` is edited by a node utf8 script matching `\r\n`, never the Edit tool; German strings use real umlauts; EN/DE key parity.

## 1. #428 / §618 — classic header overflows between `lg` and ~1390px

**Defect.** In the classic layout the search wrapper (`shell-chrome.tsx`, `lg:w-96`) is a fixed 384px from `lg` up; at 1024–1100px viewports the header content is wider than the header and the page scrolls sideways (measured: document scrollWidth 1165 at 1100 and 1024).

**Fix.** From `lg` up the classic search takes a preferred width of 384px but may shrink to a floor of 224px (flex-basis 24rem, min-width 14rem, shrinkable); below `lg` unchanged. The modern top bar is unchanged. The rejected earlier variant (the modern rule verbatim) shrank the classic search to ~209px even at 1600px; the floor and preferred basis prevent that — at 1390/1600 the search stays 384px.

**Verification.** RTL/class assertions for the wrapper; a Playwright measurement in the classic layout at 1024, 1100, 1390, 1600 wide: `document.documentElement.scrollWidth <= innerWidth`, header `scrollWidth <= clientWidth`, search width ≥ 224 at 1024 and = 384 at 1390/1600.

## 2. #244 / §338 — `useResizable` is a no-op in modals that stay mounted while closed

**Defect.** `use-resizable.ts`'s main effect runs once (`[storageKey, axis]`) and bails when its ref is null at mount; modals that render `null` while closed never attach, so a resized size is never saved or restored.

**Fix.** The hook takes an `open` flag (default `true`, so the ~40 always-mounted callers are unchanged) and re-runs its attach/restore on each false→true transition, mirroring `useDraggable`'s `wasOpen` handling. Callers that stay mounted while closed pass their open state: `task-form-modal`, `shift-edit-modal`, `asset-preview-modal`, `notes-window`; `jira-conflicts-modal` is checked and included if it has the same shape.

**Verification.** Hook test: open → resize → close → reopen restores the saved size; persisted value written on resize. Mutant: drop the `open` dependency → red.

## 3. #217 / §277 — bulk-edit field names collide with column headers

**Defect.** In four panels the bulk-edit enable checkbox, the bulk value control and the column sort button share one accessible name (13 keys).

**Fix.** Inside the shared `bulk-edit-panel.tsx` only: the enable checkbox is named "Change ‹field›" and the value control "New ‹field›" (two new EN/DE keys with a `{0}` placeholder). No per-field keys; panels unchanged.

**Verification.** Unit test using the shared row-unique-name helper over an open bulk panel + table header: no duplicate names; name queries replace the DOM-id workaround in `stakeholders-panel.test.tsx`. Mutant: revert either qualifier → red.

## 4. #427 / §617 — a meta slice whose sanitizer returns nothing is dropped silently

**Defect.** In `turso-schema.ts` `rowsToWorkspace`, a meta row that parses but sanitizes to nothing (null / empty) is skipped without `reportUnreadableSlice`; for `project_meta` the next meta-dirty save then deletes the row for good.

**Fix.** Report through the existing `reportUnreadableSlice` when the raw parsed value had content and the sanitized result is empty/null. A row stored as a genuinely empty list (`[]`) or absent stays silent. The report already pauses saving (decode failures), which is what protects the stored row. The JSON and IndexedDB load funnels are checked for the same gap and fixed the same way if they have it.

**Verification.** Real-SQL (`node:sqlite`) decode tests: non-empty-but-invalid → reported + slice absent; stored `[]` → not reported; valid → loaded. Mutant: drop the "had content" check (report on every empty) → the stored-`[]` test goes red; drop the report → the invalid test goes red.

## 5. #75 / §463 — exports silently drop enabled sections

**Defect.** The header Export button passes 11 slices and the project Export 16; neither passes calendar events, knowledge items or insights, so three Settings → Export switches have no effect and switched-on sections vanish without notice.

**Fix.** One shared pure builder (e.g. `buildExportWorkspace(ws)`) produces the full export input — every slice the document exporters can render, including `calendarEvents`, `knowledgeItems`, `insights` and the project block. Both buttons call it; the Settings → Export switches (`ExportConfig`) decide what is written, as the section builders already do. Both buttons now produce the same content, so both use the project-based filename (`aipm-cockpit-project-<name>-<date>`, falling back to the tasks name when there is no project name). CSV and Markdown are unchanged (storage formats).

**Verification.** Builder unit test: every `ExportConfig` section key has its slice present (a derived-axis test over the config keys, so a future switch without data fails). Each exporter test: a switched-on calendar-events / knowledge / insights section appears; switched off it does not. Mutant: drop one slice from the builder → red.

## 6. #229 / §304 — export column headers are raw field keys; five titles are English-only

**Defect.** PDF/DOCX/PPTX/XLSX tables use raw keys (`dueDate`, `noteLog`) as headers in EN and DE; titles "Budgets", "Roles", "Absences", "Shifts", "Project Status" are hard-coded English.

**Fix.** Section builders emit translated display labels for the four document formats (PDF, Word, PowerPoint, Excel): a per-entity field→label map that reuses the app's existing table-header i18n key wherever the field is shown in a table, and adds keys only for fields no table shows. The five titles go through `t(lang, …)`. CSV and Markdown keep raw keys. The golden files that pin document headers are regenerated (intentional format change); the storage goldens (CSV/MD) must stay byte-identical.

**Verification.** For every builder: no header equals its raw key when a label exists (test iterates the builders and the column lists), EN and DE both; titles translated. Storage goldens unchanged. Mutant: return the raw key for one entity → red.

## 7. #235 / §320 — a policy-refused image is shown as "missing" (HTML/PDF) or as a size omission (Word/PowerPoint)

**Defect.** `document-export-assets.ts` has two buckets (`missing`, `omitted`); an asset whose mime is not allowed goes to `missing`, so HTML/PDF draw the empty dashed missing box and DOCX/PPTX treat it like a budget omission.

**Fix.** A third bucket `blocked` for assets whose bytes exist but whose type is not allowed. Blocked assets do not count against the size budget. HTML/PDF render a labelled placeholder "Image not shown — file type not allowed" (distinct styling from missing); DOCX/PPTX render the same text instead of the size-omission text. New EN/DE strings.

**Verification.** Asset-resolution unit tests for the three buckets; renderer tests per format for the blocked placeholder text; budget accounting excludes blocked. Mutant: route blocked back to missing → red.

## 8. #117 / §64 — a Trends snapshot stores 0% complete while nothing is in scope

**Defect.** `snapshot.ts` captures `pctComplete: model.progress.percent` (non-nullable) even when nothing is in scope (e.g. all tasks cancelled), so the sparkline shows a false drop and a baseline can take 0% as its figure.

**Fix.** `pctComplete: number | null`; new captures store `null` when nothing is in scope. Existing stored snapshots are unchanged (decision already recorded in §64). The Trends sparkline renders a gap for `null`; baseline selection never takes `null` as its completion figure; variance already hides the row. The plan verifies how the value is persisted in the Turso snapshots table and whether `null` needs a schema/codec change.

**Verification.** Capture test (all cancelled → null; otherwise the percent); sparkline and baseline tests with a null point. Mutant: capture 0 again → red.

## 9. #174 / §185 — an over-long document paragraph is flattened at commit

**Defect.** A document paragraph over 20,000 visible characters is flattened to plain text at commit (`capHtmlText` → `degradeToPlain`), losing all formatting, with no warning.

**Fix (interactive editing only).** While editing a document paragraph, a counter appears from ~90% of `MAX_HTML_TEXT_CHARS` ("18,400 / 20,000"). Committing a paragraph over the cap is refused through the block editor's existing refusal notice, stating how many characters to remove; the editor keeps the text and formatting; nothing is flattened. AI-written and imported text keep today's fallback (out of scope, recorded in §185).

**Verification.** Editor tests: counter hidden below the threshold, shown above; over-cap commit refused with the notice and the draft intact; at/under cap commits unchanged. Mutant: let the over-cap commit through → red.

---

## Out of scope

- The rest of the register; the block-editor refusal-notice UX issues (#175–#191) beyond reusing the existing notice.
- Mark-preserving truncation for AI/imported over-long text (§185 option b).
- `APP_VERSION` / `CHANGELOG.md` (release-time).

## Verification before PR

`npx tsc --noEmit`, `npx eslint --max-warnings=0 src`, `npm run desktop:typecheck`, `npm run test:shuffle`, `npm run size:check`, `npm run dup:check`, the register gates (`followups:status/index/workitems`), `npm run docs:claims:check`, and `npm run gate:local` under the lock; axe (`--workers=1`) for any view whose controls changed; Playwright measurements for #428.
