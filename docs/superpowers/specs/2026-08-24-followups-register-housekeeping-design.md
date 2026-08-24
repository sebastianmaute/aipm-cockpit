# Follow-ups register housekeeping — design

**Date:** 2026-08-24 · **Base:** `main` @ `ec60348d` (0.258.1 "Mandelo") · **Branch:** `feat/followups-register-housekeeping`

## Origin

A nine-agent cold audit of `docs/open-followups.md` (223 headings, 150 open, 1,115,223 bytes).
Seven agents took ~22 open entries each; one hunted for open work recorded elsewhere with no entry;
one audited the file's structure. Every agent was read-only, was forbidden to run vitest/playwright,
and was asked to refute its own brief.

### What the audit established

★★★ **Not one of the 150 open entries has its core defect wrong.** Seven independent confirmations.
The failure mode the brief primed for — "describes behaviour fixed two releases ago" — occurred
**4 times in 150**. Anyone planning future work on this register should budget for the opposite
problem than the obvious one.

★★★ **~55 entries (37%) carry a false SUPPORTING claim.** The rot is uniformly in the apparatus:
counts, line cites, "X is guarded by Y" mechanism sentences, and reproduce commands that no longer
answer the sentence they are attached to. Three agents independently named the dominant class as
**extraction drift** — the entry cites a file the code has since left (§94, §98, §102, §151).
`git log -S` on the moved string finds it; no gate can.

★★★ **A false premise in one entry defers fixes in three others.** §189 measured
`document-block-editors.tsx` at exactly 800 lines — zero headroom. §188, §190 and §191 each cite
that as their reason for deferral. It has been **659 since `0387402b`**. Per-entry auditing is
STRUCTURALLY blind to this: the cluster was caught only because all four happened to land in one
agent's number range. **Partition future audits by topic cluster, not by number.**

★★ **Five entries carry code comments citing the § number back, and in three the CODE IS AHEAD of
the entry** (§132, §134, §135 — §134 and §135 record the opposite decision in source). Auditing an
entry in isolation marks all three "still open, cites fine". What found them was reading the cited
SITE, not the citation.

## Scope — decided by the user, 2026-08-24

One combined slice. Full correction depth (all ~55). All four structural changes. A version bump,
because it ships runtime code.

## Part 1 — two runtime defects (verified by hand, not by agent report)

### 1a. A Turso version restore silently blanks six workspace slices

`getVersionPayload` (`task-manager.tsx`) serializes **18** slices. `applyRestoredWorkspace` fans out
**24** `set*(w.x …)` calls. `knowledgeItems`, `insights`, `documents`, `documentVersions`,
`settingsOverrides` and `calendarEvents` are each SET from a payload that never carried them — so
restoring any version blanks all six.

★★★ The `activityLog` slice is deliberately and STRUCTURALLY absent (no `setActivityLog` binding
exists in the file), and the comment above `applyRestoredWorkspace` says so — then points at
AGENTS.md for "why it does NOT generalise to the other six slices here", **with no § to follow.**
The reasoning lives in `docs/AGENTS/activity-log.md`, a load-on-demand file.

Silent data loss on a shipped Turso-gated feature. **Fix:** add the six slices to the payload so a
restore round-trips what it captured. `documents`/`documentVersions` are meta-blob slices —
`workspaceToJson` already serializes them, so this is a payload key-set change, not a codec change.

★★ TEST TRAP: a fixture whose workspace has all six slices EMPTY round-trips identically whether or
not the fix is present. Seed each of the six non-empty and assert survival individually.

### 1b. umber-dark is scanned by the axe gate in no view, ever

`e2e/a11y.spec.ts` `COMBOS` holds six rows: harbor L/D, meridian L/D, umber **L**, beacon L.
`BUILTIN_SCHEMES` declares umber `supportsDark: true`, `UMBER_DARK` **is imported** into the spec,
and `SCHEME_SEED` **already wires it** as `umber: { light: UMBER_LIGHT, dark: UMBER_DARK }`. Only the
`COMBOS` row is missing — so everything around it reads as covered.

★★ Two register entries UNDERCOUNT this while complaining about it: §21 and §56 both say "5 of the 6
built-in scheme combos". It is **6 of 7**, and the unscanned one is umber-dark. §56 is specifically
about a dark-mode contrast failure, so it is complaining about a class in the very combo the gate
cannot see.

**Fix:** add `{ scheme: "umber", dark: true }` to `COMBOS`. This RAISES the scan count — AGENTS.md's
"110 axe scans / 111 tests" arithmetic moves and must be re-derived, not edited by hand:
`npx playwright test e2e/a11y.spec.ts --list`.

★★★ Adding a combo may turn the gate RED — that is the point of the fix, and a red run here is a
finding, not a regression to revert. If umber-dark fails, open an entry for the failure and decide
separately; do NOT drop the combo to get green.

## Part 2 — entry corrections (~55)

Grouped by what the reader loses today, because that determines the fix.

### 2a. Dead — close (4)

| § | why |
|---|---|
| §9 | all four raw-`<th>` tables folded into `SortResizeTh` (`92b3309c`); its table reads 7/7/5/0, tree reads 0/0/0/1. Close, PRESERVING the VoiceOver known-loss paragraph as the resolution note. |
| §142 | the exact remedy it lists under "options, none taken" was taken — `labelSuffix` is required, and the source cites §142 as the reason. Close, preserving the mutation-result paragraph. |
| §87 | already closed and DELIBERATELY kept ("if the tool is ever removed, that is a new entry, not a revival"). Do NOT delete. Its open ★ is now settled: `VIEW_AI_SCOPE.activity` was updated but `ASK_CLAUDE_PROMPTS.activity` is still asserted under the title "has no chips for the views whose read tools are deferred" — activity's read tool is no longer deferred. Split that out as a new entry. |
| §212 | ★★★ the ONLY heading/status mismatch in 223 entries. Body says `**Status:** CLOSED`; heading carries no marker, so it is invisible to every heading scan and will be re-audited as open forever. Append `— CLOSED <date>` to the HEADING. |

### 2b. Wrong fix instructions — a reader following them ships a half-fix or wrong work (9)

- **§113** — title and roadmap table say S3c-2 (OOXML media parts) is **open**. It shipped in 0.256.0.
  The same falsehood sits in `docs/work-inventory.md` (×4) and `docs/AGENTS/documents.md:865` ("the
  largest unbuilt piece"). ★★ Its gitignored-design-doc apparatus is also dead — `docs/superpowers/`
  became tracked in 0.253.0, so the reproduced-in-full text can be replaced by a link. ★★★ The
  genuinely open item inside it — **an untaken Turso request-size measurement that could invalidate
  the image caps** — is buried under text a reader will now distrust wholesale. Salvage it.
- **§146** — enumerates three `onClose` callers and prescribes a three-member reason union. There is
  a FOURTH (ancestor-scroll, `popover-panel.tsx:103-105`), and scroll-dismiss must NOT restore focus.
  Widen to four before anyone starts.
- **§190** — "all four call sites in `document-block-editors.tsx`". Five sites across three files
  (`bullets-block-editor.tsx`, `document-table-editor.tsx` too). Its "To close" instruction ships a
  half-fix. ★ Its own derive-loop is also vacuous ON ITS OWN SUBJECT — it excludes
  `document-block-notices.tsx`, the file the entry is about, and still exits 0 printing a plausible
  list.
- **§189/§188/§191** — the false-premise cluster. `document-block-editors.tsx` is 659, not 800.
  §189's whole "pressure is real, measured 2026-08-19" block has rotted; §188 and §191 are unblocked
  small fixes that read as blocked.
- **§134** — "`use-budget-buckets.ts` and `use-task-submit.ts` flag nothing". `use-budget-buckets.ts`
  now passes `isPrimary: true` WITH a comment giving this entry's own reasoning. Six of seven flag.
- **§135** — its premise was killed by a redesign that recorded the OPPOSITE decision in source
  (`dependencies-editor.tsx:76-103`). Rewrite to the residual (a mixed-type pair arriving from the AI
  tool / import is invisible and not individually removable) or close as superseded.
- **§204** — ★★ the entry poses a probe; the audit SETTLED it and the answer is a real leak.
  `hardDeleteProjectStatements` loops `TABLE_NAMES` only, and neither `chat_threads` nor
  `committee_report_versions` is an `ENTITY_SPECS` row, so deleting a project leaves both tables'
  rows behind. Rewrite from question to confirmed defect. **The FIX is out of scope for this slice**
  — record it, do not build it.

### 2c. Reproduce commands that no longer answer their sentence (7)

★★★ This is the class the repo's own rule ("attach a command and RUN it") does not cover: each of
these commands EXITS 0 and prints something plausible.

- **§95** — `grep -rn ":memory:" src/app/*.test.ts  # no hits` now returns THREE. Its own recommended
  fix (b) shipped as `turso-schema.execute.test.ts`. "No test in the repo opens a database, real or
  in-memory" is false. Rewrite to the residual (nothing hits a real Turso endpoint) or close.
- **§98** — its `sed` points at `workspace.ts`; the counters moved to `workspace-metrics.ts`. **Both
  positive controls now return 0** — the exact safeguard the entry built to stop a broken pattern
  masquerading as a finding, failed silently.
- **§28** — `grep -n 'TEXTAREA_MAX, "' sanitize-records.ts` returns nothing; the sink argument became
  the `RICH_SINK` constant. Its sink census says six; there are eight. Security-adjacent.
- **§214** — its enumerate command sweeps the now-tracked `docs/superpowers/` and returns **497**
  where the sentence says "roughly six". Scoped properly: 23, of which 16 are inside the entry.
  Anyone sizing the closing doc-sweep from it is wrong by two orders of magnitude.
- **§209** — count stale by two (the three byte-identical `IMG_TAG_RE` copies were consolidated by
  `e7b327a0`, AFTER the entry was written); its repro returns one line because the surviving
  declaration wraps.
- **§104** — the command lacks `-E`, so it matches nothing and exits 1 while the entry prints results
  beneath it. With `-E` it returns two files the entry says do not exist.
- **§173** — `sed -n '/const adopt/,/^      }/p'` returns zero lines; there is no `const adopt`. The
  branch is real but anchored differently (`use-chat-threads.ts:314-330`).

### 2d. Mechanism sentences overtaken by a refactor (~14)

§6 (`UNDO_CAP` is 25, not "~10" — falsified by the SAME commit the entry cites for redo) · §7
(`Field` is now imported, and the two survivors have DIVERGED, so the prescribed extract is a merge)
· §16 (four rich call sites, not six) · §37 (three other callers, not two) · §38 (`NOTE_ALLOWED_ATTR`
no longer exists) · §39 (the guard now includes `isMisconfigured`; §74 is closed) · §51 (★★★
`asyncUtilTimeout` is 15000, not the 5000 it states TWICE — so its headline rule "match on duration,
not message" now points at a signature IDENTICAL to §39's and will actively cause a misdiagnosis) ·
§88 (an `<h3>` would trip axe heading-order on three of four mount surfaces; the fix is
`role="group"` + `aria-labelledby`) · §91 (the localStorage writer is GONE; `use-storage-backend.ts`
names §91 as fixed — and the stale claim is ALSO in `task-manager.popout-guard.test.tsx:24`) · §102
(RAID adopted `SortResizeTh`, so its `grep -c aria-sort → 7` returns 0; the stale version has
propagated into always-loaded AGENTS.md) · §124 (its correction paragraph's line set and dep array
are both wrong now) · §131 (`check-agents-symbols.mjs` DOES have a test) · §132
(`CaptureCompositeOpts` DOES carry `entityKey` — the call site's comment says so) · §151 (★★ its
entire urgency argument is "these assertions sit in always-loaded AGENTS.md"; there are ZERO there —
they moved to `docs/AGENTS/rich-text.md` in the split, which INVERTS the argument) · §158 (quotes a
test title that no longer exists, while its own repro two paragraphs up uses the correct one) · §174
(the source now rules on this case explicitly at `use-chat-threads.ts:137-154`, so the entry is a
counter-argument to a documented decision, not a report of an oversight) · §180 (§226 closed) ·
§211 ("only ever emits ADD COLUMN" — it also emits RENAME COLUMN) · §133/§211/§201/§61/§62/§68/§40
(count and cite drift; see 2e).

### 2e. Count and cite drift — mechanical (~15)

§1 · §8 · §10 · §13 (the entry says "the app is 0.203.0"; it is 0.258.1, so the audit gap it
describes is 55 releases wider) · §40 (★★★ population is ~28 in section B against 18 claimed, with
TEN files unnamed — the THIRD recurrence of the exact failure the entry's own ★★★ records) · §41 ·
§44 (★★★ **both reserved codenames are spent** — `CHANGELOG.md:726` is `0.246.0 "Bodard"`, which the
entry says is free; discovered at release time otherwise) · §46 · §52 · §56 · §60 (its one actionable
residual is already resolved) · §61 · §62 (SECOND rot of the same four numbers inside an entry whose
own ★★ explains why they had to become symbols — drop them, do not renumber) · §68 · §93 · §94
(★★ every citation points at `doc-render-pptx.ts`; all of it lives in `doc-render-pptx-slides.ts`) ·
§101 · §109 (its Gantt bullet is DONE — all eight toggles carry hints; and its "still 17" now names a
different row of its own inventory, real surface 11) · §116 (its deferral target — "decide during S3b
planning" — expired four slices ago) · §128 · §138 · §139 (INCOMPLETE: four entity editors already
render a `DocumentLinksGroup` labelled "Documents" that binds `knowledgeLinks`, NOT
`linkedEntities` — whoever builds the real door must put a SECOND "Documents" section in the same
modal) · §153 · §201 · §205 (quotes `content: "⚠"`; source holds `"\26A0\FE0E "` — VS-15 text
presentation, which is exactly what the owed eye-verify has to judge) · §229.

★★★ **Dated snapshots are APPENDED to, never rewritten.** §28's "Correction 2026-08-11", §32's
"Measured 2026-08-10", §116's and §138's dated tables, §109's inventory figures are signed
observations. The repo's convention — the banner on `docs/security/findings-2026-07.md`, which §13
cites approvingly — is that rewriting a dated record to match today's tree destroys the only thing it
is good for. Add a NEW dated line; leave the old measurement intact.

## Part 3 — nine missing entries (§232–§240)

★★ Numbers are provisional. A register number is reserved only once it is on `origin/main`, and
`feat/timelog-booking-review-tl1` is unmerged with a colliding §225. Re-check the max before merge.

1. **Turso version restore blanks six slices** — the Part 1a defect. Opened AND closed by this slice.
2. **umber-dark unscanned by axe** — the Part 1b defect. Opened AND closed by this slice.
3. **Four critical flows with zero E2E coverage** — Jira sync, storage-backend switching, voice
   commands, OOXML export. Recorded at `CONTRIBUTING.md:444`, nowhere in the register — which DOES
   carry e2e gaps elsewhere (§99, §171, §215), so a reader concludes coverage is mapped.
4. **The inline task-status dropdown writes no activity-log entry.** `use-task-row-handlers.ts` has
   exactly one `logActivityRef.current(` call and it is `"task.deleted"`. The fastest path in the
   product to complete a task leaves no audit record, while the form save and the AI tool both log.
   §163 reconstructs completion trends from that log.
5. **Five ungated version-carrying files** — `package.json`, `package-lock.json` (×2), the README
   shields badge (version AND codename), the header on all five `docs/CODEMAPS/*.md`. Already drifted
   six and eleven releases. Recorded in AGENTS.md and CONTRIBUTING.md, not in the register.
6. **Two more "the AI cannot read X" gaps** — `Stakeholder.raci` is absent from both
   `StakeholderSummary` and `MilestoneSummary`; `get_dashboard_snapshot` is active-project-only with
   no cross-project tool. The register already carries a family of three (§86, §87, §89).
7. **The HTML/PDF inline export sink charges the 25 MB budget for an asset it then draws as a
   placeholder.** `sanitizeDocumentAsset` does not enforce the mime allowlist on load, so an imported
   workspace can carry a row whose bytes are fetched, charged, and dropped. §223 (which owns the
   load-path decision) is CLOSED and argues the load path is not the bug — leaving this consequence
   with no open home.
8. **`sample-workspace-{big,huge}.json` carry a regeneration duty nothing enforces** — regenerate
   when a SANITIZER changes what a field serializes to, not only when the master changes. The golden
   fixtures are byte-pinned and gated; these are not.
9. **A user custom scheme can pin `--ui-green-strong`** (it is in `ADVANCED_TOKENS`) and skip AA
   derivation. Accepted escape hatch; the register carries every other one of its class (§40, §55,
   §56, §101).

★ Deliberately NOT opened: the `docs/RUNBOOK.md` observability gap (no APM/RUM, structured logging,
uptime check or server-side error tracking). The register's header declares RUNBOOK swept-clean, and
overriding that is a judgement call for the user, not a housekeeping slice. ★★ But note the sweep is
dated 2026-07-27 — **55 releases ago** — and nothing has re-run it.

## Part 4 — four structural changes

### 4a. Move the three closing sections to EOF

`## Decided — do not re-litigate` (L5616), `## Provenance` (L5960) and `## Standing notes` (L6237)
sit at 36–40% of the file. **129 of the 150 open entries are BELOW them.**

★★★ Worse: **§99, §100, §101 and §102 are stranded INSIDE `Decided — do not re-litigate`** — four
live entries, including §100 (a measured WCAG 2.1.1 keyboard trap), filed under a heading telling
readers not to reconsider them.

Global numbering is already strictly ascending with zero duplicates, so this is a pure block move:
cut the three sections to EOF, leaving §99–§102 in the numeric run. Verify the heading count, order
and duplicate count are all unchanged.

### 4b. Fix the header's false claims

The header is **231 lines** (§1 starts at L232), and carries at least four errors:
- The `docs/baselines/` census names TWO files. There are FIVE — and one of the three unlisted is
  `followup-claims.json`, **this register's own gate baseline**, which the header does not know
  exists. Two more (`doc-line-cites.json`, `ooxml-parts.json`) are live gate inputs, so the
  surrounding "★ Only the FIRST is a live gate input" is false three ways.
- "AGENTS.md at §22 and §28" — AGENTS.md cites NEITHER. §22 moved to `docs/AGENTS/rich-text.md`, §28
  to `docs/CODEMAPS/data.md`. Same 2026-08-04-split rot as §151.
- The `superpowers` gitignore-sweep command **returns 0 for BOTH entries its own sentence names**
  (§44, §113) — they say "gitignored" without `superpowers` within 80 chars. True surface is 7
  entries across 16 lines; the command under-reports ~4×.
- "218 specs and 238 plans" → 228 and 248.

★ Prefer replacing each census with the command that DERIVES it, since a hand-maintained census
re-rots on the next doc split.

### 4c. Regenerate the index table

It covers **124 of 223 entries (56%)**; the newest 79 have no row. It contradicts the entry headings
in five unambiguous cases (row says open, heading says `CLOSED <date>`: §22, §50, §54, §112, §115).
It calls a range "CONTIGUOUS" that skips §102.

★★ Judgement needed on HALF-CLOSED entries (§64, §65, §117), where "row says open" is defensible.
Generate rows from headings so it cannot drift again, and let it double as the missing TOC — the file
has **zero anchor links** and no table of contents, so finding §142 today means scrolling to ~L9,300.

### 4d. Unify the status convention

★★★ Status is recorded two incompatible ways: **59 of 60 closed entries mark it in the HEADING**
(`— CLOSED <date>`, usually struck through) and carry no `**Status:**` line; newer entries use a
bolded `**Status:**` line. Only ~17 have the latter.

Consequence: **"N open" is not reproducible for this register.** A hand count and a heading regex
disagree by twelve, `work-inventory.md` §4 records the discrepancy, and §212 went stale invisibly
because its status lived in a form nothing scans. Every "150 open" figure in this document inherits
that uncertainty.

Pick ONE form, apply it to all 223, and make `followups:check` assert it.

★ One in-file contradiction to fix while here: L9331 says "that is §115, **still open**"; §115's
heading says `CLOSED 2026-08-13 by §140`.

## Non-goals

- Fixing §204's leak, §113's Turso measurement, or any other defect the register records. This slice
  corrects the REGISTER and ships the two defects named in Part 1. Everything else stays recorded.
- Merging `docs/tech-debt-register.md`. It is a deliberately separate artifact class — owner-assigned,
  quarterly, next sweep 2026-10-03. Linked, not merged, by the register's own header.
- Re-running the RUNBOOK swept-clean declaration (see Part 3's closing ★).

## Verification

- `npm run followups:check` — must stay exit 0, and the open count must become REPRODUCIBLE (4d).
- `npm run docs:claims:check` — BLOCKING ratchet. ★★★ It fails on a NEW `path:LINE` citation. This
  slice converts cites to symbols, which moves the count DOWN; re-baseline only after removal, via
  `node scripts/check-doc-claims.mjs --update`.
- `npm run docs:symbols:check` — does NOT scan this file (13 files = `AGENTS.md` + 12), so it cannot
  catch a bad symbol name introduced here. Grep each one.
- Full unit suite + `tsc` + lint + `size:check` + `dup:check` for the Part 1 code.
- `npx playwright test e2e/a11y.spec.ts --list` to re-derive the scan count after 1b.
- ★★ AGENTS.md needs sweeping for the claims this slice falsifies: the axe scan/test arithmetic
  (1b), §102's `aria-sort` line, and §91's popout-localStorage claim (also in
  `task-manager.popout-guard.test.tsx:24`).
