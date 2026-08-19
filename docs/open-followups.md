# Open follow-ups — central register

_Opened 2026-07-27, at the close of 0.203.0 "Czerneda". Self-contained: it absorbed the R5 calendar
follow-ups, the 49-finding audit campaign's remainder, and the 2026-06 refactor review._

Cross-release. Everything here is **open** — found and deliberately deferred, each entry carrying
enough detail to resume without re-deriving the finding. Closed items move to "Decided" or
"Provenance" below, not to a separate document.

★ **This file has no dependencies outside the repo — all three of its source documents are gone.**
`docs/refactor-review-2026-06-19.md` was git-tracked and is recoverable with
`git show HEAD:docs/refactor-review-2026-06-19.md`. `superpowers/r5-calendar-followups.md` and
`superpowers/audit-campaign-remaining.md` were gitignored, so they were never in the repo and are
recoverable only from the local archive described below. Everything worth keeping from all three is
reproduced here — nothing in this file requires reading them, and each fact was re-verified against
0.203.0 on the way in rather than copied forward. ★ Do not add a link pointing into
`docs/superpowers/`: that whole tree is gitignored, so such a link is dead for everyone but the
machine that wrote it.

**Deliberately NOT absorbed:** [`tech-debt-register.md`](tech-debt-register.md) is a different
artifact class — owner-assigned, quarterly-reviewed, next sweep **2026-10-03**. Copying TD-1/2/3/5/6/7
here would create two masters and guarantee drift. It is linked, not merged; §2 and §7 below note
where they touch.

**Doc cleanup 2026-07-27 — what was deleted, and where its content went.** Four superseded documents
were removed after their live content was extracted here. All four were git-tracked, so
`git show HEAD:<path>` restores any of them:

| deleted | why | content now lives |
|---|---|---|
| `docs/refactor-review-2026-06-19.md` | 2026-06 review of v0.104, ~100 releases stale | §7 below — 4 of 9 findings survive, the other 5 recorded as closed with reasons; its Tier C rejects are in "Decided" |
| `docs/tech-debt-remediation-roadmap.md` | Phases 1–4 all complete — a finished plan | nothing outstanding; `tech-debt-register.md` is the live artifact |
| `docs/baselines/deadcode-2026-07.md` | every AMBIGUOUS hit resolved false-positive in Phase 2 Task 4; the one real deletion is made | nothing outstanding |
| `docs/baselines/knip-raw.txt` | raw tool output backing the above | nothing outstanding |

`docs/baselines/` keeps **`file-sizes.json`** and **`jscpd-2026-07.json`**. ★ Only the FIRST is a
live gate input (`scripts/check-file-sizes.mjs:6` reads it by name). The jscpd file is a retained
July-2026 report, kept for comparison and read by NOTHING — `npm run dup:check` passes only
`--threshold` and there is no `.jscpd.json`. Keep both files; do not claim the duplication gate
consults one. Also removed: **296 orphaned per-slice `plans/` + `specs/` docs** referenced
from nowhere (35 kept — 3 linked from AGENTS.md, 30 from the memory files, 2 git-tracked). All 331
are archived byte-identical in `docs/superpowers/_archive-slice-docs-2026-07-27.zip`. ★ That archive
lives under a **gitignored** path, so it exists only on this machine — it is not in the repo and not
in anyone else's checkout.

**Swept clean 2026-07-27 — nothing open in these, don't re-read them looking:** the 18-requirement
multi-surface roadmap (R1–R5 all shipped, there is no R6; its only unshipped line is §4.3b
`optimize_wbs` = item 3 below — its spec is `docs/superpowers/specs/2026-07-24-multi-surface-feature-roadmap-design.md`,
gitignored and local-only) · `docs/RUNBOOK.md` · `docs/DESIGN-TOKENS.md` · `docs/architecture/*.md` ·
`docs/security/threat-model.md` (every residual carries an acceptance, no live action).

★ `docs/CODEMAPS/*` are **stale, not obsolete** — generated 2026-06-10/11/26, roughly 50 releases
behind. Regenerate with `/ecc:update-codemaps`; do not read them as current.

| # | Item | Origin | Size | State |
|---|---|---|---|---|
| 1 | Two dead `memo()`s in the Resources subtree | R5 (0.202.0) | S–M | **fork open — decision needed** |
| 2 | ~~`use-resource-planner.ts` 30% over the 800-line ceiling~~ | R5 (0.202.0) | M | **CLOSED post-0.212.0** — two verbatim extractions, 1043 → 553 |
| 3 | `optimize_wbs` never built | R4 (0.201.0) | ? | owed; open design question |
| 4 | Two-tab last-writer clobber on file/IDB (#39) | audit (2026-07) | L | parked — own design |
| 5 | No list virtualization anywhere (#14) | audit (2026-07) | L | parked — own batch |
| 6 | Undo residuals: project delete, persistence, retention (#11) | audit (2026-07) | M each | optional, unscheduled |
| 7 | Four surviving dedup seams from the 2026-06 review | refactor review | S–M | re-verified 2026-07-27 |
| 8 | `tour-overlay` claims `aria-modal` with no Tab trap | 0.203.0 (Czerneda) | S | open — a11y, unguarded |
| 9 | `aria-sort` inconsistent across the four raw-`<th>` tables | 0.202.2 | S | open — a11y, unguarded |
| 10 | Keyboard move has no preview (band + day grid) | R5 (0.202.2) | M | open — a11y/UX |
| 11 | ~~`instanceof DOMException` abort check misreports a user cancel~~ | 0.201.0 | S | **CLOSED 0.211.1** — shared `isAbortError`, all four sites |
| 12 | `list_allocations` dumps the grid; should be a scoped query | R4 (0.201.0) | M | open — design |
| 13 | Security audit is scope-stale — 39 releases of unaudited surface | audit was v0.164 | M | open — re-scope |
| 14 | ~~Timelog has two per-device stores keyed differently~~ | 0.207.0 | S | **CLOSED 0.211.1** — re-keyed canonical, no fallback |
| 15 | ~~Two file-picker patterns — extract a `FilePickerButton`~~ | 0.208.0 (Yolen) | S | **CLOSED 0.211.1** — three sites, spun off §46/§47 |
| 16 | Dictation flattens rich formatting | 0.196.0, widened 0.209.0 | M | open — needs a design |
| 21 | Eye verification owed: change + milestone editors, 4 detail cases | 0.209.0 (Lafferty) | S | open — a11y/visual |
| 22 | `clipText` can split a surrogate pair (~54 call sites) | 0.209.0 (Lafferty) | M | open — needs golden regen |
| 24 | Named entities aren't decoded — miscount + mid-entity truncation | 0.209.0 (Lafferty) | S | **open — named tail only** |
| 28 | CSV/MD/Turso never DOMPurify a rich field at load | 0.196.0, widened 0.209.0 and again 2026-08-11 | M | open — needs a new boundary. ★★ The 2026-08-11 `unify-rich-text-s1` classifier move widened the door by TEN leading tags (`hr s code mark sub sup pre blockquote h3 h4`) — the measured, INTENDED price of closing §107/§137, not a new defect. Same entry also corrects its own table: the `noteLog` row is browser-only, and `decodeNoteLog` silently returns `[]` under bare node |
| 29 | ~~`form.noteLog` is dead state in the task form~~ | 0.209.0, promoted 0.210.0 | S | **CLOSED 0.211.1** — field removed, guard re-proved |
| 30 | A link in a task description loses its address in document exports | 0.210.0 (Larbalestier) | M | open — needs a decision |
| 31 | `sanitizeRichText` caps visible text, so markup bytes are unbounded | 0.210.0, pre-existing for 3 of 4 | M | open — truncates stored values |
| 32 | `HTML_START` misclassifies `<a note…>`-shaped plain text, deleting it | pre-existing, reach widened 0.210.0 | S | open — read-time classification |
| 33 | A multi-paragraph description can overflow its PPTX box | 0.210.0 (Larbalestier) | S | open — cosmetic, needs eye-check |
| 34 | ~~DOM-free guard filtered by NAME LIST (18 of 76 graph files)~~ | 0.210.0 (Larbalestier) | S | **CLOSED 0.210.0 — guard now resolves the import graph** |
| 35 | `sanitizeAiRichText`'s double pass can double-escape `<a-b>`-shaped markup | 0.210.0 (Larbalestier) | S | open — suspicion, same root as 32 |
| 36 | Template import has no allow-list; `noteLog` exports as a JSON blob — both wrongly cited as recorded in §28 | 0.210.0 (Larbalestier) | S | open — one decision each |
| 37 | `RaidItem.title`/`owner` have NO storage-side cap on any save or load path | pre-existing, found 0.210.0 | M | open — read-time normalisation care needed |
| 38 | `ALLOWED_URI_REGEXP` strips `target`/`rel` from every stored link — all links open same-tab | pre-existing, found 0.210.0 | S–M | open — not a vulnerability; moves goldens |
| 39 | Timelog partial-failure toast has failed CI eight times; a bigger timeout did not fix it | first seen 0.205.0 | M | open — mechanism CANDIDATE (a click swallowed by the button's `disabled` state): precondition proved locally, **causation unreproduced**; fix landed in both affected tests |
| 40 | `text-ui-dark-blue` with no mode-appropriate companion — **40 sites** | pre-existing, counted 0.211.0 | M–L | open — needs its own slice |
| 41 | Eye verification owed on 0.211.0, on surfaces no gate reaches | 0.211.0 (Samatar) | S | open — a11y/visual |
| 42 | `CalendarSyncControls` push/pull buttons carry unqualified names | pre-existing, found 0.211.0 | S | open — WCAG 2.4.6 |
| 43 | Two "Suggest RACI" reporting gaps | 0.211.0 (Samatar) | S | open — both incomplete rather than wrong |
| 44 | UX-roadmap S6 planned but UNEXECUTED, S7 undesigned | roadmap (gitignored, local-only) | L | open — invisible to every tracked doc |
| 45 | ~~`brace-expansion` advisory in the eslint dev chain~~ | 0.211.0 | S | **CLOSED 0.211.1** — major-scoped `overrides` pair |
| 46 | A `<label>`-wrapped file input can never show a focus ring | 0.211.1 | S | closed for 3 sites — **pattern open** |
| 47 | `chat-panel` clicks a `display:none` file input | pre-existing, found 0.211.1 | S | open — contradicts §15's own warning |
| 48 | ~~RAID editor destroys notes added while it is open~~ | pre-existing, found 0.211.1 | M | **CLOSED 0.211.1** — `noteLog` read from the stored row |
| 49 | ~~Every AI edit to a RAID item erased its whole note log~~ | pre-existing, found 0.211.1 | S | **CLOSED 0.211.1** — `updateRaid` re-applies the stored `noteLog` after sanitizing |
| 50 | Undo of a BULK edit reverts write-through fields | pre-existing, found 0.211.1 | M | open — **DATA LOSS**, shared undo engine, tasks likely affected too |
| 51 | `use-tasks-dedup` "on confirm" fails under CI load | found 0.211.1 (main #5418) | S–M | open, narrower — the recorded symptom cannot recur; ★★ two of this entry's OWN claims were false and are corrected; ★★★ a future failure wears §39's clothes — match on duration, not message |
| 52 | `useColumnResize`'s v1→v2 migration pins defaults for existing users | 0.212.0 (Nayler) | M | open — deliberate; a v1 payload is a defaults SNAPSHOT, and the cheap fix is already foreclosed |
| 53 | ESLint 10 is blocked upstream by `eslint-plugin-react` | 0.211.2 | — | open — **not actionable today**; a dated MEASUREMENT, re-measure before acting |
| 54 | Prod-only CSP blocks ProseMirror's base CSS | pre-existing, found 0.211.2 | S–M | open — **user-visible in production**, no gate sees it |
| 55 | Twelve hand-rolled `aria-pressed` toggles show their on-state by colour alone | 0.212.0 (Nayler) | M | open — a11y (1.4.1), unguarded; ★ 2 of the 12 are NOT colour-only; was 14 (tier selector → `SegmentedControl`), then 13 (editor toolbar → `ToggleButton`, 2026-08-11) |
| 56 | `ToggleButton`'s pressed state is near-invisible in all three DARK schemes | 0.212.0 (Nayler) | S–M | open — **WCAG 1.4.11**, 1.03–1.22:1; fix belongs in the scheme maps |
| 57 | Four toolbar Outlook enable-toggles carry an untested `auto` guard | 0.212.0 (Nayler) | S | open — the storage-layer mask IS pinned; these four are not |
| 58 | The axe gate can pass against a STALE dev server | 0.212.0 (Nayler) | S | **gate half CLOSED post-0.212.0** — version stamp + guard test; the sibling-worktree half is OPEN, three candidates sketched and unverified |
| 59 | Eye verification owed on 0.212.0 — and on the two releases before it | 0.212.0 (Nayler) | S | open — ★ the finding is the PATTERN, three releases running |
| 60 | The file-size ratchet ignores every file at or under 800 lines, so a sub-limit baseline entry is inert | pre-existing, found post-0.212.0 | S | open — no fix proposed; ★ §2's re-record buys nothing but dropping the stale 1043 |
| 61 | Three residuals from the `use-resource-planner` split | post-0.212.0 | S | open — cosmetic + a stale comment + a dup seam jscpd cannot yet see |
| 62 | Two reference-data handlers have no production consumer, only tests | pre-existing, found post-0.212.0 | S | open — delete-or-record; ★ needs a non-move-only commit |
| 63 | ~~`gantt.tsx` crossed 800 and was baselined rather than split~~ | post-0.212.0 | M | **CLOSED in 0.213.0** — split after all; `gantt.tsx` is 715 lines and its baseline entry is gone |
| 64 | Other surfaces still read "0% complete" for an all-cancelled project | cancelled-work presentation | S | **half closed post-0.216.0** — presentation + model feeds done; the persisted `pctComplete` and landing-state `complete:` remain, deliberately |
| 65 | A `Done` task with no `completedDate` shows the cross while its tooltip says "completed" | cancelled-work presentation | S | **half closed post-0.216.0** — tooltip fixed by a three-way driver; the entry's second symptom (such a row still called "cancelled" in the UI) is open |
| 66 | ~~The R/A/G tile counts a cancelled task GREEN, one tile from the fix~~ | cancelled-work presentation | M | **CLOSED post-0.216.0** — out-of-scope work leaves the tally and is counted separately |
| 67 | ~~A committed NUL byte makes `use-portfolio-health.ts` invisible to content greps~~ | pre-existing (`909118b2`) | XS | **CLOSED post-0.216.0** — source escape, plus a ratchet |
| 68 | Allocation rows' `border-t` sits on the `<tr>`, where it has never painted | 0.214.0 (Lostetter) | S–M | open — **VISUAL change across six panels, needs sign-off**; 6 of the 8 sites unconfirmed |
| 69 | `BrandingConfig`'s "is this blob empty?" is answered in TWO places | 0.214.0 (Lostetter) | S | open — silent data loss on a missed field, not an error; ★ it bit on the FIRST addition |
| 70 | A budget bucket's Total column and total row follow the role filter | 0.214.0 (Lostetter) | S | open — product decision, untested either way |
| 71 | A budget bucket evaluates `cellBudget` three times per (row, period) | 0.214.0 (Lostetter) | S–M | open — unmeasured; the prize is structural (one matrix, two axes), not speed |
| 72 | ~~Caller callbacks fire after unmount — the `unit-tests` job exits 1 with every test passing~~ | pre-existing, captured on main #5446 | M | **CLOSED in this slice** — `mountedRef` + four emitters, 33 sites + 3 pass-throughs, for CALLER CALLBACKS only; see the entry's Residual block. ★ Row-only history: `refreshBackendStatus` was closed later by `0fa2e9c6` (this row said "surveyed, left" long after the body said "NOW GUARDED"), and an earlier one-name version of this row contradicted the body |
| 73 | ~~`onTestFailed` reports post-teardown state, so any capture it makes is a false witness~~ | found post-0.214.0 | S | **CLOSED** — recorded in AGENTS.md's `npm run test:run` block |
| 74 | ~~The TimeLog action handlers omit a guard their buttons carry~~ | pre-existing, found post-0.214.0 | S | **CLOSED** — shared pure `timelog-guards.ts` predicates; all four button wirings DOM-pinned |
| 75 | ~~Two test files contain ORDER-DEPENDENT tests (intra-file, NOT cross-file leakage)~~ | pre-existing, found post-0.214.0 | S–M | **CLOSED** — both leaks fixed, plus the pinned-seed blocking gate `unit-tests-shuffled` and a weekly random-seed sweep |
| 76 | ~~Two hooks have a CLEANUP-ONLY `mountedRef` — dev-only total suppression after StrictMode's remount~~ | pre-existing, found post-0.214.0 | S | **CLOSED** post-!346 — `use-scheduled-jobs.ts` + `use-operating-guides.ts` now re-set on mount; both pinned |
| 77 | ~~The snapshot capture gate is a one-way latch, so a mid-session storage switch can still capture the wrong project~~ | found post-0.214.0 | M | **CLOSED** post-0.226.0 — identity (`loadedBackend === backend`) derived in RENDER, not a latch; ★★ needs the re-stamp in the suppress branch or it strands closed at all seven arm sites |
| 78 | A brand-new Turso project auto-captures an empty snapshot, and that row becomes the BASELINE | pre-existing, found post-0.214.0 | S | **HALF CLOSED** post-0.226.0 — the ALL-null empty-project case gates the CAPTURE, not `isFirstEver` (★★ gating the flag would NOT have worked — `pickBaseline` falls back to the earliest row); ★★★ the partial-KPI half is OPEN — a project with one task and no budget still baselines a row with no SPI/CPI |
| 79 | The lane engine resolves a person by name but ignores `assigneeEmail`; the backfill prefers email | found post-0.214.0 | S | open — narrow: only a task created in-session with an email and no usable name; self-heals at next load |
| 80 | ~~Both hide-external toggles trust whatever `readDeviceJson` returns~~ | pre-existing, found post-0.214.0 | XS | **CLOSED** — `=== true` at both sites; both pinned |
| 81 | ~~The swimlane no-op drop guard no longer holds for a name-resolved task~~ | 0.214.0 (Lostetter) | S | **CLOSED** — guard asks `laneKeyOf`, and `source` carries caller INTENT |
| 82 | The task-FK backfill lives in a React hook, outside the numbered migration chain | found post-0.214.0 | M | open — a permanent normalisation pass, not a one-shot migration; ★★ TWO load funnels, both now pinned |
| 83 | Email/name disagreement in the FK backfill resolves silently to email | found post-0.214.0 | XS | open — deliberate (an address is the stronger identifier), but nothing surfaces the disagreement |
| 84 | ~~A THIRD order-dependent test in `use-storage-backend.test.tsx` — different mechanism from §75~~ | pre-existing, found post-0.214.0 | S | **CLOSED, FALSE** — same §75 mechanism, measured on a tree with only the `beforeEach` half of the fix |
| 85 | ~~StrictMode does NOT double-invoke effects under vitest — cause unknown~~ | pre-existing, found in the slice-3 review | M | **CLOSED, FALSE PREMISE** — it DOES double-invoke here in the right wrapper shape; `src/app/strictmode.meta.test.tsx` is the standing instrument |
| 86 | AI cannot read timelog entries — no tool exposes them | view-scoped AI prompts, unreleased | — | deliberate — `VIEW_AI_SCOPE.timelog` says so; no chips |
| 87 | AI cannot read the activity log — no tool exposes it | view-scoped AI prompts, unreleased | — | deliberate — `VIEW_AI_SCOPE.activity` says so; no chips |
| 88 | `ai-section.tsx`'s own sub-section titles are styled `<span>`/`<p>`, not real headings | found during view-scoped AI prompts review, unreleased | S | open — a11y, unguarded; the new disclosure's `<h3>` was not extended back to them |
| 89 | AI cannot read absences, and the Resource-calendar view renders them beside meetings | view-scoped AI prompts, unreleased | S | open — buildable (absences are in `Workspace`, unlike §86's live external calls); out of scope for that slice. ★ Had a detail section but NO table row until 2026-08-06 |
| 90 | `onCreateResource` is unguarded in a popout and cannot take `guardEdit` — it returns the new resource id, which the guard would widen to `number \| undefined` | found in the help-coverage slice-3 review, unreleased | S | open — a popout can create a resource via the RAID/task picker while the save around it is blocked |
| 91 | A popout can record an undo entry and persist an activity line | found in the help-coverage slice-3 review, unreleased | S | open — `onCaptureRaidBulk` is unguarded and `useUndoHotkey` is unconditional, so bulk-apply + Ctrl+Z writes `setRaid` and `logActivity("undo")`; the activity log is localStorage with no `isPopout` check, so that line outlives the window. Gating the hotkey closes both |
| 92 | The `settings-types` ⇄ `workspace` ⇄ `document-model` value-import cycle is a standing trap for any eval-time snapshot | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | S per instance | open — a TRAP, not a defect. **Sweep 2026-08-06 CLEAN**, no unfixed instances; carries a verified structural triage rule (exporter must transitively import the snapshotter) so the next candidate is decidable, not guesswork |
| 93 | The PPTX truncation notice is a hardcoded English frame wrapped around a LOCALIZED section title | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | S | open — i18n; affects BOTH PPTX paths, and only the newer one carries a code comment saying so |
| 94 | PPTX pagination counts logical lines, so a wrapped long line still overflows the slide | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | S–M | open — eye-verify owed; UNBOUNDED overflow is fixed, bounded overflow remains and no test in this repo can see it |
| 95 | No test exercises a real Turso database on any path — meta-blob coverage is statements → synthetic results | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | M | open — class-wide (`documents` · `insights` · `knowledgeItems`), not a documents-specific gap |
| 96 | The document preview/print path loads the whole `export-sections` registry even for a document with no `dataSection` block | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | S–M | open — measured 60 runtime modules, 59 of them from that one import; priority UNKNOWN, no bundle measurement taken |
| 97 | The DOM constraint **INVERTED** for the document load paths — they now REQUIRE a DOM, and failure is silent | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | S | open — TRAP, safe today. Contradicts the widely-repeated "you cannot call DOMPurify here" lore (§36(a)). ★ The catastrophic half is **FIXED**: the JSON path used to lose the ENTIRE workspace (measured tasks: 0) and is now contained to documents-only like the other three. The DOM dependency itself is unchanged, which is why this stays open |
| 98 | `documents` is in NEITHER save-time data-loss counter, so a documents-only wipe trips no guard | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | M — two lines of code, but it moves a live save-REFUSAL threshold | open — MISSING NET, **no known live path**, and NOT a regression the documents slice introduced. `knowledgeItems`, `insights`, `timelogLinks` and `settingsOverrides` share the gap — **state that scoping whenever this row is quoted**, or a reader goes hunting for a documents bug that is not there. Widening `nonEmptyCollectionCount` / `workspaceRecordCount` shifts the L3 and Layer-B thresholds for EVERY existing project, so it needs its own slice, its own tests, and a deliberate decision on whether the other four join |
| 99 | The e2e seed writes only four of BrowserBackend's ten optional kv slices, so any view backed by one of the other six is axe-scanned against its EMPTY STATE | AI document authoring S1 — **shipped in 0.219.0 "Elgin"** | S per slice | open, PARTLY CLOSED 2026-08-08 — `insights` and `timelogLinks` were seeded on 2026-08-08, so **Insights is no longer in this position**; six remain (`fieldVisibility`, `features`, `steeringCommittee`, `knowledgeItems`, `settingsOverrides`, `calendarEvents`). `documents` was the same defect and seeding it immediately exposed a real serious violation, so seeding the rest may legitimately turn scans RED for the first time. ★ Re-measure rather than quoting: `grep -c "^const KV_" src/app/browser-backend.ts` (→ 10) against `e2e/seed.ts`'s `KV` map (→ 4) |
| 100 | Tab ejects focus from a portaled popover opened inside a modal, leaving it open and its contents keyboard-unreachable | field controls → modal header, unreleased | M | open — WCAG 2.1.1, **measured in Chromium** from both a radio and a checkbox. PRE-EXISTING and architectural (`Modal`'s trap guards on `container.contains`, false for every element in a portal); the move only made it prominent. Invisible to jsdom (the control's tests never mount inside `Modal`) and to axe |
| 101 | `SegmentedControl`'s selected segment is distinguished by fill alone in the three DARK schemes | field controls → modal header, unreleased | S | open — computed track-vs-active lightness 2.38 / 2.43 / 2.25:1 dark vs 10.42 / 8.73 / 10.54:1 light, against this repo's own ≥3:1 bar; `--shadow-control` is `none` with no per-scheme override, so there is no fallback cue. Screen readers unaffected (`aria-checked` carries it). Pre-existing, shared by 31 invocations |
| 103 | ~~Opening an over-`MAX_DOCUMENTS` file silently and PERMANENTLY destroys the excess documents on the next save~~ | **shipped in 0.219.0 "Elgin"** (`90199c26`), found in S2 | M | **CLOSED** — cap raised 200 → 1000 (ONE constant, both doors), the truncation is COUNTED as an upper bound, every backend publishes `lastLoadTruncation` under a registry-test guard, one consumer at the generic load effect, and automatic saves PAUSE until the user accepts. ★ The persistent banner's "Save anyway" is load-bearing, not polish: the user cannot delete their way under the cap, so a sticky guard without an escape would be a permanent save lockout |
| 104 | `ai.documentWrite` activity rows are now written, but `activityViewOf` has NO production caller, so clicking one still navigates nowhere | AI document authoring S2 (`d7f1e0b9`) | S to wire, but the placement is a decision | open — the ROUTING FUNCTION was never called from production, so emitting the rows did NOT light the path up. Anyone who sees the rows start appearing will reasonably assume the deep-link works |
| 105 | ~~CSV section markers are matched on RAW LINES, so a newline inside a quoted cell switches the parser's section mid-row and the rest of the row decodes as absent~~ | property-based coverage (`!360`, no bump), found by `codec-roundtrip.property.test.ts` | M — silent data loss | **CLOSED 2026-08-16** — was **MEASURED**, not reasoned: `blockers: "step one\n# RAID\nstep two"` → `"step one"`, with no throw, no `ImportDiag` and nothing in the UI, across every entity the CSV backend writes. Fixed by `splitCsvLines` (`csv-line-scan.ts`), which breaks a line only outside a quoted cell; the property is now LIVE (the `describe.skip` this row used to point at is gone — the only remaining skip in `codec-roundtrip.property.test.ts` is §106's unrelated Markdown fixed-point one). ★ Markdown was immune BY CONSTRUCTION all along (`mdEscape` turns every newline into `<br>`) — do not "simplify" that away |
| 106 | The Markdown codec is not a fixed point when bare CRs precede a newline — one CR is lost per save/load cycle with no edit in between | property-based coverage (`!360`, no bump) | XS | open — converges, and only ever loses CRs, so it sits well below §105. Recorded because "the stored value changed on a load that made no edit" later reads as corruption. ★ Found only at `numRuns: 1500`; the **deterministic companion is the reliable reproduction**, not the property, which is itself seed-dependent |
| 107 | ~~`HTML_START` (8 tags) and `sanitizeTemplateHtml`'s `ALLOWED_TAGS` (11) disagree about `u` / `h1` / `h2`, so a model description LEADING with a heading is stored as escaped literal markup~~ | property-based coverage (`!360`, no bump) | M | **CLOSED 2026-08-10** — the one shared 8-tag classifier is GONE (the name `HTML_START` is retired; it survives only in comments). `html-start.ts` derives a regex PER SINK from that sink's own allow-list, and `descriptionHtml` / `sanitizeRichText` now REQUIRE the sink with no default, so tsc enumerated every call site instead of leaving one on a silent fallback. ★★★ READ THE ENTRY TO THE END: its retraction block is the only record of why widening the shared constant was wrong, and its closure note points at **§137** — storing the model's `<h1>` as real markup is correct and it converted a visible-but-lossless defect into a silent lossy one on a path this row never mentions. ★★★ THIS ROW'S LAST CLAUSE IS NOW HISTORY — it read "CLOSED MEANS 'THE CLASSIFIER IS FIXED', NOT 'THE PAYOFF IS DELIVERED'", because `sanitizeRichFields` applied the narrow **`note`** sink on both whole-object load boundaries and `<h1>Title</h1><p>body</p>` came back as `<p>&lt;h1&gt;Title&lt;/h1&gt;…</p>`. **§137 CLOSED that on 2026-08-11**: the `note` and `template` sinks merged into one `rich` sink and the narrow sanitizer is DELETED, so the payoff IS delivered for values written from now on. ★★ Values already stored escaped are NOT repaired — that residue is **§141** |
| 108 | The meeting-report HTML is truncated by a raw `.slice`, so it can cut mid-tag as well as split a surrogate pair | split out of §22 rather than folded in — same shape, strictly larger problem | S | open — the value is HTML, so a raw cut lands inside a tag (`<stro`) and stores malformed markup. Copy `capHtmlText`'s project → truncate → **re-wrap**, NOT `clipText` (correct only for plain text). ★★ Do NOT route it through `sanitizeText`: that fixes the surrogate half, leaves the mid-tag cut, and makes the call site LOOK guarded — the more dangerous state. Reachability narrow, unmeasured in the wild |
| 109 | Icon-only controls with no hover tooltip, plus one control whose accessible name comes only from its `title` | filed on `feat/ui-batch-slice-2` as §103, renumbered TWICE — **shipped in 0.223.0 "Okorafor"** | M — ratchet | open — full audit in [`docs/tooltip-inventory.md`](tooltip-inventory.md). ★★ Its counts are SNAPSHOTS and moved within one day; re-run the inventory's parser before quoting any as present-tense. Open surface at `9927d045`: **17** untitled icon-only controls; Class B row **B1** (the settings cog) HELD pending the modern shell's own route to Settings; five of the Gantt View menu's eight toggles carry no hint; **one name defect** — `workspace-section-chrome.tsx:165` is named by `title` alone and **axe passes it**; and 15 hardcoded-English accessible names across nine files that tsc's key-parity check structurally cannot see |
| 110 | `IconButton` cannot express a non-`rounded-md` / non-`p-1` control, so a circular 20px chip cannot be converted to it | found while converting the close-button family in slice 2 — **shipped in 0.223.0 "Okorafor"** | S–M | open — `raci-chip-picker.tsx`'s ✕ is the fifth of five sibling chips sharing a `h-5 w-5 rounded-full` base. ★★★ A caller `className` CANNOT reliably override: Tailwind resolves conflicting utilities by **stylesheet source order**, not class-attribute order, and `p-1` sorts after `p-0` — so this is a primitive problem, not a call-site one. A KNOWN, DELIBERATE hand-roll; do not "finish the conversion" before the primitive gets a shape/size escape hatch. ★★ jsdom has no layout, so no unit test can catch the regression — eye-verify only |
| 111 | Document row controls are named by a title that is NOT row-unique, and the code comment asserts that it is | found 2026-08-08 by a merge review, in main's document-authoring code | M | open — a11y, WCAG 2.4.6, six controls per row. ★★★ **The false comment is the defect** — an untrue invariant outlives the code, because the next reader stops checking. `uniqueDocumentTitle` runs at only two of the four title-writing paths; `commitRename` and `use-document-tools.ts`'s `createDocument` (the MODEL's title, untouched) both bypass it, and `document-model.ts` holds no uniqueness check either. ★★ Being in `A11Y_VIEWS` does NOT help: the seed's two documents have DISTINCT titles, so the collision never renders at scan time |
| 112 | The settings rail's `role="group"` breaks the wrapped narrow-viewport layout — the active parent pill stretches to the group's full height and unrelated top-level entries interleave onto a child's row | slice 2 eye-verify on a seeded Playwright run — **shipped in 0.223.0 "Okorafor"** | S | open — UX. Visible only there: jsdom has no layout, and the axe gate scans one desktop viewport with no rule for wrap order. ★★ This is the **COST of a deliberate choice**, not a regression against it — `display: contents` was rejected because its a11y-tree exposure is browser-version dependent and being ANNOUNCED is what the group exists to deliver; do NOT reach for it. Likely fix `basis-full`. ★ Reproduce: activate the AI Assistant branch FIRST, then narrow to 760px — narrowing first drops the rail's labels and there is no group to reflow |
| 113 | The documents roadmap — block editor, entity attachment and images — is designed but UNIMPLEMENTED, and the design lives only in the gitignored tree | designed 2026-08-08 against 0.222.0 "Charnas" | XL — four releases | open — §44's failure mode, pre-empted: the decisions are reproduced in full below so the roadmap survives without that tree |
| 114 | ~~`HTML_START` does not know the nine tags `sanitizeDocumentHtml` adds, so a document paragraph LEADING with one of them is stored as escaped literal markup~~ | S3a (`feat/documents-s3a-foundations`) — scoped out of the slice deliberately, see its plan's "does NOT do" | S-M | **CLOSED 2026-08-10** by §107's derive-per-sink split — the `document` sink derives from `DOCUMENT_ALLOWED_TAGS` (20), so all nine are recognised and the `<p>`-wrapping INSTRUCTION below is no longer the only thing standing between a model and an escaped value. Was a SECOND instance of §107's drift class, now on a THIRD list; the mechanism lives there and is NOT restated here. ★★ The common shape is covered by an INSTRUCTION, not by construction: `chat-tool-defs-documents.ts` tells the model to wrap every paragraph in `<p>` and `p` is one of the eight — so a model that ignores it and returns a whole-paragraph `<blockquote>`/`<pre>` still escapes. ★ The DIRECTION is the mild one: this ESCAPES (visible, recoverable), it does not DELETE as §32 does |
| 115 | `ALLOW_DATA_ATTR` is left at DOMPurify's default TRUE in `sanitizeRichHtml`, which admits arbitrary `data-*` across every rich surface | found while making `DOCUMENT_ALLOWED_ATTR` a real gate in S3a | S | open — ★★ RESCOPED 2026-08-11: the two sanitizers this row used to name are DELETED and replaced by ONE, so it is now a **ONE-line** fix, but the blast radius GREW (21 tags where the wider predecessor had 11). `ALLOW_DATA_ATTR: false` still occurs ONCE in `sanitize-html.ts`, inside `sanitizeDocumentHtml`; grep the SETTING, not the bare name. ★★ The re-admission set is still **EMPTY**, re-verified against the new editor — but `@tiptap/extension-highlight` emits `data-color` under `multicolor`, whose default is `false`, so one config flag would end that. No known exploit: `data-*` carries no script. **§140 owns closing this** |
| 116 | The duplication gate compares the TOTAL duplicated-LINE percentage (1.19% vs 1.75), not the per-format token figure — and S3b is a large `.tsx` slice | measured 2026-08-08 during the S3a gate run; the first revision inherited AGENTS.md's "per-format" and was wrong | S — a deferred decision, not a defect | open — ★★ the gate reads ONE of the six cells the console prints: total LINES. Bisect by exit code — `npm run dup:check` exits 0 at `--threshold 1.19` and 1 at `1.18` ("found too many duplicates (1.2%)"); 1.52 and 1.60 both exit 0, ruling out total-tokens and per-format-tokens. Headroom is 0.56pp, not 0.05pp. Decide during S3b planning: refactor the top tsx clones, or raise the threshold |
| 117 | The three traps S3c walks into the moment images go live — image-only paragraphs are deleted on load, `data-asset-id` values are entirely unvalidated, and adding `src` to the allow-list opens `data:` URIs on `img` | measured 2026-08-08 during the S3a review, all three inert today | M | open — three S3c PREREQUISITES, not live defects. ★ Each is measured with the probe in the entry, not reasoned. ★★ (a) makes the S3a rationale for allow-listing `img` FALSE as written (`sanitize-html.ts`), which is the §111 class: the comment outlives the code and the next reader stops checking |
| 118 | ~~A legacy plain-text `paragraph.html` collapses to one line in every renderer — and the obvious fix was implemented, measured to DESTROY valid markup, and reverted~~ | S3a; the collapse found by review, the fix's defect found by implementing it 2026-08-08 | M — blocked on §114 | **CLOSED 2026-08-10 in TWO commits, and the FIRST was wrong in a NEW way.** With the classifier split landed, composing `descriptionHtml(html, "document")` at the three renderers fixed the fusing and turned the falsification test green — but ESCAPED every paragraph opening with a tag the 20-tag list omits (`<h3>` `<div>` `<table>`, measured). ★★★ At a RENDER boundary NO allow-list-derived classifier is narrow-safe, because the sink keeps EVERY tag's text; it took a fifth, list-free `render` sink. Entry carries the before/after table |
| 119 | `<a href>` is dropped by both OOXML renderers while `a` is advertised to the document-authoring model | pre-existing, confirmed 2026-08-08 during the S3a review | S | open — link TEXT survives in `.docx`/`.pptx`, the TARGET does not; HTML/PDF keeps both. ★ Verified, not assumed: no `w:hyperlink`/`a:hlinkClick` in either renderer and `A` is in neither map in `rich-text-runs.ts` |
| 120 | The background insight-recommendation runner has no `AbortController` at all | UI batch slice 3 — 0.224.0 "Emshwiller" | S | open, BILLED — the six converted trigger sites all gained a Stop; the scheduled/background runner that starts the same call has no controller to cancel, so nothing can stop it |
| 121 | ~~`use-tasks-dedup.tsx` never aborts its in-flight call on unmount~~ | UI batch slice 3 — 0.224.0 "Emshwiller" | S | **CLOSED 2026-08-08** in the slice-3 review round — cleanup-only effect added, mutation-proved. The audit table in the entry is HISTORY. The two hooks that remained were §127, **also CLOSED** the same day — all six abort on unmount now. The adjacent unguarded-`setBusy` defect is §128 |
| 122 | The budget people rows and the role row above them read BOOKED from two different sources | UI batch slice 3 — 0.224.0 "Emshwiller" | M — it is a design question, not a wiring bug | open, DATA-INTEGRITY — the per-person figures cannot be made to sum to the role row above them even when both sources are fresh, because they are different sources. A tooltip is not the fix |
| 123 | ~~The budget people-row disclosure clips its own label mid-glyph, with no ellipsis~~ | UI batch slice 3 — 0.224.0 "Emshwiller" | S | **CLOSED 2026-08-08** — measured in Chromium at 4 of 7 role labels clipped at the DEFAULT width, all 7 at 90px; `max-w-full` does the work (`min-w-0` measured INERT — `truncate` already sets `overflow:hidden`, which gives a flex item automatic min-size 0) |
| 124 | A popover opened by a click that also scrolls its ancestor never mounts | found in the slice-3 eye-verify | UNKNOWN | open, PRE-EXISTING — ★★ the entry once named a "second effect" that does not exist and proposed a fix that cannot be implemented; both are RETRACTED in place. The mechanism is restated, no replacement fix is asserted |
| 125 | Two more controls start a billed Anthropic call with no way to stop it | found in the slice-3 review prose check | S each | open, BILLED — the dashboard digest `Generate now` and the steering meeting report `Draft with AI` only grey out while running. NOT a regression; they were never converted. Read with §120 — neither is in the "six sites" the CHANGELOG names |
| 126 | Two same-type Insight rows produce identically-named per-row controls, and no gate can see it | found in the slice-3 review, exposed by the new e2e seed | S | open, a11y — WCAG 2.4.6. ★★★ **axe CANNOT catch this** — measured against axe-core 4.12.1: in the gate’s requested tagset there is NO rule that flags two buttons sharing a name (`identical-links-same-purpose` is links-only AND `wcag2aaa`, which the spec never requests). `insight-digest-card.tsx` already de-collides the identical shape — copy it. Same class as §111 |
| 127 | ~~Two of the six AI trigger hooks still never abort on unmount~~ | split out of §121 on 2026-08-08 | S each | **CLOSED 2026-08-08** in the review round that followed — both gained the cleanup-only effect, each mutation-proved. ★★ Filed then immediately closed on purpose: a follow-up is the right home for a decision, the wrong home for a one-liner with three precedents in the same file family. ★ `use-action-analysis.ts`’s guard was measured UNREACHABLE and applied as defence-in-depth — do not quote it as a shipped defect |
| 128 | `use-timelog-sync.ts` clears `busy` from a superseded run | split out of §127 on 2026-08-09 | S | open, UI — the LAST of the three `finally` blocks whose `setBusy(false)` sits outside its guard, so a superseded run reports idle while its successor is still in flight. ★★ NOT the same defect as §127 (that was an unmount leak; this is a disarmed flag) and NOT an AI path, so §121/§127's sweeps do not surface it. First written as a bullet inside CLOSED §127 — a live defect in a closed entry has no index row and stops being read |
| 143 | The `isHtmlStart` sink ARGUMENT is unpinned at every call site | cold review of `unify-rich-text-s1`, 2026-08-11 | S–M | open, **HIGH** — the map is pinned, the argument is not. Measured swaps leaving suites fully green: `narrative-html.ts` `"rich"`→`"document"` (34/34) and all SIX `sanitize-records.ts` entity sites (151/151); `doc-render-html.ts` `"render"`→`"document"` is the positive control at **3 red**. Bounded today (`rich` and `document` differ by `img` alone), unbounded in shape |
| 144 | The rich-text toolbar's 15 controls are invisible to every gate, and cost 15 tab stops per editor | `unify-rich-text-s1`, 2026-08-11 | M | **CLOSED 2026-08-12** — (b) closed the a11y-gate reachability gap; (a) built the roving-tabindex keyboard contract in `toolbar-roving.ts` + `rich-text-toolbar.tsx` and flipped `role="group"` to `role="toolbar"`, cutting the row from 15 tab stops to 1. Mutation-proved (portal guard 1 red, `tabIndex` ternary 3 red) and browser-proved (`e2e/rich-text-toolbar-keyboard.spec.ts`). Full closing detail in the entry below |
| 150 | A BALANCED pair of stray quotes MISLABELS rows across a CSV section boundary instead of losing them | cold review of the branch closing §105, 2026-08-16 | UNKNOWN | open, **UNDECIDABLE — no fix is proposed**. A severity regression of §105's fix, not a new failure: the same file lost the same rows before it. Measured — one `"` in a task cell and one in a later milestone cell make quote state carry across the `# MILESTONES` marker, so milestones 6 and 7 import as TASKS (`taskName` `M6`/`M7`) and `milestones` comes back EMPTY. Silent on both sides of the fix (`droppedRows` 0, `unterminatedQuote` false). Needs a hand-edited/truncated/foreign file — `csvEscape` doubles every `"`, so a file we wrote cannot exhibit it |
| 151 | "The sample generator runs under bare node" is FALSE, retracted in four source headers, and still asserted in eight places | cold review of the branch closing §105, 2026-08-16 | UNKNOWN — it is a probe, not a fix | open, DOC-INTEGRITY — the generator installs JSDOM before its dynamic `import`, so the stated rationale for several DOM-free rules is dead. ★★★ **NOT a licence to delete those rules** — a rule with a false rationale can still be correct, and `csv-line-scan.ts` already re-grounded itself on a different argument. The stakes are §36(a) and §49, where the false claim is the reason an allow-list pass is NOT applied to a model-writable field; neither has been probed |
| 152 | `onOpenStorageFile` applies tasks + RAID from a malformed CSV and reports NO import loss, because the import signal and the §103 documents flag ride ONE call | cold review of the branch closing §105, 2026-08-16 | S for the split; UNKNOWN for per-section attribution | open — the one load path of six with no `reportFor`, and its stated reason (documents-only, so neither raising nor lowering the flag would be true) is CORRECT for truncation and does NOT carry over to import diagnostics. Fix is to split the two signals. ★★ Even split, `droppedRows` is WORKSPACE-WIDE (FIVE increment sites — 3 CSV + 2 Markdown — no section attribution), so the count cannot say whether the lost rows were the tasks/RAID this path APPLIES or a section it DISCARDS. ★ Not in conflict with §103's "two loads deliberately do NOT report": that counts non-reporting EXITS, this counts load SITES |

★★ **The table's CONTIGUOUS run stops at §128 and has done since 2026-08-08.** Past that only §143,
§144, §150, §151 and §152 carry an index row; §129–§142 and §145–§149 carry none.
Reproduce: `for n in $(seq 129 152); do printf "%s %s\n" "$n" "$(grep -c "^| $n |" docs/open-followups.md)"; done`
— 24 entries, 5 rows, **19 missing**. Those four rows were added because a new entry with no index row
is a new entry nobody finds; backfilling the nineteen that are missing is real work and is not done
here, so do NOT read a present row as evidence an entry is newer or more important than an absent one.

★★★ **THIS PARAGRAPH IS FALSIFIED BY EVERY ROW ADDED ABOVE IT, AND HAS ALREADY BEEN SO ONCE.** Its
counts and its `seq` range are transcribed, not derived, so adding one row silently makes three
statements wrong at once (the range, the row count, the missing count). §150's row did exactly that —
it left this paragraph reading "two rows above", "fourteen missing" and a range ending at 144, all
three false, and the paragraph went unchanged in the commit that broke it. ★★★ **§152's row then did
it AGAIN, in a commit whose author had read this paragraph** — the range stayed at 151 and the count
at "23 entries, 4 rows", both false the moment the row landed, and it was a cold REVIEW that caught it
rather than the instruction sitting directly beneath the row. Three instances now. An instruction a
reader must remember to obey is not a guard; treat this paragraph as the standing candidate for a real
gate. **If you add a row above,
re-run the command in this paragraph and rewrite every number it prints.** Nothing gates this:
`docs:claims:check` only checks `path:LINE` citations, of which this paragraph has none.

★ **The numbers are stable identifiers and closed ones are never reused** — hence the gaps at 17–20,
23 and 25–27, all closed by 0.210.0 "Larbalestier" (see Provenance). They are cited from outside this
file: `rich-text-plain.ts:96` points at §24, AGENTS.md at §22 and §28, and `docs/CODEMAPS/*` at §4,
§7 B4, §8–§10 and §13. Renumbering silently redirects every one of those.

★ `48-was` was a duplicate left behind when §48 closed; it was folded into §48 on 2026-08-05 and the label is retired. `48` keeps its meaning.

---

## 1. Two dead `memo()`s in the Resources subtree — **fork open**

Originally filed as R5 §3, "`ResourcesPanel`'s memo never bails". Re-opened and re-derived
2026-07-27; the original write-up was right about the symptom and wrong about the cause, and it
missed half the finding.

### What is actually true

**`ResourcesPanel` (`resources-panel.tsx`, `export const ResourcesPanel = memo(ResourcesPanelInner)`)
never bails.** `makeEditGuard` is called UNMEMOIZED during render (`task-manager.tsx`,
`const guardEdit = makeEditGuard(isPopout, …)`), so every `guardEdit(handler)` prop is a fresh
function each render — that is ~25 of the panel's 47 props (`task-manager.tsx`, the `workspaceProps`
object literal). The
`absenceCalendar:` bag is rebuilt each render, so its four function members are unstable
too. Call site: `workspace-section.tsx`, the `<ResourcesPanel …>` call.

**★ NEW — `ResourceCalendar` (`resource-calendar.tsx:697`) is ALSO `memo()`'d and also never bails.**
The original write-up does not mention it. It guards the heaviest subtree in the view — the calendar
grid, the meetings band, lane packing — and takes only 17 props:

| stable | unstable |
|---|---|
| `lang` · `includeExternals` · `rows` (a `useMemo`) · `absences` · `today` · `holidaySet` · `resources` · `startDate` · `endDate` · `calendarEvents` | `onAddAbsence` · `onEditAbsence` · `onMoveAbsence` · `onEditResource` · `onAddResource` · `onEditEvent` (all `guardEdit`-wrapped) · `onMoveOccurrence` |

`onMoveOccurrence` is `buildMoveOccurrenceHandler(calendarEvents, onSaveCalendarEvent)` called
during render (`resources-panel.tsx:662-666`) — a fresh function every time, independent of
`guardEdit`.

**★ Correction to the R5 write-up.** It says `guardEdit` is "one unstable family of several" and
names `setResources` / `onReassignTask` / `logActivity` / `holidaySet` as independently suspect.
`holidaySet` is a `useState` value and is stable (`use-holiday-set.ts:12,26`); `onCaptureUndo` is
`undoApi.capture`. For `ResourceCalendar` specifically the unstable set is exactly TWO root causes
(`guardEdit`, `buildMoveOccurrenceHandler`), not an open-ended family. The "several families" claim
holds for the 47-prop outer panel, not for the inner one.

**★ Stabilising fights the codebase's own convention.** AGENTS.md, Phase-3 extraction conventions:
deps-object hook handlers "MUST NOT be memoized — they read live render-scope state every call". A
blanket `useCallback` sweep across task-manager reintroduces exactly the stale-closure class those
hooks exist to avoid.

**★ The waste is smaller than AGENTS.md implies.** The panel's internal `useMemo`s (`resourcesById`,
`rows`, `planRows`, `nearTerm`, `visibleResources`, `externalRowKeys`) bail on their own deps
regardless of the outer memo. What a non-bailing memo actually costs is React reconciliation of the
subtree, plus one shallow 47-prop compare — not the expensive derivations. Do not cite the memo as
the reason anything is fast; that is what AGENTS.md currently does.

### The fork

| | **A** — delete both memos | **B** — fix the inner one, delete the outer | **C** — full stabilisation |
|---|---|---|---|
| **Do** | Drop `memo()` from `ResourcesPanel` + `ResourceCalendar`; rewrite the AGENTS.md passage | `useCallback` the 6 `guardEdit`'d handlers + memoize `buildMoveOccurrenceHandler` so `ResourceCalendar` genuinely bails; delete the outer `ResourcesPanel` memo as unfixable; correct AGENTS.md | Stabilise all 47 `ResourcesPanel` props |
| **Perf** | zero change (it never bailed) | structural: the calendar grid stops re-rendering on background writes | marginal over B |
| **Risk** | none | low — 7 props, one subtree | high — fights the deps-object convention, stale closures |
| **Effort** | ~30 min | ~2h + tests | days |
| **Result** | code matches docs | code matches docs AND one memo earns its keep | — |

**Recommendation: B.** The memo that *can* bail is the one guarding the expensive tree; the one that
cannot gets deleted rather than defended by a doc paragraph.

★ **Caveat on B, stated honestly: nothing here is profiled.** "The calendar grid stops re-rendering"
is a structural claim derived from reading the props, not a measurement. If the number matters, take
a React Profiler trace before and after — a background Outlook pull or insight-recommendation write
while sitting on Resources → Calendar is the scenario to capture.

★ Whichever branch is taken, **AGENTS.md must change in the same commit.** The passage under
"`ResourcesPanel` is the ONLY `memo()`'d panel `workspace-section` renders" already admits the memo
does not bail, but it still frames the guidance as protecting a live optimization, and it names
`guardEdit` as the single cause. Both need correcting, and the second `memo()` needs adding.

---

## 2. ~~`use-resource-planner.ts` is 30% over the 800-line ceiling~~ — CLOSED post-0.212.0

**Cited from:** `use-reference-data.ts`, `use-resource-directory.ts` — this entry cannot be deleted.

**Was:** the file sat over the 800-line ratchet with the baseline recording its own size, so the next
line added to it failed the build.

★★ **BOTH NUMBERS IN THE ORIGINAL ENTRY WERE ALREADY STALE WHEN THE WORK STARTED, AND IN THE
DIRECTION THAT MATTERS.** It said "1037 lines, baseline 1038 — one line of slack". The true state on
`main` `0d770283` was **1043 lines against a 1043 baseline: zero slack, not one line.** 0.212.0 had
grown the file and re-baselined it in passing, and nobody came back to this entry. The cluster line
ranges recorded below had drifted by roughly six lines for the same reason. An entry that quantifies
something quantifies it *as of its writing* — **re-measure before acting on a number in this file.**

**Resolution:** two **verbatim, move-only** extractions, in that order:

| new file | lines | what moved |
|---|---|---|
| `src/app/use-reference-data.ts` | 314 | 15 handlers — roles · disciplines · grades (create/save/delete/assign/reorder) |
| `src/app/use-resource-directory.ts` | 344 | 9 exports — resource CRUD, bulk edit/delete, import; plus the private helpers `recordMatchesRemoved` and `purgeCalendarFor` |

`plainSeed` moved into `use-resource-directory.ts` but is **exported and imported back** by the
planner (`use-resource-planner.ts:11`), which is what keeps the module graph acyclic without
duplicating the helper.

`use-resource-planner.ts` is now **553 lines** and its baseline entry was re-recorded at **554**.
Those are the same number: `scripts/check-file-sizes.mjs` measures `content.split("\n").length`,
which is one MORE than `wc -l` for a file ending in a newline. Anyone hand-editing
`docs/baselines/file-sizes.json` must use the script's count, not `wc -l`'s. ★ That baseline entry is
now BELOW the limit and therefore invisible to the tool's own regeneration — see §60, which records
why `--update` dropping it costs nothing (the entry is inert at 554), and why the value of this
commit is REMOVING the stale 1043, not installing a 554.

★★ **THE PRECEDENT THIS ENTRY NAMED WAS THE WRONG ONE, and it cost a review round.** It said to
follow `use-storage-file-ops.ts` — a typed `deps` object, `use*`, NON-memoized handlers. That
convention is for **cross-cutting orchestration extracted from `task-manager.tsx`**, which is not
what this is. The precedent that actually applies is **`use-calendar-events.ts`**: extracted from
*this same file* for *this same reason*, using `useWorkspace()` and `useCallback`. The two conflict,
and the conflict was sidestepped rather than settled — a verbatim move keeps whatever form the code
already had, so no convention had to win.

★★ **AND THE MEMO JUSTIFICATION THE ENTRY IMPLIED IS FALSE FOR BOTH CLUSTERS.** The old ★ note here
warned that these NON-memoized handlers are what keep §1's `ResourcesPanel` memo from bailing, so a
split must not tempt anyone into memoizing. An early draft of the extraction repeated that as the
reason to preserve the memoization form. It does not hold:

- **twelve of the fifteen reference-data handlers reach `RolesPanel`** (`roles-panel.tsx:7`), a plain
  function component — its JSX is rebuilt every render regardless, so nothing there can bail. ★ The
  other three do NOT, and an earlier revision of this bullet said "reach only `RolesPanel`" flatly,
  contradicting the very header comment it defers to: `handleAssignRoleById` reaches the memo'd
  `ResourceDirectory` (arriving `guardEdit()`-wrapped, so unstable anyway), and
  `handleAssignResourceRole` + `handleClearResourceRole` reach nothing in production at all (§62);
- **resource-directory handlers do reach** the memo'd `ResourceDirectory` (`resource-directory.tsx`,
  the `memo(ResourceDirectoryInner)` export) and `ResourcesPanel` (`resources-panel.tsx`, the
  `memo(ResourcesPanelInner)` export) — but they arrive `guardEdit()`-wrapped
  (`task-manager.tsx:2258-2261`), and `guardEdit` is `makeEditGuard(...)` called unmemoized during
  render (`task-manager.tsx`, `const guardEdit = makeEditGuard(isPopout, …)`), so their identities
  are unstable whatever this hook does. ★ §1 and §2 cited that one call as `:2047` and `:2041`, so at
  least one was wrong the day it was written; the real line is `:2044`. Cite the symbol, not the number.

Preserving the memoization form needed no justification beyond the commit being move-only, and the
corrected reasoning now lives in `use-reference-data.ts`'s own header comment. ★ §1 is unaffected in
either direction by this split.

★ This was the surviving half of the 2026-06 review's **B2** ("`use-bulk-operations` +
`use-resource-planner` multi-concern"), so B2 is now fully closed. `use-bulk-operations.ts` was
**419 lines** as of 2026-07-27 — no longer a finding. `task-manager.tsx` (B3) is tracked as **TD-5**,
not here.

★ Residuals the split left behind — a stale warning prefix, a doc comment that now names one of two
consumers, and a duplication seam jscpd cannot yet see — are **§61**, not re-opened here. If a
further cut is ever wanted, §61 also names the cleanest next one; there is no ratchet pressure for it.

**The original write-up follows — present tense, and NO LONGER TRUE at HEAD.** Kept for the cluster
analysis, which is what made the two-cluster choice, not for its figures (see the correction above).
The line ranges are pre-0.212.0 and have drifted; the sizes are still roughly right.

| cluster | lines | size |
|---|---|---|
| ref plumbing + `logUpdate` (shared, stays) | 131-167 | ~37 |
| RAID handlers (+ mitigation task at 872-911) | 181-311, 872-911 | ~170 |
| Absences + shifts | 312-446 | ~135 |
| Resource directory CRUD / bulk / import | 447-643 | ~197 |
| Reference data (roles · disciplines · grades) | 644-871 | ~228 |
| Planning grid (utilization, absence override, plan window) | 912-986 | ~75 |

★ **One cluster is not enough**: 1037 − 228 = 809, plus wiring ≈ 819, still over. Clearing 800 takes
**two** — reference data + resource directory lands at ≈620. (The prediction held: the real landing
point was 553, better than estimated because the two clusters had grown since the ranges were taken.)

---

## 3. `optimize_wbs` never built — owed from R4

Roadmap 4.3b. The user explicitly asked to be reminded, and it has now survived two releases.

Open question preserved in R4's spec §5: **is it a tool at all**, or a prompt affordance over the
existing `create_task` / `update_task` tools plus the inline Ask-Claude editor? Decide that before
writing anything — the two answers have almost nothing in common.

See [[release-4-ai-planning-powers]].

---

## 4. Two-tab last-writer clobber on file/IDB (audit #39) — parked, own design

Two browser tabs on the same **file or IndexedDB** project can last-writer-clobber each other's
saves. `BroadcastChannel` syncs some state but there is no save lock.

**★ Re-verified 2026-07-27 and narrower than the original write-up implies.** A cross-tab Web Locks
save lock DOES exist — but only in `turso-backend.ts:177`, and `storage-error.ts:14` handles its wait
timeout. `grep navigator.locks src/app/*.ts` returns that one non-test hit. So Turso is covered and
**file/IDB is the whole of the exposure.**

Recommendation unchanged: Web Locks coordination or a save token so a second tab cannot overwrite.
Needs its own design pass — the locking model and the conflict UX are both real decisions, and the
data-loss guard in the save path (`allowDestructiveSave`) is adjacent prior art worth reading first.

---

## 5. No list virtualization anywhere (audit #14) — parked, own batch

**Where:** task table, Kanban board, Gantt (including the SVG arrow layer), activity log. No
virtualization dependency is installed (`package.json` has no `react-window` / `@tanstack/virtual`).

Every filtered row/card/bar is in the DOM; at 10× data the initial paint and every re-render walk
the full set. Compounds the batch-B render-perf work.

**Rec:** virtualize the table + Kanban columns first; interim visible-row windowing.

★ **Collides with four shipped features** — print (needs the full render; `@media print` resets every
`overflow-*` descendant precisely so nothing clips), the deep-link row flash (`scrollIntoView` on a
row that must exist), column resize, and the axe scan. Own batch, carefully.

---

## 6. Undo residuals (audit #11) — optional, unscheduled

#11's large part shipped (0.173.0 "Jordan" + 0.174.0 "Egan"): a ~10-step backend-agnostic in-memory
undo stack covering all 11 single-entity deletes, bulk edit, clear-all, bulk delete and cascade
deletes. What was explicitly left out:

- **(a) Project delete has no undo.** `handleDeleteProject` (`task-manager.tsx:1935`, wired at
  `:2300`). Whole-project scope, higher stakes — needs its own soft-delete/archive design, not an
  undo entry.
- **(c) No persisted / cross-reload undo.** The stack is in-memory and dies on reload, by design.
- **(d) Retention is the last ~10 ops** (`UNDO_CAP`).

★ **(b) "no redo" is STALE — redo shipped in 0.178.0 "Bester".** `undo/use-undo-stack.ts` is
bidirectional (`:131`, `:166`). Do not carry that bullet forward from
the campaign doc, which still listed it.

---

## 7. Surviving dedup seams from the 2026-06 refactor review

That review was dated **2026-06-19 against v0.104.0** — ~100 releases stale. Re-verified item by item
on 2026-07-27; **four of nine survive**, and they are reproduced in full below, so nothing here
depends on the original. The tier letters are the original ones.

★ The source document `docs/refactor-review-2026-06-19.md` was **deleted in the same cleanup** — it
was git-tracked, so `git show HEAD:docs/refactor-review-2026-06-19.md` returns it if the full
reasoning is ever wanted. Its two genuinely unique sections were its verified **false positives**
(three "CRITICAL" claims debunked by reading source — notably that converting the sanctioned
render-time reconcile to a `useEffect` would FAIL CI, since `set-state-in-effect` is banned) and its
**Tier C rejects**, both of which are preserved under "Decided — do not re-litigate" below.

### Still real

| # | Finding | Verified state |
|---|---|---|
| **A1** | `Field()` wrapper re-declared identically in `task-form-fields.tsx` + `project-form-fields.tsx` → extract a shared `form-field.tsx` | Both files still declare `function Field`; no `src/app/form-field.tsx` exists. |
| **A3** | `resetAllCols` chains N× `resetColWidths()` with a repeated deps array → `useResetTableColumns(resizers[])` | Still in `change-report-panel.tsx`, `raid-report-panel.tsx`, `resources-report.tsx`; no shared hook. |
| **A4** | `getValue` sort callbacks copy-pasted → a `makeGetValue(mapping)` factory | Six files declare one: budget-report · change-report · milestones-panel · raid-report · reports-tables · resources-report. |
| **B4** | Jira API responses not schema-validated (untrusted external data) | No `zod` in `package.json`. **Zod is a new dependency → ask first**, or hand-roll guards. |

★ A1/A3/A4 are duplication-gate fuel — `npm run dup:check` is BLOCKING, and TD-6 records that the
single-extraction ratchet hit its floor at gate 1.75 needing a TypeScript-side reduction. A4 (six
sites, `.tsx`) is the largest of the three.

### Verified CLOSED — do not re-open

- **A2** (Escape `useEffect` duped across modals) — superseded by `use-dismissable.ts` +
  `use-popover-dismiss.ts`, and by the whole 0.203.0 dismissal-stack protocol.
- **A5** (touched-field `Set` duped between `raid-edit-modal` + `task-form-fields`) — only
  `task-form-fields.tsx` still has it. Not a duplication.
- **B1** (4 raw Anthropic `fetch` blocks → shared helper) — shipped as `ai-forced-call.ts`. The
  multi-turn agentic `callClaude` is deliberately outside it; that is not a leftover.
- **B2 / B3** — see §2 above; only `use-resource-planner` survives, and `task-manager` is TD-5.
- **`task-row.tsx` may lack `aria-label`** — the premise was "Open Points is NOT in the axe gate".
  It is now (AGENTS.md `A11Y_VIEWS`, 16 views), and `task-row.tsx` carries 15 `aria-label`s.

---

## 8. `tour-overlay` claims `aria-modal` with no Tab trap — open, unguarded

**Where:** `tour-overlay.tsx` — `role="dialog"` + `aria-modal="true"` at `:96-97`; the file imports
`useDismissable` (`:13`) and nothing else. There is no `useFocusTrap` import and never has been.

Shift+Tab from the overlay's first button walks straight into the app behind the dimmed backdrop.
The `aria-modal="true"` tells assistive tech a containment story the keyboard does not honour —
WCAG 2.4.3 (focus order), and arguably 4.1.2 for the false state.

**★ This is a STANDING GAP, not a regression, and 0.203.0 did not close it.** That release tagged
the overlay `kind: "layer"` in the dismissal stack (`:72`), with the reasoning inline at `:58-62`:
`kind` means "traps Tab", and tagging a trap-less surface `modal` had taken
`isTopmostOfKind(…, "modal")` away from any real `Modal` open at the same time, so that Modal
stopped trapping Tab and nothing took over. The `layer` tag fixed **that** — it stops the tour
breaking OTHER modals. It does nothing about the tour's own missing trap. Do not read AGENTS.md's
dismissal-stack section as saying the tour is a11y-clean; it says the opposite, in the paragraph
after the fix.

**Two ways to close it, and they are not equivalent:**

- **Add a real trap.** `useFocusTrap(ref, active, onEscape)` already exists and is the app's
  sanctioned one. ★ If this is taken, **flip `kind` to `"modal"` in the SAME commit** — the two must
  agree or the tour silently starts stealing Tab containment from a co-open `Modal` again, which is
  the exact bug 0.203.0 fixed. ★ `onEscape` must be a stable `useCallback` or the effect re-focuses
  the first element every render.
- **Drop the lie instead.** Remove `aria-modal="true"` (and reconsider `role="dialog"`), leaving a
  non-modal overlay that is honest about not containing focus. Cheaper, and arguably right for a
  coaching overlay that deliberately spotlights the app behind it — the tour *wants* you looking at
  what is underneath.

★ **Nothing will catch a regression here.** The tour is not in `A11Y_VIEWS`, and axe has no rule for
"`aria-modal` without a focus trap" — it would pass the gate at 85/85 either way. Whichever fix
lands needs its own unit test asserting the Tab/Shift+Tab boundary.

★ One more thing to re-check while in this file: `use-tour.ts`'s render-time auto-launch is the ONE
push site in the app that is not a user gesture, and the dismissal stack's open-order-equals-nesting-order
precondition is asserted, not detected. It holds today only because the empty-state modal and the tour
are mutually exclusive `if/else` branches in `task-manager.tsx`.

---

## 9. `aria-sort` inconsistent across the four raw-`<th>` tables — open, unguarded

Every sortable header that flows through the shared `SortResizeTh` got `aria-sort` in 0.202.3, with
the `↑`/`↓` glyph made `aria-hidden` so the state is announced once, in one vocabulary. The four
tables that still hand-roll their `<th>` did not, and they disagree in two different ways
(AGENTS.md records this at the end of the `SortResizeTh` bullet: "Folding them in is a follow-up,
not a claim about today"):

| file | `aria-sort` occurrences | problem |
|---|---|---|
| `change-panel.tsx` | 7 | has `aria-sort` **and** keeps a ▲/▼ inside the button's accessible name → double announcement |
| `raid-panel-rows.tsx` | 7 | same |
| `stakeholders-panel.tsx` | 5 | same |
| `activity-log-panel.tsx` | **0** | glyph only, **no `aria-sort` at all** — sort state is invisible to AT |

Counts verified 2026-07-27. `activity-log-panel` is the worse of the two failures and the cheaper
fix; the other three are a de-duplication of an announcement, not a missing one.

**Rec:** fold all four into `SortResizeTh` — it already solves both halves and would make the whole
app consistent in one move. ★ Two of these panels are axe-scanned (RAID, and Activity as
"Activity log"), which buys nothing here: **axe has NO rule for a missing or duplicated `aria-sort`**,
so the gate is silent on this whole class. Unit tests are the only possible coverage.

★ Watch the existing glyph assertions — `report-table.test.tsx` and `calendar-series-list.test.tsx`
read `textContent`, and the shared component deliberately keeps the arrow VISIBLE while hiding it
from the accessible name. A fold-in must preserve that, not delete the glyph.

★ Known loss to re-state rather than rediscover: VoiceOver/Safari does not announce `aria-sort`, so
each folded-in table trades "Title ↑" for "Title" on that one AT. Standard-correct, still a real
regression there — it was accepted once already for the shared component.

---

## 10. Keyboard move has no preview — band and day grid both — open

**Where:** `resource-calendar-band.tsx` (chips) and `resource-calendar.tsx` (the day-cell grid).

Alt+Left/Right ARMS a move and accumulates a day delta in state; Enter commits it as one
`onMoveOccurrence` call (one undo entry per intent); Escape cancels. That much works. What is
missing is any feedback before the commit:

- **No visual.** `pendingMove` is read only in handlers — its last reference is line 399, the JSX
  begins at 431 — so nothing renders differently while a move is armed. Verified 2026-07-27.
- **No announcement of the delta.** `onMoveModeChange` emits only `"armed" | "cancelled" | null`
  (`:82`, fired at `:280`, `:306`, `:325`, `:363`), so the parent's live region says a constant
  string. Three Alt+Rights and one Alt+Right are announced identically.

So a screen-reader user can arm a move, press an arrow four times, and commit with no way to know
where it will land — WCAG 3.3 territory, and simply poor UX sighted too.

**Rec:** a ghost chip/cell at the pending date plus a delta in the announced string ("moved 3 days
later, Thursday 30 July — press Enter to confirm"). AGENTS.md records the day grid as having the
identical gap; that half was taken on trust from the doc and not independently re-verified here.

★ AGENTS.md is explicit that this must not be described as "previewing" — the word appears in the
band bullet and is wrong. Fixing the feature and fixing that sentence go together.

★ Commit routes through `resolveOccurrenceDrag` keyed on `(eventId, originalDate)`, shared with the
mouse drop handler. Read `occurrence-drag.ts` before touching this — both of its documented identity
bugs are reachable from the keyboard path, and a no-op result must write nothing.

---

## 11. ~~`instanceof DOMException` abort check misreports a user cancel~~ — CLOSED in 0.211.1

**Was:** four abort checks read `instanceof DOMException` instead of reading `.name` directly.
**Cited from:** `abort-error.ts` — this entry cannot be deleted.

**Resolution:** pure `abort-error.ts` `isAbortError(e)` reads `.name` directly and is used at **all four**
sites. The two that also read `signal.aborted` keep that short-circuit as the left operand.

★★★ **THE PREMISE OF THIS ENTRY WAS FALSE, AND THE FIRST RESOLUTION REPEATED THE ERROR.** The entry
opens "A plain user cancel surfaces a spurious error toast", and the sweep table below marks two sites
"exposed? **YES**". Neither holds in a browser. `AbortController.abort()` with no reason makes `fetch`
reject with a **same-realm `DOMException`**, so `e instanceof DOMException` was **true** and the old
guard returned early. The path was traced end to end for a re-wrap and there is none —
`ai-forced-call.ts` lets the fetch rejection propagate verbatim (its only `throw`s are `AiHttpError` on
`!res.ok` and `Error("parse")`), and neither `task-dedup-call.ts` nor `scheduled-job-analysis.ts`
catches. Both flows are popout-unreachable, so there is no cross-realm case either — though by two
different mechanisms, and the earlier "both hooks are `!isPopout`-gated" was imprecise: `useTasksDedup`
gates INTERNALLY (`use-tasks-dedup.tsx:86`), while `useActionAnalysis` mounts unconditionally and the
gate sits on the PROP (`task-manager.tsx` `aiAnalysis: isPopout ? undefined : aiAnalysisBundle`), which
is the only route to `analyze`. The `instanceof`
only fails across the **jsdom/Node** boundary — which the correct-pattern comment quoted further down
says in as many words, and which nobody noticed says *tests*, not *users*.

So: **all four** sites catch nothing reachable, not two. What shipped is hardening plus one shape for
four call sites. That is still worth having — but the CHANGELOG entry was written under **Fixed**
claiming a user-visible error toast, and `abort-error.ts` carried a comment asserting the same as
established fact. Both were corrected. Found by a COLD reviewer; the primed reviewer, holding this
entry, re-derived the same wrong conclusion — the entry itself was the misinformation.

★★ **This closed AGAINST the advice below, which is left in place because the advice was defensible and
the reasoning for overriding it matters.** The text said "the fix is two sites, and the other two are
worth leaving alone … rewriting them would be churn." A cold review of the shipped diff confirmed that
judgement on its own terms: at `use-project-proposal` and `use-timelog-sync` the only `AbortSignal` is
the caller's own controller, so any AbortError-named rejection **already** had `signal.aborted === true`
and was caught by the left operand. The widening at those two sites catches nothing reachable today.
They were folded in anyway, for one reason only: a fifth caller copying the surviving broken shape is a
likelier future defect than the churn cost of two lines. If you disagree, the way to relitigate is to
narrow the helper's use — not to reintroduce `instanceof DOMException` anywhere.

★★ **Real consequence of the fold, stated so nobody rediscovers it as a bug:** `use-timelog-sync.ts` now
swallows any future AbortError-named rejection that did *not* come from its own controller, instead of
`setError(-1)`. Given `runGuarded`'s own "leave prior data + state intact" contract that is the desired
direction, but it is a genuine widening of a silent-failure path, not a no-op.

★★ **The line references in the historical write-up below are stale and were NOT corrected** — an
earlier revision of this line claimed "Corrected in the sweep table" and nothing in that table was ever
touched, which is the same self-referential falsehood this entry now exists to record. The table is
left VERBATIM as the historical record; use these instead. Pre-fix `use-tasks-dedup.tsx` was `:121`,
not the `:111` the table says. **Current lines:** `use-tasks-dedup.tsx:122` · `use-action-analysis.ts:35`
· `use-project-proposal.ts:52` · `use-timelog-sync.ts:107`. ★ The **pattern** is wider than the four sites this entry
named: `chat-panel.tsx:478`, `use-alloc-plan.tsx:167` and `use-raci-suggest.tsx:204` each hand-read
`.name` correctly with their own four-line explanatory comment. None is a defect, so none was touched —
but three verbatim copies are `dup:check` fuel, and the helper now exists to absorb them if that
BLOCKING gate ever flags them.

**The correct pattern is already written down, in the hook added by the same release.**
`use-alloc-plan.tsx:154-165` reads the name directly and says why:

```ts
// Read .name directly (never `instanceof DOMException`) because DOMException
// may not be instanceof Error/DOMException consistently across the
// jsdom/Node boundary — mirrors chat-panel.tsx.
const errName = e instanceof Error ? e.name : (e as { name?: string }).name;
if (errName === "AbortError") { setPhase("input"); return; }
```

**★ Wider than the one file — four call sites, two of them actually exposed.** Swept 2026-07-27:

| site | shape | exposed? |
|---|---|---|
| `use-tasks-dedup.tsx:111` | bare `instanceof DOMException` | ~~**YES** — falls through to an error toast~~ **DISPROVED — see the correction above** |
| `use-action-analysis.ts:34` | bare `instanceof DOMException` | ~~**YES** — falls through to `setError(msg)`~~ **DISPROVED — see the correction above** |
| `use-project-proposal.ts:51` | `signal?.aborted \|\| (instanceof …)` | no — the `signal.aborted` read catches it first |
| `use-timelog-sync.ts:106` | `signal.aborted \|\| (instanceof …)` | no — same |

So the fix is two sites, and the other two are worth leaving alone: they are already correct by a
different route, and rewriting them would be churn.

★ Note the two exposed sites fail *differently* — dedup shows a toast, action-analysis sets an error
state — so a test for one does not cover the other. ★ Whichever way it is fixed, the `reqId !==
reqIdRef.current` stale-guard on the line above must stay ahead of it; it discards a superseded
request and is not the same condition.

---

## 12. `list_allocations` dumps the grid; should be a scoped query — open, design

The tool takes **no arguments at all** — `input_schema: { type: "object", properties: {} }`
(`chat-tool-defs.ts:368-372`) — and returns the whole planning grid: plan window, granularity, every
valid period key, and every non-zero cell for every resource.

That runs into its own caps. `MAX_ALLOC_CELLS = 200` (`alloc-plan/alloc-plan.ts:40`) truncates the
cell list, and each resource carries a `truncated` flag whose entire purpose is to tell the model
"treat this resource's load as UNKNOWN, not zero" — the tool description spends four sentences on
exactly that hazard. On any real portfolio (`ALLOC_CONTEXT_MAX_RESOURCES` is 120, a 104-week window
is normal) the answer to a narrow question arrives partial, and the model has to say so.

**Rec:** accept a scope — `resourceIds?`, `periodFrom?`/`periodTo?`, maybe `minPercent?` — so a
narrow question returns a COMPLETE answer instead of a truncated dump. "What is Anna booked on in
Q3?" should never come back `truncated: true`.

★ Keep the `truncated` flag and its description even after scoping — a scoped query can still
overflow, and the "unknown ≠ zero" instruction is the part that stops the model asserting someone is
free when it simply cannot see them.

★ This is a read tool with no `isReadOnly` guard (correct — reads need none) and its getter is
un-memoized on `ChatDispatcherArgs` so an unused read tool costs nothing per render. Adding
parameters does not change either property; do not add a guard while in there.

---

## 13. Security audit is scope-stale — open

`docs/security/findings-2026-07.md` is dated **2026-07-02, scope "v0.164 Cixin"**. The app is
0.203.0. The audit's *conclusions* still hold for what it looked at — 0 CRITICAL, 0 HIGH, every
proxy and secrets check PASS — but it has never looked at anything shipped since, and several of
those are exactly the surface classes it was written to cover.

**★ The gap that matters: `/api/stt` was never audited and is the app's weakest proxy by design.**
Dictation SP2 added it. Every other proxy pins a vendor apex (`*.atlassian.net`, `*.timelog.com`);
this one cannot, because the base URL is **user-supplied BYO** — `_helpers.ts:56-57` says so in a
comment. It compensates with `isPrivateHost` (`:71`), https-only (`:68`), `redirect: "manual"`
(`:95`) and a 25 MB cap, which is a sound design — but "sound by reading" is what an audit is for,
and `grep -il "stt\|dictation" docs/security/*.md` returns **nothing**. The word does not appear in
either security document.

Other post-v0.164 surface with no audit coverage:

| shipped since | why it is in scope |
|---|---|
| noteLog stored-XSS defense (0.196.0) | three-layer `dangerouslySetInnerHTML` guard — the audit has a URL-sink review but no HTML-sink review |
| `update_settings` AI write tool (0.190.41) | first non-entity AI write; its allowlist is the whole control |
| `knowledgeItems`, `insights` blobs | new persisted paths, new load boundaries |
| 5th `SecretId` (`sttApiKey`) | see the correction below |

**Rec:** re-run the manual triage at current HEAD, scoped to the delta rather than the whole app.
The method is recorded in the doc's own header and the STRIDE tables in `threat-model.md` are the
frame — this is a re-scope, not a fresh audit.

★ **Correction found, code is FINE:** `findings-2026-07.md` SEC-5 reads "All **four** `SecretId`s in
the id allowlist ✅ PASS". There are **five** — `secrets.ts:8-13` adds `sttApiKey`, and the
`isSealedSecret` allowlist at `:28-37` does include it. So the *check* still passes; only the doc's
count is stale. Fix the number when re-scoping. (This matters more than it looks: AGENTS.md warns
that a missed id in that hardcoded allowlist "silently drops the ciphertext on read", so a reader
trusting "four" would not know to verify five.)

★ **PX-9 is a conditional trigger, not work.** The in-memory `Map` rate-limit store (LOW, "Open
(accepted)") is single-process only. Its own verdict says "Register as TD if the app moves" to a
multi-instance deploy. Single-instance today ⇒ nothing to do; the trigger is a deployment change,
not a code change. Do not open a ticket for it now, and do not lose it if hosting changes.

---

## 14. ~~Timelog has two per-device stores keyed differently~~ — CLOSED in 0.211.1

**Was:** Timelog had two per-device stores keyed differently — the actuals cache on the user-editable project code, the picker scope on the canonical id.
**Cited from:** `timelog-panel.tsx`, `timelog-panel.test.tsx` — this entry cannot be deleted.

**Resolution:** the actuals cache is keyed on the canonical id. `timelog-panel.tsx`'s local is now named
`projectCode` and no longer keys anything — **it is only the picker's in-place project-switch signal**
(`use-timelog-picker-scope.ts:49-50`, `:213`), which must keep receiving `ws.project?.code` or the
picker stops re-seeding on a switch. Guarded by a test in `timelog-panel.test.tsx` that fails with
`expected 'proj-a' to be 'canonical-key'` if the wiring is reverted.

★★ **A pre-existing cache is ORPHANED, deliberately.** Existing users open Time bookings once, see an
empty pane, and press Fetch.

**Residual (still open):**
★ There is a SECOND, smaller cost that the sentence above originally claimed was "the entire" one:
the orphaned entry is never reclaimed. `clearActualsCache` deletes only the key it is handed
(`timelog-actuals-store.ts:54`), so a pre-0.211.1 code-keyed entry — carrying a full
`aggregates` + `users` + `projectRefs` payload — survives until the `MAX_PROJECTS = 50`
sort-by-`fetchedAt` eviction (`:62-65`) reaches it, or until `clearAppConfig` sweeps the
`aipm-cockpit:*` namespace. Slot pressure in a bounded store, not a leak, and not worth code to
reclaim — but it is a cost, so it is written down rather than left for the next reader to rediscover.
Both accepted because this cache holds refetchable TimeLog data, not user input.

★★★ **TWO better-looking designs were built or specified and BOTH rejected — do not re-propose either.**
- **Read-both (built, then reverted).** `loadActualsCache(id, legacyId?)` fell back to the old key and
  `clearActualsCache` deleted both. It shipped briefly and a cold review killed it: the map is a single
  flat `Record<string, …>`, so the fallback put **two namespaces in one keyspace** — canonical ids AND
  user-editable project codes. Reachable case: project A has code `default` while its canonical id is
  `proj-7`; A's "Clear all" then calls `clearActualsCache("proj-7", "default")` and **deletes the real
  default project's cache** as collateral.
- **Migrate-once (specified, never built).** Moving the entry instead of reading through is *worse*: in
  the same case it would relocate the default project's entry to `proj-7`, so the other project loses
  its cache permanently rather than being transiently misread. It also cannot run early enough — the
  hook seeds four lazy `useState` initializers at mount, before any effect fires, so an effect-based
  migration lands after the pane has already seeded empty.

★ The collision is **unfixable by any migration**: a project code and another project's canonical id are
the same kind of string with nothing to distinguish them. Dropping the fallback is the only design that
removes the hazard rather than relocating it.

★ Structural note for whoever tests this area next: `timelog-panel.test.tsx` mocks `useTimelogSync`
**wholesale** at file level, so no test there can observe a real cache lookup through a render. Pinning
"what does the panel hand the hook" has to be done by asserting on the mock's call arguments — which is
what the §14 guard does, following the one pre-existing precedent in that file.

---

## 15. ~~Two file-picker patterns — extract a `FilePickerButton` primitive~~ — CLOSED in 0.211.1

**Was:** the app opened a file dialog in two structurally different ways, both on Settings → Appearance.
**Cited from:** `file-picker-button.tsx` — this entry cannot be deleted.

**Resolution:** `file-picker-button.tsx` — a DS `Button` plus the `sr-only` input it owns
(`tabIndex={-1}`, `aria-hidden`, value reset **before** the callback so the same file re-picks). It owns
**no validation**: `onFile` hands back the raw `File` and `branding-image-input.tsx` keeps its `FILE_RE`
raster-mime allowlist and `MAX_BYTES` raw-byte cap.

★ **THREE** call sites moved, not the two this entry scoped: `theme-gallery.tsx`,
`color-scheme-editor.tsx` and `branding-image-input.tsx`. The entry's own scoping sentence ("the
follow-up is scoped to those two") was right about what to change and wrong about what was there to
find — the third site was a third copy of the label shape, and looking at it turned up **§46**, while
the excluded `chat-panel.tsx` turned out to carry **§47**.

★ Accepted cosmetic consequence: in `color-scheme-editor.tsx` the Import control is now a DS `Button`
while its neighbours in that flex row keep the file-local hand-rolled `btn` string. Correctness over
local consistency — matching them would mean copying `btn` into a second file and minting a `dup:check`
clone against a BLOCKING gate, which is the very thing this entry says not to do.

★ `theme-gallery.test.tsx`'s tab-order walk was **not touched** and still passes — it is the regression
guard for the duplicate-accessible-name defect (`df507f95`) that the primitive now prevents structurally.

The real fix is one small primitive — a `FilePickerButton` wrapping `Button` with an `accept` prop
and the input it owns — and moving both sites onto it. That also settles the a11y question in ONE
place: the gallery's sibling input was a **second tab stop announcing the same accessible name as its
Button** until `df507f95` gave it `tabIndex={-1}` + `aria-hidden`, and the axe gate cannot see a
duplicate accessible name (it reports missing names only), so nothing would have caught it. The
editor's label shape never had that failure mode, and a shared primitive means neither can regress
into it.

★ Do NOT "fix" this by making the input `display:none` — a hidden input cannot be clicked in every
browser, which is why both sites use `sr-only`.

---

## 16. Dictation flattens rich formatting — open, needs a design

`appendDictationToHtml` round-trips the field through plain text before appending, because Web
Speech fires `onFinal` **multiple times per hold** and each segment must join onto the previous one
rather than replace it (the landmine already recorded in AGENTS.md's dictation bullet). The
round-trip is what makes that work, and it is also what discards any bold, italics, list or link
already in the field.

This is **shipped behaviour on `Task.description` since 0.196.0** — slice B (0.209.0) did not
introduce it, it widened it, because the same helper now serves all six rich register fields.

A fix needs per-utterance segment tracking: keep the appended run as its own tracked node so a later
segment extends that node instead of the whole field being re-serialized. ★ Do not "fix" it by
dropping the plain-text round-trip — that reintroduces the multi-`onFinal` overwrite bug, which is
worse (it loses dictated words, not formatting).

---

## 21. Eye verification owed on two editors and four detail cases — open, slice B (0.209.0)

Verified by screenshot against seeded data: the **RAID editor** and the **task editor's inline note
log**. Not verified:

- **The CHANGE and MILESTONE editors.** Their rows would not open from a row click in the harness.
  Both are structurally identical to RAID's swap and are unit-tested, but nobody has looked at them.
- **Both note surfaces open at once.** The inline log suffixes its control names and the floating
  window does not, so the two should not collide — but ★ the axe gate reports *missing* accessible
  names, never *duplicated* ones (same blind spot as §15), so nothing automated covers this.
- **The `max-h-72` scroll boundary** on the inline log with a genuinely long note log.
- **The disclosure summary's contrast** across the six scheme combos. The axe matrix scans five of
  the six built-in combinations, so a scheme it does not scan can carry a contrast failure with the
  gate green — exactly how 0.208.0 shipped one.

---

## 22. `clipText` truncates on UTF-16 code units and can split a surrogate pair — CLOSED

**Where:** `sanitize-core.ts`, `clipText`. (Cited as `:52-55` until the closing commit itself
widened the function past that range — the exact `file:line`-rot this repo's convention warns about.
Cite the SYMBOL.)

```ts
function clipText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) : s;
}
```

`slice` counts UTF-16 **code units**, so an over-cap value ending on an astral character (emoji,
rarer CJK, most symbols above the BMP) keeps a **lone surrogate**. That is not a character: it
UTF-8-encodes to `U+FFFD` on the **CSV and Markdown** backends while surviving intact on **JSON and
IndexedDB**, because `JSON.stringify` escapes it as `\ud83d`. A silent, **backend-dependent**
corruption — harder to diagnose than a uniform one, because the same workspace reads correctly or
incorrectly depending on where it was stored.

`clipText` is the truncator behind `sanitizeText` and `sanitizeMultiline`, which have **54 call
sites** — `sanitize-core` (6), `sanitize-entities` (7), `sanitize-records` (36), `calendar-event` (5)
— every capped name,
title, note and plain-text field in the app. (`clipText` itself appears only in `sanitize-core.ts`;
an earlier revision of this entry said "~54 times across" the three files, which sent a reader
grepping for `clipText` in `sanitize-records.ts` and finding nothing.) The same shape recurs in `note-log.ts`'s `cleanText`,
`color-schemes.ts` names, `ai-errors.ts` and `diagnostics-redact.ts`.

**The fix is known and already shipped once.** `capHtmlText` had the identical defect and was fixed
in `ca8ab6f4` (slice B) by backing the cut off one code unit when it would land on a high surrogate:

```ts
const last = text.charCodeAt(max - 1);
const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
```

Applied once inside `clipText`, that closes all 54 sites at once. ★ It closes one MORE than that:
`sanitizeVoiceTranscript` reaches `clipText` directly and is not one of the 54 (consumer:
`use-bulk-operations.ts:463`). ★ The body said **49** until 2026-08-05 — its own enumeration summed
exactly but omitted a fourth file, `calendar-event.ts`, while the index row said `~54`. Reproduce:

```bash
grep -rPn "(?<!function )\bsanitize(Text|Multiline)\(" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -vP ":\s*(//|\*)" | grep -v "export function" | wc -l   # 54
```

**Why it was NOT done in slice B:** unlike `capHtmlText` — whose fields are empty in the sample —
`clipText` reaches fields that **DO ship in the sample workspace**, so changing it needs its own
golden regeneration and its own review. Bundling it into a rich-text slice would have put a
fixture-moving change under a commit message about something else.

★ **That split is now confirmed, not assumed.** §24's numeric decode (0.210.0) changed what
`sanitizeRichText` produces for every rich field on every load, and `golden-workspace.test` held
**unchanged** through it — no fixture commit anywhere in that release. So the six rich fields really
are empty in the sample workspace, and the fixture cost recorded here belongs entirely to the
**plain-text** fields `clipText` reaches. A `clipText` fix still needs its golden regen; a further
rich-text fix does not.

★ `max <= 0` is safe in the `capHtmlText` version (`charCodeAt(-1)` is `NaN`, and `NaN` fails every
comparison) but that was *asserted with a test*, not assumed — do the same here rather than
reasoning about it, because `clipText`'s `max` is a per-field argument, not one constant.

### CLOSED — the back-off shipped, pinned by a property suite

`clipText` now backs the cut off one code unit when it would land on a high surrogate, the same
shape `capHtmlText` carries. Pinned by `sanitize-core.property.test.ts` (8 properties).

★★★ **THE GOLDEN-REGEN PREDICTION ABOVE WAS WRONG, and the two ★ paragraphs preceding this one are
the record of getting it wrong twice in the same direction.** `golden-workspace.test` passed
**unchanged** through this fix — 5/5, no fixture written. The reason is narrower than "the rich
fields are empty": **no plain-text field in `sample-workspace-small.json` is over its cap**, so
`clipText`'s truncation branch never executes on the sample at all. The paragraph above reasoned
from "which FIELDS the sample populates" when the deciding question was "does any field EXCEED its
cap" — populated and over-cap are different properties, and only the second one moves a golden.
The fix's reach is unaffected: a real workspace with a long emoji-bearing title still gets it.

★★ **`max <= 0` was NOT one case, and the ★ advice above is exactly why that surfaced.** Writing the
test instead of reasoning found that a NEGATIVE `max` is a *distinct* defect from `max === 0`:
`slice`'s end index counts from the END, so `"a𐀀".slice(0, -1)` returns `"a\uD800"` — over cap AND
ending on a lone surrogate, i.e. it defeats the very invariant the fix establishes. `max === 0` is
genuinely inert (`charCodeAt(-1)` is `NaN`). `clipText` now clamps `max <= 0` to `""`. No call site
passes a negative today (every argument is a positive literal or named constant), so this is
defensive — but the property is stated unconditionally and would otherwise simply be false.

★★★ **FIXING `clipText` DID NOT CLOSE THE DEFECT CLASS, AND THE FIRST VERSION OF THIS CLOSURE
IMPLIED IT DID.** A cold review found `sanitizeLabel` — **in this same file, 100 lines below the
fix** — truncating with a raw `.trim().slice(0, LABEL_MAX)`, bypassing `clipText` entirely and
returning a lone high surrogate for a label ending in an emoji at the boundary. `describeLabelStrip`
(`sanitize-report.ts`) carried the identical body, and its own docstring says it MIRRORS
`sanitizeLabel`. Both now route through `sanitizeText` (hence `clipText`); the replace→trim→cap order
is unchanged, so this is behaviour-preserving apart from the back-off. Pinned by a 9th property,
verified to fail against the raw-slice version.

★★ **The lesson generalises past this entry.** "The fix reaches 54 call sites" was TRUE and still
left `sanitizeLabel` out, because it was never one of the 54 — it never called `sanitizeText` or
`sanitizeMultiline`. An entry named after ONE function says nothing about its siblings, and a
call-site count answers "how far does this function reach", never "who else does this by hand".
When closing a defect-CLASS entry, grep for the SHAPE (`\.slice\(0,` next to a `_MAX`), not for the
fixed function's name.

★★★ **MANY sites of this class are still open, and an earlier revision of this closure said "one".**
That sentence was written in the same edit that prescribed the grep above — and did not run it.
Running it: `grep -rn "\.slice(0, *[A-Z_]*MAX" src/app --include="*.ts" --include="*.tsx" | grep -v
"\.test\."` returns **66** hits. Most are ARRAY slices (`MAX_CHIPS`, `MAX_BLOCKS_PER_DOC`,
`MAX_SCHEMES`) and irrelevant; separating those from STRING truncations needs eyes, not grep, so no
exact string-only count is asserted here. Confirmed string sites include `chat-panel.tsx:269`
(`.trim().slice(0, CHAT_MESSAGE_MAX)` on user chat input, against a cap exported from
`sanitize-core.ts` itself), plus `note-log.ts`, `color-schemes.ts`, `ai-errors.ts`,
`diagnostics-redact.ts`, `committee-report/report-draft.ts`, `digest/digest-narrative.ts`,
`insights/recommend.ts`, `insights/sanitize-insights.ts`, `settings-types.ts`,
`next-actions-tuning.ts` and `jira-projects.ts`.

★★ **§22's own body named four of those sixty lines above** ("The same shape recurs in
`note-log.ts`'s `cleanText`, `color-schemes.ts` names, `ai-errors.ts` and `diagnostics-redact.ts`"),
so the closure contradicted its own entry. This is the same defect the closure was rewritten to
record, committed one paragraph after prescribing the cure — which is the strongest available
evidence that stating the rule is not the same as applying it. **Run the command you attach.**

★ Only ONE of them is separately filed, and only because it is a different problem: §108,
`sanitize-records.ts` `rr.html.slice(0, REPORT_HTML_MAX)` (the meeting report). That value is HTML,
so a raw slice can also cut mid-tag — strictly larger than the surrogate issue and NOT fixable by
the one-line back-off. The rest are plain-text and would each take the `sanitizeText` routing, but
they are not audited here and none is claimed safe.

★ **Test-validity note worth carrying to any future cap fix.** The property was first written with a
`>= 3`-of-30 anti-vacuity floor tuned against ONE run. Measured across 5 fixed seeds the true
minimum was **8** — green only by luck, with an unmeasured tail. It is now 30/30 **by construction**
(the arbitrary places the cap exactly one code unit into an astral character) with the floor at 15.
A counter tuned against a single run is itself a flake source, because fast-check reseeds every run.

---

## 24. NAMED entities are neither decoded nor counted — open, the named tail only

**Narrowed by 0.210.0 "Larbalestier" (`ec271c25`, `d4d16341`), not closed.** The numeric half is
done; the named tail below is the whole of what remains, and its illustration is unchanged.

`htmlPlainProjection` (`rich-text-plain.ts`) decodes entities by regex, and the named set is
deliberately small: `&nbsp;` (three spellings), `&lt;`, `&gt;`, `&quot;`, `&#39;`/`&apos;`, and
`&amp;` **last** so `&amp;lt;` cannot double-decode. Everything outside that set stays literal text:

| stored | `htmlTextLength` says | the user sees |
|---|---|---|
| `<p>&mdash;</p>` | 7 | one em dash |
| `<p>a&mdash;b</p>` capped at 4 | — | `a&md` |

Two effects, both on the DOM-free path only. The counter and the cap **over-charge** a value carrying
undecoded entities, so a description with a few `&mdash;`/`&hellip;` eats budget that is not visible
text. And truncation can land **mid-entity** — the broken-entity hazard `capHtmlText` is otherwise
immune to, because a decoded entity is a single character by the time `slice` sees it while an
undecoded one is still seven.

Not reachable from the lean editor (Tiptap emits characters, not references). Reachable by paste from
Word/Outlook, an imported workspace, or an AI tool writing HTML.

★ The DOM path is immune: `descriptionText` runs DOMPurify first, which normalises references to
characters before the projection sees them. So this is a divergence between the two projections — the
same shape as the `HTML_START` approximation AGENTS.md records in its rich-text bullet. The DOM-free
half is the approximate one, and remains so for named references.

### What shipped, and the three refusals that constrain any named-decode fix

`decodeNumericEntities` (`rich-text-plain.ts:98`) decodes `&#8212;` / `&#x2014;` in either case,
running **after** the tag work and **before** the `&nbsp;`/whitespace passes. It returns any
reference it declines verbatim and cannot throw — it runs inside the entity sanitizers on every load.
It refuses three classes, and a named-decode pass has to refuse the same ones for the same reasons:

- **`&` `<` `>`** (`UNSAFE_CODE_POINTS`). `&#38;` is `&`, so decoding it early turns `&#38;lt;` into
  `&lt;` and the named pass then yields `<` — the exact double-decode "`&amp;` decodes LAST" exists
  to prevent. `&#60;`/`&#62;` would put a tag delimiter back into a string the TAG pass has finished
  with. All three stay literal: over-counted, which is the pre-existing behaviour, never corrupting.
  ★ This is why `&mdash;` cannot simply be table-driven alongside them — ordering is load-bearing.
- **Control characters** (`cp <= 0x08`, `0x0e–0x1f`). `sanitizeRichText` strips controls from the RAW
  string and only then projects, so `&#7;` survives that pass, decodes to a BEL inside the projection,
  and on the OVERFLOW path `plainToHtml` (which escapes only `& < >`) writes it back into the stored
  value on all six backends. `\t \n \r \x0b \x0c` are absent for the same reason they are absent from
  `CONTROL_CHARS`.
- **Lone surrogates** (`0xd800–0xdfff`). Emitting one reproduces the backend-dependent corruption of
  §22 exactly: `U+FFFD` on CSV/MD, intact on JSON/IDB. (Not because `fromCodePoint` throws on them —
  it does not; only the range and integer arms are throw-guards.)

**Remaining fix:** a named table beyond the current set, ordered so it cannot subvert the `&amp;`-last
rule and refusing the same three classes. Lower value than the numeric half was — Office paste
produces numeric forms — so this is genuinely small and genuinely optional.

---

## 28. CSV / Markdown / Turso never DOMPurify a rich field at load — open, needs a new boundary

`9e284c68` closed the two **whole-object cast** load paths: `jsonToWorkspace` (file-JSON, SharePoint,
local-file) and the IndexedDB read now route all six rich fields through the escape-then-sanitize
pass, alongside `Task.description` and every `noteLog[].html`. The **codec** paths were not closed,
and cannot be by the same mechanism.

Verified state, per backend:

| entity · field | JSON / IDB | CSV · MD · Turso |
|---|---|---|
| `Task.description` | escaped + DOMPurify'd | **neither** |
| `RaidItem.description` / `.mitigation` | escaped + DOMPurify'd | **neither** |
| `ChangeItem.description` / `.impactDescription` / `.resolutionNotes` | escaped + DOMPurify'd | upgraded, **never DOMPurify'd** |
| `Milestone.description` | escaped + DOMPurify'd | **neither** |
| every `noteLog[].html` | escaped + DOMPurify'd | DOMPurify'd via `decodeNoteLog` |

The change row differs because `buildChangeFromObj` calls `sanitizeChangeItem` → `sanitizeRichText`,
which escapes and caps but is **DOM-free by contract**. `buildMilestoneFromObj` assigns the raw cell
(`if (obj.description) m.description = obj.description`), and `buildRaidItemFromObj` builds a raw
object literal and never calls `sanitizeRaidItem` — only its `noteLog` goes through `decodeNoteLog`.
Turso inherits the CSV column exactly, because `ENTITY_SPECS.fromObj` reuses `build*FromObj`.

★★ **This is out of scope by construction, not by oversight.** The codecs run under bare node in
`scripts/generate-sample-workspace.ts` and the fixture flow, where DOMPurify's `sanitize` is
undefined and a call throws — which `jsonToWorkspace`'s catch-all converts into an EMPTY workspace
that then "successfully" writes near-empty sample files. That is the entire reason `rich-text-plain.ts`
exists and is guarded. Closing this column needs a **post-decode hook** in `csvToWorkspace` /
`markdownToWorkspace` / `TursoBackend.load()` — the same shape as the two paths already fixed, but at
a boundary that does not exist today — plus its own golden-stability answer.

★ `AGENTS.md` says "CSV/MD/Turso already route through `decodeNoteLog`". True of `noteLog` **only**,
and easy to misread as covering `description`. It does not.

★ **What covers this today is the sink, not the load path.** None of the six fields has a display
`dangerouslySetInnerHTML` sink: they reach `RichTextEditor` (which sanitizes with `sanitizeRichHtml`)
or are projected to plain text for search, exports and AI digests. So the realized risk is bounded —
but only because nobody has yet added a read-only rich display for one of these fields, which is
exactly the position the defence-in-depth rule exists to prevent. `Task.description` has been in this
state on these three backends since 0.196.0.

### 2026-08-11 — the door got TEN leading tags wider, and that is the intended price of §137

The `unify-rich-text-s1` branch moved the entity sanitizers' classifier from the `template` sink
(11 tag names) to the `rich` one (21), so the set of values `descriptionHtml` recognises as
already-HTML — and therefore passes through VERBATIM to these three backends — grew by exactly ten
leading tags: **`hr`, `s`, `code`, `mark`, `sub`, `sup`, `pre`, `blockquote`, `h3`, `h4`**.
★★ Re-measure that list PER TAG, never with a set-difference one-liner — one such expression
printed 9 on its first run and 10 on three later ones, and the loop is unambiguous. Build both
regexes with the real factory and probe `<tag>x</tag>` for every member of `SINK_TAGS.rich`,
counting the tags where the old one says `false` and the new one says `true`:
`htmlStartRe(OLD)` vs `htmlStartRe(SINK_TAGS.rich)`, with `OLD` =
`["p","br","strong","em","u","h1","h2","ul","ol","li","a"]` — recover that literal with
`git show 33ab5ec3:src/app/sanitize-html.ts | grep TEMPLATE_ALLOWED_TAGS`, and confirm the sink
argument actually moved with `grep -n 'TEXTAREA_MAX, "' src/app/sanitize-records.ts` (six sites, all
`"rich"` now, all `"template"` at `33ab5ec3`).

Measured under bare node, no DOM:
`sanitizeRaidItem({id:1,title:"t",description:'<blockquote>x</blockquote><img src=x onerror=alert(1)>'})`
stores that string **verbatim**; at `33ab5ec3` the same input was escaped whole, because the
`template` classifier answered `false` on a leading `blockquote`.

★★★ **Record this as a measured TRADE, not a defect.** Escaping was the §107/§137 data-corruption
bug — the stored value came back as visible `&lt;blockquote&gt;` in every surface at once — so
recognising the wider set is the fix, and the verbatim-storage exposure is its known price on
exactly the three backends this entry is about. It is a defence-in-depth regression, not an
exploitable one: every raw-HTML sink re-sanitizes. Enumerate them and check each, don't trust the
count — and this entry then stated a wrong one in the very next clause, which is the point:
`grep -rn "dangerouslySetInnerHTML" src/app --include=*.tsx | grep -v "\.test\."` returns **eight**
lines, not six. TWO are PROSE, not JSX props — one in `chat-panel.tsx` and one in `markdown.tsx`,
both comments that merely name the API to say the file does not use it. The remaining six are real
sinks: five
carry workspace or document HTML (`rich-text-view.tsx`, `comm-send-preview-modal.tsx`,
`meeting-report-panel.tsx`, `document-preview.tsx`, `documents-history-modal.tsx` — the first three
call `sanitizeRichHtml` inline, the last two render through `renderDocumentHtml` →
`sanitizeDocumentHtml`) and the sixth is `layout.tsx`'s build-time theme script, which is not
workspace data. So the SUBSTANCE was right and only the count was wrong. Adding a SIXTH workspace
sink that does not sanitize is what converts this row into a live vulnerability.

★ The same widening reaches template import through `templates.ts` `sanitizeSeedTask` — that
boundary is **§36(a)**, which is out of scope here for the same DOM-free reason, and its door
widened by the same ten tags.

### Correction 2026-08-11 — the `noteLog` row of the table above is browser-only

The row reading "every `noteLog[].html` | DOMPurify'd via `decodeNoteLog`" is true **in the
browser** and silently false without a DOM. `decodeNoteLog` → `sanitizeNoteLog` → `sanitizeRichHtml`
+ `htmlToText`, both DOM-bound, inside a `try/catch` that returns `[]`. Measured under bare node:

```
decodeNoteLog(JSON.stringify([{id:1,timestamp:"2026-01-01T00:00:00.000Z",html:"<p>hi</p>",text:"hi"}]))
```

returns `[]` — a well-formed entry **silently discarded**, with no throw and no diagnostic. So on
the codec paths `noteLog` is not unconditionally "sanitized"; it is sanitized wherever a DOM exists
and would be DROPPED in a bare-node consumer of the same codecs.

★★★ **THERE IS NO SUCH CONSUMER TODAY — this is a LATENT TRAP for a future script, not a live
drop, and that distinction is the entry's whole severity.** A first revision of this correction named
two victims and BOTH are false:

- **The sample generator does not decode.** `scripts/generate-sample-workspace.ts` installs a jsdom
  `window`/`document` BEFORE its deferred `await import("../src/app/storage")` — its header calls
  that a "jsdom landmine" and spells out the deferred-import ordering that avoids it — and it only
  ever calls `jsonToWorkspace` / `workspaceToJson` / `scaleWorkspace`. It never reaches
  `decodeNoteLog` at all, with or without a DOM.
- **The fixture flow runs under jsdom.** It is `golden-workspace.test.ts`, which genuinely does call
  `csvToWorkspace` / `markdownToWorkspace`, but as a vitest file under `vitest.config.ts`'s
  `environment: "jsdom"` — so the DOM is present and the decode is real.

Reproduce the scope: `grep -rn "decodeNoteLog" src scripts` gives three non-test call sites —
`csv-codecs-core.ts`, `csv-codecs-decode.ts` and `markdown-codecs-decode.ts` — and every consumer of
those three is a browser or jsdom path today. ★ Not fixed here and deliberately not "hardened" by
widening the catch: the catch is what keeps a malformed cell from failing a whole load, and
separating "malformed JSON" from "no DOM" needs a real capability check, which is the same
post-decode-hook work this entry already owns. What the measurement buys is the WARNING: the first
bare-node script that imports a codec loses note logs silently, and nothing will say so.

---

## 29. ~~`form.noteLog` is dead state in the task form~~ — CLOSED in 0.211.1

**Was:** `form.noteLog` was dead state in the task form — seeded into the draft, written by nothing.
**Cited from:** `task-form-fields.tsx`, `task-form-modal.test.tsx` — this entry cannot be deleted.

**Resolution:** the field is gone from `emptyForm` (`task-form-context.tsx`), from the `openEditModal`
seed (`use-task-submit.ts`) and from the disabled fallback button, **which now shows no count at all**.
Because
`TaskFormDraft = ReturnType<typeof emptyForm>`, deleting it from `emptyForm` deleted it from the type
and `tsc --noEmit` located every stale literal — it found exactly the two test sites predicted and no
others.

★★ **The data-loss guard was re-proved, not assumed.** Re-adding `noteLog` to the payload (and back to
`emptyForm` so it typechecks) made both write-through tests in `use-task-submit.test.ts` fail with
`saved.noteLog` coming back `undefined` — i.e. the stale draft copy spread over the live row and wiped
it. That is the exact shape `fe779f32` fixed. Those two `it`s survive untouched; only the assertion
pinning the *seeding* was removed.

★ Several negative assertions were deleted as **vacuous rather than passing**: with no competing draft
copy, `queryByText("… (1)")` and `queryByText("Stale draft note")` can no longer discriminate anything.
The 1-vs-2 discriminator that made those tests meaningful is structurally impossible now, because the
bug it guarded against is. Leaving an assertion that *looks* like a guard and proves nothing would have
been worse than deleting it.

---

## 30. A link in a task description loses its address in document exports — open, needs a decision

Found by the adversarial sweep of 0.210.0, after that release routed `Task.description` through the
export projection. Recorded rather than fixed, because the fix touches four renderers.

`sanitizeRichHtml` allows `<a href>`, so a description can genuinely store a link. The export
projection ends in `htmlToText`, which is `DOMPurify.sanitize(html, {ALLOWED_TAGS: [], ALLOWED_ATTR: []})`
— that keeps the anchor's TEXT and drops its `href`.

So `<p>Spec: <a href="https://intra/spec">the spec</a></p>` exports to `Spec: the spec` in PDF, DOCX,
XLSX and PPTX, and the address is unrecoverable from the file.

★ Scope is TASKS ONLY as a regression: RAID / change / milestone descriptions already went through
`descriptionText` before 0.210.0 and already lost their hrefs. But before 0.210.0 the Tasks section
emitted the raw markup, so for that one field family the export became more readable and strictly
LESS informative — in a release headlined "formatted descriptions survive the trip out of the app".
CSV/MD are unaffected (they carry the stored markup verbatim, addresses included).

Two options, and the cheap one is not obviously right:
- Render a link as `text (url)` in the EXPORT projection only. Keeps every address, but re-opens a
  byte question in all four renderers and in the golden-adjacent export tests, and makes a
  link-dense description noisy to read.
- Accept the loss and say so in the UI or the export itself.

★ Do NOT "fix" this by widening `htmlToText`'s allow-list — it is the shared plain-text projection
that search, the AI digests and the inline-AI preview also use, and none of them wants markup.

---

## 31. `sanitizeRichText` caps VISIBLE TEXT, so markup bytes are unbounded — open, affects all four rich entities

Found auditing 0.210.0's write-boundary fix. Not introduced by it in general — RAID/change/milestone
already had this property via `sanitize-records.ts` — but that fix DID remove the one byte bound that
`Task.description` still had, so the field joined the others' posture.

`capHtmlText(html, max)` measures `htmlTextLength` (VISIBLE text) and returns the html untouched when it
fits. `descriptionHtml` is `HTML_START.test(s) ? s : plainToHtml(s)` — a verbatim pass-through for
anything already HTML, with no allow-list at this layer (correct: the module is DOM-FREE and cannot run
DOMPurify). So markup carries no limit. Measured:

| input | visible text | stored |
|---|---|---|
| `<p>` + `<em></em>`×200000 + `a</p>` | 1 char | **1,800,008 B** |
| `<p data-x="` + `A`×500000 + `">a</p>` | 1 char | **500,018 B** |

Before the 0.210.0 fix the task boundary was `plainToHtml(sanitizeNotes(x))`, which clipped RAW length at
`TEXTAREA_MAX` — so the same input stored 11,676 B. That value lands in a Turso row, a CSV cell and a
Markdown table cell on all six backends.

★ Practical ceiling is the model's `max_tokens` for the chat and proposal paths. For persisted
insight-recommendation replay it is whatever `sanitizeToolCall` allows on `proposedCalls[].input` — NOT
verified, so do not assume it is small.
★ Not a corruption or XSS issue: every read of these fields projects through DOMPurify or the editor
schema. It is bloat/abuse.
★ The fix is one raw-byte ceiling inside `sanitizeRichText`, which would cover all four rich entities at
once — but it can TRUNCATE ALREADY-STORED values on their next load, so it needs the same care as §22
(and probably a golden regen). That is why it is recorded rather than done in 0.210.0.

---

## 32. `HTML_START` misclassifies eight plain-text prefixes, and the text is then DELETED — open, small

Pre-existing (`narrative-html.ts`, where `HTML_START` then lived), found by a cold review of 0.210.0.
Not introduced by it, but 0.210.0 extended the reach to the AI write boundaries, so a model-supplied
value now hits it too.

★★ **STILL OPEN, but the name below is RETIRED — do not go hunting for it.** §107 replaced the one
shared `HTML_START` with a per-sink classifier built by `htmlStartRe` (`html-start.ts`) on
2026-08-10. That factory assembles the SAME shape — `\b[^>]*>` after the alternation — so this
defect is unchanged in kind and now exists once per sink rather than once globally. The line number
that used to sit here was broken by that move, which is why it is gone; read the regex out of
`htmlStartRe`, not out of this entry.

★★ **THAT SLICE ALSO WIDENED THE FALSE-POSITIVE SURFACE ON ONE PATH — the PROJECTION path, from 8
tag names to 20.** The projection classifier (`SINK_TAGS.projection`, = `DOCUMENT_ALLOWED_TAGS`)
deliberately takes the widest list, because on a strip-everything pass the opposite direction (§107 /
§114 — a real `<h1>` escaped whole into literal `&lt;h1&gt;` in search, the AI digests and every
export) is commoner and louder. The trade is recorded at `DerivedSink` in `html-start.ts` and was
taken knowingly; it does not change this defect in KIND, only in reach. Measured 2026-08-10 through
the real `descriptionText`:

| stored | projects as |
|---|---|
| `<mark> means highlight in this project` | `means highlight in this project` |
| `<code> blocks are banned in the report` | `blocks are banned in the report` |
| `<blockquote> is what we call the callout` | `is what we call the callout` |
| `<h1> headings are numbered` | `headings are numbered` |
| `<table> layouts are deprecated` | *(unchanged — `table` is not on the list)* |

The twelve extra names are the difference between the old eight and `DOCUMENT_ALLOWED_TAGS`; the
`<table>` row is the control proving the boundary is the list and not the regex shape.

`HTML_START` is `/^\s*<(p|br|strong|em|ul|ol|li|a)\b[^>]*>/i`. `\b` matches on a following SPACE, so a
plain sentence that merely OPENS with one of those eight words in angle brackets is classified as HTML
and passed through verbatim — and then the `TAG` pass deletes the pseudo-tag along with its words:

| stored | renders / exports as |
|---|---|
| `<a note about pricing> is attached` | `is attached` |
| `<em dash> means something` | `means something` |
| `<li 2 items> to review` | `to review` |
| `<p 3 open> and counting` | `and counting` |

Under the old plain-text-only AI boundary this survived as `&lt;a note…&gt;`. The parenthetical is now
gone with no reader able to recover it.

★ `rich-text-plain.test.ts` pins the NEVER-CLOSES cases (`"<li 3 items"`), which correctly do NOT match.
The closes-with-a-space case is what is untested.
★★ The fix is NOT just tightening the regex: `HTML_START` is shared with the dashboard narrative and it
decides the classification for every rich field on every READ, so a change moves what existing stored
values mean. Requiring `[\s>/]` after the tag name plus a well-formedness check is the shape; it needs
its own slice and probably a golden check.

---

## 33. A multi-paragraph description can overflow its PPTX box — open, cosmetic

0.210.0 made a block boundary cost a whole `<a:p>` in PPTX instead of collapsing to whitespace.
`pptxTextBox`'s `cyEmu` is FIXED (`2800000` on the row-fields box, sized for ~6 wrapped lines) and
`pptxTextBox` (`ooxml-pptx-primitives.ts` — grep `a:bodyPr`) sets `<a:bodyPr wrap="square" …>` with **no** `normAutofit`/`spAutoFit` — verified,
so PowerPoint will not shrink text to fit. A task with a four-paragraph description turns one meta line
into four and pushes later fields past the bottom of the box.

★ Not a regression in kind (a long run-on line wrapped and overflowed too) but it is newly easy to hit,
and the adjacent "cap at 6 extra fields so the text fits the slide" comment is now false.
★★ That `bodyPr` sentence cited a line in `export-pptx.ts` until 2026-08-09 and was wrong in BOTH
halves — the number ran past that file's 201 citable lines, and the element is no longer in it at
all: `pptxTextBox` emits it and `export-pptx.ts` only calls the primitive. ★ The cite was EXACT
before the extraction commit that moved it, so this is drift, not an authoring error. The doc-claims ratchet flagged
the past-EOF half, which is the cheap one; a wrong FILE is the half no gate can see. The `cyEmu`
cite beside it (grep `2800000`) was correct.
★ Byte-stability of the break-free case IS pinned; layout is not, and nothing in the release's
verification opened a generated deck. Cheapest fix: add `<a:normAutofit/>` to that `bodyPr`, or bound the
paragraph count per meta line. Needs an eye-check on a real deck either way.

---

## 34. ~~The DOM-free guard's filter is a NAME LIST where the real set is an import GRAPH~~ — CLOSED in 0.210.0

`rich-text-plain.test.ts`'s reverse sweep decides "is this file DOM-free?" by matching paths
(`/scripts/`, `sanitize*.ts`, `*-codecs*.ts`, plus `workspace.ts`/`storage.ts`/`rich-text-plain.ts`/
`narrative-html.ts` added by hand as each was noticed). A round-5 audit resolved the real set from the
generator entry point: **`scripts/generate-sample-workspace.ts` transitively imports 76 files**, of which
the filter matches ~18. Unmatched but in the graph: `templates.ts`, `browser-backend.ts`,
`document-link.ts`, `calendar-event.ts` and 54 more (58 unmatched in total). ★ Two files an earlier draft
of this entry named — `template-apply.ts` and `new-project-workspace.ts` — are NOT in the graph: they are
imported only from `.tsx` surfaces the generator never loads. Corrected here rather than left as a plausible
-sounding list, since the whole point of the entry is that guessing which files matter is the failure mode.

**CLOSED the same day it was opened** — the mechanism was the defect, so recording it and moving on would
have left the next reviewer to notice the next file. `rich-text-plain.test.ts` now RESOLVES the graph from
`scripts/generate-sample-workspace.ts` (static `from`, bare side-effect `import`, and dynamic `import()`,
following `.ts`/`.tsx`/`index.ts`) and scans exactly that set. Counts re-derived independently before and
after: 76 graph files, of which the old name filter matched **18**.

Mutation-proved on two files the old filter silently ignored: a `rich-text-projection` import in
`templates.ts` (the file AGENTS.md warns a reader away from) and in `browser-backend.ts` — both now
reported, neither was before. `scanned > 50` replaces `> 10`, so the assertion fails if the resolver stops
resolving instead of passing on a collapsed set, and the set is asserted to contain `templates.ts` by name.

★ Kept as a numbered entry rather than deleted, because the LESSON is the reusable part: a hand-maintained
list of "the files that matter" is a guard that reports on what someone remembered. Where the real set is
derivable, derive it.

---

## 35. `sanitizeAiRichText`'s double pass can double-escape one exotic shape — open, suspicion

Recorded from a round-5 audit; **real-world reachability is a suspicion, not established.**

`sanitizeAiRichText` is `sanitizeRichText` → `sanitizeRichHtml` → `sanitizeRichText`. It is
idempotent (`f(f(x)) === f(x)` on 13 probes) and the double cap is safe (DOMPurify never increases visible
length). One divergence from a single logical pass:

`<a-b>cost &lt; 5k</a-b>` → `HTML_START`'s `a\b` matches (the hyphen is a word boundary), so pass 1 passes
it through → DOMPurify unwraps the unknown element to bare text → pass 3 no longer sees an HTML start, so
`plainToHtml` escapes AGAIN → `<p>cost &amp;lt; 5k</p>`, rendering the literal `cost &lt; 5k`.

★ Needs a hyphenated/namespaced element whose name STARTS with one of p/br/strong/em/ul/ol/li/a, in
leading position, plus an entity in the body. A model would have to emit that unprompted.
★ Same root cause as §32 (`HTML_START` classification), so fixing that likely closes this too — worth
handling together rather than special-casing the third pass.

---

## 36. Two rich-field write/export postures that were CLAIMED as recorded but were not — open, small

Both surfaced in round-6 reviews of 0.210.0. Filed together because the shared defect was documentary: two
places pointed at §28 for a posture §28 does not cover (§28 is scoped to the **codec** load paths — it names
`buildMilestoneFromObj` and "the codecs run under bare node").

**(a) Template import upgrades but never allow-lists.** `templates.ts` `sanitizeSeedTask` runs
`sanitizeRichText`, so a template's task description passes through as HTML with no DOMPurify pass. Before
0.210.0 it went through `plainToHtml`, which escaped `& < >` — so this boundary got *less* strict in a
release about write boundaries.
★ Risk is genuinely low and that is why it is recorded rather than fixed: there is **no template import
channel** (no `importTemplate`/`exportTemplate`, no template-JSON path — verified). A template is captured
from your own workspace into your own `settings.templates`, so the trust level is "your own settings", not
"a file someone sent you". Every read of the field also re-sanitizes at its sink.
★★ It CANNOT be fixed in `templates.ts` — that file is in the sample generator's import graph, so a
DOMPurify call there breaks the generator under bare node (and the guard now bans the import). The fix, if
ever wanted, is an allow-list pass at the browser-side caller of `sanitizeTemplate`.

**(b) `noteLog` exports as a raw JSON blob into the document formats.** `noteLog` is a `CSV_COLUMNS` entry
(`csv-codecs-core.ts` returns `encodeNoteLog(...)`), and `export-sections.ts` maps every CSV column through
`richCell` — where `noteLog` is correctly NOT a rich column. So a task or RAID row with notes exports a cell
reading `[{"id":1,…,"html":"<p>…</p>","text":"…"}]` into the PDF/DOCX/XLSX/PPTX tables.
★ Pre-existing since 0.196.0 and outside the rich-column mechanism this release fixed — but it sits in the
same exported row as the descriptions that were just cleaned up, which makes the release note's "every other
register already exported readable text" read further than it should.
★ Fix is a decision, not a bug fix: drop `noteLog` from the document-format sections, or project it to
readable text (author · date · text per entry).

---

## 37. `RaidItem` has NO storage-side length cap on any path — open, pre-existing

Produced by a round-6 review exchange in 0.210.0: a reviewer asserted the modal cap merely duplicated a
sanitizer one, I showed the sanitizer is not on the save path, and tracing it properly turned up something
neither of us had. **`sanitizeRaidItem` looks like the storage boundary for RAID and is on no save or load
path at all.** Its only non-AI caller is `task-manager.tsx` `applyRaidFromTask`; the other two are the chat
tools.

| entity | save path | JSON / IDB load | CSV / MD / Turso load | net |
|---|---|---|---|---|
| Change | none | `workspace.ts:560` → `sanitizeChangeItem` ✓ | `csv-codecs-core.ts:429` `buildChangeFromObj` → `sanitizeChangeItem` ✓ | capped on next load |
| RAID | none | `workspace.ts:545` bare cast + `sanitizeRaidRichFields` (**rich fields only**) | `csv-codecs-core.ts:324` `buildRaidItemFromObj` hand-builds `obj.title?.trim() ?? ""` | **capped nowhere, ever** |

Consequences:
- `RaidItem.title` and `owner` are effectively UNBOUNDED stored fields. An over-long value written by any
  writer other than the edit modal stays over-length on all six backends indefinitely.
- 0.210.0's Enter-submit fix is therefore *adding* the only cap on the human editor path, not aligning the
  modal with storage — the modal comment says so, and the release note describes the two registers
  separately because one sentence cannot cover both.
- The asymmetry with `buildChangeFromObj` (which DOES route through its sanitizer) reads as unintentional
  rather than designed: RAID is the one register whose decoder hand-builds *and* whose JSON load runs only
  the rich pass.

★ The fix is not simply "call `sanitizeRaidItem` on load": that function enforces per-category status
defaulting and would silently rewrite stored statuses, so it needs the same care as any read-time
normalisation change (and probably a golden run). Related to §31 (unbounded markup) — same class, different
field.
★★ Process note worth keeping: BOTH of us reasoned from a sanitizer's EXISTENCE rather than its call sites.
"A function named `sanitizeX` exists" says nothing about whether anything calls it on the path you care
about. Trace the path.

---

## 38. `ALLOWED_URI_REGEXP` silently strips `target` and `rel` from every stored link — open, pre-existing

Found on 2026-07-30 while adding rich descriptions to the sample master: the link I wrote as
`<a href="…" target="_blank" rel="noopener noreferrer">` came back out of the golden fixtures as a bare
`<a href="…">`. Both `target` and `rel` are listed in `ALLOWED_ATTR` / `NOTE_ALLOWED_ATTR`
(`sanitize-html.ts:8`, `:25`), and `ADD_ATTR: ["target"]` does **not** change the outcome.

**Mechanism, isolated on dompurify 3.4.12** — it is the `ALLOWED_URI_REGEXP`, not the attribute lists:

| config | result |
|---|---|
| DOMPurify defaults | `<a href rel>` — `target` dropped (not in the default attr list) |
| `ALLOWED_ATTR: [href, target, rel]` | `<a href target rel>` — **both survive** |
| `ALLOWED_URI_REGEXP: /^(?:https?\|mailto):[^<>"]*$/i` alone | `<a href>` — **both dropped** |

A custom `ALLOWED_URI_REGEXP` is tested against **every** attribute value, not just URI-bearing ones.
`_blank` and `noopener noreferrer` do not match an end-anchored scheme pattern, so they fail and are removed.
DOMPurify's *default* regexp tolerates them because it has an alternation for values that are not schemes at
all; ours, deliberately end-anchored to keep the `href` boundary airtight on its own, does not.

Consequences:
- The Tiptap editor explicitly sets `target: "_blank", rel: "noopener noreferrer"`
  (`rich-text-editor.tsx:157`), and the storage boundary discards both. **Every stored link opens in the
  same tab**, in note bodies, all seven rich description fields, and communication templates.
- Blast radius is exactly `target` + `rel`, because those are the only non-URI attributes in the allow-lists.
- ★ This is **not** a security hole, and the direction matters: with `target="_blank"` gone there is no
  reverse-tabnabbing surface for a missing `rel="noopener"` to expose. Stripping both is strictly safer than
  stripping only `rel`. It is an intent mismatch, not a vulnerability — do not file it as one.
- The comment at `sanitize-html.ts:2` says the allow-list "mirrors the Tiptap editor's schema (the only
  producer of this HTML)". For tags that holds; for attributes it does not, and listing `target`/`rel` there
  reads as though they persist. Corrected in place on 2026-07-30 — the list is unchanged, only the comment.

★ The fix is not "drop the end-anchored regexp": that regexp is the `href` scheme boundary and is
load-bearing. Scope the strict test to URI attributes (or re-add `target`/`rel` via a hook that runs after
the URI check) — a behaviour change that rewrites stored `<a>` markup and moves the golden fixtures, so it
needs its own slice and a golden run, not a drive-by.
★ The sample master deliberately writes its one link **without** `target`/`rel`, so the curated data
reflects what is actually storable rather than implying an attribute that cannot survive a save.

---

## 39. The timelog partial-failure toast — a click swallowed by the button's `disabled` state — mechanism CANDIDATE (precondition proved, causation unreproduced), fix landed

`timelog-panel.test.tsx` → "surfaces a partial-failure toast when Refresh drops some projects". Eight CI
failures, always this one assertion, always with the other ~767 files green and the full suite passing
locally: 0.205.0 · 0.208.0 · twice on the 0.209.0 MR · once on main after that merge (which left main
**red**) · the 0.210.0 MR pipeline #5305 · and TWO on 2026-08-02 — the weekly `schedule` pipeline #5403
(00:25) and the post-merge main pipeline #5418 (19:38) for the 0.211.1 MR !338, which again left main red.

★★★ **THE "WORKER STARVATION UNDER FULL PARALLEL LOAD" DIAGNOSIS IS DISPROVED.** It was what justified
raising this assertion's budget from the global `asyncUtilTimeout: 5000` to an explicit `timeout: 15000`
(!335). The failure then recurred **with that mitigation in place**. Three failures have now run under
the 15 s budget and consumed:

| run | duration |
|---|---|
| !335 (the 6th failure) | **15,093 ms** |
| #5403 (weekly schedule, 2026-08-02) | **15,098 ms** |
| #5418 (main post-merge, 2026-08-02) | **15,117 ms** |

A spread of **24 ms across three runs** at a 15,000 ms ceiling — 0.16%. A toast arriving slowly would
scatter; a toast that never arrives pins at the ceiling. **Do NOT raise the timeout again**: 5 s → 15 s
moved the failure point and bought nothing, and 30 s would cost another 15 s of CI wall-clock per
failure.

**The mechanism CANDIDATE.** The Refresh **button** carries a fifth `disabled` condition the **handler** does not
(that asymmetry is §74, recorded separately as a product-code finding):

- handler `handleRefreshBookings` guards `isPopout || sync.busy || confirming || !canRefresh`;
- the button in `timelog-panel-toolbar.tsx` adds **`isMisconfigured`** = `!cfg.enabled || !cfg.host ||
  !cfg.apiToken`.

`useSettings` starts at defaults — `defaultTimelogConfig.enabled === false` — and commits the stored
config **behind an `await migratePlaintextSecrets(...)`**, which act-wrapped `render()` does not drain.
So at first commit `isMisconfigured` is true and the button is disabled. The button's *existence* is
gated only on `fetchedAt` (a static truthy mock), so `findByRole` matches it **immediately** and offers
zero protection against that. React drops `onClick` on a disabled `<button>`, so the click is a **silent
no-op that nothing retries** — the toast never arrives and `waitFor` burns its whole budget, which is
exactly the 15,09x ms signature above.

**PROVED locally:** a probe asserting `toBeDisabled()` immediately after `render()` passes, and flipping
it to `toBeEnabled()` fails. The button IS disabled at first commit.
★ That flip is the NEGATION of the assertion, not a mutation of the implementation — it shows the probe
is non-vacuous, it does not show the disabled state CAUSES the CI failure. Do not cite it as a mutation
check; the causal step is the unproved one below.

★★ **NOT proved — state this precisely.** That the button is *still* disabled at click time in the CI
failures. It cannot be deterministic: if the click were always swallowed the tests would fail on every
local run, and they never have. `findByRole`'s own await usually drains the settings commit before the
first successful match. This is a **race at that boundary**, and the local probe measured a different
moment than the one that fails.

**The fix:** wait for the ENABLED state before clicking —
`await waitFor(() => expect(btn).toBeEnabled())` — applied to **both** affected tests: the toast test and
its structurally identical sibling ("shows a Refresh button once bookings are read and re-fetches the
persisted scope"). The record had attributed every failure to the toast test; both had the same exposure.
No timeout VALUE was changed — nothing raised, nothing lowered.

★ The toast assertion was also split in two (`fetchBookingsForProjects` called, then `showToast`) so a
future failure says which half broke. ★★ **But be precise about what that did to the budget**, in an
entry whose operative rule is "do not raise the timeout": no value moved, yet the assertion's worst case
went from one 15 s wait to two, i.e. **15 s → 30 s nominal**. That sum exceeds the 20 s `testTimeout`,
so the excess is unreachable — and the practical consequence is not the one an earlier draft of this
paragraph claimed. A first-half FAILURE throws at ~15 s, inside `testTimeout`, and **does** name its
half. The case that reports a bare "timed out in 20000 ms" with no half named is a first half that is
**slow but passing** followed by a second-half failure.

**State: mechanism CANDIDATE, fix landed, closure pending CI confirmation.** ★★ The precondition is
proved and the causation is not — do not let the shorthand "diagnosed" harden into "established" in a
later edit. The failure never
reproduced locally, so a local green is the same signal it always gave and proves nothing. Do not mark
this flatly CLOSED until a run of CI pipelines has passed with the fix in place.
★ Meanwhile the operational answer is unchanged: **retry the job**, do not edit the test again.
★ Six full-suite amplification configurations (3 × `--no-isolate`, 3 × `--sequence.shuffle` seeds 1–3)
failed to reproduce this test on 2026-08-04 — see the amplification note in §51 for what that negative
is and is not worth.
★ It was untracked here until 2026-07-30 despite six occurrences and one red main — which is why the
frequency data lived only in a code comment and a memory file.
★ Instrumentation: a failure capture now lives in that describe block. It is deliberately NOT
`onTestFailed` — see §73 for why that form would have fabricated evidence *for this very hypothesis*.

---

## 40. `text-ui-dark-blue` without a mode-appropriate companion — **40 sites**, open, needs its own slice

`--ui-dark-blue` is a near-black navy in all three dark scheme maps, so as TEXT on `--surface` it
measures roughly **1.10:1 (harbor) / 1.17:1 (meridian) / 1.31:1 (umber)** — not "low contrast",
effectively invisible. On `--surface-muted` it is **1.01 / 1.04 / 1.17**.

★★★ **The first version of this entry listed three sites and implied that was the remainder. A sweep
found 26 in this token class plus 13 more in the widened class — and a later audit added a 27th
the sweep had missed, giving 40.** The entry is corrected rather
than deleted because the wrong number is the more instructive artifact: it came from fixing what
review happened to surface, then documenting that as the scope.

### A. Base text, no companion — 7

`jira-conflicts-modal.tsx:183` (Jira-key badge, on `bg-surface-muted`) · `jira-settings.tsx:617`
(selected arm, assignee picker) · `settings-sections/integrations-section.tsx:484` (link, carries
`underline` as a non-colour affordance) · **`tasks-section.tsx:615`** (Jira-sync button) ·
**`use-tasks-dedup.tsx:69`** (dedup toolbar button class const) · **`chat-prompt-chips.tsx:37`** ·
**`rich-text-view.tsx:13`**.

★★★ **`rich-text-view.tsx:13` is plausibly the most user-visible site in the whole set, and TWO
independent sweeps missed it.** `PROSE_CLASS` is
`"… [&_a]:text-ui-dark-blue [&_a]:underline …"` with no dark variant, and this is the app's shared
read-only rich-text sink — the note log, the dashboard narrative, and every stored HTML body render
through it. So **every link in every rendered rich-text field** is near-black navy on `--surface` in
dark mode. It belongs in this section by the entry's own criteria (it is the same underlined-link
shape as `integrations-section.tsx:484`, which is listed).
★★ **Why both sweeps missed it, which is the transferable part:** it is an ARBITRARY-VARIANT
utility, `[&_a]:text-*`, not a bare `text-*`. A scan keyed on `text-ui-dark-blue` finds the string
but a companion test keyed on `dark:text-` never matches, because the correct companion here is
`dark:[&_a]:text-*` (or `[&_a]:dark:text-*`). The "Not swept" list at the bottom names `border-`,
`fill-`, `stroke-` and friends — it did NOT name arbitrary variants, so this was a silent gap rather
than a declared exclusion. **Any future sweep must enumerate the variant forms it handles.**

★★ **`chat-prompt-chips.tsx:37` defeats every sweep keyed on "does a companion exist".** Its
companion is `dark:text-ui-dark-blue` — it re-asserts the same broken colour. Verified: that string
occurs exactly **once** in the repo. A companion must be checked for its VALUE, not its presence.

### B. `hover:text-ui-dark-blue` with no `dark:hover:text-*` — 18

★★★ **A `dark:text-*` companion does NOT survive `hover:`, and this is the part that looks fixed and
is not.** `globals.css:3` defines `@custom-variant dark (&:where(.dark, .dark *))`, and `:where()`
contributes **zero** specificity — so `dark:text-x` resolves to (0,1,0) while `hover:text-y:hover` is
(0,2,0). The hover rule wins regardless of source order. Only `dark:hover:text-*` fixes a hover arm.
★ Reasoning from source order gives the WRONG answer here: Tailwind emits the `dark:` rule later,
which looks like it should win.
★★ **The defect and its remedy are decided by different rules.** The defect is specificity-decided and
therefore order-immune. The FIX is not: `dark:hover:text-*` compiles to
`:where(.dark,.dark *):hover` = (0,2,0), which TIES `hover:text-*` and wins only on emission order.
That order is stable in Tailwind today, but it means the remedy — unlike the bug — would be sensitive
to any change in variant emission order.

`combo-input:117` · `gantt-chrome:262` · `gantt-rows:160` · `inline-ai-edit-button:30` ·
`insights/insight-digest-card:86` · `jira-settings:207` · `labels-input:162` · `raci-panel:228,238` ·
`raid-edit-modal:355` · `raid-panel-rows:373` · `resource-directory:425` · `task-kanban-card:133` ·
`task-manager-ui:34` · `task-row:391` · `tasks-section:1031` · `workspace-section-chrome:177,178`

★ **`inline-ai-edit-button:30`, `task-kanban-card:133` and `task-row:391` each carry a base
`dark:text-ui-light-grey` on the same element** — they read as handled and are not.
★ `task-manager-ui:33/34` and `workspace-section-chrome:177/178` are the two-arm ternary shape: in the
first, the active arm is companioned and the inactive arm is not; in the second, both arms are broken.

★★ **A THIRD UNNAMED VARIANT GAP, found 2026-08-05 — the sweep never handled `group-hover:`,
`active:` or `focus:` either, and two more uncompanioned sites fall in it.** They are additional to
the 40 enumerated above, which all re-verified as real and correctly grouped (A 7 · B 18 · C 2 ·
D 13). `gantt-chart.tsx:296` carries `group-hover:text-ui-dark-blue` on `bg-surface` — the trailing
"add task" affordance, in no group at all. `gantt-chrome.tsx:262` is already counted in B for its
`hover:` arm, but the SAME element also carries `active:text-ui-dark-blue`, equally uncompanioned.
★ `focus:text-ui-dark-blue` also occurs once and was CHECKED and is clean: `modern-shell.tsx:139`
pairs it with `focus:bg-ui-green` on the skip link, so both colours are forced and the pair is
mode-independent. Do not add it to the list. ★ This is the second time a variant form defeated a
sweep here — the arbitrary-variant miss above was the first — which is why the rule is to enumerate
the forms handled, not to trust a bare-name grep. Reproduce each form separately:

```bash
for v in "" "hover:" "group-hover:" "active:" "focus:"; do printf '%s %s\n' "$v" "$(grep -rn "$v"'text-ui-dark-blue' src/app --include="*.tsx" --include="*.ts" | grep -vc "\.test\.")"; done
```

★ Nine of the line numbers above were stale by −5 to +43 and were re-derived 2026-08-05; groups C and
D were exact. These are class-name occurrences with nothing nameable to cite instead, so a number is
the only available cite — expect it to drift again and re-run the command rather than trusting it.

### C. Icons, lower priority — 2

`tour-catalog.tsx:36` (`aria-hidden` icon holder; the card title carries the meaning) ·
`calendar-chip.tsx:67` (`data-moved-marker`; the chip already signals "moved" via a dashed border).

### D. Widened class — `text-ui-purple`, 13 sites

Different severity: it stays legible, just under threshold — **3.52 / 3.65 / 3.33** on `--surface`
dark, **3.18 / 3.29 / 3.02** on `bg-ui-purple/10`. All fail the 4.5:1 body threshold in all three dark
schemes; all clear the 3:1 large-text bar, and several are `text-xs`, so the small-text threshold
binds. `comm-template-diff-view:29` · `influence-interest-matrix:97` (★ TWO defects on one element — the
base purple here, AND a `hover:text-ui-green` at 1.97–2.48:1 in the light schemes, see the cleared
section; `--ui-purple-strong` fixes only the first) ·
`outlook-calendar-import-modal:118` · `outlook-import-modal:72` · `raid-edit-modal:361` ·
`raid-panel-toolbar:150` · `ai-section:548` · `templates-section:158` · `storage-config:178,187,193` ·
`task-form-fields:363` · `resources-panel-rows:175` (which additionally sets `dark:text-ui-purple`, a
second no-op companion — ★ the COMPANION is harmless because the value is unchanged, but the SITE
fails identically to the other twelve; listing it only as a companion note made it read as cleared).
★ The fix is `--ui-purple-strong`, which exists and is AA-derived.

### Why this is a slice and not a patch

★★ **The correct pattern is already established here — 12 files use `dark:hover:text-`.** So this is
not a new technique to introduce but a convention applied inconsistently, which is what makes a
mechanical sweep safe and a piecemeal fix wasteful.
★★ **No gate can catch ANY of it, and that is structural, not an oversight.** axe scans the RESTING
state only, so all 18 hover sites are uncatchable by construction; there is no hover pass in
`e2e/a11y.spec.ts`. **At least five** of the seven base sites self-hide behind a feature flag
(`jira.enabled`, `isAiEnabled`) or live in an unscanned view or a closed modal — the two whose
reachability was never established are `chat-prompt-chips.tsx:37` (see below) and
`rich-text-view.tsx:13`, which renders wherever stored rich text does, including the Dashboard
narrative on a scanned view. Nobody checked whether the seed supplies narrative text. The gate would not
have caught the three originally-filed sites either. **Only a static lint closes this class** — "a
one-mode colour token used as text requires a companion at the same variant level, whose value
differs". ★ A Playwright hover pass is conceivable but would have to hover every control across 16
views × 5 scheme combos; the repo's own precedents for this kind of check (`shell-palette-guard`,
`scheme-purple-hover.test.ts`) are source/computed sweeps, not runtime scans.

★ **"At least five" is deliberate.** Whether `chat-prompt-chips.tsx:37` renders at axe scan time was
NOT established — the AI Assistant view is scanned, but the chips are probably unrendered without a
configured key. Weak counter-evidence that they do not render: if they did, harbor-dark and
meridian-dark ought to be failing the gate today, and they are not. That is inference, not a check.
Do not convert it to "five of six" without opening the view.

### Cleared — SPOT-CHECKED, not audited

★★★ **Read this heading literally.** An independent audit checked exactly ONE of the buckets below
(`hover:text-ui-green`) and found it wrong on both its mechanism and its numbers — one of its 20
sites was not a table header at all and is actively broken in light mode. **Do not assume the
remaining buckets hold.** They record what the sweep CONCLUDED, not what it verified site-by-site,
and a "cleared" note is the most dangerous thing to get wrong here because it is precisely what stops
anyone looking again. Re-verify a bucket before relying on it to skip work.

21 checkbox/radio `accent` colours (Tailwind Forms uses `text-*` as the checked fill) · navy on
`bg-ui-green` (6.84/5.78/6.73 dark, 5.40/5.04/5.00 light — both modes pass, the bg moves with the
scheme) · 11 base `text-ui-light-grey` in the sidebar (root is `bg-ui-dark-blue`, mode-invariant) ·
`text-ui-white` (8, all on navy) · `hover:text-ui-green` (**19 of 20** — `<th>` sort buttons routed through
`DataTable`, which applies `TABLE_HEAD_CLASS` to its `<thead>` by construction, so they sit on
`--table-head-bg`: **4.93–7.48** across all six combos; AGENTS.md's "green is sub-AA on a header"
warning refers to the RETIRED Mockup light header, not these. ★★ **The 20th is NOT cleared** — see
below) · `hover:text-ui-pink` (10, 4.63–6.78 both modes) ·
`text-ui-blue` (8 — these ARE the companions) · `-strong` variants (AA by construction:
`deriveAaVariants` nudges against `--surface-muted`, the harder surface — **except
`--ui-purple-strong`, which is derived against the purple TINT composited over that surface**, not
the surface itself; see the AGENTS.md scheme landmine, where deriving it against the bare surface IS
the documented bug).

★★ **The green floor is 4.93:1 (meridian-dark), i.e. 0.43 above AA — not the ~0.9 a collapsed
"5.40–7.48" range implies.** Stated as a range across both modes the minimum disappears, and this is
a "cleared" note, so the next reader inherits the margin as fact. Any future edit to
`--table-head-bg` or `--ui-green` has far less headroom here than it looks.

★★★ **`influence-interest-matrix.tsx:97` was swept up in that "all 20 are table headers" claim and is
NOT one.** It is a `role="button"` comms marker nested in a `bg-surface` chip; the file contains no
`DataTable` and no `TABLE_HEAD_CLASS`. `--ui-green` on `--surface` measures **2.17 (harbor-light) /
1.97 (meridian-light) / 2.48 (umber-light)** — its hover state is close to invisible in every LIGHT
scheme, the mirror of the dark-mode defect this whole entry is about. Dark is fine (6.74–8.80).
★★ This is the failure mode named at the top of this section as the worst kind: a site recorded as
**cleared** while actively broken, which stops a future sweep from ever looking again. It also
contradicted the register internally — the same line is listed in section D for its base
`text-ui-purple`, so it sat in both the affected and the cleared bucket at once. ★ Fixing D's
prescription (`--ui-purple-strong`) does NOT address the green hover; they are two defects on one
element.

★ Ratios throughout are computed from `builtin-schemes.ts` and composited arithmetically for alpha
tints — **nothing here was measured in a browser**. Where an element carries no `bg-*` of its own,
`--surface` was assumed, which is the optimistic case; a card puts it on `--surface-muted`, ~0.1 lower.
★ Not swept: `border-`, `fill-`, `stroke-`, `divide-`, `placeholder-`, `caret-`, `decoration-` — and,
until the audit caught one, ARBITRARY VARIANTS such as `[&_a]:text-*`, whose companion must itself be
variant-qualified. Enumerate the variant forms any future sweep handles.
`border-ui-dark-blue` in dark mode is the same token on the same surfaces — likely near-invisible,
1.4.11 rather than 1.4.3 — and deserves its own pass.

★ **The fix is not "swap to `text-foreground`".** That was tried in 0.211.0 and reverted: the repo's
idiom for this heading colour is **`text-ui-dark-blue dark:text-ui-light-grey`** (`--ui-light-grey`
measures 8.41 / 8.80 / 10.32:1 on the three dark surfaces), which fixes dark mode just as completely
and leaves light mode **byte-identical**. A neutral changes light mode where nothing was wrong and
desynchronises the file from its siblings — in `stakeholder-report-panel.tsx` it left the section
`<h3>` brand-blue while its own quadrant labels three lines below went grey. **Six** pre-existing uses
of the idiom live in that one file (lines 86, 100, 109, 120, 140, 185).

★★ **This defect propagates by copying, which is why a sweep beats a fix.** `combobox-shared.tsx`,
`global-search-box.tsx` and `entity-link-picker.tsx` carry three near-identical highlight
treatments; all three hit this bug, and the latter two were repaired **locally** while the shared
file every other consumer inherits from kept it, untested, until 0.211.0.
★ **The direction of copying is asserted in-file, not established, and the sources disagree.**
`combobox-shared.tsx:125-127` names itself the origin — which is the file claiming its own primacy,
not corroboration. `global-search-box.tsx:288` says the opposite: *"Same fix as entity-link-picker
(which copied this pattern from here)"*, naming itself as origin. `entity-link-picker.tsx:316-332`
names no source at all. Neither of the other two even imports `ComboboxOptions` from
`combobox-shared`, so nothing inherits the markup — these are three hand-copies, and an earlier
version of this entry stated the provenance as fact in the wrong direction. Mtimes are merely
*consistent* with combobox-shared being first (2026-05-29 < 06-22 < 07-26); treat that as weak.

★★★ **Writing this entry immediately found a fifth instance, TWO LINES BELOW the fix that prompted
it** (`combobox-shared.tsx`, the "+ Add new" row) — fixed and tested in the same commit, so it is
listed here as evidence rather than as open work. Its shape is the reason it survived: the
**unhighlighted** branch carried `dark:text-ui-light-grey` and the **highlighted** branch set
`dark:bg-ui-green/30` with no dark text, so the pair reads as handled at a glance while the state
that matters is the broken one. Highlighting that row in dark mode made it HARDER to read than
leaving it alone — the same inversion as the option rows above it. ★ When auditing a two-branch
ternary, check **both** arms for the dark companion; one arm having it is not evidence about the
other, and is actively misleading.

★ No gate can find these. Contrast figures above are computed from `builtin-schemes.ts`, not measured
in a browser — nobody has rendered them.

---

## 41. Eye verification owed on 0.211.0, on surfaces no gate reaches — open

Three checks nobody in the session could make. Distinct from §21, which is slice B (0.209.0).

- **Task editor**: create-RAID and new-linked-task sit on one row collapsed, and the linked-task
  button wraps below when the RAID mini expands.
- **AI Assistant**: attach and dictate are the same size with centred glyphs.
- **`stakeholder-report-panel` quadrant labels in dark mode** — after the 0.211.0 swap they and the
  chips beneath them are both light greys, separated only by `font-semibold text-xs`. Whether that
  reads as distinct is an eye question; the token maths says nothing about it.

★★ **The RACI matrix toolbar and the "Suggest RACI" modal are outside `A11Y_VIEWS` entirely** (`raci`
is a CHILD view of `stakeholders` and appears nowhere in the spec), so the 0.211.0 AI feature has had
**no automated a11y check of any kind** — its unit tests are the only coverage.

★★★ **The four calendar toolbars are a DIFFERENT failure and an earlier version of this entry filed
them under the wrong one.** All four host views — Open Points, Resources, RAID, Changes — ARE in
`A11Y_VIEWS`. They are never scanned because `CalendarSyncControls` returns `null` unless
`m365Configured && !isPopout && onToggleCalendar`, and the e2e seed configures no M365 at all (zero
`m365`/`msal`/`clientId` hits in `e2e/seed.ts` and `e2e/a11y.spec.ts`). ★ The distinction is not
pedantry: acting on the old wording, someone would add four views to `A11Y_VIEWS` and still scan
nothing. `digest-card` is the same shape — Dashboard *is* scanned, but `if (!digest) return null`
means it renders nothing at scan time. **A view being in the list does not mean a component inside it
is ever seen, and "not scanned" has at least two distinct causes that need different fixes.**

---

## 42. `CalendarSyncControls` push/pull buttons carry unqualified accessible names — open, pre-existing

The enable **checkbox** is qualified per entity (`"… – Tasks (due dates)"`); the Push and Pull
**buttons** beside it are the bare `calendarPush` / `calendarPull` ("Push to Outlook" / "Pull from
Outlook"). In the CLASSIC layout `TasksSection` and `WorkspaceSection` mount simultaneously
(`task-manager.tsx`), so with sync enabled on two entities a user can see two identically-named
"Push to Outlook" buttons — WCAG 2.4.6.

★ **Verified pre-existing**, not a 0.211.0 regression: the label is UNQUALIFIED on `origin/main` too.
(Not byte-identical — main has `t(lang,"calendarPush")` where the tree now has a busy-state ternary —
but the unqualified property, which is what this entry is about, is unchanged.)
That release *reduced* exposure by moving the Open Points pane's hand-rolled duplicate onto the shared
component and qualifying its checkbox — which is what made the asymmetry visible.

★★ **DO NOT FIX THIS IN ISOLATION — it is already Task 11 of the unexecuted S6 plan (§44).** S6 has a
sharper reason for the same change than this entry does: the Calendar sub-tab is about to render a
SECOND `CalendarSyncControls` (absences *and* meeting series), at which point the two Push buttons
collide within a single view rather than only across the classic dual-mount. Fixing it here first is
harmless but will be re-done there; fixing it there closes both. This entry was filed on 2026-07-30
without knowing the plan existed, because that plan is gitignored — the same invisibility §44 records.
★ Fix is the same shape the checkbox already uses:
``aria-label={`${t(lang,"calendarPush")} – ${t(lang, entityLabelKey)}`}``, applied to both buttons.
★ Do not expect the axe gate to confirm it either way: axe reports *missing* accessible names, never
*duplicated* ones (the §15/§21 blind spot), and the live seed renders one pane at a time regardless.

---

## 43. Two "Suggest RACI" reporting gaps — open, both incomplete rather than wrong

**(a) An Accountable HANDOVER inside one proposal is silently refused.** If the model demotes the
current A to R and promotes someone else on the same milestone, `groundRaciCells`
(`raci-suggest/raci-suggest.ts`) still holds the old id in `accountableHolder` when the second cell is
examined, so the promotion is skipped as `duplicate-accountable`. Conservative and safe — it can never
mint a second Accountable — but it discards a natural proposal and reports it as a conflict, which is
the wrong explanation for what happened. Fixing it means processing a milestone's cells as a set
rather than a stream, so the demotion is known before the promotion is judged.

**(b) The no-op count never reaches the modal.** `groundRaciCells` returns `noOp` and the *hook* uses
it (that is what makes the empty-result toast say "already in place" rather than the false "Claude
proposed no assignments"). The modal does not receive it, so in the MIXED case — some cells dropped as
no-ops, some skipped — the user is told "None of the proposed assignments can be applied", shown the
refusals, and told nothing about the rest. ★ That sentence is **true** in that case, which is why this
is a completeness gap and not the recurring falsehood class; the earlier wording ("Every proposed
assignment was refused") *was* false there and was fixed. Closing it is one prop plus a string.

---

## 44. The last two UX-roadmap slices — S6 designed and planned but UNEXECUTED, S7 undesigned

★★★ **Recorded here because it was invisible to every tracked document.** The 8-slice roadmap and
S6's own spec and plan all live under `docs/superpowers/`, which is **gitignored** — so on any other
machine the remaining work simply does not exist. Six slices shipped (C 0.204.0 · D 0.205.0 ·
F 0.206.0 · A 0.207.0 · E 0.208.0 · B 0.209.0); these two did not. Per this file's own rule, no link
into that tree — enough detail is reproduced below to resume without it.

**S6 — Outlook PUSH for calendar events.** Spec and a 17-task / 109-step plan exist and **not one
step has been executed**. Written against 0.208.0 targeting 0.209.0, then displaced when that release
shipped slice B instead.

★★ **UNEXECUTED — every file and function named in this task list was NOT built and does not exist in the codebase.**

The tasks: `graph-recurrence.ts` · `calendar-event-attendees.ts` · widen
`GraphEvent` · `eventToGraphEvent` · `exceptionPlan` · freeze/`afterPush` on the shared reconcile ·
`replayExceptions` · `"event"` as a calendar entity type · i18n EN+DE · settings row for meeting
series · entity-qualify the Push/Pull names (**= §42 — see there**) · wire the push in
`use-calendar-integrations` · thread the bag to the Resources pane · the attendee field · mount the
field + confirm + invitation-aware delete · **security review of the invitation path** · release chain.

**The data model is already shipped** (S3, 0.202.0): `CalendarEvent` carries `startTime`,
`durationMinutes`, `attendeeResourceIds`, `sendInvitations` and `outlookEventId` across all six write
paths. **No migration is owed.** Three blockers remain, all re-verified 2026-07-31:
`graph-recurrence.ts` / `use-event-calendar-push.ts` / `calendar-event-pull.ts` /
`use-event-calendar-pull.ts` are all **missing**; `CalendarEntityType` (`settings-types.ts:493`) is
still `"task" | "raid" | "change" | "absence"` with no `"event"`; and `GraphEvent`
(`outlook-calendar-write.ts:17-19`) pins `isAllDay: true` and `timeZone: "UTC"` as **literal types**,
so a timed event is currently inexpressible.

★★ **Invitations are in scope and are the ONLY surface in this app that emails third parties.**
`sendInvitations` defaults false; enabling it must show a confirm naming the resolved recipient count
and addresses, and list attendees with no email as **unreachable** rather than silently skipping
them — only then does the field persist as `true`. An outbound-email path is a different risk class
from anything else here; the plan schedules its own security review and that should be honoured.

★★ **CODENAME HAZARD, already triggered once.** S6's spec reserved **Bodard** (primary) and
**Samatar** (spare), both verified absent when written. **0.211.0 then consumed "Samatar"** — the
spare was taken by an unrelated release while S6 sat idle. Bodard is still free (0 uses in
`CHANGELOG.md` as of 2026-07-31). ★ A codename reserved in a gitignored plan is not reserved in any
sense the next release can see; re-check immediately before use, which is exactly what that plan's
own final task says to do.

**S7 — occurrence-level PULL + exception reconciliation.** Neither spec nor plan; the only entirely
un-designed slice. Two constraints survive from the archived R5 design and should not be re-derived:
it needs its own baseline key (`${projectId}:event:${seriesMasterId}:${originalDate}`) in a
**sibling** pure module, and `planCalendarPull`'s date-only `PullEntity`/`PulledEvent` must **NOT**
be widened — the four shipped entities must not inherit occurrence semantics they do not have.

---

## 45. ~~`brace-expansion` advisory in the eslint dev chain~~ — CLOSED in 0.211.1

**Was:** a high-severity `brace-expansion` advisory sat in the eslint dev chain.

**Resolution:** a MAJOR-SCOPED override pair in `package.json` — the form this entry's false premise
had ruled out:

```jsonc
"overrides": { "brace-expansion@1": "^1.1.17", "brace-expansion@5": "^5.0.8" }
```

`npm audit` → **found 0 vulnerabilities** (was 1 high). Resolved tree: `brace-expansion@1.1.18` under
`minimatch@3.1.5`, `5.0.9` under `minimatch@10.2.5`. **eslint still runs** — `npx eslint
--max-warnings=0 src/app` exit 0, `npm run build` exit 0 — which is the check that matters, because
the earlier unscoped `"brace-expansion": "^5.0.9"` attempt killed eslint with `TypeError: expand is not
a function`. Scoping by major is what makes it safe: `minimatch@3` keeps a v1 export shape.

★★ **No eslint major was needed.** This entry spent its length arguing the only remedy was eslint 10,
and it was wrong — see the correction block below for what it claimed versus what `npm audit` reports.
The lesson is not about npm: a do-not-relitigate record built on a **measurement** rather than a
property will eventually forbid the fix that works.



★★★ **THIS ENTRY'S CENTRAL TECHNICAL CLAIM WAS FALSE AND ITS NUMBERS ARE STALE. Corrected 2026-08-02
against a live `npm audit`; the original text is kept below the line so the executed negative results
survive.** It asserted that "no 1.x release escapes" the advisory and concluded the sole remedy was an
eslint major — then told the reader not to re-litigate. That combination is the dangerous one: a
confidently-worded do-not-relitigate record steering the next maintainer past a fix that exists.

| the entry claimed | live, verified 2026-08-02 |
|---|---|
| "`npm audit` reports **9 high**" | **1 high**, total 1 |
| "range is `<=5.0.7` **across all majors**" | **TWO** sources: `<1.1.17` (1.x) and `>=4.0.0 <5.0.8` (5.x) |
| "no 1.x release escapes it — not 1.1.17, not 1.1.18" | **both are published and both clear it** (`npm view brace-expansion versions`) |
| "`npm audit fix --force` offers exactly one remedy: eslint@10.8.0, a breaking major" | npm offers plain **`npm audit fix`** — no `--force`, no major |

★★ **The untried remedy is a MAJOR-SCOPED pin on the 1.x side.** Both executed attempts below targeted
the **5.x** side, which is why both failed — one broke `minimatch@3`, the other upgraded the branch
that was not the problem. The obvious third form was never attempted, because this entry's false
premise ruled it out:

```jsonc
"overrides": { "brace-expansion@1": "^1.1.17", "brace-expansion@5": "^5.0.8" }
```

★ **Re-run `npm audit` before acting on this entry.** The advisory ranges have already moved once
between it being written (2026-07-31) and being corrected (2026-08-02) — a 1.x backport landed. Treat
every number here as a measurement with a date, not a property.

- ★★ **The blocking gate is unaffected and green.** `.gitlab-ci.yml:99` is `npm audit --omit=dev
  --audit-level=high` — dev deps excluded. `dependency-audit` passed in all three pipelines on
  2026-07-31. Nothing is red.
- ★★ eslint 10 is a major landing against a **`--max-warnings=0`** gate, so any rule added, renamed or
  changed-by-default becomes an instant fatal build. There is also a hook blocking `eslint.config.mjs`
  edits, which a major would likely require. That is a slice with its own verification, not an install.

★★★ **The npm-`overrides` workaround was tried and it does not work. Both forms were EXECUTED, not
reasoned about — do not repeat them.**

| Attempt | Result |
|---|---|
| `"overrides": { "brace-expansion": "^5.0.9" }` | **eslint dies**: `TypeError: expand is not a function` at `minimatch.js:271`, exit 2. v5 changed its export shape and `minimatch@3` calls the v1 convention |
| `"overrides": { "minimatch@^10": { "brace-expansion": "^5.0.9" } }` | eslint fine, `5.0.7 → 5.0.9` applied — and the audit is **still 9 high**. Zero benefit |

**Why neither can work.** The tree holds two majors: `brace-expansion@1.1.16` under **six**
`minimatch@3.1.5`, and `brace-expansion@5.0.7` under one `minimatch@10.2.5`. All nine advisories
chain through the **1.x** side. ~~The advisory range is `<=5.0.7` **across all majors**, so no 1.x
release escapes it — not 1.1.17, not 1.1.18 — and the only clean versions (5.0.8+) are exactly the
ones `minimatch@3` cannot load. So the sole fix is removing `minimatch@3` from the tree~~ ← **FALSE,
see the correction above: there are two advisory sources, and `brace-expansion@1.1.17`+ clears the 1.x
one.** `minimatch@3` is
held there by `eslint-plugin-import` / `eslint-plugin-jsx-a11y` / `eslint-plugin-react` via
`eslint-config-next`, and by `@eslint/eslintrc` + `@eslint/config-array` via **`eslint` itself** (not
`eslint-config-next` — the original text attributed all four to the config package). ~~npm's advice was
right; the clever alternative is not.~~ ← npm's advice has since changed to a non-breaking
`npm audit fix`.

★★★ ~~Plugin peers would NOT block it — `eslint-config-next@16.2.6` is `>=9.0.0`, and typescript-eslint
and `eslint-plugin-react-hooks` both list `^10.0.0`. The risk is entirely in rule drift, not install
resolution.~~ ← **FALSE in its conclusion, and this is the sentence that made the 2026-08-03 attempt
look safe — see §53.** The peer survey is accurate as far as it goes (install DID resolve cleanly, no
ERESOLVE), but it draws the boundary wrong twice. It surveyed `eslint-plugin-react-hooks` and never
**`eslint-plugin-react`**, whose own peer is `^3 || … || ^8 || ^9.7` — no published version mentions
v10. And it framed the risk space as *peers vs rule drift*, when the actual failure was a third
category it did not model: a transitive plugin calling `context.getFilename()`, which v10 removed.
Measured rule drift was **ZERO** — `eslint:recommended` is not layered into this repo at all.

---

## 46. A `<label>`-wrapped file input can never show a focus ring — pattern open

Found while grounding §15, and not in that entry. `color-scheme-editor.tsx` and
`branding-image-input.tsx` both put a `focus:ring-2` on a `<label>` that wrapped an `sr-only`
`<input type="file">` — via `INTERACTIVE` in the first and `FOCUS_RING` in the second (an earlier
revision here named `INTERACTIVE` for both; the atom differs, the defect does not).

★★ **The focus indicator did not merely go unstyled — it VANISHED, and it took two separate facts to
do it.** (1) A `<label>` is not a form control and carried no `tabindex`, so `focus:ring-2` compiles to
`&:focus` and can never match it. (2) The element that actually took focus was the `sr-only` input
inside — genuinely tabbable, because nothing gave it `tabIndex={-1}` — and `sr-only` clips it to a 1×1px
`inset(50%)` box, which clips the UA's own default focus ring along with it. So a keyboard user tabbing
across Settings → Appearance hit a tab stop where the focus indicator disappeared entirely. WCAG 2.4.7,
at Import and at Logo/Favicon.

★ Verified rather than assumed: `globals.css` contains **zero** occurrences of `focus`, `outline` or
`label`, so no global rule could have rescued it, and `FOCUS_RING` is exactly
`focus:outline-none focus:ring-2 focus:ring-ui-green`.

★★ Nothing catches it. axe has **no focus-visibility rule**, and the accessible NAME was fine — a
wrapping `<label>` supplies it — so the one property axe does check passed. Same blind-spot family as
§15's duplicate-name finding and §21's.

**Closed for the three sites 0.211.1 touched**, which now use `FilePickerButton` (a real `<button>`).
The entry stays open as a PATTERN: `focus:` on a non-focusable wrapper is a mistake anyone can repeat,
and `focus-within:` is the fix if a label shape is ever genuinely wanted.

★ A grep for the ring class proves nothing on its own — presence of `focus:ring-*` says nothing about
whether the element carrying it can receive focus. Check the element type, not the class.

---

## 47. `chat-panel` clicks a `display:none` file input — open, pre-existing

`chat-panel.tsx` gives its attachment input `className="hidden"` (Tailwind `display:none`) and opens it
via `fileInputRef.current?.click()`. That is exactly what §15 warns against — both theme pickers used
`sr-only` *precisely because* a `display:none` input cannot be clicked in every browser. So the entry
that documented the rule sat beside a live violation of it.

★ Scoped out of 0.211.1 deliberately: the attachment flow is multi-file with its own classification and
size caps (`chat-attachments.ts`), so it is a bigger read than swapping one class.
`step0-import-panel.tsx` is the same class of flow and was excluded for the same reason, though it uses
a plain visible input and is **not** affected by this particular bug.

**Fix when taken:** move it onto `FilePickerButton` — which would need a `multiple` prop, deliberately
NOT added speculatively in 0.211.1 — or, minimally, swap `hidden` for `sr-only` plus `tabIndex={-1}` and
`aria-hidden`.

---

## 48. ~~RAID editor destroys notes added while it is open~~ — CLOSED in 0.211.1

**Was:** the RAID editor destroyed notes added while it was open.
**Cited from:** `use-resource-planner.ts`, `use-resource-planner.test.tsx`, `use-resource-planner.undo.test.tsx` — this entry cannot be deleted.

**Resolution:** `use-resource-planner.ts` builds `withStamp` with `noteLog` taken from the STORED row
(`previous?.noteLog`), never from the payload — for an UPDATE only; a create keeps whatever the payload
carries. Reproduced RED first (`expected [ 'first' ] to deeply equal [ 'first', 'added while open' ]`),
then fixed.

★★★ **The obvious fix — copying the task approach and OMITTING `noteLog` from the payload — would have
been WORSE THAN THE BUG.** Tasks merge on save; RAID does a full row **REPLACE**
(`prev.map(r => r.id === id ? withStamp : r)`), so a payload without the field erases the whole log
instead of merely losing the newest note. The two registers diverge here; do not reason about them
together.

★★★ **THE FIX HAS TO LAND ON `withStamp`, NOT ONLY INSIDE `setRaid` — and that is a SECOND defect, not
a stylistic choice.** `RAID_UNDO_GROUPS` is `[]` and `NEVER_CAPTURE` is only `{id, localModifiedAt}`,
so `changedFieldGroups` emits **one capture per changed key** and a stale `noteLog` on `withStamp`
becomes undoable/redoable state even when the saved row is correct. Pinned by its own test in
`use-resource-planner.undo.test.tsx`.

★★★ **TWO TEST TRAPS, BOTH HIT DURING THIS FIX — the second is the instructive one.**
1. The save-path fixture must add the note **between** the snapshot and the save. A fixture that does
   not passes whichever way the handler behaves. (Named in advance by this entry; avoided.)
2. **`changedFieldGroups` emits one call per changed key, so an assertion on `calls[0]` is vacuous** —
   `calls[0]` is `title`, and the captured `noteLog` is a LATER call. The undo test was written that
   way first, passed against deliberately broken code, and was only caught by mutating. It now asserts
   over `mock.calls.flatMap(...)`. Mutation-verified: reverting the `withStamp` half yields
   `expected [ 'title', 'noteLog' ] to deeply equal [ 'title' ]`.

★★ **A belt-and-braces second merge inside `setRaid` was written and then REMOVED.** Re-reading
`r.noteLog` from `prev` is strictly more authoritative than the `raid` closure, but no reachable case
exists (a save never changes `noteLog`, and the notes window cannot commit mid-tick), no test pinned
that line alone — both §48 tests pass with it reverted — and `use-resource-planner.ts` sits at the
file-size ratchet with §2 already tracking a split. An untested line on a file with no headroom, for a
case nobody can reach, is not defense in depth. If a reachable case ever appears, add it back **with a
test that fails without it.**

**Residual (still open):**
★ Still open, cosmetic: `raid-edit-modal.tsx:460`'s `draft.noteLog?.length ?? 0` reads the same stale
snapshot, so the Notes button can under-report while the window is open. The log itself is safe.

★ Sweep the same shape at the other snapshot-then-replace editors before assuming RAID is the only
one; the pattern is a full-row `useState` draft plus a write-through side channel, not anything
specific to notes.

---

## 49. ~~Every AI edit to a RAID item erased its whole note log~~ — CLOSED in 0.211.1

**Cited from:** `use-chat-dispatcher.test.tsx` — this entry cannot be deleted.

**Was:** `use-chat-dispatcher.ts` `updateRaid` round-tripped the merged item through `sanitizeRaidItem`
and wrote the result back. That sanitizer builds its result from an EXPLICIT field list and `noteLog`
is not in it, so a patch as small as *"push R#3's target date to June"* **deleted every note on the
item**. AI tool writes capture no undo, so it was unrecoverable. Also reachable from Insights → Apply
recommendation (`update_raid_item` is in `ALLOWED_REC_TOOLS`). Found by an adversarial reviewer
attacking §48's fix; `noteLog` appeared **zero** times in `use-chat-dispatcher.test.tsx`.

**Resolution:** `updateRaid` re-applies the STORED `noteLog` after sanitizing. Same "stored row wins"
rule as §48, and safe because `noteLog` is write-through and appears in no AI tool schema, so a patch
can never legitimately carry one. Reproduced RED first (`expected undefined to deeply equal
[ 'keep' ]`).

★★★ **THE OBVIOUS FIX IS FORBIDDEN, AND THE REVIEWER'S PRIMARY SUGGESTION WAS IT.** "Carry `noteLog`
through `sanitizeRaidItem` via `sanitizeNoteLog`" would close it for every present and future caller —
and it CANNOT BE DONE. `sanitizeNoteLog` calls `sanitizeRichHtml`, which calls DOMPurify, which binds
`window` at module-eval; the entity sanitizers run under **bare node** in
`scripts/generate-sample-workspace.ts`, where the call throws and `jsonToWorkspace`'s catch-all
swallows it into an EMPTY workspace that then "successfully" writes near-empty sample files. This is
the same DOM-free constraint that already forces `templates.ts` `sanitizeSeedTask` to skip the
allow-list (§36(a)). **Do not "complete the sweep" by importing it there.**

★ Consequence to accept: the guarantee is per-CALLER, not central. The other **three**
`sanitizeRaidItem` callers are all CREATES on freshly built objects, so nothing is lost today —
`task-manager.tsx:1308`, `use-chat-dispatcher.ts` `createRaid`, and `ai-project-proposal.ts:287`. But a
FUTURE caller that sanitizes an existing RAID row will re-open this, and no gate will catch it. A new
call site must ask whether it holds a stored row.

★★ **`grep 'sanitizeRaidItem('` DOES NOT FIND ALL OF THEM — and the one it misses is the one you most
need.** `ai-project-proposal.ts:287` passes the function **by reference** (`buildList(s.raid,
sanitizeRaidItem)`), so there is no `(` after the name to match. The first version of this entry said
"the other two callers" for exactly that reason, and both reviewers caught it. Sweep on the BARE name.
The same trap applies to any sanitizer used as a `.map`/`buildList` callback.

**Residual (still open):**
★ KNOWN latent divergence, deliberately not fixed: `updateRaid` stores
`{ ...merged, noteLog: existing.noteLog }` but returns `toRaidSummary(merged)`. A no-op today
(`toRaidSummary` reads none of the re-applied fields), but it is the only sibling update path where
what the model is TOLD is not derived from what was PERSISTED, so a future field joining both lists
would hand the model a stale value. Hoisting one `saved` const fixes it and costs one line —
`use-chat-dispatcher.ts` is at **799** of a hard **800** ceiling with no baseline entry, and spending
the last line to pre-empt a hypothetical is the same trade this batch already refused for §48's
belt-and-braces merge. Take the line when the file is split, not before.

★ The same shape has NOT been checked on the other sanitizers. `sanitizeRaidItem` is the one with a
write-through field; whether any other entity sanitizer drops a field its callers hold is open.

---

## 50. Undo of a BULK edit reverts write-through fields — CLOSED 2026-08-18

`undo-stack.ts:89` restores an edit-image with `out[findIndex(...)] = item` — a **whole-row replace**
using the before-image captured at bulk-apply time. `use-resource-planner.ts` `captureRaidBulkUndo`
snapshots whole rows (`edited = raid.filter(...)`).

Sequence: select 3 RAID rows → bulk-set severity → open the notes window on one → add a note → Ctrl+Z.
**The note is gone.**

★★ **REDO DOES BRING IT BACK — an earlier revision of this entry said it did not, and that was wrong.**
The forward image is NOT a snapshot taken at capture time; it is built from the LIVE array at UNDO time
(`use-undo-stack.ts:199` `buildForwardImages(before, prev, remap)`, and `undo-stack.ts:185` resolves each
edit image via `afterArray.find(...)`). So the note is in the redo image and comes back. The loss is
recoverable — but only by an immediate redo, which also re-applies the bulk edit the user was trying to
undo. ★ This matters because of the test instructions below: asserting that redo also loses the note
would FAIL against correct code and send you debugging a path that is not broken.

★★ This is §48's defect class — a stale whole-row snapshot clobbering write-through content —
relocated into the undo engine. The per-FIELD undo path is immune (`captureFieldEdit` merges
`{...r, ...patch}` over the live row); only whole-row `capture()` is affected.

★★ **Deliberately NOT fixed in 0.211.1, and the reason is scope, not doubt.** It is the SHARED undo
engine: `applyUndoRestoreWithRemap` serves every entity, and `Task` carries `noteLog` too, so the same
sequence very likely loses task notes — **unverified, check before assuming**. Fixing it means deciding
whether write-through fields are preserved engine-wide (needs a per-entity list of which fields those
are) or whether RAID/task bulk edits capture field-wise instead. Either is a design slice, and patching
shared undo machinery in the fourth review round of an unrelated batch is how a regression ships.

★★ **THE CHANGES REGISTER NOW INHERITS THIS, as of 0.245.0.** `ChangeItem` gained `noteLog` in that
slice, and `useChangeLog`'s `captureBulkUndo` snapshots whole rows into the same shared `capture()`:

```bash
# whole-row snapshot, same shape as captureRaidBulkUndo
grep -n "const captureBulkUndo" -A 4 src/app/use-change-log.ts
# the field it now carries
grep -cF 'noteLog?: NoteLogEntry[]' src/app/types.ts   # 3 entities: Task, RaidItem, ChangeItem
```

So the RAID sequence reproduces one register over: select 3 changes → bulk-set impact → open the notes
window on one → add a note → Ctrl+Z. Not a new defect and not caused by that slice — the engine was
already like this; the slice added a third entity to its blast radius. ★ It also means the
per-entity field list a fix would need is now three entries, not two, and it grows silently every time
a write-through field is added to an entity — which is an argument for the field-wise capture option.

### Resolution

Closed by **two complementary mechanisms**, not one, because they cover different shapes of writer:

- **The engine backstop.** `applyPreserved(image, live, preserve)` in `src/app/undo/undo-stack.ts`
  merges an edit-image over the LIVE row, letting the live row win on a named `preserve` list, and
  never invents a key neither row carries. `applyUndoRestore` / `applyUndoRestoreWithRemap` /
  `applyUndoForward` all take a REQUIRED `preserve: readonly string[]` — required so a future call
  site that forgets it is a typecheck error, not a silent regression. `use-undo-stack.ts` declares
  `WRITE_THROUGH_FIELDS = ["noteLog", "outlookEventId"]` and passes it at all four runner sites. This
  is the backstop for paths that genuinely still replace a whole row (e.g. dependency stripping on
  delete, which captures dependents as whole-row edit-images) — it preserves exactly the two named
  fields and nothing else.
- **Field-patch capture.** `buildBulkFieldEdits` in `src/app/undo/field-groups.ts` diffs
  `{before, after}` row pairs into field PATCHES (excluding `id`, `localModifiedAt` and the
  write-through keys), and `captureFieldRows` turns N such patches into one undo entry. **Five PANEL
  bulk-edit sites were converted** — RAID (`use-resource-planner.ts`), changes (`use-change-log.ts`),
  stakeholders (`use-stakeholders.ts`), milestones (`milestones-panel.tsx`), tasks
  (`use-bulk-operations.ts`) — plus ONE consumer the original plan never named,
  `use-raci-suggest.tsx`, which builds the same field patches and hands them to the stakeholders
  capture prop. ★ An earlier revision of this line said TWO and named `raci-panel.tsx` beside it;
  that panel declares the prop, destructures it and forwards it into the hook's `deps`, and calls
  neither `buildBulkFieldEdits` nor any capture. One builder, one pass-through:

  ```bash
  grep -n "onCaptureBulk\|buildBulkFieldEdits\|captureFieldRows" src/app/raci-panel.tsx src/app/use-raci-suggest.tsx
  ```

  ★★ **THOSE ARE NOT ALL THE `bulk.edit` EMITTERS** — an earlier revision of this line said "all five
  `bulk.edit` sites … were converted", which is false.
  `use-alloc-plan.tsx` and `use-resource-directory.ts` emit the same kind through whole-row
  `capture()` and were deliberately left there, as is the BUCKET half of the tasks composite
  (`commitBuckets` → `capturePart` in `use-budget-buckets.ts`; that composite's TASKS half is a
  field part). Those remain whole-row and are covered by the Part A backstop instead — the two named
  fields and nothing else. Re-derive the set rather than trusting this list:

  ```bash
  # ★★ SOME HITS ARE COMMENTS quoting the literal, not emit sites — this doc's own round added one
  # (`use-budget-buckets.ts`). The trailing filter drops a `//` line; a `*` continuation inside a
  # block comment would still slip through, so READ each line rather than counting them.
  grep -rn 'kind: "bulk\.edit"' src/app --include=*.ts --include=*.tsx | grep -v '\.test\.' \
    | grep -vE ':[0-9]+: *//'
  ```

  ★★★ **A field patch preserves concurrent edits to OTHER FIELDS — NOT "EVERY concurrent edit on
  that row", which is what this entry claimed.** `buildBulkFieldEdits` captures whole FIELD VALUES
  (`pick(before, changed)`) and the restore merges them wholesale — `const merged = { ...row,
  ...pick(edit) }` in `captureFieldPart` (`src/app/undo/use-undo-stack.ts`), the BULK runner, NOT the
  `{ ...r, ...patch }` of `captureFieldEdit`'s single-row modal-save path in the same file — so a
  concurrent write to a DIFFERENT KEY of the same object-valued field is still reverted. Reachable
  today on `Stakeholder.raci`. Filed as §178.
  Within that limit it is still strictly stronger than the backstop, wherever it applies.

**The task half is now verified, not suspected.** This entry said the same sequence "very likely" lost
task notes too, but marked that half UNVERIFIED. It was measured true: `use-bulk-operations.ts`
captured whole `beforeRows`, exactly like RAID and changes, before this slice converted it to a field
part.

**`outlookEventId` was a second member of the class this entry never named.** Everything above was
written about note logs. But the background calendar push stamps `outlookEventId` on live rows, so the
same shape had a second, worse trigger: bulk-edit → auto-sync fires → Ctrl+Z restores
`outlookEventId: undefined` → the next push creates a DUPLICATE event in the user's real Outlook
calendar. Worse than the note case two ways — no user race is needed (a background timer supplies the
concurrent write on its own schedule), and it reaches entities that carry no note log at all.

Residual scope — the whole-row paths this slice deliberately left untouched, and the duplicated
write-through field list — is recorded separately as §177, not folded in here.

---

## 51. A SECOND load-sensitive test — `use-tasks-dedup` "on confirm" — open, narrower: the recorded symptom cannot recur, the mechanism is unreproduced

`use-tasks-dedup.test.tsx` → "on confirm, removes the duplicate and records ONE undo entry" failed on
the post-merge main pipeline **#5418** (2026-08-02, MR !338), in the same `unit-tests` job where §39
failed for the 8th time. It left main red.

**What is established:**
- The same tree passed on the MR pipeline **#5417** minutes earlier. #5418 is that tree plus a merge
  commit, so this is environment-sensitive, not a code regression.
- The failure is `TestingLibraryElementError: Unable to find … role "button" and name /merge selected/i`
  — the preview modal was not in the DOM.
- In the failure dump the trigger button carried **`disabled=""`**, i.e. the hook was still in its busy
  phase: the mocked `runDedupProposal` had not resolved.
- Duration **38 ms** — this is NOT a timeout. `getByRole` fails immediately.

**Two corrections to this entry's own recorded text — both were wrong, and both were load-bearing.**
The line before the failure was
`await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy())`.

★★★ **This entry cited the wrong string.** It said `/dup/i` is a substring of the trigger's own
**accessible name**, "**Dedup**licate & unify tasks". But `getByText` matches an element's direct child
TEXT NODES, never its `aria-label`. The accessible name is irrelevant to the old gate. Verified: the
trigger's accessible name comes from `aria-label={triggerLabel}`, while its rendered text child is a
*different* string. ★ `triggerLabel` is `taskDedupTitle` only when `triggerQualifier` is absent — with
one it is `` `${taskDedupTitle} – ${triggerQualifier}` ``. Immaterial here (the failing test passes no
qualifier), but the equality is not unconditional.

★★★ **This entry's hedge was FALSE.** It said "The trigger renders no text child, so it is not proven
that it is what matched". It does render one: `use-tasks-dedup.tsx` renders
`{phase === "thinking" ? t(lang, "taskDedupThinking") : t(lang, "taskDedup")}` as the button's text child
(the `SparklesIcon` beside it is `aria-hidden`). And **both** strings match `/dup/i` —
`taskDedup: "Deduplicate & unify"` and `taskDedupThinking: "Claude is looking for duplicate tasks…"`
(`i18n.ts`).

**The contradiction resolves, and the phase is deducible rather than guessed.** `disabled` is
`phase === "thinking" || phase === "applying"`; the modal renders for `phase === "preview" ||
phase === "applying"`. Modal absent **and** trigger disabled ⇒ the phase was **`"thinking"`** ⇒ the
trigger's text child read "Claude is looking for duplicate tasks…" ⇒ exactly one node matched ⇒
`getByText` **succeeded**. Nothing opened and closed; the gate simply matched the trigger.
★ The single-match step is not a *unique* deduction — the `idle` phase also yields exactly one match
("Deduplicate & unify"). It does not need to be: the decisive point below is that the modal being OPEN
yields several, which is the case the gate had to survive and could not.

★★ **Decisive.** With the modal OPEN, `/dup/i` would have matched **four** nodes in this test's own
fixture — the trigger's text, the modal's `<h2>` (`taskDedupTitle`), the intro `<p>`
(`taskDedupIntro`, "…possible **dup**licates…") and that test's rationale `<span>` (the string `"dup"`) —
and `getByText` **throws** on multiple matches. So the old gate could *only ever* resolve while the modal
was **closed**. It was structurally incapable of waiting for what the next line needed. ★ Three of those
four are structural; the fourth is this test's rationale fixture, so the count is 3 for a sibling test
with a rationale that does not contain "dup".

**A mechanism candidate now exists — derived from source, NOT reproduced.** ★ Deliberately unquantified:
an earlier revision said "confidence moderate (~70%)", a specific number with no stated method, sitting
beside §39's honest qualitative hedge ("precondition proved, causation unreproduced") for a claim that
at least HAS a local measurement. The unsourced percentage read as the more rigorous of the two while
resting on strictly weaker evidence. Neither is reproduced; say so, and do not invent a number.
With the wait a no-op, correctness rested on macrotask ordering: RTL's `asyncWrapper` disables the act
environment during `findBy*` and opens exactly one `setTimeout(0)` window, while React 19 commits the
`setPhase("preview")` DefaultLane update on a Scheduler macrotask. Two independently-scheduled
macrotasks, order unspecified and load-sensitive. ★ **This is inference, not observation.** Do not
promote it to "established" without a reproduction.

★★ **DONE post-0.212.0 — and the matcher fix is NOT a root cause; this entry must not record it as
one.** The test now awaits `findByRole("button", { name: /merge selected/i })`, so the wait and the
assertion are one condition. That it *also* removes the ordering dependence — `findByRole` retries
against the 5000 ms `asyncUtilTimeout` — is a **side effect of retrying, not its rationale**. The
rationale was only ever "wait on the thing you are about to assert".

★★★ **A FUTURE FAILURE WILL WEAR §39'S CLOTHES.** The error text is unchanged
(`Unable to find … role "button" and name /merge selected/i`), but the duration flips from **38 ms** to
**~5000 ms** — budget fully consumed, because `findByRole` retries where `getByRole` did not. §51's "not
even timeout-shaped" defence therefore no longer applies to future failures, and the two entries can no
longer be told apart by their message. **Match on duration, not message.**

★★ **DO NOT "FIX" THIS BY RAISING A TIMEOUT.** §39 is the cautionary case: 5 s → 15 s moved the failure
point and bought nothing, and three subsequent failures then consumed the 15 s budget to within 24 ms.

★ **The same falsehood was in the source and is now fixed.** The comment above the fixed line in
`use-tasks-dedup.test.tsx` said "`/dup/i` is a substring of the trigger's own **name**". It is the
trigger's **text**; `getByText` never consults an accessible name. An earlier revision of this bullet
deferred the correction on the grounds that "only `docs/open-followups.md` was in scope" — but the slice
edits that very file to add the §51 failure capture, so the deferral did not hold (AGENTS.md: correct
what you disprove, in the same commit). Corrected in the same commit that recorded it.

★ Two load-sensitive failures in one job, on a runner that also took 15.1 s to not-deliver a toast,
suggests a shared environmental trigger rather than two unrelated test bugs. Worth investigating
together — but §39's signature (budget fully consumed) and this one's (immediate miss) are different, so
do not assume one diagnosis covers both.

★★ **CONFIRMED FLAKY BY RETRY, not by argument.** Job 20222 — a plain retry of the failed `unit-tests`
job on the SAME commit `351eb05f`, no code change — passed in 389 s, and #5418 went green. Both this
test and §39's passed on the retry. That is the decisive evidence that #5418's failures were
environmental: the identical tree produced both outcomes.

★ Operational answer meanwhile, as with §39: **retry the job.** It is a known-flaky failure, not a
signal to edit the test — and editing on a red-CI reflex is how §39 acquired a 15 s timeout that bought
nothing.

**State: still open, but for a narrower reason than when this entry was written.** The recorded symptom
— a `getByText(/dup/i)` gate that resolves against the trigger and lets an un-waited `getByRole` miss
immediately — **cannot recur**, because that gate is gone. What stays open is the mechanism: a plausible
macrotask-ordering candidate that has never been reproduced. Close this only on a reproduction or on a
decision that it is unfalsifiable and not worth chasing.

★★ **BOUNDED AMPLIFICATION RAN AND DID NOT REPRODUCE — the first negative evidence either flake has.**
Six full-suite configurations on 2026-08-04, against a branch already carrying §39's fix: three
`--no-isolate` runs (hypothesis: cross-file async leakage) and three `--sequence.shuffle` runs at seeds
1 / 2 / 3 (hypothesis: file-neighbour ordering). **`use-tasks-dedup.test.tsx` failed in none of the six,
and neither did `timelog-panel.test.tsx`.** Record what that is and is not worth:

- It is **not** a clean bill of health. `--no-isolate` produced 22–82 unrelated failures per run, so
  those three runs say little about anything — most of this suite is not written to share a module
  registry. The shuffle runs are the informative ones, and they were quieter (4 / 4 / 5 failures).
- ★ Seeds 2 and 3 each also logged **16 unhandled errors, all of them
  `[vitest-pool]: Failed to start forks worker … Timeout waiting for worker to respond`** — this
  machine saturating after six back-to-back full suites, with 16 files never running (768 of 784).
  Those are **not** the §72 signature and must not be counted as one. ★★ But they make the negative
  slightly *stronger*, not weaker: under load heavy enough to time out worker startup, neither flaky
  test failed.
- ★★ **No `ReferenceError: window is not defined` appeared in any of the six runs** — consistent with
  §72 being fixed, though six runs of an intermittent fault prove nothing on their own.
- ★ Reproduce: `npx vitest run --sequence.shuffle --sequence.seed=<n> --reporter=dot`. A seed that
  reproduces either flake is the single most valuable artifact this hunt could produce; seeds 1–3 are
  now known **not** to.

---

## 52. `useColumnResize`'s v1→v2 migration pins defaults for existing users — open, deliberate

0.212.0 changed the hook to persist `{v:2, widths}` holding ONLY columns the user actually dragged,
so that a later change to a `*_COL_WIDTHS` default reaches people who had dragged some unrelated
column. A v1 payload (a bare object) cannot distinguish dragged from default, so `readSized` treats
every key in it as user-set — the conservative direction, preserving widths rather than discarding
them.

★★ **The premise that makes that conservative choice look cheap is false, and the commit message
implies otherwise.** The pre-v2 persist effect had **no first-run guard**: it fired ~250ms after
MOUNT and wrote the whole MERGED map. So a v1 blob is not a record of the user's drags — it is a
full defaults snapshot taken the first time that table was ever displayed for a quarter second.
Found by a reviewer of the 0.212.0 batch, not by the implementation.

Consequences, for the 37 tables that are NOT Open Points (37 `useColumnResize` INVOCATIONS across
17 files — count call sites, not files: `raid-report-panel` holds 7 and `resources-report` 5, so a
file count understates the blast radius by half; re-verified 2026-08-05):

```bash
grep -rPn "(?<!typeof )\buseColumnResize\s*[<(]" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -vP ":\s*(import|//|\*)" | grep -v "export function" | wc -l   # 38, minus use-column-manager.ts (Open Points) = 37
```

★ The `typeof` exclusion is REQUIRED: `ReturnType<typeof useColumnResize<X>>` type aliases match a
bare `useColumnResize<` grep, so a naive count reads 54 and "disproves" the 37.

| | |
|---|---|
| stated benefit | "a `DEFAULT_COL_WIDTHS` change now reaches existing users" |
| actual reach | fresh installs · anyone who clicks reset-columns · a table whose id was bumped |
| existing users | `sizedWidths` comes back fully populated, so nothing changed for them |

★ Open Points is unaffected **because its table id was bumped** to `open-points-v2` in the same
release, which discards the v1 blob outright. That bump is what makes the flex-`taskName` column and
the retuned `status`/`depRelations`/`actions` widths actually land. Do not read "the migration is
conservative" as "the feature works for everyone" — those two facts are about different tables.

★ The cheap fix, if this is ever worth doing: drop v1 keys whose value already equals
`defaults[key]`. The only thing lost is a user who dragged a column to *exactly* its default width,
who then keeps seeing that width anyway and diverges only once the default changes — arguably the
desired outcome. Not done in 0.212.0 because it is a behaviour change for the 37 other tables that were not in
that slice's scope.

★★★ **BUT THAT DEFERRAL IS NOT FREE, AND IT IS ALREADY SPENT.** The migration is SELF-SEALING: on the
first mount after upgrading, `readSized` reads the v1 bare object, promotes every key to `sizedWidths`,
and the debounced effect writes it straight back as `{v:2, widths:{…every key…}}`. From the second
launch onward that former defaults-snapshot is INDISTINGUISHABLE from genuine drags. The cheap fix
above can only ever run against a **v1** payload — so once a user has launched 0.212.0 even once,
there is nothing left for it to identify. This was not "deferred"; for every user who runs this
release it is **foreclosed**. Raised by a cold reviewer before merge and recorded rather than acted
on: recovering the benefit later needs a different mechanism entirely (e.g. shipping the defaults
alongside the payload so a future version can tell chosen from inherited), not this predicate.

★ Related and CLOSED in the same release: an unrecognised version (`{v:3,…}`, `{v:"2",…}`) used to
fall through to the v1 branch and get spread verbatim, putting a numeric `v` and an object-valued
`widths` into a `Record<TId, number>` and on into `colWidths`. It is now `if (v2.v !== undefined)
return {}` — an unknown version reads as "no user widths". Pinned by an `it.each` test; verified
failing without the guard.

---

## 53. ESLint 10 is blocked upstream by `eslint-plugin-react` — open, not actionable today

Attempted 2026-08-03 as the slice §45 called for. **Reverted; nothing shipped.** `eslint@10.8.0`
installs cleanly and then crashes before linting a single file.

★★★ **Everything below is a MEASUREMENT dated 2026-08-03, not a property.** This blocker evaporates the
day `eslint-plugin-react` publishes v10 support, which is one upstream release away. **Re-measure before
acting** — `npm view eslint-plugin-react peerDependencies` — and do not read this entry as "eslint 10 is
impossible here". §45 above is the cautionary case: it earned its own correction by recording a
measurement in the grammar of a property.

★★★ **THIS BLOCKER WAS ALREADY DOCUMENTED, AND NOBODY LOOKED.** The `eslint` row in
[`tech-debt-register.md`](tech-debt-register.md) has recorded it all along, on `main`, before the
attempt — naming the same package, the same removed API and the same consequence:

> `eslint-config-next`'s bundled `eslint-plugin-react` calls `context.getFilename` (removed in
> eslint 10's flat-config API) → lint crashes.

Neither the plan nor §45 consulted it, so a full install-and-crash cycle was spent re-deriving a
finding the repo already held. ★★ The near-miss is worse than the waste: §45 asserted "the risk is
entirely in rule drift, not install resolution" while that row sat one file away saying the lint
*crashes* — and §45's confident do-not-relitigate framing is what made the contradiction easy to
walk past. **Two masters is exactly the failure the register/follow-ups split was meant to prevent**
(see this file's own preamble on not copying `tech-debt-register.md` rows here). The rule that
follows: before opening a dependency slice, grep the register for the package name. The re-derivation
was not wasted only because it upgraded a plausible claim into measured evidence — the crash trace,
the peer ranges and the version matrix below are new; the *conclusion* was not.

### What is established

**The crash is universal, not React-specific.** It fired on `src/app/abort-error.test.ts` — a plain
`.ts` file with no JSX:

```
TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
  at resolveBasedir (eslint-plugin-react/lib/util/version.js:31)
  at detectReactVersion → getReactVersionFromContext → testReactVersion
  → usedPropTypesInstructions → Components.componentRule
  at createRuleListeners (eslint/lib/linter/linter.js:497)
```

`context.getFilename()` was removed in ESLint 10. The call at `version.js:31` is **unguarded**
(`typeof contextOrFilename === 'string' ? contextOrFilename : contextOrFilename.getFilename()`), sits in
React version detection, and is reached from `Components.componentRule` — which backs
`react/display-name` and most other react rules, all enabled by `eslint-config-next/core-web-vitals`.
★★ It is a rule-LOAD failure, so it aborts before any file is linted: `--max-warnings=0` exits **2** and
`-f json -o <file>` writes **no file at all**. That is zero output, not zero findings — do not mistake
an empty report for a clean run.

**No published version combination fixes it.**

| package | measured 2026-08-03 |
|---|---|
| `eslint-plugin-react` | **7.37.5 is the latest** — the last six releases are all 7.37.x. Peer: `^3 \|\| ^4 \|\| ^5 \|\| ^6 \|\| ^7 \|\| ^8 \|\| ^9.7`. **No published version's peer range mentions v10.** |
| `eslint-config-next` | 16.2.6 (ours), 16.2.12 (latest stable), and the 16.3.0 pre-release line (preview.10 and canary.106 both checked) — **all pin `eslint-plugin-react: ^7.37.0`**, so bumping it changes nothing |

★★★ **A satisfied peer range is not a compatibility test.** `eslint-config-next` declares
`peerDependencies: {eslint: ">=9.0.0"}` while nesting a dependency capped at `^9.7`. The parent's range
is broader than its own transitive dependency actually supports, so npm resolves silently, a dry run
reports no conflict, and the install exits 0. **Only running the tool proves anything.** This is
precisely how §45 arrived at "the risk is entirely in rule drift".

**Rule drift was ZERO — the risk model was aimed at the wrong layer.** `--print-config` across seven
representative files (`.tsx`, `.ts`, a test, `.mjs`, `next.config.ts`, `eslint.config.mjs`, `e2e/`) is
uniform:

- **`eslint:recommended` is NOT layered into this repo.** Zero canaries — `no-cond-assign`, `no-empty`,
  `no-fallthrough`, `use-isnan`, `valid-typeof`, `no-debugger` are all "not configured". The config is
  only `...nextVitals, ...nextTs, globalIgnores([...])`: no custom plugins, no custom rules.
- Of **112** configured rules only **26** are core, and just **four** are ON: `no-var`, `prefer-const`,
  `prefer-rest-params`, `prefer-spread`.
- Core `no-unused-vars` and `no-undef` are **OFF everywhere** (turned off by typescript-eslint's
  `eslint-recommended` layer), so v10's new JSX reference tracking cannot report here at all.
  `@typescript-eslint/no-unused-vars` at severity 1 is what actually runs; `react/jsx-uses-vars` at 2 is
  what currently marks JSX identifiers as used.
- v10's three newly-recommended rules therefore **cannot activate**. Measured under v9:
  `no-unassigned-vars` **0**, `preserve-caught-error` **0**, `no-useless-assignment` **6** — and only
  those six were ever real. ★ They were cleaned up anyway (`ea3cd093`), which stands on its own merits,
  but that commit's original message justified them as "gate failures on upgrade". That was false and
  the message was amended.

**Two plugins were cleared — do not re-investigate them.** `eslint-plugin-react-hooks@7.1.1` is properly
feature-detected (`typeof context.getSourceCode === 'function' ? … : context.sourceCode`, likewise
`getScope`) and degrades correctly on v10. `eslint-plugin-jsx-a11y`, `eslint-plugin-import`,
`@next/eslint-plugin-next` and `@typescript-eslint/eslint-plugin` have **zero** files touching removed
context APIs.

### What is NOT established

- ★★ **Whether anything else breaks behind the crash.** Rule loading aborts at the first failure, so v10
  has never linted this tree — not one file. `eslint-plugin-react` is the first blocker, **not provably
  the only one**. When upstream ships a fix, expect to re-run the whole spike and find a new
  first-failure, rather than to confirm a clean pass.
- **When upstream lands it.** No release is announced; nothing here predicts a date.
- ★ Three further unguarded call sites exist in `eslint-plugin-react` — `lib/util/eslint.js:18`,
  `rules/forward-ref-uses-ref.js:60`, `rules/jsx-filename-extension.js:64` — but those rules are not
  enabled here, so their reachability is unproven either way.

### Two method notes worth keeping

★★ **A name-based grep undercounts this defect class.** Sweeping for `context.<method>(` **missed the
actual failing line**, because the parameter there is named `contextOrFilename`. The count it produced
was a floor, not a total — grep the bare `.getFilename()` shape instead.

★★ **`"eslint": "^9"` is an unpinned caret, so a reinstall is NOT the inverse of a version experiment.**
`npm install -D eslint@^9` resolves *forward*: it landed **9.39.5**, a patch published after the
lockfile was written, and rewrote the spec to `"^9.39.5"` plus ~740 lines of lockfile churn.
**`npm ci` from the committed lockfile is the reliable inverse** — `git checkout -- package.json
package-lock.json && npm ci` restored 9.39.4 exactly. This applies to any dependency experiment in this
repo, not just eslint.

### State on 2026-08-03

Reverted to **eslint 9.39.4**. `npx eslint --max-warnings=0 src/app`, `npx eslint --max-warnings=0 .`
and `npx tsc --noEmit` all exit **0**; working tree clean. The branch that carried the attempt kept its
Node-24 and cleanup commits and dropped ESLint from its scope, so nothing downstream is waiting on this.

**To close:** re-measure `eslint-plugin-react`'s peer range. When a version supporting ESLint 10 is
published, re-run the spike from the top — install, `--print-config` to re-establish what is actually in
effect, then the unpiped gate — and treat the result as a fresh measurement.

---

## 54. Prod-only CSP blocks ProseMirror's base CSS — CLOSED 2026-08-09

**FIXED in 0.227.0 "Bolander". This entry is a MIX of dated layers, not a preserved original — read the
date attached to a paragraph, never its position.** The 2026-08-03 measurement blocks below are written
in the present tense and describe the BROKEN state. But the mechanism paragraph ("The injector is
`@tiptap/core` itself, measured 2026-08-09") and the blast-radius list were REWRITTEN on 2026-08-09 and
are the authoritative versions — they sit *above* the fix section, not in it. The fix and the real-browser
verification are under "Fix — option A chosen and shipped".
★★ An earlier revision of this banner called everything below it "the original investigation preserved
verbatim" and sent readers to the fix heading for "the corrected mechanism". Both false: this branch
rewrote four regions above that heading, and the corrected mechanism ("The injector is `@tiptap/core`
itself") sits well *above* it, not in it — so the banner discounted the very paragraph that replaces the
disproved Turbopack theory. A banner that mislocates a correction is worse than no banner.
★★ An earlier wording of THIS sentence said "87 lines before it" and attributed the disproved theory to
"three contributors". Both were wrong and in different ways. The line count was measured on the
pre-commit file and the same commit's own insertions moved it to 91 before it shipped — a distance in
lines self-invalidates, so cite the heading. And no repo record supports the contributor count: it was
imported from the unrelated `migrateTaskStatus` incident in AGENTS.md, which really did have three.
Borrowing a number from a similar-sounding incident is how a fabricated fact enters a register.

Every rich-text editor in a **production build** rendered without ProseMirror's base stylesheet, because
the prod CSP refused the `<style>` element Tiptap injects at runtime. Dev was unaffected, which is why
this went unseen.

★★★ **MEASURED 2026-08-03 on `main` (`13b518db`) in an isolated worktree — observed, not inferred.**
Same dated-measurement rule as §53: re-measure before acting, do not treat these values as properties.
Reproduction:

```bash
npm ci
npm run build
npx next start -p 3200
E2E_URL=http://localhost:3200/ npm run e2e:smoke     # → REAL_EXIT=1, ISSUES (1)
PORT=3200 npm run stop
```

### What is established

**The violation.** Prod smoke on plain `main` is RED — `REAL_EXIT=1`, `=== ISSUES (1) ===`, and this is
the *only* issue; 22 nav views found, 20 visited, the app otherwise loads fine:

```
Applying inline style violates the following Content Security Policy directive
'style-src-elem 'self' 'nonce-…''. Either the 'unsafe-inline' keyword, a hash
('sha256-PlumsSlvJ7vvWzjqibGAYKq92O3y/4JTxWWsWJvyUYA='), or a nonce is required
```

**The culprit was identified by hashing every `<style>` in the live prod DOM, not by inference.**
Exactly one `<style>` element: 1329 bytes, no nonce, `sha256=PlumsSlvJ7vvWzjqibGAYKq92O3y/4JTxWWsWJvyUYA=`
— an exact match for the hash the browser named. Its content is ProseMirror's base stylesheet
(`.ProseMirror { position: relative } … white-space: break-spaces …`). The violation event named the
injector directly: `sourceFile: /_next/static/chunks/2uni9ru3abh_p.js`, and that built chunk contains
both `ProseMirror` (19 hits) and `createElement("style")`.

**The injector is `@tiptap/core` itself, measured 2026-08-09.** Not Turbopack, not prosemirror-view:

```
node_modules/@tiptap/core/src/Editor.ts:255-257
  private injectCSS(): void {
    if (this.options.injectCSS && typeof document !== 'undefined') {
      this.css = createStyleTag(style, this.options.injectNonce)
```

`style` is a JavaScript STRING CONSTANT (`@tiptap/core/src/style.ts`), measured at **1329 bytes** — a
byte-exact match for the `<style>` element hashed in the live prod DOM above. Reproduce:

```bash
node -e 'const s=require("fs").readFileSync("node_modules/@tiptap/core/src/style.ts","utf8");const m=s.match(/^export const style = `([\s\S]*)`\s*$/);console.log(Buffer.byteLength(m[1],"utf8"));'
```

★★★ **THE ORIGINAL `grep` EVIDENCE POINTED THE OPPOSITE WAY FROM HOW IT WAS READ.** This entry cited
`grep -rn "prosemirror.css" src/` returning nothing as SUPPORT for the bundler theory. Nothing imports
that file because the CSS never travels as CSS at all — it is a JS string. `prosemirror.css` is a
different file (`prosemirror-view/style/prosemirror.css`, 1243 bytes, so not the one hashed) and
`grep -rn "prosemirror.css\|style/prosemirror" node_modules/@tiptap` returns no matches either.
prosemirror-view never injects; it only warns (`checkCSS`, `dist/index.js`, recommending you load its
stylesheet yourself). Fires once, on initial load.

★ The entry also said "The editor loads via `next/dynamic`". True of only 2 of its 8 call sites —
`meeting-report-panel.tsx` and `settings-sections/comm-templates-section.tsx`. The other six import
`RichTextEditor` statically, so it SSRs, which is why the nonce reader must guard `typeof document`.
Reproduce the split with `grep -rl 'rich-text-editor"' src/app --include="*.tsx" | grep -v '\.test\.tsx'`
(8 consumers). See §129, which carries the full table and the counter-example command.

★★ **Why it is prod-only, structurally** (`src/proxy.ts`, the `styleElem` ternary — `grep -n styleElem
src/proxy.ts`) — verified on the live response header:

| build | `style-src-elem` | injected `<style>` |
|---|---|---|
| dev | `'self' 'unsafe-inline'` | allowed |
| prod | `'self' 'nonce-${nonce}'` | **blocked** |

★ It is `style-src-**elem**`. React `style={{…}}` props ride `style-src-attr 'unsafe-inline'`
(the `style-src-attr` entry in `proxy.ts`) and are **not** implicated — do not conflate the two axes
when reasoning about a fix.
★ The SSR HTML is clean: zero un-nonced `<style>` tags, and its one stylesheet `<link>` correctly
carries the nonce. The offender is client-injected only, which is exactly why an SSR-level audit would
report all-clear.

**It is user-visible, measured on the live prod editor.** Computed styles read off the live
`.ProseMirror` element (Open Points → "Add task"):

| property | measured | expected |
|---|---|---|
| `white-space` | `normal` | `break-spaces` |
| `position` | `static` | `relative` |
| any ProseMirror rule in CSSOM | `false` | — |

Nothing compensates: `grep -c "ProseMirror" src/app/globals.css` → **0**. So in a production build,
consecutive spaces and newlines collapse while typing, and anything ProseMirror absolutely-positions
against the editor box (cursor, gap-cursor, placeholder) loses its containing block. prosemirror-view
ships its own warning about precisely this at `node_modules/prosemirror-view/dist/index.js:4908`.

**Blast radius — every rich-text surface in a prod build:** task description · note log · RAID
description + mitigation · change description + impact description + resolution notes · milestone
description · **the dashboard narrative · the meeting/steering report body · the comm-template body**.

★★★ **THE LAST THREE WERE MISSING FROM THIS LIST UNTIL 2026-08-09, AND THE OMISSION WAS SELF-REFUTING.**
The original list enumerated the SEVEN sanitizer-backed register fields plus the note log — the fields a
`sanitize*` sweep finds — not the RENDER SURFACES, which is what a CSS failure actually follows.
`RichTextEditor` has 8 consumers (§129); three of them render no register field at all. The verification
paragraph below closes this entry by measuring `dashboard-sections/dashboard-narrative.tsx` — a surface
this very list said was not affected — the two `dashboard-narrative.tsx` mentions sit 55 lines apart in
the same entry (count between the two mentions, not from the list, which gives 62). ★★ The two `ssr: false`
consumers are affected identically: `immediatelyRender: false` defers Editor construction to mount, so
the injection is client-side under BOTH import styles (§129). ★ Derive a blast radius from the consumer
list, NOT from the field list — a field list answers "what is stored", and this bug is about what is
RENDERED. The consumer list is
`grep -rl 'rich-text-editor"' src/app --include="*.tsx" | grep -v "\.test\.tsx"` (8); the bare
`grep -rl 'rich-text-editor"' src/app` an earlier revision quoted here returns 12, because it also picks
up `csp-nonce.ts` and three test files. Abbreviating an attached command is how it stops reproducing the
number beside it.

**Not caused by the eslint-10 branch.** That branch touches no CSS, no markup and not `src/proxy.ts`;
its only runtime commit is six type annotations. The same violation, with an identical hash and only the
per-request nonce differing, was seen from the branch first and then measured on `main`.

### What is NOT established

- ★★ **Only `main` was measured.** That is sufficient to establish the branch did not introduce it, but
  it is **not** an independent re-confirmation of the branch-side observation — the two are one
  measurement plus one corroborating sighting, not two measurements.
- ~~**Which fix is right.**~~ SETTLED — option A (`injectNonce`) shipped; see below.
- Whether any other lazily-loaded dependency injects an un-nonced `<style>` on a route the smoke does not
  reach. Only one such element was found on initial load; the sweep was not exhaustive across all views.
  ★ Still not settled. The `prod-smoke` job narrows it over time rather than answering it — the smoke
  walks the nav views it can reach, so a surface it never opens stays unmeasured.

### Fix — option A chosen and shipped

`injectNonce`, a first-class `@tiptap/core` option this entry did not know about (declared beside
`injectCSS: boolean`). `src/app/csp-nonce.ts` reads the per-request nonce and `rich-text-editor.tsx`
passes it to the app's single `useEditor`. **`src/proxy.ts` is untouched and the CSP is unchanged.**

★★ It covers BOTH Tiptap injection points — `Editor.ts` and `@tiptap/extensions`'s selection extension
both read `editor.options.injectNonce` — which the previously-recorded option 1 shape would not have.

The two options recorded earlier were rejected. **`injectCSS: false` + owning the CSS** copies a
dependency stylesheet (drift), gates only `Editor.injectCSS()` and not the selection extension's tag, and
would import `border-top: 1px solid black`, an off-palette literal the palette-sweep scans for.
**`'unsafe-inline'` in prod `style-src-elem`** would widen the single documented **`unsafe-inline`**
residual in `docs/security/threat-model.md` — that row's mitigation reads "strict nonce-based CSP, no
`unsafe-inline` script" and lists `style-src-attr 'unsafe-inline'` as the one low-risk residual — from
style *attributes* to style *elements*. ★ "the single documented residual" unqualified would be false —
but "several" was the wrong correction: the B5 table holding that row has 4 rows and exactly TWO
non-empty Residual cells, and one of those two IS the `unsafe-inline` one, so it carries exactly ONE
other. It is the only `unsafe-inline` residual in the file (`grep -n unsafe-inline
docs/security/threat-model.md` → 2 hits: the row at `:71`, and `:79`, which is the script-src inventory
line, not a residual). ★★ Correcting an over-claim with a vaguer word is not a correction — "several"
was as unmeasured as the thing it replaced.

★★★ **THE UNIT TEST CANNOT PROVE THIS AND MUST NOT BE READ AS PROVING IT.** `readCspNonce` reads the
`.nonce` IDL property, because a real browser EMPTIES the `nonce` content attribute on insertion ("nonce
hiding") and keeps the value only on the IDL slot. jsdom does not implement nonce hiding, so
`getAttribute("nonce")` passes every unit test and returns `""` in production. Measured, not reasoned: a
reviewer mutated `.nonce` into `getAttribute("nonce")` and **the entire unit suite stayed GREEN**.

Confirmed in Chromium against a real `next start`, 2026-08-09. Response headers checked first to confirm
the STRICT prod policy was in force. Landing view sufficed — `dashboard-sections/dashboard-narrative.tsx`
mounts `RichTextEditor` statically on the dashboard, so no navigation was needed.

**Shipped code:**

```
{
  "scriptSelectorMatched": true,
  "scriptAttrValue": "",
  "scriptIdlValue": "YTQwZDYwZmUtNDczYy00YjdhLWExNjktNmY4ZjQxMjBkOTA2",
  "styleTagPresent": true,
  "styleNonce": "YTQwZDYwZmUtNDczYy00YjdhLWExNjktNmY4ZjQxMjBkOTA2"
}
CSP violations seen: 0 []
```

`styleNonce === scriptIdlValue` byte for byte: the value read off the IDL property is the value that
reached Tiptap's injected `<style data-tiptap-style>`.

**Negative control** — same commit, same server, `.nonce` replaced by `getAttribute("nonce")`:

```
{
  "scriptSelectorMatched": true,
  "scriptAttrValue": "",
  "scriptIdlValue": "OTYxMjAzY2EtMzM3NC00YTdjLWJhYmQtNDc2N2Y2YTdjOGFj",
  "styleTagPresent": true,
  "styleNonce": ""
}
CSP violations seen: 1 [ "Applying inline style violates ... 'style-src-elem 'self'
'nonce-OTYxMjAzY2EtMzM3NC00YTdjLWJhYmQtNDc2N2Y2YTdjOGFj''. ..." ]
```

★★★ The refusal quotes the SAME nonce `scriptIdlValue` carries — the browser is saying the correct value
was on the page and the code simply failed to read it. So necessity here is an OBSERVATION, not a
deduction.

★★ `styleTagPresent` stays `true` under the mutation. Tiptap injects the tag either way and the browser
then refuses to APPLY it — so "a style tag exists" proves nothing; only `styleNonce` does.

★★★ The mutated build COMPILES AND SERVES CLEANLY. The failure is silent at every layer except the
browser console. That is why the unit suite stayed green on it, and why a real-browser probe rather than
a test is what proves this fix.

**The gate that now covers this:** `npm run e2e:smoke:prod` (`scripts/e2e-smoke-prod.mjs`) and the
BLOCKING `prod-smoke` CI job. Baseline before the fix on this branch: `=== ISSUES (1) ===`, the
`style-src-elem` violation and nothing else. After: `=== ISSUES (0) ===`.

### ★★★ Why this went unseen — the process lesson

**`npm run e2e:smoke` starts no server of its own.** Its header says so: *"Requires the dev/prod server
to be already running at the target URL."* `npm run e2e` is the opposite — Playwright's `webServer`
config auto-starts one. So in practice the smoke is only ever pointed at a dev server somebody already
had running, and **the dev CSP is the permissive branch**. A prod-only defect of this size was therefore
structurally invisible to the one suite most likely to catch it. That is the reason this bug is old and
unnoticed, not a footnote to it. Anything that needs prod-CSP coverage has to point the smoke at a real
`next start`, as the reproduction above does.

---

## 55. Twelve hand-rolled `aria-pressed` toggles still show their on-state by colour alone — open

0.212.0 gave the shared `ToggleButton` primitive a non-colour pressed cue (a trailing check glyph).
Twelve controls do NOT use that primitive and were left as they were. For MOST of them the only
visual signal that they are active is a fill or tint change — WCAG 1.4.1.

★ **THIS READ *thirteen* UNTIL 2026-08-11.** The unify-rich-text slice deleted the editor toolbar's
hand-rolled `ToolbarButton` — the entry's own "clearest and most used" case — when
`rich-text-editor.tsx`'s toolbar moved to `rich-text-toolbar.tsx`, where every stateful control is
the shared `ToggleButton`. That is **one** site removed, counted rather than estimated: the grep
below returns 13 on `main` and 12 here. It is also this entry's first resolution by MIGRATION to the
primitive rather than by adopting `role="radio"`.

★ THIS READ **fourteen** UNTIL 2026-08-06. The field-visibility tier selector
(`modal-field-controls.tsx`) was the fourteenth, and it is RESOLVED — the control moved into the
modal header and its hand-rolled `aria-pressed` buttons were replaced by the shared
`SegmentedControl`, i.e. by `role="radio"`, which is exactly the answer this entry's own closing
paragraph proposed for the radio-like cases. Re-measure rather than trust the number:

```bash
grep -rn "aria-pressed={" src/app --include="*.tsx" | grep -v "\.test\." | grep -v "toggle-button.tsx" | wc -l   # 12
```

★★ TWO OF THE TWELVE ARE NOT COLOUR-ONLY, and an earlier revision of this entry said flatly that
all of them were. `voice-button.tsx:113` adds `animate-pulse` while listening (a motion cue) plus a
flipping `title`. `dictation-mic.tsx:73` is colour-only IN THE BUTTON, but the hook also returns a
`status` node rendering visible "Listening…/Transcribing…" text (`dictation-mic.tsx:83`) — so the
**13** callers that render it are covered and the two that destructure without it are not: the
`editMic` call in `NoteEntryRow` and the `composerMic` call in `NoteLogPanel`, both in
`note-log-panel.tsx`. Check the caller, not the grep hit.
★★ Those two were cited BY LINE (`:68,181`) until 2026-08-11, and both were stale — the a11y
follow-on to §137's branch (`a6e7c0c5`) inserted a shared-const declaration above each, moving them
to 74 and 189. The CLAIM was re-verified and still holds (neither destructures `status`); only the
numbers had rotted, which is exactly why they are now SYMBOLS. Third recorded instance in this entry
alone of a `file:LINE` citation broken by an edit to a file the doc never opened.
★ That number read **four** until 2026-08-05 and understated the covered set by nine, which errs
against this entry's own argument: `dictation-mic` is the WEAKEST of the eleven colour-only cases,
not a middling one. Re-measured — all 13 destructure the node AND render it in JSX; the 2 that do
not destructure it are the only gap. Reproduce:

```bash
grep -rn "= useDictationMic(" src/app --include="*.tsx" | grep -v "\.test\." | grep -cE "\bstatus\b"   # 13
```

★ A grep keyed on `status:` answers **12** — `chat-panel.tsx:198` destructures `status` unrenamed, so
it has no colon. Key on the bare word, and confirm each hit RENDERS the node rather than merely
destructuring it.

★★ The entry's worst case is GONE and this paragraph used to lead with it: `rich-text-editor.tsx`'s
`BTN`/`BTN_ON` pair differed by `bg-ui-dark-blue` + `text-white` and nothing else, on the
bold/italic/list buttons every task description and note passes through. That toolbar was REPLACED by
`rich-text-toolbar.tsx`, which uses the shared `ToggleButton` throughout — so the primitive's
non-colour marker now covers the highest-traffic case in the app.

The twelve that remain: `task-form-fields.tsx:576,590` (health-override chips) ·
`create-project-wizard.tsx:308,337` (template picker) · `raci-chip-picker.tsx:107` ·
`knowledge-panel.tsx:213` · `settings-sections/comm-templates-section.tsx:324,346` (version compare)
· `step0-import-panel.tsx:304` · `influence-interest-matrix.tsx:80` · `dictation-mic.tsx:73` ·
`voice-button.tsx:101`.
★★ FOUR of those line numbers MOVED in the same slice that removed the thirteenth, and none of the
controls changed: `task-form-fields` 545,559 → 576,590 and `comm-templates-section` 335,357 →
324,346, because both files are `RichTextEditor` call sites and lost the `variant`/`labels` props
(`raci-chip-picker` 105 → 107 was already stale). Re-verified against the tree 2026-08-11. This is
AGENTS.md's own corollary — an edit that inserts or deletes lines invalidates every `file:LINE`
citation in the file, including ones in a doc the edit never opened.

★★ NOTHING AUTOMATED WILL FLAG THESE. axe 4.12.1 ships exactly ONE rule tagged `wcag141` —
`link-in-text-block`, which is about links against surrounding text — and nothing in axe evaluates
whether a CONTROL's state is colour-only (queried in-process: 105 rules, one `wcag141`). Several of
the hosts sit on axe-scanned views and pass today. The count above is the whole population — every
`aria-pressed` JSX attribute outside the primitive, counted, not estimated.

★ The fix is not uniformly "migrate to `ToggleButton`". Some are radio-like single-select groups
(template picker, RACI role, import method, quadrant) where the primitive's chip styling and
pinned-label rule may not fit, and where `role="radio"` might be the better answer than
`aria-pressed` at all. That is no longer a hypothesis: the tier selector took exactly that route
(adopting `SegmentedControl`, i.e. `role="radio"`) and left this list. ★ Deliberately NO version
here — the change is committed but UNRELEASED, and an earlier draft of this sentence said "in
0.218.0", which is the commit this work sits ON TOP of; that release shipped a different a11y fix
and a reader chasing the resolution would find nothing. Write the real version at release time or
leave it to the date above. ★ The editor toolbar was the first of those three and is DONE — it
migrated to `ToggleButton` wholesale, which also settles the open question above in its favour for
the binary cases. The two mic buttons are the remaining genuine binary toggles and are the natural
next migration; the radio-like groups still want the `role="radio"` answer instead.

---

## 56. `ToggleButton`'s pressed state is near-invisible in all three DARK schemes — open

Pressed-vs-unpressed border contrast, computed from `src/app/builtin-schemes.ts`:

| scheme | `--line` vs `--ui-dark-blue` |
|---|---|
| harbor-light | 8.97:1 |
| meridian-light | 7.71:1 |
| umber-light | 9.30:1 |
| **harbor-dark** | **1.22:1** |
| **meridian-dark** | **1.16:1** |
| **umber-dark** | **1.03:1** |

★★★ THIS IS NOT THE 1.4.1 PROBLEM 0.212.0 FIXED, AND THE CHECK GLYPH ONLY MASKS IT. SC **1.4.11
Non-text Contrast** requires 3:1 for "visual information required to identify user interface
components **and states**" — "states" is in the normative text. At 1.03:1 the pressed styling is
invisible to EVERY user, not only to users with a colour-vision deficiency, so this is a contrast
defect rather than a colour-reliance one. The new glyph means state is still discoverable, which is
why this is a follow-up and not a release blocker — but `--ui-dark-blue` as an accent ON a dark
surface does no visual work anywhere in the app, and the fix belongs in the dark scheme maps
(a pressed border clearing 3:1 against `--line`), not in the component.

★★ The header comment in `toggle-button.tsx` — "gains an accent border + tint when pressed, so the
ON state is visible at a glance" — is measurably false in the dark schemes. Pre-existing text; this
is the release that made it disprovable.

★ Why no gate caught it: `e2e/a11y.spec.ts` runs axe over 5 of the 6 built-in scheme combos, but
axe's contrast rules evaluate TEXT, not a component's state border, and umber-dark is the omitted
combo. Scheme DATA remains 5-of-6 covered — this is that hole producing a real defect.

---

## 57. The four toolbar Outlook enable-toggles carry an untested `auto` guard — open

`tasks-section.tsx` and the raid/change/absence writers in `use-calendar-integrations.ts` each read
the RAW stored `auto` when switching a row on (`auto: enabled ? (s.outlookCalendar?.X?.auto ?? false)
: false`). Every fixture stubs `auto: false`, so the guard is never exercised with a true value:
deleting the `enabled ? … : false` wrapper at any of the four sites leaves the whole suite green.

★ Since 0.212.0 `sanitizeOutlookCalendar` masks `auto` by `enabled` at LOAD, so a stale
`{enabled:false, auto:true}` can no longer reach these writers — that is the real defence and it IS
tested (`calendar-sync-config.test.ts`). These four guards are now belt-and-braces, which is exactly
why nobody would notice removing them. Removing BOTH would arm unattended two-way Outlook sync from
a single click on an imported settings blob.

---

## 58. The axe gate can pass against a STALE dev server — gate half CLOSED post-0.212.0, sibling-worktree half OPEN

**Cited from:** `layout.tsx`, `e2e/a11y.spec.ts` — this entry cannot be deleted.

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, so a local `npx playwright test
e2e/a11y.spec.ts` attaches to whatever already answers on the target port. On a machine with a dev
server left running from another worktree — which is the normal state here, since this repo is
routinely checked out twice — an 85/85 pass can be evidence about code that is not on your branch.

★★ AGENTS.md already warns about this and prescribes `PORT=3100 npm run dev` plus a fresh-port run.
That is a LANDMINE, not a gate: it depends on the next person remembering, and on them verifying the
port actually took. During 0.212.0 the check was done by hand — resolving `Number(process.env.PORT ??
3000)` to 3100 and then confirming with `netstat` that nothing answered on :3000 — which is three
steps too many to expect reliably.

**Resolution (the gate half only).** `src/app/layout.tsx` renders `data-app-version={APP_VERSION}` on
the server-rendered `<html>`, and `e2e/a11y.spec.ts` opens with a guard test — "the served app is this
checkout" — that reads the attribute back and compares it to the imported `APP_VERSION`, failing with
an error message that names both versions and prescribes the fresh-port run. The suite is now **86
tests: 85 axe scans (5 scheme combos × 16 views + 5 Kanban variants) + 1 guard.**

★★ **STILL ONLY HALF, which is why this entry stays open rather than closing.** A version match is
necessary and not sufficient: two worktrees on the SAME version still agree, and that is the normal
state here between releases. The `PORT=3100 npm run dev` convention AGENTS.md prescribes still
applies — the guard removes the *stale-release* failure mode, not the *sibling-worktree* one.

★★ **The error message names a cause the guard cannot detect.** It says the reused server may be "a
dev server from another worktree, or a leftover process in this one" — but `APP_VERSION` only moves
at release, so BOTH of those read as a match for the whole of a release cycle. The message is
accurate about what to DO (fresh port) and overstated about what was DETECTED. Two reviewers raised
this independently. Leave the remedy wording; the diagnosis half is what the follow-up below fixes.

### The remaining half — follow-up, not yet built

**What it needs:** a token that differs per CHECKOUT, not per release, surviving from the serving
process into the DOM, comparable from the test process. Three candidates, cheapest first. ★★ None is
verified — this is a design sketch written at the point the gap was understood, and the first job of
whoever picks it up is to disprove the assumption each rests on.

**(a) Working directory of the serving process — recommended.** `RootLayout` is a Server Component,
so it executes in the server's own node process; `process.cwd()` there is the checkout that is
serving. Emit a short hash of it as a second attribute and have the guard compare it to the test
process's own `process.cwd()` hash. Two worktrees differ; a leftover process in the same worktree
does NOT — so this closes the sibling-worktree case and leaves the same-worktree-stale-Tailwind case
open. *Unverified:* that a Server Component may call `process.cwd()` under `next dev` in this Next
version, and that playwright's runner process shares the repo cwd (it does today; a config change
could break it). *Constraint:* hash it, and gate it on `NODE_ENV !== "production"` — a raw filesystem
path in shipped HTML is an information leak for zero benefit, since CI sets
`reuseExistingServer: false` and cannot hit this failure mode at all.

**(b) Boot nonce.** The server mints a random id at start, writes it somewhere the test can read
(`.next/`), and stamps it. Catches EVERY stale server including same-worktree, which is the case (a)
misses. Costs a file-write side effect at boot and a gitignore entry, and the read path has to fail
loudly rather than skip when the file is absent, or it degrades to a no-op guard.

**(c) Git HEAD SHA.** Rejected on inspection: a dirty tree has the same SHA as a clean one, so the
stale-Tailwind case — the one AGENTS.md's landmine is actually about — is exactly the case it cannot
see. Recorded so it is not re-proposed.

★ **Do not "close" this entry with (a) alone.** (a) makes the error message's diagnosis honest and
kills the common failure; only (b) covers a leftover process in the current worktree. Closing it
needs (b), or an explicit decision that the fresh-port convention carries that half forever.

★ **DECIDED 2026-08-03 — the production DOM change stays.** `data-app-version` renders on every
served page, not only under test, on a branch with no version bump. Reviewed and accepted: one static
server-rendered attribute, no runtime cost, no PII, and making it test-only would mean the guard no
longer exercises the same code path it is protecting. Do not "fix" this by gating it on `NODE_ENV`.
★ That reasoning does NOT extend to (a)'s cwd hash, which is a filesystem path and must be gated.

★★★ **THE OBVIOUS MUTATION PROOF CANNOT WORK, and reading its result as "the guard is vacuous" would
be the wrong conclusion.** The natural way to prove the guard discriminates is
`page.addInitScript(() => document.documentElement.setAttribute("data-app-version", "0.0.0"))` — and
it silently does nothing, because `document.documentElement` is **`null`** at the moment an init
script runs. The write no-ops, the real attribute survives, and the guard passes. It was proved live
two other ways instead: a temporary wrong-literal comparison in the assertion (fails, with the
intended message), and a `MutationObserver` registered inside the init script that catches `<html>`
at insertion and rewrites the attribute (also fails). Either is reproducible; the `addInitScript`
one-liner is the trap.

★ React does **not** reconcile this attribute. `RootLayout` is an async Server Component, so it
renders once server-side and nothing on the client recomputes or rewrites the value — it is always
the serving process's own version, which is the whole point. That is recorded in the JSX comment too,
because "is this attribute client-authoritative?" is the first question anyone will have.

---

## 59. Eye verification owed on 0.212.0 — and on the two releases before it — open

Settings → Integrations changed shape in 0.212.0: the calendar rows became **two stacked
`ToggleButton`s**, and `ToggleButton`'s `disabled` styling (`disabled:cursor-not-allowed
disabled:opacity-60`) rendered **for the first time anywhere** — it had been declared since the
primitive shipped and styled nothing, because no call site passed the prop. Neither was looked at
before the release went out.

★★ **THE FINDING IS NOT THIS RELEASE — IT IS THE PATTERN.** Three consecutive releases now carry owed
eye verification and none has been discharged: **§21** (0.209.0), **§41** (0.211.0), and this. That is
one process finding, recorded here rather than as its own number: the eye-verify step is **not
happening**, and filing a fourth entry after 0.213.0 would confirm that rather than fix it. Whoever
picks this up should decide what to do about the step, not just work through the backlog of three.

Settings → General **is** axe-scanned, so structural a11y is covered — labels, roles, resting-state
contrast. What is not covered, and what these checks are for:

- whether the two stacked toggles read as **two distinct controls** rather than one control with a
  stray second row;
- whether the disabled row reads as **disabled** rather than merely faint. §56 is the reason to doubt
  this by default: opacity and border changes on this primitive measure far worse in the dark schemes
  than the light ones, and the 60% floor was reasoned from the light-scheme label contrast.

---

## 60. The file-size ratchet ignores every file at or under 800 lines, so a sub-limit baseline entry is inert — open

`scripts/check-file-sizes.mjs`'s comparison loop opens with `if (n <= LIMIT) continue;` and `LIMIT` is
800. **A baseline entry is never consulted for a file at or under 800 lines.** So the ratchet cannot
catch growth below the limit at all — it only caps how far an *already-oversized* file may grow. That
is the design (it is a ratchet, not a budget), but the consequence is not obvious from the name and it
interacts badly with the flag below.

★ The useful half, for §2's split: re-recording `use-resource-planner.ts`'s baseline 1043 → **554**
still buys something real — but the value is in **removing the 1043**, not in installing a 554. Under
the old entry the first size the gate rejected was 1044; with any entry ≤ 800, or with none, it is
801. So the file could have crept back up with the gate firing **243 lines late**.

★★★ **CORRECTED 2026-08-03, same day it was written — the original text of this bullet was FALSE and
is the exact decay this file's preamble warns about.** It claimed that `node
scripts/check-file-sizes.mjs --update` (which regenerates the baseline as
`Object.entries(sizes).filter(([, n]) => n > LIMIT)`) would DELETE the 554 entry and thereby "silently
remove the regrowth protection §2 just installed". It deletes the entry, but that removes **nothing**:
walk the loop at `scripts/check-file-sizes.mjs:38-41` for `n = 801`. With `prev = 554` the
`n > prev` arm fires; with `prev === undefined` the NEW-file arm fires. **Both reject, at the same
line.** A sub-limit baseline entry is behaviourally identical to no entry at all, so `--update`
dropping it is a no-op and there is no trap here. The reasoning in commit `d7c423bd` is unaffected —
it argues about the harm of the old 1043 value, which was real.

★★ **There IS a residual, and it is social rather than behavioural** (found in review, 2026-08-03,
after the correction above): the committed baseline no longer matches what `--update` generates. The
flag emits only the five files over 800 (`chat-panel` 977 · `task-manager` 2966 · `task-row` 817 ·
`tasks-section` 1043 · `workspace-section` 963); the committed file carries those five **plus** the
`use-resource-planner.ts: 554` line. So the next person to regenerate gets a one-line DELETION diff
that reads as a regression and is not one. Either accept the line will be dropped whenever anyone
regenerates, or drop it now — behaviourally the two are the same file.

★ Also note the counting difference, since it will bite anyone hand-editing the baseline: the script
counts `content.split("\n").length`, which is **one more** than `wc -l` for a file ending in a
newline. `use-resource-planner.ts` is 553 by `wc -l` and 554 by the script. Use the script's number.

**No fix is proposed**, and the real gap is narrower than the first draft of this entry suggested.
It is not `--update`; it is that **a file which has been brought back under 800 cannot be held
there.** §2 took `use-resource-planner.ts` from 1043 to 553, and nothing now stops it returning to
799 one commit at a time. The two options: (a) leave it — the ratchet is a ratchet, not a budget, and
800 is the only line anyone agreed to; (b) give the baseline an explicit per-file `pin` the loop
honours regardless of `LIMIT`, so a file that earned its way down can be held near where it landed.
(b) makes the ratchet two mechanisms and needs a decision about who may raise a pin, which is why it
is a slice of its own rather than a tweak. There is no pressure to do either now.

---

## 61. Three residuals from the `use-resource-planner` split, plus one pointer — open, all small

Left deliberately by §2's move-only extractions. None blocks anything; grouped as one entry because
they share a cause and would be fixed in one pass.

**(a) A warning names the wrong hook.** `plainSeed`'s dev warning still reads
`"[useResourcePlanner] non-plain seed dropped (event forwarded as seed?)"` and is now emitted from
`use-resource-directory.ts:68`. Preserving the string verbatim was **required** by the move-only rule,
so this is a consequence of that discipline, not a defect of the commit that carries it. Fix it in any
commit that is allowed to change behaviour-adjacent strings.

**(b) A doc comment names one of two consumers.** `UseResourcePlannerArgs.captureComposite`
(`src/app/use-resource-planner.ts`, near line 60) says: "reference-data deletes (role/discipline/grade)
that cascade an edit into **a second array**". Resource deletes use it too, cascading across **three**
arrays (resources + absences + shifts). Now that the field is a pure passthrough into two sub-hooks,
the comment describes half of what it forwards.

**(c) A duplication seam the gate cannot see yet.** Two sibling hooks —
`use-reference-data.ts` and `use-resource-directory.ts` — now each hand-roll the same
ref-per-arg boilerplate (`const xRef = useRef(args.x)` plus its sync effect) over a different subset
of `{lang, logActivity, showToast, capture, captureComposite, captureFieldEdit}`. Each pair is ~2
lines, well under jscpd's 50-token floor, so the **blocking** duplication gate is silent — but the
moment a third extraction needs the same subset in the same order it becomes a 150+ token contiguous
match. Current numbers (measured 2026-08-03, threshold **1.75%**): tsx **1.71%** · typescript
**1.36%** · total **1.53%**. tsx has roughly **0.04pp** of headroom — that near-breach is pre-existing
and in a different bucket (these two files are `.ts`), but it means the total has no slack to absorb a
new `.ts` clone either.

★ **CORRECTION to how this was first written up:** it was described as *three* sibling hooks, adding
`use-calendar-events.ts`. That file contains **no `useRef` at all** — it takes its four optional
callbacks directly and uses `useWorkspace()` + `useCallback`. It is the naming precedent §2 should
have cited, not an instance of this duplication.

★ The refs are not gratuitous, so "just thread the ref objects in" is not the fix: `exhaustive-deps`
only knows a value is render-stable when it can *see* the `useRef`, so threading them as args makes
the rule demand them in every dependency array — a change to the memoization form a move-only commit
is forbidden to make. The rationale is already in `use-reference-data.ts`'s header. Any shared helper
has to preserve that property.

**(d) If a further extraction is ever wanted**, the **RAID cluster** is the cleanest next cut: ~130
lines, `use-resource-planner.ts:133-265` — `handleSaveRaidItem`, `handleDeleteRaidItem`,
`handleSendRaidInquiry`, `captureRaidBulkUndo` — self-contained, and conceptually not "resource
planning" at all. (`handleCreateMitigationTaskFromRaid` at `:407` is RAID-adjacent but reaches into
tasks, so it is a judgement call rather than an obvious inclusion.) Absence and shift CRUD genuinely
belong in the planner and should stay. ★★ **There is no ratchet pressure — the file is 553 against a
554 baseline and a 800 limit. Do not do this speculatively**; it is recorded so the next person under
real pressure does not have to re-derive it.

---

## 62. Two reference-data handlers have no production consumer — open, pre-existing

`handleAssignResourceRole` and `handleClearResourceRole` (`use-reference-data.ts`)
are reachable only from `use-resource-planner.test.tsx` (`:1012`, `:1023`, `:1085`, `:1096`). ★ Those
two cites read `:127` and `:140` until 2026-08-05 and were six lines stale — both handlers moved in
the §61 split; the sentence names both symbols, which is the durable cite. Nothing
in `task-manager.tsx` destructures them; `git grep` across `src/` finds no other caller.

★ **Pre-existing, not introduced by §2's split** — both handlers were equally dead at `0d770283`,
where `use-resource-planner.ts` still declared and re-exported them directly. Recover it with
`git show 0d770283:src/app/use-resource-planner.ts` and grep the two names. The move-only rule
required carrying them across verbatim, so the split re-exported two dead handlers through a
three-level spread rather than creating the problem.

★★ Those four line numbers were ACCURATE — and still had to go. They described the file at that
commit (1042 citable lines), not at HEAD (553), so `docs:claims:check` read them as four past-EOF violations
and could not have known better: it only ever sees the checkout. A cite pinned to a named revision
is a real category, and the durable form is the SHA plus a symbol, never the SHA plus a number.

★★ **The role-assignment path that IS live is `handleAssignRoleById`**, which the directory picker
uses and which never mints a role. `handleAssignResourceRole` is the older discipline×grade variant
that mints via `resolveOrCreateRole` — so deleting it would also remove the only non-test caller of
`resolveOrCreateRole`, which is itself passed to `RolesPanel` as `onResolveOrCreateRole`. Check that
prop is live before deleting anything; this is a small thread to pull, not a one-line removal.

The decision is delete-or-record, and it needs a commit that is allowed to change behaviour — not a
move-only one. Recorded here so the next reader does not assume a tested handler is a used one.
★ Four tests would go with them.

---

## 63. ~~`gantt.tsx` crossed 800 and was baselined rather than split~~ — CLOSED in 0.213.0, split after all

**Was:** 0.213.0 grew `gantt.tsx` past the 800-line ratchet and the release baselined it instead of splitting it.

★ **Closed the same day it opened.** The entry below was written when the split had been called off;
it was then completed and accepted, so `gantt.tsx` is **715** lines and its baseline entry is gone.
The chart body — scroll container through footer, ~190 contiguous lines of presentational JSX —
moved to `gantt-chart.tsx` (320). Proved move-only mechanically rather than by eye: slice both
regions, apply the three intended renames (`layout.bars`→`bars`, `layout.placeable`→`placeable`,
`startNameColResize`→`onStartNameColResize`), normalise whitespace, diff → identical over 5,279
chars. 70 tests before and after, no test file edited.

★★ **Two things learned that outlive the entry.** (1) The empty-state block, which looked like the
obvious seam, nets about **7** lines — the whole-panel early return has to stay in `gantt.tsx`
because it carries the `print-root` / `print-landscape` / `VIEW_PANE_RESIZABLE_CLASS` strings that
three source-scan tests assert against that specific file. Only the chart body clears 800. (2) The
cost is a ~35-prop bag at the new boundary; that is inherent to this seam, not a bad cut.

★ **A baseline entry is a licence to grow, not just a record.** While the split was in flight, the
stopgap commit added `"src/app/gantt.tsx": 864`, which would have let the file grow back to 864
unchallenged AND made `size:check` passing meaningless as evidence about that file. Removed. Verified
the split stands on its own: the ratchet is green with no `gantt.tsx` entry at all.

**The original entry, kept because its measurements are still the record of what happened:**

0.213.0 grew four already-large files past the ratchet. All four were baselined
(`docs/baselines/file-sizes.json`) rather than split. **Three of those are routine increments on
files that were already far over the limit; one is a genuine new violation and is the actual entry
here.**

| file | was | now | verdict |
|---|---|---|---|
| **`gantt.tsx`** | *(not baselined)* | **864** | **NEW file over 800 — the real item** |
| `tasks-section.tsx` | 1043 | 1067 | increment on existing debt |
| `task-row.tsx` | 817 | 827 | increment on existing debt |
| `task-manager.tsx` | 2966 | 2972 | increment on existing debt |

★ **A split was started and deliberately called off.** The judgement was that restructuring the Gantt
orchestrator at the end of a 16-task feature branch carries more regression risk than the ratchet
violation it clears, and that the split deserves its own focused work rather than being rushed as a
gate-clearing chore. That is a scope decision, not a claim the file is fine at 864.

★★ **Two traps for whoever does it.** (1) A `.tsx` extraction is coverage-EXCLUDED; a `.ts` one is
coverage-GATED and needs its own tests or it drags the blocking floor. (2) At least one Gantt test
scans raw source text to assert markup ORDER — grep the test files for `readFileSync` before moving
any markup, because such a test must be re-pointed at the file the markup moved TO. That is the one
legitimate test edit in an otherwise move-only commit; any assertion change means behaviour moved.
The applicable precedent is §2's `use-resource-planner.ts` split (two verbatim extractions, proved
move-only mechanically), not a rewrite.

★ **`use-resource-planner.ts` silently left the baseline file** in the same `--update` run: §2's split
took it to 554, and per **§60** the ratchet ignores everything at or under 800, so its entry was
inert and `--update` dropped it. That is §60's finding demonstrated rather than argued — worth noting
because it means the baseline file is not a record of "files we are watching", only of files
currently over the limit.

---

## 64. Other surfaces still read "0% complete" for an all-cancelled project — HALF CLOSED post-0.216.0

★ **HALF CLOSED post-0.216.0.** Every surface that reads the figure DIRECTLY is done; both PERSISTED
figures are deliberately untouched.

★★★ **DO NOT STATE THAT AS "everything a user READS is done" — a draft did, and it is FALSE.** The
landing-state `complete:` is persisted AND user-read: `dashboard-panel.tsx` writes
`complete: model.progress.percent` into the per-device snapshot, `use-landing-delta.ts` feeds it to
`computeMetricTrends`, and `dashboard-kpi-strip.tsx` renders `trends.complete` as a `TrendArrow`. The
arrow is suppressed WHILE the project is no-scope, so the poisoned 0 surfaces on the visit AFTER
scope returns — reachable, rendered, still open. This entry's own body says exactly that ("the NEXT
visit's trend arrow is baselined off a number the UI has just decided not to show"), so the draft
contradicted the entry it was closing. **A clean two-way split (read vs persisted) is exactly the
shape that hides an item belonging to both.**

| surface | state |
|---|---|
| Portfolio health table (`use-portfolio-health.ts` → `portfolio-health-panel.tsx`) | CLOSED — `completionPercent` is now nullable, gated on the same `hasNoActiveScope` the tiles use; the cell renders an aria-hidden "—" with an sr-only "No active scope" |
| `portfolio-rollup.ts` `avgCompletionPercent` | CLOSED — **this entry never named it** (see below) |
| `committee-report/report-draft.ts` | CLOSED — emits "no active scope" instead of "0% complete" |
| `ai-dashboard-snapshot.ts` | CLOSED — the payload carries an explicit `noActiveScope` |
| `snapshot.ts` `pctComplete` | **OPEN, deliberately** — persisted |
| `dashboard-panel.tsx` landing-state `complete:` | **OPEN, deliberately** — persisted **and user-read**: it feeds `trends.complete` → the KPI strip's `TrendArrow` on a later visit |

★★ **THE SURFACE LIST WAS INCOMPLETE, in exactly the way this entry warns about.** It names the
portfolio ROW and the CELL but not `aggregatePortfolio`, which summed those zeroes and divided by
`rows.length` — so one no-scope project pulled the portfolio-WIDE average down with a value meaning
"nothing left", not "nothing done". Found by grepping every reader of `completionPercent` rather
than reading this list, which is the habit the ★★★ below already prescribes. The divisor is now the
count of projects that contributed a figure.

★ The persisted pair stays open for the reason recorded below and not because it was missed: giving
a stored figure a null state is a data-shape change that Trends charts over time and version history
diffs. It is worth its own decision, not a pattern-match onto the presentation fix.

The cancelled-work presentation batch fixed the Reports headline tiles, the Dashboard completion
tile, the Dashboard at-a-glance KPI card, the Dashboard completion-trend sparkline, and the Open
Points status glyph. The surfaces below were found during review and deliberately left out rather
than widening the branch.

★ The heading deliberately carries NO NUMBER. It held one for four revisions and was wrong in three
of them — the last time within the hour, when this entry's own bullets grew from the review that
added the Trends pair. See the paragraph below.

★★ THE COUNT IN THIS HEADING WAS WRONG IN THREE OF THE FOUR REVISIONS IT SURVIVED, so it has now
been REMOVED rather than corrected a fifth time. The entry opened at "two" and each later review
round added bullets without re-counting — once in the very commit that added the TRANSCRIPTION
WARNING at the foot of this entry, and once more in the commit that added THIS paragraph, which
named the heading and the body ordinals and forgot the **index table row at the top of this file**.

★★★ **A `file:line` CITATION CAN BE BROKEN BY THE COMMIT THAT WRITES IT.** Two here were: the same
commit that added `withoutCompletionVariance` to `snapshot.ts` and `scopeCounts` to `dashboard.ts`
also edited this entry, and both insertions pushed a line the entry cites further down the file. The
numbers were correct when read and wrong when committed — no later drift, no staleness, just an
edit-order trap. A third citation named a location that had been TRIED AND ABANDONED earlier in the
same commit, while the commit message recorded the real one, so the doc contradicted its own commit.
★ THE HABIT THAT SURVIVES THIS: cite the SYMBOL and the file (`computeVariance` in `snapshot.ts`),
not the line. A symbol is checkable by grep, it is what the `agents-symbol-check` gate can see in
AGENTS.md, and it does not move when someone inserts a function above it. Reserve `file:line` for a
spot with no symbol to name, and re-read it AFTER staging.

★★★ AND THE FIX FOR THAT WAS ITSELF WRONG. It said "a count lives in THREE places: the table row,
the `##` heading, and any ordinal in the prose" — a closed list, which is the error. A review found a
FOURTH copy nine lines below it ("the same shape as the three already done"), stale since the day it
was written. There is no fixed number of places: **a count lives wherever someone wrote one.**
Enumerating the places is the losing move, because the next writer adds a place. The durable habit
is to stop writing counts an edit can invalidate — name the surfaces, say "the fixes already made",
and reserve a number for the heading, where one is unavoidable. When you must change that number,
`grep -n` the entry for every digit-word before you commit.

**A user READS this one — it belongs with the surfaces that were fixed, not with the persisted figures:**

- `use-portfolio-health.ts` sets `completionPercent: model.progress.percent`, and
  `portfolio-health-panel.tsx` renders that `completionPercent` as a percentage in the Turso
  Portfolio-health table. An all-cancelled project reads "0%" in a table a portfolio owner scans
  across projects — the same misreading, on the surface where cross-project comparison happens.

**The rest are model- or storage-facing:**

- `committee-report/report-draft.ts:68` emits `"- Completion: 0% complete"` into the
  steering-committee AI draft. So the model is handed the misreading a human no longer sees,
  and can restate it in generated prose.
- `ai-dashboard-snapshot.ts:92` (`percent`) feeds the model the bare number.

★★ `snapshot.ts:211` (`pctComplete`) IS IN BOTH BUCKETS AND AN EARLIER REVISION FILED IT ONLY UNDER
THIS ONE. The same assignment feeds the persisted snapshot AND the LIVE current-snapshot that
`computeVariance` diffs against the baseline, so it reaches two rendered surfaces:
`VarianceSummary` (declared in `variance-summary.tsx`, rendered by `dashboard-tile-bodies.tsx` as
the body of the Turso-gated `trends` TILE) and the Trends view (`trends-panel.tsx`). ★ It used to be
cited here as `dashboard-panel.tsx` line 378 (deliberately NOT written in `path:LINE` form — the
ratchet would parse a citation this very sentence exists to retract), described as "the Turso-gated
Trends card in the dashboard masonry, which sits DIRECTLY AFTER the Progress `<Section>`" — all
three halves went stale in 0.240.0 when the
arrangeable grid replaced the masonry (`git log -S VarianceSummary -- src/app/dashboard-panel.tsx`
names the commit). The position claim cannot be repaired, only dropped: the grid is user-ordered, so
the tile sits wherever that project's stored layout puts it.
`computeVariance` (`snapshot.ts`) builds that row with `worseIfLower`, so a project baselined at 40%
whose remaining work is then all cancelled rendered **"Percent complete −40%"** beside an AMBER dot,
one card below a tile reading "No active scope" — delivery announced as having gone backwards on a
project with no scope left. ★ AMBER, not red: `worseIfLower` returns only `"A"` or `"G"`; an earlier
revision of this bullet said red and a test assertion disproved it.

★ **THE RENDERED HALF IS NOW FIXED.** `withoutCompletionVariance` (`snapshot.ts`) drops the
completion ROW, applied ONCE in **`use-snapshots.ts`** — the hook that PRODUCES `variance`, whose two
consumers are the dashboard Trends card and the Trends view — gated on `tasksHaveNoActiveScope`
(`dashboard.ts`), which is `hasNoActiveScope` over the same `scopeCounts` the tiles use, so a surface
gated on it cannot drift from them. Partial cancellation keeps the row.
★★ An earlier revision of this sentence named `workspace-section.tsx`. That placement was TRIED and
ABANDONED (the file sits at its size-ratchet baseline), and the register kept the abandoned location
while the commit message recorded the real one — so the doc and its own commit contradicted each
other. The appositive that followed it ("the sole feeder of both surfaces") was true OF
workspace-section, which is exactly what let a wrong location survive a skim.

★★ **THE PERSISTED HALF IS STILL OPEN**, and the split is why it survived the fix above. Giving the
stored `pctComplete` a null state is a data-shape change that Trends charts over time and version
history diffs — migration consequences for every stored snapshot. Do not do the second because the
first was done; the fix above deliberately touches no record.
- `dashboard-panel.tsx:175` writes `complete: model.progress.percent` into the per-device
  landing-state snapshot, so the NEXT visit's trend arrow is baselined off a number the UI has just
  decided not to show.

★★ These are NOT one class of change, and the split is the point. Portfolio health is PRESENTATION —
the same shape as the fixes already made. `pctComplete` is also a PERSISTED figure that Trends charts
over time and version history diffs, so giving THAT a null state is a data-shape decision with
migration consequences for every stored snapshot. Decide those separately; do not "finish the sweep"
by pattern-matching the presentation fix onto the stored ones.

★★★ THIS SENTENCE HELD A FOURTH COPY OF THE COUNT AND IT WAS WRONG FROM THE DAY IT WAS WRITTEN —
"the same shape as the three already done", written when four surfaces were already fixed, then left
untouched while two later commits corrected the heading, the index row and the intro around it. The
paragraph nine lines above, which instructs re-counting "all three" places, sat directly over a
fourth one it did not know about. **A count in this register lives in as many places as someone
chose to write one.** Do not enumerate the places; the durable fix is to stop writing counts that a
later edit can invalidate — say "the fixes already made", not "the three already done".

★★ The honest framing meanwhile — and the previous two attempts at this sentence were both WRONG in
the same direction, each declaring a screen finished that was not. **Portfolio health** — the
cross-project table, a different screen — is the user-read surface that remains. The Trends card and
Trends view, named here in the previous revision, were fixed rather than deferred. Named, not
numbered: every ordinal that has lived in this sentence went stale within days.

★★★ THE LESSON THAT KEEPS COSTING: a claim of the form "every X on screen Y is now fixed" is a claim
about EVERY CONSUMER of a value, and it cannot be made from a diff. It was written twice from the
set of surfaces that had been CHANGED, which is the wrong set. Before writing it a third time, grep
every reader of `progress.percent`, `progress.inScope` and `pctComplete` and enumerate them.

★★ TRANSCRIPTION WARNING, learned here: the first draft of this entry cited
`ai-dashboard-snapshot.ts:92` as `completionPercent`. That file's key is `percent`;
`completionPercent` is the portfolio symbol above. The design spec had it right and the register
degraded it while copying. Nothing catches this — the AGENTS.md symbol gate reads AGENTS.md only,
never this file. Grep a symbol before citing it here.
★ And grep the RIGHT symbol before calling a cite DEAD: a 2026-08-05 audit flagged the
`ai-dashboard-snapshot.ts` cite above by searching for `completionPercent` — the exact wrong name
this warning exists to record — and reported the entry's correct cite as a defect.

---

## 65. A `Done` task with no `completedDate` shows the cross while its tooltip says "completed" — HALF CLOSED post-0.216.0

★ **HALF CLOSED post-0.216.0.** `computeTaskHealth`'s finished-task driver is now three-way —
`cancelled` (by status) / `completed` (by `isTaskDelivered`) / `closed` (neither) — so this pair
announces "closed" and no longer contradicts the ✕ beside it.

★★ **`isTaskDelivered` ALONE would not have fixed it.** A two-way split on delivery labels this row
"cancelled", which is a different false statement, not a fix. Cancelled is a STATUS; delivered is a
DATE; this pair is neither, so it needed its own driver and its own i18n key.

★★★ **THIS ENTRY HAS TWO PRESCRIPTIVE CLAUSES FOUR LINES APART, AND THREE SUCCESSIVE DRAFTS OF THIS
CLOSURE EACH READ ONLY ONE OF THEM.** The verdict below concerns the FIRST. The SECOND — "Fixing the
drivers fixes both" — is **WRONG**, and this slice proved it: the second symptom is gated on
`hasNoActiveScope` → `scopeCounts` → `isTaskOutOfScope`, which never consults a health driver, so no
driver change could ever have reached it. A draft that had just finished retracting an over-claim
about clause one then declared the whole entry "sound", never having read clause two. **Over-correction
is the same error as over-claiming: deciding the answer's shape, then reading only far enough to
confirm it.**

★★★ **CLAUSE ONE WAS RIGHT AND A DRAFT OF THIS CLOSURE SAID IT WAS WRONG.** It reads
"drivers should consult `completedDate`, **not `status` alone**" — that is *consult BOTH*, which is
exactly what the three-way does. The draft paraphrased it as "consult `completedDate` INSTEAD OF
`status`" and then refuted the paraphrase, in a closure block whose theme was other entries' faulty
prescriptions. **Slice 1 made this identical mistake one week earlier and had to retract it**
(see the §77/§78 provenance). Twice now: hunting for a pattern makes you find it where it is not.
What is fair to say is that the prescription is UNDERSPECIFIED — it does not say the split is
three-way, and the careless two-way reading of it is the trap. That is a much weaker claim, and it
is the true one. **Quote an entry before criticising it; a paraphrase you wrote is not evidence.**

★★ The second symptom this entry names is verified and **STILL OPEN**. The entry's complaint is about
the WORD: `dashboardAllCancelled` — "All cancelled ({0})" — is rendered about rows whose status says
Done. The COUNT is right (that work will not be delivered, so it is out of scope), but "cancelled" is
still the wrong word for a Done row, and BOTH `dashboard-panel.tsx` and
`dashboard-kpi-strip.tsx` still render it.
★★★ A draft of this bullet said "Only the tooltip was lying", having answered a complaint about the
count that the entry never made — while calling the symptom "verified" two clauses earlier, which
contradicts it. Same paraphrase-then-refute shape as the §66 block above. The tooltip was the half
worth fixing here; the naming half is below.

★★ **AND THIS SLICE ADDED TWO MORE SURFACES USING THAT WORD.** `GroupHealth.outOfScope` counts
`isTaskOutOfScope` = cancelled PLUS Done-with-no-date, and its new user-facing strings are
`dashboardOutOfScopeCount` ("Cancelled") and `reportsGroupOutOfScope` ("{0} cancelled"), with
`dashboardProgressCaption` saying "cancelled work is counted separately". So the engine calls that
row `closed` and the UI calls it "Cancelled", two tiles apart on one screen.
★ Recorded as a DECISION, not an oversight: `reports-stats.ts` already labelled the identical bucket
"cancelled" (`reportsCancelledCount`) before this slice, and `dashboardAllCancelled` predates it too,
so renaming only the two new strings would make one card disagree with itself. Renaming all four is a
UX call that should not ride in on a defect-closure slice. The Done-with-no-date pair is also not
producible through the UI — `migrateTask` leaves it alone, so it arrives only via an imported or
hand-edited blob. **Left as is, deliberately; the naming sweep is the open half.**

`isTaskDelivered` is `!!task.completedDate`, so a task whose status is `"Done"` but which carries no
completion date is CLOSED but not DELIVERED, and `TaskStatusGlyph` renders the muted ✕ where it used
to render the green ✓.

★★ The glyph is the correct half and is pinned by a test — `completedDate` is the field that answers
"was this delivered?", and there is no date to show. The STALE half is the tooltip:
`computeTaskHealth` derives its drivers from `status` (`health.ts:62-66`), so it still yields the
`completed` driver and the accessible name reads `"{colour}: completed"` while the glyph disagrees.

★★★ IT DOES **NOT** READ "Completed on {date}" — an earlier revision of this entry said it did, and
that is the one string the code provably never produces here. `task-row.tsx:354` picks the label with
`isTaskDelivered(task) ? t(lang, "completedOn", …) : formatHealthTooltip(health, lang)`, and
`isTaskDelivered` is `!!completedDate`, so for THIS pair the `completedOn` arm is unreachable — the
adjacent comment says the ternary exists precisely to avoid rendering "Completed on undefined". The
sibling claim in `task-status-glyph.test.tsx` was correct and the register degraded it in
transcription, the same failure the TRANSCRIPTION WARNING in §64 records.

★★ The same `status`-driven derivation makes ONE MORE string wrong, and it is not a tooltip:
`inScope` (`scopeCounts`, `dashboard.ts`) subtracts every task that is closed-but-not-delivered, so a project
made only of these rows renders `dashboardAllCancelled` — currently "All cancelled ({0})" — about
rows whose status says Done. Fixing the drivers fixes both; fixing only the tooltip leaves this.
★ Quoted by KEY with the value marked "currently", because the previous revision pinned the literal
"N tasks, all cancelled" and the value changed three commits later in the same branch. A register
entry that quotes a string verbatim acquires a maintenance obligation nothing enforces.

★ Reachability: AGENTS.md records that `migrateTask` deliberately does NOT repair a valid-but-
inconsistent status/`completedDate` pair — it short-circuits on a valid status — so the invariant is
held by the WRITERS, and an imported or hand-edited blob can carry the pair. Not producible through
the UI.

★ The fix belongs in the health engine (drivers should consult `completedDate`, not `status` alone),
which is why it was not folded into a presentation batch. Anything done here must keep the two
predicates distinct: `isTaskClosed` answers "will this be worked on again?", `isTaskDelivered`
answers "was it delivered?", and collapsing them is the defect 0.213.0 existed to remove.

---

## 66. ~~The R/A/G tile counts a cancelled task GREEN, one tile from the fix~~ — CLOSED post-0.216.0

★ **CLOSED post-0.216.0** by the second of the three options this entry listed: closed-but-never-
delivered work leaves the R/A/G tally and is counted in a sibling `GroupHealth.outOfScope`, rendered
as a fourth group on the dashboard tile and a trailing clause on each reports group card.

★ **The entry's stated blast radius was RIGHT.** It says the options "each ripple well past the
dashboard" — and they did: the reports group cards gained a cancelled clause, and their within-colour
sort silently became in-scope size rather than group size. Confirmed, not refuted.

★ Where the ripple STOPS is worth recording, because it is not obvious and the entry does not say:
it does not reach `overallComputed` (`dashboard.ts`). An out-of-scope task only ever incremented
`counts.G`, and the colour is `R > 0 ? "R" : A > 0 ? "A" : "G"` with G as the FALLBACK, so removing
G-only entries cannot change the result in any case. That is an argument, not a test — the
all-cancelled fixture returns "G" both before and after, so no fixture of that shape can pin it.

★★★ **A DRAFT OF THIS BLOCK SAID "THE STATED BLAST RADIUS WAS WRONG" AND ATTACHED THAT
`overallComputed` CLAUSE TO THE ENTRY AS IF THE ENTRY HAD WRITTEN IT.** The entry never mentions
`overallComputed` — reproduce with
`git show f9e17f9e:docs/open-followups.md | grep -c overallComputed` → **0**; every occurrence in
this file today is text the closure added. So the draft invented a claim, refuted it, and credited
the error to the entry. **§65 in this same file was corrected for the identical misquote-then-refute
in the identical commit that published the rule "quote the entry inline before criticising it."** The
retraction pass caught one instance and walked past the other, because it was looking for the §65
wording rather than the SHAPE. When you retract one instance of an error, grep for the shape.

★ The `healthOverride` clause this entry insisted on is preserved and is now load-bearing in a way
it was not before: the exclusion is guarded on `!task.healthOverride`, so a hand-pinned cancelled
row keeps its manual colour inside `counts`. The consequence is that the invariant is
`R + A + G + outOfScope === total`, NOT `=== inScope` — the two diverge by exactly the pinned rows.
Both halves are pinned by tests; `dashboardProgressCaption` was reworded, since it asserted the
opposite ("covers every task; closed work counts Green").

`computeGroupHealth` (`health.ts`) tallies `computeTaskHealth` per TASK, and that returns `"G"` for
anything `isTaskFinished` — Cancelled included. So the Dashboard's Progress `<Section>` renders, side
by side inside ONE card, "No active scope / All cancelled (2)" and "R 0 · A 0 · G 2".

★★ This is the cancelled-work batch's own premise, violated one tile away from where it was applied.
The whole reason `task-row.tsx` stopped showing the delivered green ✓ for a cancelled row is that
cancelled work must not wear the healthy/delivered signal — and the AGGREGATE of those same rows
still does. The only disclosure is the `text-xs` caption under the tiles
(`dashboardProgressCaption`).

★ The PARTIAL case is worse in kind, not better: 8 open + 2 cancelled shows two green counts mixed
into genuinely on-track work, with nothing distinguishing them.

★ Found by a cold reviewer asked to enumerate every renderer of a completion figure or cancelled
count. It is NOT §64 (that entry is about surfaces reading `0%`) and NOT §65 (the Done-without-date
pair), which is why it needed its own number rather than a bullet on either.

★★ Not fixed here because it is not a presentation-only change. `computeGroupHealth` and
`computeTaskHealth` feed group health across the app, so the options — a fourth bucket, excluding
cancelled from the tally, or a per-caller flag — each ripple well past the dashboard and want their
own decision. ★ Whatever is chosen must keep `isTaskClosed` and `isTaskDelivered` distinct, for the
same reason §65 says so.

★ `healthOverride` wins over the Green path (`computeTaskHealth` checks it first), so a cancelled
task pinned Red counts Red. The `dashboardProgressCaption` string says "unless its health was set by
hand" for exactly that reason — do not simplify that clause away.

---

## 67. ~~A committed NUL byte makes `use-portfolio-health.ts` invisible to content greps~~ — CLOSED post-0.216.0

★ **CLOSED post-0.216.0.** The raw `0x00` is now the source escape `\u0000`, so the runtime
character is byte-identical — still the one separator that cannot occur in a URL or a token — and
the file is text again.

★★★ **THE VERIFICATION COMMAND FIRST RECORDED HERE WAS FABRICATED.** It read: *"`grep -c
completionPercent` returned 'Binary file … matches' before and a count after."* `grep -c` prints a
COUNT in both states — `-c` suppresses the binary notice — so that command cannot distinguish them.
What actually happened is that two DIFFERENT commands were run, before and after, and written up as
one. The working check drops `-c`:
`git show f9e17f9e:src/app/use-portfolio-health.ts > /tmp/pre.ts; grep completionPercent /tmp/pre.ts`
→ `Binary file /tmp/pre.ts matches`, versus the matching line on the current file. **This is the
failure this whole register warns about, committed inside the entry about a guard that had to be seen
red before it could be trusted.** Run the command you are about to quote, in the state you claim it
was run.

★★ **This entry proposed the wrong fix and the reasoning it gave is why.** It weighed `|` and a space
and noted both are merely UNLIKELY to collide rather than unable to — then treated that as an
acceptable cost instead of a reason to look for a third option. The escape has neither cost. When an
entry records a drawback and accepts it anyway, check whether the drawback was avoidable.

★ A ratchet now guards recurrence: `src/app/no-nul-bytes.test.ts` takes its file list from
`git ls-files src docs` and checks every tracked `.ts`/`.tsx`/`.md`, failing on any NUL and naming
file and offset. It was written BEFORE the fix and verified red against
`use-portfolio-health.ts @ byte 2940` — a guard that has never been red is not known to work. It
filters by EXTENSION for the reason this entry already records: `src/app/favicon.ico` and
`docs/assets/dashboard.png` are TRACKED binaries holding NULs legitimately.

★★ **It asks git rather than walking the filesystem, because the first version's comment claimed a
CATEGORY while the code implemented an INSTANCE.** It skipped one hardcoded directory name
(`superpowers`) under the sentence "skips gitignored trees" — and `docs/patterns/` is also
gitignored and was being scanned, so a scratch file dropped there could redden the suite for a reason
unrelated to any commit, which is the exact failure the skip existed to prevent. Reproduce the gap
with `git status --porcelain --ignored=matching -- docs | grep '^!!'` → two entries, not one.
`git ls-files` makes "what gets COMMITTED" the literal definition instead of an approximation of it.

★ It also carries a POSITIVE CONTROL (`files.length > 500`, and that the list still contains
`use-portfolio-health.ts`). The real assertion is `toEqual([])`, which passes trivially if the file
list is ever empty — a bad regex, a cwd that is not the repo root. Without the control the guard can
scan nothing and report success.

★★★ **THE DOCS HALF EXISTS BECAUSE CLOSING THIS ENTRY PRODUCED TWO MORE NUL BYTES — IN THIS FILE.**
The scan started at `.ts`/`.tsx`, matching the sweep recorded above. Then writing the closure prose
put a raw `0x00` into `open-followups.md` twice: *the escape sequence, written as prose about the
escape sequence, collapsed into the byte it names.* Nothing would have caught it — the sweep this
entry declares DONE was source-only, and this register is the file in the repo most likely to be
grepped, so it is the worst one to silently read as binary. **A guard scoped to where a bug was last
seen is blind to where it is next written.** The scope was widened only because the failure recurred
during the fix; had it not, the narrow guard would have shipped looking complete.

Byte offset 2940 is a raw `0x00` inside a template literal — `` `${tursoConfig.httpUrl}\0${tursoConfig.authToken}` ``
— almost certainly the recorded Edit-tool corruption (see the memory note on NUL corruption). It is
PRE-EXISTING, not from the cancelled-work branch: present at `c5313d9f`, last touched by `909118b2`.

★★ It is benign at runtime — a NUL works as a cache-key separator exactly as a space would, which is
why nothing ever caught it — but ripgrep and grep classify the file as BINARY and print
`Binary file … matches` with no line content. So a content sweep silently SKIPS this file. That bit
a reviewer during the §64 work: the file holds `completionPercent`, one of the user-read surfaces
§64 depends on, and the grep that should have found it returned nothing usable.

★ Fix is one byte. ★ Pick the replacement deliberately: NUL is the one separator that CANNOT occur
in a URL or a token, so a printable stand-in (`|`, a space) is merely UNLIKELY to collide rather
than unable to. That is fine here — `configKey` is only a `useEffect` dep and is never sent anywhere
— but do not carry the swap to a key that is persisted or transmitted without re-checking it.
★ The reason to bother is not the runtime behaviour, it is that every future `grep -rn` over
`src/app` is quietly incomplete until it is done. ★ The repo-wide scan is DONE (2026-08-04): this is
the only tracked **`.ts`/`.tsx`** file containing a NUL, so the sweep half of this entry is closed.
★★ Say `.ts`/`.tsx`, not "under `src`" — `src/app/favicon.ico` is a tracked binary under `src` and
contains NULs legitimately, so the looser phrasing is FALSE. It was written that way for one command
and the sweep that was supposed to confirm it disproved it instead. Any future sweep must filter by
extension, or it reports binaries as findings.

---

## 68. The budget allocation rows' `border-t` sits on the `<tr>`, where it has never painted — open

`budget-panel.tsx`'s two allocation rows — the `<tr key={a.roleId}>` in the detailed/role branch and
the `<tr key={a.disciplineId}>` in the blended/discipline one — both render
`<tr className="border-t border-line">`. That border has never rendered. `globals.css:125`
`table:has(> .aipm-cockpit-thead)` sets **`border-collapse: separate`**, and CSS 2.2 §17.6.1 puts that
table in the separated-borders model, where "borders set on rows, row groups, columns and column
groups are ignored".

★ Note the direction: Tailwind's preflight sets `border-collapse: collapse` on every `<table>`
(Tailwind's own `node_modules/tailwindcss/preflight.css`, the `table { … border-collapse: collapse; }`
reset — a dependency file, never in this repo), under which a `<tr>` border WOULD paint. It is the
`globals.css` override that breaks it, and only for tables carrying `TABLE_HEAD_CLASS` / rendered through `DataTable` —
`globals.css:124` puts that at ~25 tables.

★★ **NOT budget-specific.** Sweeping `<tr …className=…border-…>` across `src/app/*.tsx` finds **8
occurrences in 6 files**, and all six render their tables through the marked shell: `budget-panel`
(×2) · `learning-insights` · `portfolio-health-panel` · `steering-committee-panel` (×2) ·
`timelog-people-table` · `timelog-projects-table`. Reproduce with
`grep -rn '<tr[^>]*className="[^"]*border-' src/app --include=*.tsx | grep -v "\.test\.tsx:"` —
deliberately no line numbers, because the first revision of this entry cited two that the very
commit writing it had already invalidated (it named `budget-panel.tsx:567`/`:599`; the rows had moved
to `:589`/`:621` before the commit landed, and they were `:654`/`:684` at its base). Only budget's two
were verified in a browser; the other six share the mechanism but were not individually confirmed.
★ `learning-insights.tsx:72` additionally sets an explicit `border-collapse` Tailwind utility on the
table, which reads as if it opts back into the collapsed model — it does not, because the
`globals.css` rule is UNLAYERED and therefore beats a layered utility whatever the specificity. That
class is misleading and should go with the fix.

★★ Verified in Chrome, not inferred: a `border-top` on a `<tr>` paints nothing AND adds nothing to
the row box (a row measured 30px at both `1px` and `2px`), while the same border on a `<td>` paints
and grows the box to 32px. A screenshot of the three-row repro shows exactly one rule — the `<td>`
one. So the allocation rows in every bucket table are, and always have been, separated by nothing but
their cell padding.

★ The Total-column work on `feat/ui-batch-five-fixes` (unversioned when this entry was written; it has
since shipped as **0.214.0 "Lostetter"** — 0.213.0 "McKillip" preceded it and contains no Total column;
§69 says the same about `branding.startLogo` and the two entries must not drift apart) hit this and
**worked around it rather than fixing it**:
`BucketTotalRow` (`budget-panel-totals.tsx`) passes a `cellClass` of `border-t-2 border-line` to each
of its cells and leaves the `<tr>` carrying only `font-medium`. A unit test pins that split, so the
total row's rule cannot regress onto the `<tr>`. The allocation rows were deliberately left alone.

★★ **Fixing this is a VISUAL change, not a bug fix, and needs sign-off.** Moving these borders to the
cells would give the tables in six panels row separators they have never had. That may well be what
each author intended, but nobody has seen those tables with the lines, and "restore the intended
styling" and "add row separators across six panels" are the same diff described two ways. Decide
which one is wanted before touching it. ★ If it IS wanted, the mechanism already exists (`cellClass` in
`budget-panel-totals.tsx`) — the work is agreeing the look, not finding the fix.

---

## 69. `BrandingConfig`'s "is this blob empty?" question is answered in TWO places — open

Adding a branding field means extending **two independent field lists**, and missing either is a
silent data-loss path rather than an error:

- `sanitizeBranding` (`settings-types.ts`) ends `return out.logo || out.slogan || out.footerSlogan ||
  out.favicon || out.startLogo ? out : undefined;`
- `AppearanceSection`'s `setBranding` (`settings-sections/appearance-section.tsx`) has its own
  `cleaned` gate over the same fields.

★★ This is not hypothetical — it bit on the FIRST addition. `branding.startLogo` (added on the
`feat/ui-batch-five-fixes` branch, unversioned when this entry was written; it has since shipped as
**0.214.0 "Lostetter"**) was added to the sanitizer arm and
its presence check, and the `setBranding` gate was missed. Two failure
modes followed, both silent: uploading ONLY a start logo wrote `branding: undefined`, so the upload
appeared to do nothing; and removing the sidebar logo while a start logo existed **destroyed the start
logo**. Caught in review, fixed in `876b8777`, and pinned by
`settings-sections/appearance-section.test.tsx` ("keeps the start logo when the sidebar logo is
removed").

★ What is pinned today is only the SECOND failure mode, for THIS field. There is no test that the two
lists agree, and there cannot easily be one — a TS interface has no runtime keys to walk, so a generic
"every `BrandingConfig` key appears in both gates" test would need a hand-maintained key array, which
is a third list to keep in step.

★ The fix, if wanted: export one `hasAnyBrandingField(cfg): boolean` from `settings-types.ts` and call
it from both sites, making the field list a single source of truth. Deliberately NOT done in the
five-fixes UI batch — it is a refactor of a shipped, tested path at the end of that batch, and
the slice that surfaced it had already fixed the live bug. ★ Until then, the AGENTS.md branding bullet
carries the lockstep note, which is prose, and prose here decays ungated.

---

## 70. A budget bucket's Total column and total row silently follow the role filter — open

`budget-panel.tsx` builds its per-bucket totals from `rowsForTotals`, which is whichever of
`detailedRows`/`blendedRows` applies — and BOTH come out of `filterSortAllocations(..., roleFilter,
roleSort)`, so both are already narrowed by the role filter. The CCI tiles rendered directly above
them read `br` (the `BucketReport` straight off the engine) and are NOT narrowed.

So with a role filter typed in, one card shows whole-bucket margin/burn/CPI/consumption above a Total
column and total row that are a subtotal of the matching roles only — and the label just says "Total",
with nothing on screen saying which of the two scopes it means.

★ Defensible as-is: a total of what you are looking at is the more useful reading for a filtered table,
and it is what every other filtered table in the app does. Recorded, deliberately NOT changed — the
alternative (an unfiltered total, or a "Total (filtered)" label) is a product decision, not a bug fix.
★ Untested either way: no test pins which scope those totals use, so a future edit could flip them to
the unfiltered list and nothing would fail.

---

## 71. A budget bucket evaluates `cellBudget` three times per (row, period) — open

`cellBudget` (`budget-panel.tsx`, a closure over `effectiveBudgetHours`) is the most expensive call in
the panel: it walks resources, absences, holidays and the budget-follows-plan mirroring rule. Every
`(allocation, period)` pair now evaluates it **three** times per render — once for the cell
(`HoursTd budget={cellBudget(a, p, periods)}`), once inside the row's `totBudget` reduce, and once more
inside `bucketColumnTotals`. Nothing memoizes any of them; they sit inside a `.map` over buckets where a
`useMemo` cannot easily go.

★ Two of the three pre-date this work — the cell and the row total have both called it since the RAG
row dot was added. The Total-column work on `feat/ui-batch-five-fixes` added the third, so it raised
the count by **50%**, it did not create the pattern.

★ Not measured. No profile exists and no gate covers render cost, so the impact is unknown; the
argument for fixing it is structural, not a benchmark. Buckets are typically a handful of allocations
by a handful of periods, so the absolute number is probably small.

★★ The real prize is not speed. Building the row×period matrix ONCE and deriving both the row totals
and the column totals from it would make "the two axes cannot disagree" a STRUCTURAL property. Today it
holds only by convention — `bucketColumnTotals` takes the caller's own `cellBudget` as `budgetOf`
precisely so the two agree, which works but relies on every future caller passing the same accessor.
★ A test pins the current agreement (`budget-panel.test.tsx`, the row-totals and total-row cases read
budget and actual off their own labelled lines), so a refactor has something to land against.

---

## 72. ~~Caller callbacks fire after unmount — the unit-tests job exits 1 with every test passing~~ — CLOSED in this slice

**Cited from:** `use-storage-backend.ts`, `use-storage-backend.test.tsx`, `use-scheduled-jobs.ts` — this entry cannot be deleted.

**The symptom is the point.** Vitest exits non-zero on an unhandled error even when the whole suite is
green, so this failure mode does not look like a test failure at all. Captured from pipeline **#5446**
on main `6dcee7eb` (the slice-1 merge, before 0.214.0) — a pipeline that failed while a pipeline on the
SAME sha, **#5441**, passed:

```
Test Files  778 passed (778)
     Tests  8792 passed (8792)
     Errors  1 error
ERROR: Job failed: exit code 1
```

★★★ **Do NOT grep such a trace for `FAIL` or `✗`** — there is nothing to find, and the reader concludes
the runner broke. Search for `Errors  N error` / `Unhandled Errors`.

**The trace:**

```
ReferenceError: window is not defined
 ❯ resolveUpdatePriority  react-dom-client.development.js
 ❯ requestUpdateLane
 ❯ dispatchSetState
 ❯ Object.onStorageOutcome  src/app/task-manager.tsx
 ❯                          src/app/use-storage-backend.ts
This error originated in "src/app/task-manager.editor-modal.test.tsx"
```

An async storage callback resolves AFTER the test file's jsdom environment has been torn down, so
React's own `setState` path reaches for a `window` that no longer exists.

★★ **THREE DISTINCT SIGNATURES NOW EXIST ON THIS ONE JOB.** Anyone diagnosing from "unit-tests failed"
alone will conflate them, and two of the three have already been mistaken for each other:

| entry | does a test fail? | duration | what the trace shows |
|---|---|---|---|
| §39 | yes | budget fully consumed (15,093 / 15,098 / 15,117 ms) | `waitFor` timed out — a toast that never arrives |
| §51 | yes | 38 ms | `getByRole`/`findByRole` miss — the modal was not in the DOM |
| §72 | **no — every test passes** | n/a | `Errors  1 error`, an unhandled `ReferenceError` after teardown |

**The fix.** A hook-scope `mountedRef` in `use-storage-backend.ts` plus four emitters — `emitOutcome`,
`emitToast`, `emitRegistryChange`, `emitStorageConfig` — as the single choke point every caller callback
now goes through. **33 direct call sites** (8 outcome + 23 toast + 1 registry + 1 config) plus **3
pass-through props** (2 × `showToast`, 1 × `setStorageConfig`) = 36 sites. Routing the pass-throughs
through the emitters extends the guard into `useTursoProjectOps` (`use-storage-turso-ops.ts`) and
`useFileProjectOps` (`use-storage-file-ops.ts`) at zero extra cost.

★ Reproduce commands rather than line numbers, because a line number can be invalidated by the very
commit that writes it:

```bash
grep -c 'args.showToast(' src/app/use-storage-backend.ts   # 1 = the emitToast body only
grep -c 'emitToast(' src/app/use-storage-backend.ts        # 24 = 23 sites + 1 declaration
```

★★ The trap in sweeping this: the four emitter BODIES necessarily contain `args.<callback>(`, so a
blanket find-and-replace rewrites them into infinite self-recursion. A residual sweep for
`args.showToast|args.onStorageOutcome|args.onRegistryChange|args.setStorageConfig` correctly returns
**four** lines — exactly the four emitter bodies — **not zero**. Any fifth hit is an unrouted call site.

★★★ **It must be a MOUNTED ref, not the load effect's per-run `cancelled` flag.** The save effect's
deps include the whole workspace, so it re-runs on every edit. A per-run flag would suppress the outcome
of a save merely SUPERSEDED while still in flight — silently swallowing real save failures in
production, with no banner and no toast. The load effect keeps its `cancelled`: a superseded *load*
genuinely is irrelevant, a superseded *save* is not.

★★ Pinned by **two** tests in `use-storage-backend.test.tsx`, and the second one is not redundant —
record the evidence, because a future reader will try to delete it. Under a deliberately-wrong per-run
implementation, the superseded-save test fails **while the unmount test still passes**. The unmount test
alone cannot distinguish the two implementations.

★ **Also required: the ref is re-set to `true` on mount, not merely cleared on unmount.** React
StrictMode mounts, unmounts and remounts in development; a cleanup-only guard would leave every callback
permanently suppressed after that first cycle.

★★★ **THAT LINE IS NOW PINNED — AND THE ENTRY PREVIOUSLY SAID IT COULD NEVER BE.** It read "the suite
structurally cannot see it": deleting `mountedRef.current = true` from the effect body left every gate
green, and a `<StrictMode>`-wrapped `renderHook` written to pin it was **VACUOUS**, on a 2026-08-04
probe measuring `["mount"]` — one invocation, no cleanup+remount. That measurement reproduces for one
wrapper shape only; in the right shape StrictMode double-invokes here normally. §85 (retracted) carries
the full rule and the retraction narrative — including the part that is easy to over-generalise, that it
turns on the PLACEMENT FLAG rather than on the tree or the commit number — and
`src/app/strictmode.meta.test.tsx` is the standing instrument and the normative copy.
The guard is `still emits a save outcome after StrictMode's remount`, in the
`useStorageBackend — StrictMode mount re-set (§72)` describe of `use-storage-backend.test.tsx`;
deleting the line fails it (`onStorageOutcome` is never called), verified by running that mutation and
recorded in the test's own comment. ★★ Note what this does NOT cover — the three
`refreshBackendStatus` guards are a different line of defence and remain UNPINNED. The
"NOTHING IN THE SUITE PINS THESE GUARDS" paragraph further down still stands; do not read this
mount-re-set guard as having closed it.
★ The consequence if the line is ever dropped is **dev-only and total**: after the first StrictMode
cycle in `npm run dev`, every toast, every storage banner and every `versionNotifyRef` version-history
checkpoint is silently suppressed for the rest of the session. ★ Until the guard above was written
that happened with a fully green suite, which is why this sat alongside the CSS landmines of §68-§71
as a real behaviour the unit suite cannot observe. It turned out to be observable, so that comparison
no longer holds for this line. Found by a cold reviewer naming the one-line mutation; verified by
running it.

**Residual (still open):**
★★★ **THE CHOKE POINT IS COMPLETE FOR *CALLER CALLBACKS*, NOT FOR THE *MECHANISM* — do not read
"single choke point" as "post-unmount `setState` is handled in this hook".** It is not. The same
`dispatchSetState → requestUpdateLane → resolveUpdatePriority → window` shape, with a different top
frame, still exists at every one of these, all **surveyed and deliberately left**:

- ~~`refreshBackendStatus`'s own `setStorageReady` / `setStorageDescription`~~ — **NOW GUARDED.**
  **THREE** guards cover all four setters — the two in the `catch` share one, and neither follows an
  await of its own (they follow `logDiag`). Don't grep for four and conclude one was dropped. This
  was the last
  escape in the hook that could surface as an UNHANDLED REJECTION rather than a discarded update,
  so it is the one that actually reproduced §72's signature; the rest below are silent no-ops in a
  browser. ★ `logDiag` stays OUTSIDE the guard on purpose — a status check that fails during
  teardown is still worth recording, and that placement is what makes the fix observable at all
  (see below). ★ Mounted-scoped is unambiguously right here, unlike the save outcome: this is the
  hook's OWN state, so no caller is waiting on a superseded run's result.
  ★★ **A DIFFERENT RACE REMAINS AND THIS DOES NOT ADDRESS IT** — two overlapping refreshes can
  still land out of order, letting an older `isReady()` overwrite a newer status. That needs a
  per-run sequence token, not a mounted flag. Not attempted; out of §72's scope.
- `applyWorkspace`'s **24** workspace-context setters after awaits (`use-storage-backend.ts:203-226`).
  ★★ Count them BY EYE. There is no honest one-liner: `grep -cE "^\s+set[A-Z]" src/app/use-storage-backend.ts`
  returns **34** (it sweeps the whole file — type declarations, `refreshBackendStatus`, `onOpenStorageFile`,
  the return object), and scoping it to the block —
  `sed -n '203,226p' src/app/use-storage-backend.ts | grep -cE "^\s+set[A-Z]"` — returns **23**, because
  `setPlan` (`:211`) sits behind an `if (workspace.plan)` prefix and the anchored pattern cannot see it.
  An earlier revision here quoted the unscoped command with the scoped command's output. In
  `use-storage-turso-ops.ts` and
  `use-storage-file-ops.ts`; likewise `setTursoProjectId`, and `setTasks`/`setRaid` in
  `onOpenStorageFile`.
- `args.setActivityLog`, handed to `useBroadcastSync`, which owns its own listener lifecycle and
  cleanup. Guarding it needs a different design.

★★★ **THREE OF THOSE ARE UNPROTECTED, NOT ONE — and an earlier revision of this bullet named the wrong
one and credited the wrong mechanism.** It said "the load effect's `cancelled` shields its own instances
by accident. The one that does not is `onGrantWriteAccess`". Both halves are false, and the two reviewers
who caught it did so independently.

★★★ **THE LINE NUMBERS IN THIS TABLE ARE PRE-FIX AND ARE NOW ALL 16 TOO LOW — kept deliberately, as
the record of what was wrong.** The fix inserted 16 lines (12 comment + 3 guards + 1 blank) above the
old `:251`, so every citation below that point shifted. Current `refreshBackendStatus` call sites are
**275 · 290 · 297 · 319 · 459 · 470 · 500 · 716**; the load effect is **269-324**. ★★ This is the
`file:line`-invalidated-by-its-own-commit trap in its purest form — one sentence further down cited
`:443/:484/:700`, was written BY the fixing commit, and was false the moment it landed. Prefer
function names to line numbers here; where a number is unavoidable, re-derive it with
`grep -n "refreshBackendStatus()" src/app/use-storage-backend.ts` after any edit to that file.

What the code said at the time (the load effect was `use-storage-backend.ts:253-308`; the last row is
outside it):

| `await refreshBackendStatus()` | protected? | by what |
|---|---|---|
| `:259` — the `suppressNextLoadRef` branch | **NO** | before the `try`; no `cancelled` check on that path at all |
| `:274` (the data-loss REFUSAL early return) and `:281` (the success path) | yes | the **enclosing `try`**, whose `catch` opens `if (cancelled) return;` — NOT `cancelled` reaching them |
| `:303` — last statement of the `catch` | **NO** | inside the `catch`, therefore outside any `try`; `cancelled` was checked at `:284`, *before* this await |
| `onGrantWriteAccess` `:454` | **NO** | a bare await on a floating promise |

★★ The escape is a DOUBLE throw, which is why an inner `try`/`catch` does not stop it:
`setStorageReady(ready)` (`:241`) throws, `refreshBackendStatus`'s own `catch` (`:244`) then runs
`setStorageReady(false)` (`:248`) — inside the catch, outside any `try` — and *that* throw leaves the
function. ★ The two load-effect escapes are the HOTTER pair, but they are reached DIFFERENTLY and a repro
written for one will not reach the other: `:303` needs a rejecting `backend.load()` (staged by many
existing tests), while `:259` returns at `:260` **before `backend.load()` is ever called** and needs
`suppressNextLoadRef.current === true`. `onGrantWriteAccess` needs a user click. Scoping the follow-up to
`onGrantWriteAccess` alone would leave the hook's hottest path — the one the original CI crash came
from — still exposed. ★ Secondary damage on the way past: the first throw is swallowed into
`logDiag("warn", "storage.statusCheckFailed", …)`, filing a React teardown error as a storage fault.

★★ **ALL THREE ROWS ARE NOW CLOSED BY ONE GUARD** — the fix lands in `refreshBackendStatus` ITSELF,
not at the three call sites, so the other five — `onPickStorageFile`, `onOpenStorageFile`,
`reloadCurrentProject`, and the load effect's data-loss-refusal and success paths — are covered too,
and no future call site can reopen it. (`onGrantWriteAccess` is one of the three escapes, not one of
these five.) The table above is kept as the RECORD of what was wrong, not as an open list.

★★★ **NOTHING IN THE SUITE PINS THESE GUARDS — DELETING ALL THREE LEAVES EVERY GATE GREEN.**
Measured: with the three `if (!mountedRef.current) return;` lines removed,
`use-storage-backend.test.tsx` passes **69/69, EXIT=0** (2026-08-05, after the
`useStorageBackend — StrictMode mount re-set (§72)` describe was added — that guard pins
`mountedRef.current = true` in the mount effect body, not these three `refreshBackendStatus` guards, and
nothing else added since targets them either). So a future contributor who sees the four emitters
already guarded, decides these are redundant and deletes them, reintroduces §72's unhandled
rejection with a green suite, a green tsc, a green lint and this row struck through as CLOSED.
That is the single most likely way this regresses. These three remain unpinned; re-run the deletion
rather than trusting this number if the file has grown further since.

★★★ **AND AN EARLIER REVISION OF THIS BULLET CLAIMED THE OPPOSITE — the distinction is between an
EXPERIMENT and an ARTIFACT.** The guard's purpose (stopping a post-teardown `setStorageReady` from
throwing) cannot be staged: React 19 discards a post-unmount setState silently and the throw needs a
torn-down jsdom. But `logDiag` sits ahead of the guard in the `catch`, so a test that rejects
`isReady()` AFTER unmount and asserts the warn still lands **fails when the `logDiag` call is moved
below the guard** — and it can only fail if the guard fired. That reasoning is sound, and it is what
the shipped test does NOT do: it never re-runs that mutation, so it demonstrates the guard was live
*once, on my machine*, and pins nothing thereafter. ★ The generalisable trap: "I proved X with a
mutation" and "the suite pins X" are different claims, and a comment asserting the second while
having only done the first is how a guard gets deleted later. A cold reviewer caught this one; the
mutation that settled it took ninety seconds.

★★★ **Honesty note — and the obvious reason is the WRONG one.** An earlier revision of this entry said
production impact is near-zero because "`task-manager` is the root orchestrator and effectively never
unmounts". **That is false.** `page.tsx` wraps `<TaskManager />` in an `ErrorBoundary` whose `render`
returns the fallback *instead of* its children, so any thrown render error anywhere in the tree unmounts
the whole subtree. Next 16 also defaults `reactStrictMode` to true, so every dev mount is
mount→unmount→remount.

The impact is near-zero for a different and stronger reason: **in a browser these calls were already
no-ops.** React 19 does not throw on `setState`-after-unmount while `window` exists — it schedules the
update and discards it. The throw is specific to a torn-down jsdom. So suppressing them changes nothing
observable in production *even on the path that really does unmount*. ★ Durable side effects are
ordered BEFORE the emitters and survive regardless: `commitRegistry` calls `saveRegistry(next)` before
`emitRegistryChange(next)`, `recordDataLossEvent` precedes its refusal toast, and `logDiag` sits outside
the guard. ★★ **Do NOT extend that to the file-ops path** — an earlier revision here said it "calls
`writeSettings(...)` directly", which is true at only TWO of its config-commit sites
(`use-storage-file-ops.ts:235` and `:294`, both immediately before a `window.location.reload()`).
the OTHER **four** commits go through `deps.setStorageConfig` — the now-guarded emitter — with no direct
durable write behind them: `switchToProject` (`:96`), `createProject` (`:150`), and the default paths of
`loadProjectFromFile` (`:221`) and `createDemoProject` (`:305`). ★ Read that as four, not two: the two
`writeSettings` calls are in CONDITIONAL branches of the latter two functions
(`switchPortfolioToFileOnSuccess`, `loadPortfolioMode() === "turso"`), so those functions appear on BOTH
lists and an enumeration naming only the first two understates the exposure by half. No persistence is
lost on any of the four, but for the reason given above (an unmounted `setSettings` was already discarded
by React), NOT because a `writeSettings` backstop exists. A reader who takes the old sentence at face
value will assume a durable write on those paths that is not there.

The value of this fix is a CI job that stops exiting 1 with a fully green suite; do not read it as a
user-facing bug fix.

★ One more true thing worth recording: `onStorageOutcome` does more than `setState`.
`reportStorageOutcome` (`task-manager.tsx`) also calls `versionNotifyRef.current()` on a clean save,
arming the version-history idle checkpoint. Suppressing the callback after unmount skips that too —
inert only because the whole tree goes down together.

---

## 73. ~~`onTestFailed` reports post-teardown state, so any capture it makes is a false witness~~ — CLOSED

Found while instrumenting §39 and §51. This is repo-wide, not specific to those two tests.

Vitest runs `onTestFailed` **after** all `afterEach` hooks. `afterEach` runs LIFO, so the real order is:
describe-scoped `afterEach` → the test file's own `afterEach` (e.g. `vi.clearAllMocks()`) → the setup
file's `afterEach` (RTL `cleanup()`, `vitest.setup.ts`) → **`onTestFailed` last**, against zeroed mocks
and an empty `document.body`.

★★★ **Measured, not theorised.** A capture written per the obvious pattern printed
`{"fetchCalls":0,"toastCalls":[],"refreshButtonPresent":false,…}` on a run where the fetch HAD been
called once and the error toast HAD fired. It would have reported "the click was swallowed" — **falsely
CONFIRMING the already-suspected §39 hypothesis with fabricated evidence.** That is strictly worse than
no capture at all: a capture that agrees with your prior is the one you stop checking.

**The working pattern** — a describe-scoped `afterEach` guarded on the task result, holding a closure the
test body assigns. Registered last ⇒ runs first ⇒ mocks and DOM are still live:

```ts
let captureOnFailure: (() => void) | undefined;
afterEach((ctx) => {
  const capture = captureOnFailure;
  captureOnFailure = undefined;
  if (ctx.task.result?.state === "fail") capture?.();
});
```

Used by the §39 capture (`timelog-panel.test.tsx`) and the §51 capture (`use-tasks-dedup.test.tsx`),
both merged in the machine-unblocking slice-2 MR (`!346`). ★ An earlier revision said "on this branch",
which stopped being true the moment that branch merged — a relative reference in a long-lived register
decays silently. Name the MR or the commit.

**Scope:** this affects **any** test in this repo that would inspect DOM or mock state from
`onTestFailed` or `onTestFinished`, because the setup file's `cleanup()` always wins the race.
`onTestFailed` is used **nowhere** in `src` or `e2e` — it was tried here, found unusable, and replaced
by the `afterEach` pattern shown above, so the hook has no call site in this repo at all. ★ The three mentions
a grep finds today (two in `timelog-panel.test.tsx`, one in `use-tasks-dedup.test.tsx`) are the warning
comments those files now carry, not calls. (An earlier revision said "these captures are the first use",
contradicting its own next sentence and this entry's whole conclusion.)

★ ~~Worth a line in AGENTS.md eventually; **not added there yet**, so this entry is the only record.~~
**SUPERSEDED by the paragraph directly below — it WAS added.** Struck rather than deleted because two
independent reviewers flagged this line, both reading it as the file's live answer and taking away the
opposite of the truth. Elsewhere this file marks a disproven claim explicitly ("**This entry was
wrong.**"); leaving one unmarked directly above the paragraph that disproves it makes the convention
look optional.

★★★ **CLOSED — the landmine now lives in AGENTS.md's `npm run test:run` command block**, so it reaches
every session automatically rather than requiring a targeted open of this file. It records the same
LIFO ordering, the same measured `{"fetchCalls":0,…}` fabricated-evidence example, and the same working
`afterEach`-closure pattern, citing `timelog-panel.test.tsx` and `use-tasks-dedup.test.tsx`.

★ **`agents-symbol-check`'s only anchor for the name `onTestFailed` is the three warning COMMENTS** —
two in `timelog-panel.test.tsx`, one in `use-tasks-dedup.test.tsx` — confirmed still present. There is
no call site anywhere in `src`/`scripts`/`e2e`: the gate proves only that the NAME `onTestFailed`
resolves somewhere in the repo, and today it resolves solely because those comments exist. A future
comment cleanup that removed all three (e.g. "dead warning, nobody would try this again") would delete
the gate's only anchor for the name and fail `docs:symbols:check` — not because the trap stopped being
true, but because the one place recording it in code was gone. Keep at least one comment naming
`onTestFailed` alive, or move the citation into an allowlisted absence marker if the comments are ever
pruned.

---

## 74. ~~The TimeLog refresh handlers omit a guard their button carries~~ — CLOSED

**Cited from:** `timelog-guards.ts`, `timelog-panel.tsx` — this entry cannot be deleted.

`handleRefreshBookings` and `handleFetchBookings` (`timelog-panel.tsx`) each open with an early return,
and neither includes `isMisconfigured` — while the corresponding buttons in `timelog-panel-toolbar.tsx`
both do:

| | handler guard | button `disabled` |
|---|---|---|
| Refresh | `isPopout \|\| sync.busy \|\| confirming \|\| !canRefresh` | the same four **plus `isMisconfigured`** |
| Fetch | `isPopout \|\| sync.busy \|\| confirming \|\| projectCustomerId === "" \|\| selectedProjectIds.size === 0` | the same five **plus `isMisconfigured`** |

`isMisconfigured` is `!cfg.enabled || !cfg.host || !cfg.apiToken`. So any **non-button** caller — a voice
command, a keyboard shortcut, a future Action-Center CTA — would act against an unconfigured TimeLog.
Today the button is the only caller of each, so it is latent, not live.

★ **This asymmetry is what made §39 possible.** The test compensated for the product code's split
instead of the product code resolving it: the fix there waits for the button to become enabled, which
works precisely because the button carries a guard the handler does not. **Read §39 as "test fixed", not
"cause removed."**

★ The cheap fix is to lift `isMisconfigured` into both handler guards, making the button's `disabled`
a presentation of the handler's contract rather than a second, stricter contract.

★★★ **FIXED — went structural instead of the cheap lift.** A shared pure module
`src/app/timelog-guards.ts` exports `canFetchBookings` / `canRefreshBookings` /
`canLoadManagedProjects` / `canClearAllFetched`, and BOTH the handlers' early returns and the buttons'
`disabled` expressions evaluate the same predicate. The two-copy lift was rejected deliberately: it
leaves two copies of one contract — the shape that produced this defect — while a pure predicate is
unit-testable regardless of what renders it. Predicates were verified logically equivalent to the
buttons' PREVIOUS `disabled` expressions, so no button changed behaviour in any state; the handlers
gained the terms they lacked. `isMisconfigured` is declared once directly below `cfg`, above every
reader (readability only — both handlers are hoisted `function` declarations invoked from `onClick`,
so the earlier placement was never a TDZ hazard, whatever a previous comment here implied).

★★★ **`canClearAllFetched` deliberately does NOT take `isMisconfigured`,** and takes its own
`TimelogClearState` so the omission is visible in the type rather than reading as a fifth oversight.
Clearing is the only one of the four actions that never reaches the network — it forgets local data the
user already has — and a broken config is exactly when someone wants stale bookings gone. Gating it
would trap them with data they can neither refresh nor remove.

★★★ **THE CLOSURE WAS DECLARED THREE TIMES BEFORE IT WAS TRUE: 2-of-3 → 3-of-3 → 3-of-4.** Each time,
every instance the author had looked at was fixed. `handleLoadManagedProjects` (a third file, whose
button spelled out `isBlocked` by hand) and then `clearAllFetched` (one arm mirrored, with a comment
saying it mirrored the button) turned up in successive reviews. **The durable rule is not another sweep
of the same shape: enumerate the CALL SITES of the contract and close them as a set** —
`grep -n 'disabled={' src/app/timelog-panel-toolbar.tsx src/app/timelog-projects-table.tsx`, diffing
each against its handler.

★★ **ALL FOUR BUTTON WIRINGS ARE PINNED, each by a SINGLE-SITE mutation** (`timelog-panel.test.tsx`,
describe "action buttons while TimeLog is unconfigured"):

| wiring | arm pinned | mutation that must fail a test |
|---|---|---|
| Fetch (`timelog-panel-toolbar.tsx`) | `isMisconfigured` | `isMisconfigured: false` |
| Refresh (same file) | `isMisconfigured` | `isMisconfigured: false` |
| Load-managed (`timelog-projects-table.tsx`) | `isMisconfigured` | `isMisconfigured: false` |
| Clear-all (`timelog-panel-toolbar.tsx`) | `hasFetched` | `hasFetched: true` |

★★★ **Mutate ONE site at a time.** An earlier revision claimed the button half was pinned on the
strength of a mutation that changed two sites at once — whose failure was fully explained by one of
them, and said nothing about the other. A mutation spanning two call sites cannot attribute the failure
to either.

★★★ **Write "not done", never "cannot be done", unless the impossibility has itself been tested.** A
revision here claimed Fetch "cannot be pinned from the DOM" because the picker renders under
`!isPopout && !isMisconfigured`. The picker's RENDERING is gated; its STATE is not —
`useTimelogPickerScope` runs unconditionally and seeds the customer + selection from the persisted
picker scope or `timelogLinks` (`timelog-initial-scope.ts` ranks 1 and 2), neither of which reads
`isMisconfigured`. A device that lost its token mounts in exactly that state. **Converting a missing
test into a documented impossibility is worse than the gap: the gap invites a fix, the impossibility
forbids one.** Two independent reviewers caught it.

★ The Fetch/Refresh fixture seeds `links={{customerId, projectIds}}` with NO config, so the selection
exists and `isMisconfigured` is the only remaining blocker. Its query is anchored on the full label
(`^<timelogSync> \(1\)$`): the ` (N)` suffix appears only when `selectedCount > 0`, so the match
proves the seed took and the assertion cannot pass vacuously off an empty selection. Keep it anchored —
a bare `/\(1\)$/` would multi-match any future counted button, and a plain exact-name query stops
resolving the moment a selection exists.

★★ Coverage: 4 of 4 predicates unit-tested; 4 of 4 button wirings DOM-pinned; each wiring pins the ONE
arm that was the defect, so `isPopout` / `syncBusy` / `confirming` remain unpinned at every site.

**Residual (still open):**
★★★ **The HANDLER guards are still unpinned, and that half really is hard.** No test fails if
`isMisconfigured` is dropped from any of the three handlers carrying it. `timelog-guards.test.ts` calls
the predicates directly and never imports `timelog-panel.tsx`; `timelog-panel.test.tsx` reaches the
handlers only through a button, and every such test waits for ENABLED first, because a disabled button
drops `onClick`. Since the buttons now carry the same terms, "handler invoked while misconfigured" is
unreachable from a DOM suite. ★ Shape for real coverage: invoke the handler directly (or exercise the
predicate at the handler's own call site, with the handler's actual argument construction) with
`isMisconfigured: true` and everything else permissive, asserting `sync.fetchBookingsForProjects` is
NOT called. ★ Do not read the green suite as verifying that closure — it verified only that nothing
already passing broke.

★ Test totals are deliberately not written here — reproduce with
`grep -cE '^\s+it\(' src/app/timelog-panel.test.tsx src/app/timelog-guards.test.ts`. A hardcoded count
in this entry went stale twice inside this branch.

---

## 75. ~~Two test files contain ORDER-DEPENDENT tests — and there is a REPRODUCING SEED~~ — CLOSED

**Cited from:** `modern-shell.test.tsx`, `use-storage-backend.test.tsx` — this entry cannot be deleted.

★★ **This is the artifact the §39/§51 flake hunt was looking for, attached to different tests.** Both
of those flakes are load-sensitive and have never reproduced on demand; this one reproduces
deterministically:

```bash
npx vitest run --sequence.shuffle --sequence.seed=1 --reporter=dot
```

**4 tests fail across 2 files** — `modern-shell.test.tsx` (3) and `use-storage-backend.test.tsx` (1,
"confirm=true writes current workspace to new backend + commits config + shows info toast", where
`expect(targetSave).toHaveBeenCalledTimes(1)` gets 0). Seeds 2 and 3 also fail, 4 and 5 tests
respectively — ★ but treat those two counts as soft: those same two runs had 16 files never execute
(768 of 784) from worker-startup timeouts under machine saturation, as §51's amplification note records.
Seed 1 is the clean, fully-executed reproduction; quote that one.

★★★ **PRE-EXISTING, and verified so rather than assumed.** `use-storage-backend.ts` and its test were
both modified by the §72 work, which makes "did we break this?" the first question. Ruled out by
running the SAME seed on `main`: identical result — 4 failed / 2 files, the same named test. The §72
guard adds no module-level state (`mountedRef` is per-hook-instance via `useRef`), and the failing
assertion is a `backend.save` call count, upstream of every emitter.

★★★ **THE DEFECT IS INTRA-FILE TEST ORDERING, NOT CROSS-FILE CONTAMINATION — an earlier revision of
this entry said the opposite and would have sent the next contributor hunting the wrong thing.** It
claimed "`--sequence.shuffle` shuffles **files**, not tests within a file (`sequence.shuffle.tests`
defaults false); both files pass in isolation, so the contamination is cross-file". Both halves are
wrong, and the second was derived from the first.

★★ The citations below are into **hash-named build artifacts** and were read at **vitest 4.1.8 /
@vitest/runner 4.1.8**. The `coverage.DM_a_rWm.js` filename dies on any vitest bump and every line number
dies on a patch release — re-derive by grepping `shuffle` in `node_modules/vitest/dist/chunks/` and
`node_modules/@vitest/runner/dist/` rather than trusting these positions.

The `.tests` default governs only the **object** form. The bare CLI flag this entry prescribes parses to
boolean `true`, and `vitest/dist/chunks/coverage.DM_a_rWm.js:470` gates the object branch on
`typeof … === "object"` — so for a boolean it is SKIPPED, `sequence.shuffle` stays `true`, and BOTH
effects fire: `:477` picks `RandomSequencer` (files) **and** `@vitest/runner/dist/chunk-artifact.js:2442`
sets `file.shuffle`, which `:3151` uses to shuffle suites and tests **inside** each file.

Measured, not reasoned — each file run ALONE under the same seed:

```bash
npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1  # 1 failed / 62 passed
npx vitest run src/app/modern-shell.test.tsx        --sequence.shuffle --sequence.seed=1  # 3 failed / 17 passed
npx vitest run src/app/use-storage-backend.test.tsx src/app/modern-shell.test.tsx         # control: 83 passed
```

1 + 3 = **the same 4 failures the full-suite run produces**, with no other file present. So the whole
effect is intra-file, the unshuffled control rules out the pairing itself, and "passes in isolation" was
true only because it was measured WITHOUT the flag — a control that cannot distinguish the two
hypotheses it was cited to settle. ★ Chase these as order-dependent tests within each file (shared
module state, a leaked mock, a `beforeAll` some earlier test in the file relies on), not as cross-file
leakage.

★ Scope this honestly: nothing says CI shuffles, so this is **not** a live CI failure and **not** an
explanation for §39 or §51 (neither of those two files failed under any of the six amplification
configurations). It is a latent test-isolation defect that a deterministic seed makes cheap to chase —
which is rare enough in this register to be worth its own entry.

★★ **Do not confuse this with `--no-isolate`.** Those runs produced 22–82 failures each and prove
nothing: most of this suite is not written to share a module registry, so removing isolation is
expected to fail broadly. The shuffle result is the informative one precisely because isolation stays on.

★★★ **FIXED — both mechanisms, NAMED, and they are two different bugs.**

★★★ **SCOPE THE SECOND FIX HONESTLY: it closes `createBackend`, NOT the once-queue class.** The
storage fix below drains exactly ONE of the file's six module-level mocks. `mockBackend` is a
module-level const (`use-storage-backend.test.tsx:103`) that is never rebuilt, and eight further
describes queue once-values on `mockBackend.load` / `isReady` / `describe` / `save` — 60 `Once(` calls
across the file against 2 `mockReset()` calls — with no drain anywhere. (★ 60 is the FILE-WIDE count;
38 of those are on `mockBackend`, the other 22 on `createBackendMock`. ★ "one of six" is loose too: six
is the number of `vi.mock()` factories, `createBackend` is one function inside the `./storage` one, and
`mockBackend` is not a member of that set at all. The precise statement is: the drain covers
`createBackend` and nothing else.)

★★ **A first version of this paragraph claimed "Every one of them re-establishes its default with
`.mockResolvedValue(...)`". That is false for FIVE of the eight** — `load effect`,
`reloadCurrentProject`, `id-minter`, `Layer 3 wipe guard` and `Layer B` re-arm only `createBackend` in
their `beforeEach` and otherwise rely on the declaration-time defaults at `use-storage-backend.test.tsx:103`.
The conclusion survives (a standing default does not out-rank a queued once-value either) but the
premise was checkable and wrong — and it makes the hazard slightly WORSE than stated, since in those
five a leaked once-value goes straight into the next test's mount with nothing re-arming over it.

★ This is a LATENT hazard, not a known live leak: read statically each
queued value looks consumed by a mount or an explicit reload, and the suite passes shuffled at seeds
1/2/3/7. But nothing structurally prevents the next test added to any of those describes from
reopening the exact defect this entry closes. ★★ The comment in the test file states the general fact
("`clearAllMocks` does NOT drain a `mockReturnValueOnce` queue — only `mockReset` does") beside a
remedy applied to one mock, which reads as though the general fact had been generally handled.
★★★ **DO NOT reach for `mockReset: true` in `vitest.config.ts` — an earlier revision of this entry
recommended it as "the cheap structural close" and it is a SUITE-BREAKER.** The justification given
("every `beforeEach` in the file already re-establishes its own defaults, so nothing depends on values
surviving a test") is false: `mockBackend`'s methods are built as `vi.fn().mockResolvedValue(...)` at
DECLARATION (`use-storage-backend.test.tsx:103`), the implementation is not an argument to `vi.fn()`,
and the five describes named above depend on exactly that surviving. `mockReset` returns such a mock to
a noop yielding `undefined`, so `load()` / `isReady()` / `describe()` would resolve `undefined`
suite-wide. Recording an untried remedy as "cheap" is precisely the failure this register exists to
prevent — a later reader adopts it on the entry's authority. Closing the class properly would first
require moving those declaration-time defaults into every `beforeEach`.
★ Related and separate: the `project flows` describe sets a PERSISTENT `.mockReturnValue(targetBackend)`
that survives `clearAllMocks` into later describes. Harmless today only because every subsequent
describe re-arms `createBackend` in its own `beforeEach` — do not let anyone "simplify" one of those
re-arms away.

- `modern-shell.test.tsx`: `stubViewport` assigned `window.matchMedia` **directly**
  (`window.matchMedia = vi.fn()...`). A plain property write is invisible to `vi.clearAllMocks()` and
  `vi.restoreAllMocks()` (neither touches a non-mock property), and jsdom ships no `matchMedia` for
  anything to restore it to — so the first mobile-drawer test pinned the whole file to a narrow
  viewport for the rest of the run, and `ModernShell` rendered the off-canvas drawer instead of the
  in-flow sidebar for every later test. Now stubbed via `vi.stubGlobal` and undone by a describe-scoped
  `afterEach(() => vi.unstubAllGlobals())`, which deletes the property rather than setting it to
  `undefined`.
  ★★ It stayed invisible in DECLARATION order only by **coincidence, not because the drawer describe is
  last — it is third of five** ("settings slot" and "banners slot" both follow it). That describe's
  final test happens to stub `matches: false`, the wide-viewport value the two trailing describes need
  anyway. Adding or reordering a test inside the drawer describe would have broken them with no shuffle
  flag involved. The fix's first comment claimed "the drawer describe is last"; that was false, and a
  follow-up commit corrected it. **The correction is recorded, not silently overwritten** — this file's
  own convention (see the intra-file/cross-file correction above) is to keep a disproven claim visible
  as the instructive artifact rather than launder it out.
- `use-storage-backend.test.tsx`: `vi.clearAllMocks()` is `mockClear` — it wipes calls/instances/results
  and does **not** drain a `mockReturnValueOnce` queue; only `mockReset` does. Three tests in the
  `onRequestStorageSwitch` describe queue two `createBackend` return values and consume only one (the
  early return under test **is** the assertion), so a leftover queued value survived into whichever test
  ran next and shifted its queue by one: the switch target came back as the main backend, the main
  backend as the switch target, and `targetSave` was never called.
  ★★ The first fix drained the queue in `beforeEach` only, which is **one-directional**: it makes
  intra-describe ordering safe but does nothing for whichever test `--sequence.shuffle` happens to
  schedule LAST in that describe, whose leftover then carries into whichever describe runs next (a
  plain `.mockReturnValue` default does not out-rank a queued once-value). This gap was flagged by a
  code-quality reviewer reading the code alone, before it was connected to any failing seed. A follow-up
  commit added the same `mockReset()` drain to the describe's `afterEach`, and moved the
  `vi.resetAllMocks()`-vs-`mockReset()` rationale out of the commit message and into the test file's own
  comment.
  ★★★ **That reviewer's prediction is now empirically PROVEN, not just theoretically plausible.** The
  `beforeEach`-only drain leaves `Layer 3 wipe guard (persistence choke point) > refuses to persist a
  MULTI-collection simultaneous wipe (bug signature)` failing at `--sequence.seed=7` — the leftover
  once-value from `onRequestStorageSwitch`'s last-scheduled test survives past that describe's
  `beforeEach`-only drain and leaks into the wipe-guard describe's first `createBackend()` call:

  | tree state | seed 7, `use-storage-backend.test.tsx` alone |
  |---|---|
  | no drain at all (`2d7db4e3`) | **FAIL** — `Layer 3 wipe guard … MULTI-collection simultaneous wipe` |
  | `beforeEach` drain only (`55143042`) | **FAIL**, 2 runs of 2 |
  | `beforeEach` + `afterEach` drains (`e0064815` onward) | **PASS**, 3 runs of 3 |

  This was first filed as a separate, mechanism-unknown defect (§84) before being re-measured against
  the wrong baseline and closed as the same leak. See §84 for the full account and the transferable
  lesson about measuring against a partially-fixed tree.

★ The measured block above (`1 failed / 62 passed`) is historical: an unrelated §72 test later grew
that file's total, so the same bug would read `1 failed / 63 passed` today. Left as measured.

★★★ **The gate.** `unit-tests-shuffled` (BLOCKING quality-stage job) runs the full unit suite at
`--sequence.shuffle --sequence.seed=1` — the seed that reproduces both leaks above — so a red run is
REPRODUCIBLE. ★★ It does NOT follow that "only a real regression can turn it red": the seed pins the
PRNG, not the permutation, which is over the CURRENT test array — so adding or removing any test
anywhere reshuffles, and an MR can go red by newly exposing a PRE-EXISTING latent (the undrained
`*Once()` queues below are exactly such latents). Read a red run as "an order dependence exists
somewhere in the suite", not "this MR caused it". Its `needs` is `[install, {job: unit-tests,
artifacts: false}]`: the dependency edge is there deliberately, because no other quality-stage job
depends on `unit-tests` and without it GitLab would run this job concurrently with `unit-tests` — two
full vitest processes contending for one runner's CPU, the same class of resource contention as the
documented full-suite parallel-load worker-starvation flakes (AGENTS.md's `npm run test:run` note;
§51's amplification note). `artifacts: false` keeps the serialisation without downloading
`unit-tests`'s coverage/junit artifacts, which this job never reads. A weekly-`schedule`-only
`unit-tests-shuffled-random` (`allow_failure: true`) samples the class instead of pinning one point of
it: its seed is `$CI_PIPELINE_ID`, echoed alongside the exact local reproduce command. ★ `$RANDOM` was
rejected as the seed source because it is a bash builtin and the runner shell is not guaranteed to be
bash. ★ The echo line **must stay single-quoted in YAML** — written unquoted, its embedded `": "`
parses as a YAML mapping rather than a plain string and GitLab rejects the job at config-parse time;
that bug shipped in the first version of the job and was caught only by parsing the file with a YAML
library and printing the parsed `script` array, not by eye.

★ **Prerequisite met — and re-measured at the branch tip:** the full suite passes shuffled at seed 1,
all files, exit 0. **Reproduce with `npm run test:shuffle`** (added in this slice — it pins the same
seed CI's `unit-tests-shuffled` uses, so a red gate is reproducible locally in one command).

★★★ **NO TEST TOTAL IS WRITTEN HERE — the number went stale THREE TIMES inside this one branch**
(8959 → 8966 → 8971, each correction written by someone who had just finished a paragraph about stale
counts, each invalidated by the next commit). The lesson is not "be more careful"; three careful
attempts failed. **A count of something the branch is actively changing cannot be maintained in prose.**
★★ Related and separate: the first prerequisite measurement was taken at the commit that ADDED the
gate, then three more commits landed. **A prerequisite for a BLOCKING gate must be re-taken at the tip**
— every later commit invalidates it and CI cannot notice, because the gate has not run yet.

★★ **Scope, honestly.** This was never a live CI failure — nothing in CI shuffled before this slice.
From these commits forward it is gated at **seed 1 only**; a new order-dependent test that only fails
at some other seed still reaches `main`, and is caught, at best, by the weekly random-seed job.

★★★ **Do NOT read this closure as "these two files are now order-independent" as a general property —
only as "verified at the seeds tested."** Seeds 1, 2, 3, 7 and the unshuffled control all pass on both
files today, and seed 7 in particular is now confirmed to be the SAME `use-storage-backend.test.tsx`
mechanism above rather than a third one (§84, closed, was filed as a separate defect and found to be
this one, measured on a tree with only the `beforeEach` half of this fix). Nothing was tested beyond that finite set of seeds.

---

## 76. ~~Two hooks have a CLEANUP-ONLY `mountedRef` — dev-only total suppression~~ — CLOSED post-!346

**Cited from:** `use-scheduled-jobs.ts`, `use-operating-guides.ts` — this entry cannot be deleted.

★★★ **This is the exact defect §72's `use-storage-backend.ts` guard was written to avoid, sitting
unfixed in two sibling hooks.** Both declare the ref and then clear it in a cleanup WITHOUT re-setting
it on mount:

```ts
const mountedRef = useRef(true);
useEffect(() => () => { mountedRef.current = false; }, []);   // ← no `mountedRef.current = true;`
```

- `use-scheduled-jobs.ts` — the ref gates `setReady`, `setBusy` and `setJobs`, plus an early return
  inside `refresh` and the guarded setters inside `mutate`.
- `use-operating-guides.ts` — the ref gates `setGuides` and `setReady`, plus an early return inside its
  refresh path. (`setBusy` there is genuinely unguarded; the asymmetry with the file above is real, not
  a copy-paste slip.)

★★★ **These were LINE CITATIONS and the fix invalidated every one of them.** The original read
`use-scheduled-jobs.ts:47,52 — gates setReady (:62), setBusy (:71, :80, :81) and setJobs(next) (:76),
plus an early return at :57`. Inserting the mount effect pushed 12 lines into one file and 9 into the
other, above every cited site: `setReady` moved `:62`→`:74`, `setBusy` `:71`/`:80`/`:81`→`:83`/`:92`/
`:93`, `setJobs` `:76`→`:70`/`:88`, the early return `:57`→`:69`, and guides' `setReady` `:92`→`:101`.
Only the two `useRef` declarations still resolved. Most stale numbers pointed at a real line holding
unrelated code — a comment, a `} catch {`, a `}, []);` — so nothing looked broken. ★★ Two did NOT, and
they are the more dangerous kind: old `:62` now holds `mountedRef.current = true` (the line the FIX
added — the most related line in the file, so the citation reads as freshly correct) and old `:81`
holds `const mutate = useCallback(`. A stale citation that lands on plausible code is unfalsifiable by
skim. **Cite the SYMBOL, not the line, for anything in the file the commit is editing.** This is the third recorded instance of
a `file:line` being invalidated by the very commit that wrote it.

★★ **Consequence is dev-only and TOTAL.** Next 16 defaults `reactStrictMode: true`, so every dev mount
is mount→unmount→remount; after that first cycle `mountedRef.current` is permanently `false` and every
one of those setters is suppressed for the rest of the session.

★★★ **OBSERVED, not reasoned — and the symptom this entry claimed was WRONG.** Measured 2026-08-05 in a
real `next dev` server (isolated `PORT=3100`), with a temporary probe in the mount effect and in
`refresh`, driving the Settings → Scheduled jobs section through Playwright. Pre-fix shape (the mount
re-set deleted, everything else identical):

```
mount-effect run          ← first mount
mount-effect cleanup      ← StrictMode unmount: mountedRef = false
mount-effect run          ← remount; nothing restores the flag
refresh resolved, mountedRef=false jobs=1     ← the data DID load
(no "setJobs APPLIED")                        ← the setter is suppressed
```

With the shipped fix, the same run reads `mountedRef=true` followed by `setJobs APPLIED`. So the defect
and the fix are now both observed, on the real surface, not inferred from the code.

★★★ **The claimed symptom — "the scheduled-jobs surface never leaves its loading state" — is FALSE, and
survived three review rounds.** `useScheduledJobs` returns `ready`, and NEITHER consumer reads it, so
no loading state is driven by that flag at all. Reproduce: `grep -rn "useScheduledJobs" src/`.

There are **TWO** consumers, and the more serious symptom is the invisible one:

| consumer | reads | dev symptom pre-fix |
|---|---|---|
| `settings-sections/scheduled-jobs-section.tsx` | `jobs, busy, createJob, updateJob, deleteJob` | the job LIST renders empty — a user sees "no scheduled jobs" |
| `use-ai-orchestration.ts` | `jobs`, `recordRun` → `useScheduledJobRunner` | the runner sees a permanently empty list, so **NO SCHEDULED JOB EVER FIRES**, silently |

★ `useOperatingGuides` is a third case again: its `ready` IS consumed, reaching `chat-panel.tsx` as
`guidesPending = ai.groundInGuides && !guidesReady`, which blocks send and disables the composer — so
its symptom is the AI chat composer, and only when "ground in guides" is on.
★ "The section renders EMPTY" is loose and worth not copying forward: the section still renders its
title, help text, master toggle and Add button. It is the job LIST that is empty.

★★★ **Why three rounds missed it, and why the FIRST correction still got it wrong.** Every reviewer
verified that the SETTERS were guarded — a question about the hook. Nobody traced the flag OUT of the
hook to a render. **A claim about a symptom is a claim about a consumer — check the consumer, not the
producer.** ★★★ That sentence was written while checking exactly ONE of the two consumers, and the
correction asserted "its ONLY consumer". One `grep -rn "useScheduledJobs" src/` would have caught it.
Stating the lesson is not the same as applying it: when the claim is "the consumers do X", the
enumeration of consumers IS the claim, so grep it before writing the word "only". Production is unaffected (one mount, no remount) — and so, for as long as this went unnoticed, was
the entire test suite, which is why it survived: **a fully green suite said nothing about it**, exactly
as it said nothing about §72's own re-set line. All three are pinned now — the two guards listed below,
and §72's own line in its entry; §85 records why the "untestable" premise was wrong.

★★ **FIXED.** Both effects now re-set the flag as their first statement, identical to
`use-storage-backend.ts`. ★ Placement matters and is recorded in both files: the guard effect is
declared BEFORE the `refresh` effect that consumes it, so on a StrictMode remount React restores the
flag before re-running the effect that calls the guarded setters. Reordering them silently reinstates
the bug.

★★★ **IT SHIPPED UNTESTED, AND THAT WALL TURNED OUT NOT TO EXIST — BOTH RE-SETS ARE NOW PINNED.**
This entry previously said a StrictMode-wrapped test was necessarily VACUOUS here, on the strength of
a measurement of `["mount"]` (no cleanup+remount). That measurement reproduces only for one wrapper
shape; in the right shape StrictMode double-invokes here normally, and the entry's conclusion is
retracted in §85, which carries the full rule and the retraction narrative (`src/app/strictmode.meta.test.tsx` is the normative copy) and
names `src/app/strictmode.meta.test.tsx` as the standing instrument. The two guards:

| re-set | guard test |
|---|---|
| `use-scheduled-jobs.ts` | `still applies the loaded jobs after StrictMode's remount` (`use-scheduled-jobs.test.tsx`) |
| `use-operating-guides.ts` | `still applies the loaded guides after StrictMode's remount` (`use-operating-guides.test.tsx`) |

Each was proved by deleting the `mountedRef.current = true` line it pins and confirming that test goes
red, then restoring; each test's comment records that mutation and the failure it produces. ★ The
pre-existing tests across the two hooks pass unchanged, which confirms no regression and — as this
entry correctly said before — pins nothing about this fix on its own.
★ Production was never affected (one mount, no remount), so there is no user-facing behaviour change
and no version bump — this is a dev-experience fix.

★★★ **THE SWEEP REGEX THIS ENTRY FIRST DOCUMENTED COULD NOT MATCH THE DEFECT IT SWEPT FOR.** It read
`grep -rnE "return \(\) => \{ *[a-zA-Z]+Ref\.current = false" src/app/` → "exactly three hits", which is
the right answer TODAY. Against the pre-fix tree it returns ONE — `use-storage-backend.ts:179`, already
in block form from §72 — so the only file it finds is the one that was never a §76 defect, and it
misses both real instances. Those were written in the concise arrow-returning-arrow form,
`useEffect(() => () => { mountedRef.current = false; }, []);`, which contains no `return () => {` at
all: the pattern only matched the BLOCK form the FIX introduced. **A sweep pattern must be run against
the tree where the defect existed, not the tree where it is fixed** — otherwise "the sweep is complete"
is a statement about your own diff.

★ The form that covers both, validated in BOTH directions:
`grep -rnE "=> *\{? *[a-zA-Z]+Ref\.current = false" src/app/` (add `4a81420a --` after `git grep -nE` to
run it against the base tree). At base it finds the concise form in the two §76 files plus the block
form in `use-storage-backend`; at HEAD, the three block forms. It returns FOUR hits at both revisions —
the extra is `use-push-to-talk.ts` `pressingRef`, a pointer-press flag, not a mount guard. That is the
cost of matching a SHAPE rather than a name; cross-check with `grep -rn "mountedRef = useRef" src/app/`
→ three, all re-set on mount.

★★ Two successive revisions of the evidence above were wrong ("returns ZERO"; "the concise form in all
three files"), both asserted rather than run, in the entry whose own rule is to run the sweep. The
conclusion never changed; only the numbers offered for it did. Run the commands.

★ Found by the cold reviewer of the §72 `refreshBackendStatus` guard, when asked whether any sibling
had the same shape — a question worth asking of every guard fix.

---

## 77. ~~The snapshot capture gate is a one-way latch, so a mid-session storage switch can still capture the wrong project~~ — CLOSED post-0.226.0

`use-storage-backend.ts` publishes `workspaceLoaded`, set `true` at the end of `applyWorkspace` and
**never set back to `false`**. `useSnapshots` gates auto-capture on it (as `workspaceReady`), which
closes the boot race that made every auto snapshot record an empty project. It does not close the
same race at a *later* trigger.

`backend` is memoized on `settings.storageConfig`, and the load effect keys on `[backend, hydrated]`.
So pointing Settings at a different backend mid-session re-runs the load while `workspaceLoaded` is
still `true` from the previous one. If that switch also makes `tursoConfig` non-null, `trendsActive`
flips, the capture effect re-fires, and it captures the OLD project's tasks/budgets into the NEW
project's current bucket — which `hasCurrent` then permanently claims. **Worse than the boot bug it
sits beside:** the captured numbers are non-null and plausible, so nothing looks broken.

★ **Pre-existing, not a regression.** Before the gate there was no check at all, so this path was
already wrong; the fix narrowed the bug rather than introducing it.

★★ **The two obvious fixes are both wrong**, which is why this stayed deferred for a release.
(a) `setWorkspaceLoaded(false)` at the top of the load effect strands the flag `false` forever on the
`suppressNextLoadRef` early-return path — the one project switches take — silently disabling capture
for the rest of the session. (b) Resetting it anywhere in state loses the race anyway: both effects
run in the SAME commit, and the capture effect reads the `workspaceReady` of the render it was
scheduled from, so a reset lands one render too late.

### What closed it

The flag is no longer a flag. State `loadedBackend` holds the backend the applied workspace came
from, and the published boolean is **derived in render**: `loadedBackend !== null && loadedBackend
=== backend`. Staleness became an inequality nobody has to remember to clear. The returned key is
unchanged, so no consumer moved.

★★ **This beats objection (b) rather than dodging it.** A state *reset* lands a render late; a
render-*derived* value does not exist a render late — the same render that produces the new `backend`
produces `workspaceLoaded === false`, and `useStorageBackend` is registered before `useSnapshots`, so
capture never sees the stale value. The ref+state design this entry originally prescribed was not
needed. Deriving in render was also forced by `react-hooks/set-state-in-effect` being fatal here.

★★★ **Objection (a) is REAL and nearly shipped, reached by a different route.** The plain identity
change reproduces it exactly. `applyWorkspace` is a plain render-scope function, so it stamps
`loadedBackend` with the backend in the CURRENT render's closure — then the op flips
`storageConfig`/`tursoProjectId`, the memo rebuilds, and the load effect early-returns on the suppress
branch **without ever calling `applyWorkspace` again**. Gate stranded closed for the session. The
close therefore also **re-stamps `setLoadedBackend(backend)` inside the suppress branch**. Reproduce
the arm sites with `grep -rn "suppressNextLoadRef.current = true" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`
— **seven**, not six: six ops call `applyWorkspace` shortly BEFORE their set (five of the six on the
immediately preceding line; `switchToProject` has two comment lines between, so do not grep for
adjacency), and `onRequestStorageSwitch` instead SAVES the live workspace to the target.

★★ So the invariant is **"render scope holds the workspace that BELONGS to this backend"**, not "a
workspace from this backend was loaded" — `onRequestStorageSwitch` never loads anything, yet scope
holds exactly the right data. The narrower wording reads as a lie on that route and invites someone
to delete the re-stamp.

★★ **Two tests, pinning opposite halves; neither alone covers BOTH.** Test 1 (a bare backend change
CLOSES the gate) does catch this entry's original defect on its own — under the old latch it fails.
Test 2 (a *suppressed* change RE-OPENS it) catches the regression the fix nearly introduced.
Mutation-checked: deleting the re-stamp kills only test 2.
★ Test 2 drives `onRequestStorageSwitch`, because `suppressNextLoadRef` is passed to the ops hooks as
a dep and is NOT on the hook's return object — a test cannot arm it directly. ★★ Note what that does
NOT cover: `onRequestStorageSwitch` is the one arm site of seven that never calls `applyWorkspace`,
i.e. the one where the stale-stamp mechanism does not literally occur. The six ops that DO have that
mechanism have no test. The paths converge observationally, so the fix generalises — but do not read
test 2 as covering the six.

★★ **The gate now depends on the `backend` memo being identity-stable across renders**, which nothing
enforces. It holds today (`acquireToken` is `useCallback(…, [])`; `storageConfig` identity must
already be stable or the load effect would loop). ★ The hazard is a fresh **`settings.storageConfig`**
per render — NOT a fresh `settings`, which is harmless, since the memo keys on the nested field and an
ordinary `{...settings}` carries the same reference. An earlier revision named the harmless one.

★ **Deliberately NOT re-stamped:** the load effect's other two early-returns (the empty-load
data-loss guard and the `catch`). A cold review read the guard as a regression; it is not. If the
backend did not change the gate never closed, and if it did, the workspace the guard kept belongs to
the PREVIOUS backend — so a shut gate is exactly right.

★ **Residual, unreached:** the re-stamp is unconditional, so a *stale armed* ref would now open the
gate rather than leaving it shut. ★ That is fail-open versus the **un-re-stamped intermediate version**
(which never shipped), NOT versus the old code — the old one-way latch failed open too, which is this
entry's whole subject. An earlier revision said "where the old code failed closed", contradicting the
opening paragraph. All seven arm sites are followed by a memo-invalidating change, so it was not
reachable on inspection.

---

## 78. A brand-new Turso project auto-captures an empty snapshot, and that row becomes the BASELINE — HALF CLOSED post-0.226.0, partial-KPI half OPEN

`use-storage-turso-ops.ts` `createTursoProject` calls `applyWorkspace(ws)` with a fresh empty
workspace and `setTursoProjectId(id)` in the same batch. `workspaceReady` (§77) is legitimately
`true` — a workspace *was* applied, there is just nothing in it — so the capture effect re-fires on
the changed `projectId`, finds `history.length === 0`, and takes the `isFirstEver` branch in
`use-snapshots.ts`: it writes a row with null `remainingHours`/`remainingCost`/`spi`/`cpi` **and
`isBaseline: true`**.

`hasCurrent` then claims that cadence bucket permanently. Create a project on Monday, populate it on
Tuesday, and that week is stuck at the empty capture — and because the empty row is the *baseline*,
every later variance row compares against nulls forever, not just that one week.

★ Pre-existing, and `workspaceReady` is behaving correctly by its own definition: it answers "has a
load landed", not "is this project worth snapshotting". It was NOT overloaded to close this — that
flag's contract is what makes §77's reasoning tractable.

### What closed it

Pure `hasCapturableContent(input)` in `snapshot.ts` — true when the project has at least one task, at
least one milestone, or a non-null `model.burndown` — consulted by the auto-capture effect, which
declines the write entirely.

★★★ **Gating `isFirstEver` would NOT have closed this — the gate has to be on the CAPTURE.**
`pickBaseline` falls back to the EARLIEST row when none carries `isBaseline`, so the empty capture
would still have been the baseline, and `hasCurrent` would still have claimed the bucket, costing that
period its real numbers regardless of the flag.
★★ **This entry offered BOTH options and the second one was right** — the deleted text read *"gate
`isFirstEver` (or the auto-capture itself) on the workspace having content"*. The wrong half is what
got copied into the `use-snapshots.ts` doc comment, which named ONLY `isFirstEver`; that comment has
been corrected. A draft of this closure claimed "the entry's own prescription was wrong" — it was not,
and that sentence was itself a new falsehood written inside a correction. Check what the entry
actually said before crediting it with an error.

★★ It asks the question of the **INPUT**, not the built record, because an output-shaped test would
refuse to snapshot a project with real scope but no budget yet.
★ Be precise about which KPIs and why: `remainingHours`/`remainingCost` derive from `model.burndown`,
which is non-null iff `budgets.length > 0` (`dashboard.ts`). `spi`/`cpi` do NOT — `computeEvm` reads
task `originalEstimateMinutes`/`timeSpentMinutes`, no budget involved. An earlier revision attributed
all four to the missing budget bucket; that is true of two.

★ `captureNow` / `rebaselineNow` stay **ungated** — a manual capture is an explicit user act, and this
entry is about the automatic one. They make the identical bucket claim, so an empty manual capture is
reachable and allowed by design.

★★★ **STILL OPEN, and this entry named it first: a project with one task and no budget still
auto-captures a partial-KPI row, and that row still becomes the baseline.** The deleted text warned
that *"a naive `tasks.length > 0` test would still baseline a snapshot with no SPI/CPI"* —
`hasCapturableContent` IS that naive test. What closed is the ALL-null empty-project case (the
`createTursoProject` shape); the partial-KPI case is unchanged. A draft of this closure recast the
original objection as a different one and declared it answered — it is not. Whether it SHOULD be
closed is a real question, not an oversight: a project with scope but no budget genuinely is in that
state, so baselining it may be correct. Decide deliberately; do not assume §78 covered it.

★★ **Residual, accepted:** nothing re-arms the declined bucket. The effect's deps are `[active,
workspaceReady, cadence, currentBucket, args.projectId]` and adding the project's first task changes none
of them, so a project created Monday and populated Tuesday has no auto row for that first period
until a reload, a project switch, or a bucket rollover (which captures the NEW bucket, not the missed
one). Strictly better than the bug — the bucket is not CLAIMED, so nothing is poisoned and the first
real capture correctly becomes the baseline. Adding `tasks.length` as a dep would close it at the cost
of re-running the effect on every task edit.

★ **"Permanently" throughout this entry means "until a user deletes the row".** `useSnapshots` exports
`deleteSnapshot`/`deleteSnapshots`, so a claimed bucket IS recoverable — the harm is that nothing
prompts anyone to look, and a poisoned baseline silently skews every variance row until they do. The
absolute wording is inherited from the original entry; it overstates by one step.

---

## 79. The lane engine resolves a person by name but ignores `assigneeEmail`; the backfill prefers email — open

`task-kanban.ts` `laneResourceIdOf` resolves an FK-less task to a resource by **name** only.
`backfillTaskResourceFks` (`resource-foundation.ts`) prefers **email**, then falls back to name. So a
task carrying an email but no usable name and no FK — the Jira-import shape — gets its own lane until
the next load stamps its FK, then merges.

★ Narrow and self-healing (a reload fixes it), which is why it is recorded rather than fixed. The
asymmetry is worth knowing about before someone "aligns" the two: the backfill's email pass exists
because it is the *definite* identifier, and the lane engine has no email in hand at that point
without threading one more field through.

---

## 80. ~~Both hide-external toggles trust whatever `readDeviceJson` returns~~ — CLOSED

`resources-panel.tsx` and `resource-directory.tsx` each seed their toggle with
`readDeviceJson<boolean>(key, false)`, and `device-store.ts` documents explicitly that the parsed
value is returned **as-is** with shape validation left to the caller. Neither caller validates. A
stored `"true"`, `1` or `{}` — from a hand-edited localStorage, or a future writer that stores a
different shape under the same key — becomes a truthy `hideExternal` and lands on `aria-pressed` as a
non-boolean.

★ Pre-existing in the directory; the resources-panel copy (added when its toggle was made persistent)
inherited the same shape deliberately, to match precedent rather than diverge from it. `=== true` at
both read sites closes both.

★ CLOSED in review follow-up: both sites now read `readDeviceJson<unknown>(key, false) === true`. The
type argument was changed to `unknown` on purpose — leaving `<boolean>` there would keep asserting a
shape nothing checks, which is what made this survive review in the first place. BOTH sites are
pinned, by a "treats a non-boolean stored value as off" test apiece (`resources-panel.test.tsx` and
`resource-directory.test.tsx`) — an earlier close-out fixed both and pinned only one, which is how a
site silently regresses while the entry reads CLOSED.

---

## 81. ~~The swimlane no-op drop guard no longer holds for a name-resolved task~~ — CLOSED

`use-task-row-handlers.ts` `onSwimlaneDrop` documents "A drop that changes nothing writes nothing and
records no undo entry", enforced by `sameLane`, which compares `prevRow.resourceId ?? undefined`
against the lane's `resourceId`. Since the lane engine started resolving a free-string assignee to a
resource, a task in a name-resolved lane has `prevRow.resourceId === undefined` while the lane carries
a real id — so `sameLane` is `false` and dropping a card back onto **its own cell** writes, stamps
`localModifiedAt`, and pushes an undo entry.

★ The write itself is harmless-to-good: it stamps the FK the lane already implies, which is the repair
`backfillTaskResourceFks` performs at load. The defect is the promise — the comment claims an
invariant the code no longer has, and a spurious undo entry is a real (if small) cost.

★ Fix is either direction: compare against the RESOLVED id rather than the stored one, or narrow the
comment to say a lane-repairing drop is a deliberate exception.

★ CLOSED in review follow-up, taking the FIRST direction. `task-kanban.ts` now exports `laneKeyOf`
(the same resolution `groupByStatusAndPerson` performs) and the guard asks it, so the question is
"does this card already display in this cell" rather than "does its stored FK match". ★★ The
harmlessness assessment above was too generous and is why this was nearly left open: the write also
armed the AUTOSAVE, so an accidental drag that landed where it started cost a network round trip on a
Turso backend and a spurious undo entry. ★ Deliberate consequence: a self-drop no longer
opportunistically rewrites a stale `assignee` cache to the live directory spelling — a drag is not a
rename tool, and the load-time backfill owns that repair. Pinned by
`use-task-row-handlers.test.ts` "dropping a card back on its own cell", with two controls (status-only
change, and a real lane change) so the guard cannot pass by swallowing everything; mutation-verified
against the old comparison.

★★★ THE FIRST ATTEMPT AT THIS FIX BROKE THE ASSIGN CONTROL, and a cold review caught it before commit.
`onSwimlaneDrop` is not drag-only: `tasks-section.tsx` `onAssignFromCard` routes the per-card assignee
`<select>` through it with the task's CURRENT status. That select is controlled on `task.resourceId`
(`task-kanban-card.tsx`), so the very row this whole fix is about — free-string assignee, no FK —
displays "Unassigned" while its card sits in the person's lane. Picking that person is the repair, and
a "does it already DISPLAY here" test answers yes, swallows the write, and lets the controlled select
snap straight back. An inert control, no feedback, forever. ★★ The handler now takes a
`source: "drag" | "assign"` and picks the no-op test from the CALLER'S INTENT — the same
inspect-intent-not-state rule `resolveEntitySave` follows for the id-mint race, and for the same
reason: the two situations are indistinguishable from the row alone. Both paths still fall through to
ONE write, so keyboard and mouse cannot diverge. ★ The three original tests could not catch this:
two are controls that pass under both old and new code, and none exercised the assign path.

---

## 82. The task-FK backfill lives in a React hook, outside the numbered migration chain — open

`backfillTaskResourceFks` runs from `applyWorkspace` (`use-storage-backend.ts`) and
`applyRestoredWorkspace` (`task-manager.tsx`), not from `migrateWorkspaceV*`. That placement is
correct for *reach* — the chain misses CSV, Markdown and the Turso relational tables entirely, and no
migration has ever back-filled `Task.resourceId` for a project that already has a directory (v9 covers
absence/raid/shift only; v5 stamps task FKs but only inside `if (resources.length === 0)`).

The cost is that it is a **permanent normalisation pass**, not a one-shot migration: it re-runs on
every load. Any path that legitimately produces a name without an FK — a Jira/CSV re-import, an AI
write, a bulk edit that clears only `resourceId` — is silently re-linked next load, and there is no way
to express "this task names a person who is deliberately NOT the same-named directory resource".

★ A `migrateWorkspaceV11` invoked from the load funnel would make the one-shot intent explicit while
keeping the reach. Not done here: the version-stamp plumbing is a bigger change than the fix warranted,
and the idempotent pass is harmless for every shape encountered so far.

★★ There are now **two** load funnels and a third would silently miss the backfill. They are listed in
the function's own doc comment — keep that list current.

★★ Both funnels are now pinned, and the second one was NOT until a review audit found it:
`applyRestoredWorkspace` had zero tests of any kind, so deleting its backfill call — leaving a bare
`setTasks(w.tasks ?? [])` — kept the whole suite green while a version restore silently reverted a
project's task FKs to the broken pre-repair shape. Covered by
`task-manager.restore-backfill.test.tsx` (mutation-verified). A third funnel needs its own file; a
per-funnel test is the only thing that catches this class, because the engine's own unit tests pass
either way.

---

## 83. Email/name disagreement in the FK backfill resolves silently to email — open

`backfillTaskResourceFks` poisons an *ambiguous* key (one owned by two resources) to `null` in both
its email and name indexes, so it refuses to guess between namesakes. It does not treat a
**disagreement** the same way: when an unambiguous email resolves to resource A and an unambiguous
name resolves to resource B, email wins with no signal.

★ Defensible — an address is a stronger identifier than a cached display name, which goes stale after
a rename — and it is the documented precedence. Recorded because the module's stated bar is "never
guess", and this is the one case where it picks a side rather than declining. Very low frequency: it
needs a task whose stored email and stored name point at two different live directory rows.

---


---

## 84. ~~A THIRD order-dependent test in `use-storage-backend.test.tsx` — different mechanism from §75~~ — CLOSED, FALSE: same mechanism, measured on a partially-fixed tree

**This entry was wrong.** It was filed as a third, different-mechanism order dependence with root cause
unknown, on the strength of two independent observations of seed 7 failing
(`useStorageBackend — Layer 3 wipe guard (persistence choke point) > refuses to persist a MULTI-collection
simultaneous wipe (bug signature)`, `expected "vi.fn()" to be called with arguments: ['info',
StringContaining{…}] — Number of calls: 0`, reproducing alone under
`npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=7`). Both
observations were real. Both were taken on a tree that had only §75's `beforeEach` drain
(`55143042`) — never on a tree with no fix at all, and never on the tree with BOTH drains
(`e0064815`/HEAD). Re-measured three ways after this entry was written:

| tree state | seed 7, `use-storage-backend.test.tsx` alone |
|---|---|
| `2d7db4e3` (no drain at all) | **FAIL** — `Layer 3 wipe guard … MULTI-collection simultaneous wipe` |
| `55143042` (`beforeEach` drain only) | **FAIL**, 2 runs of 2 |
| `f993e5ae` onward (`beforeEach` + `afterEach` drains) | **PASS**, 3 runs of 3 |

So this was never a third, separate defect. It **is** §75's second mechanism — the undrained
`mockReturnValueOnce` queue — escaping the `onRequestStorageSwitch` describe's boundary: under
`--sequence.shuffle`, seed 7 schedules one of that describe's leftover-producing tests LAST within the
describe, and with only a `beforeEach` drain that leftover once-value survives into the very next
describe to run, "Layer 3 wipe guard". Its own `beforeEach` calls `vi.clearAllMocks()` (which does not
drain a once-queue) then `mockReturnValue(mockBackend)` — a plain default, which does **not** out-rank a
queued once-value. So the wipe-guard test's `renderBackend()` call receives whichever backend leaked in
from the prior describe instead of `mockBackend`, its `load` mock never resolves the seeded
two-collection workspace, `prevCollectionCountRef` never baselines at 2, the wipe condition
(`curCollections === 0 && prevCollectionCountRef.current >= 2`) never evaluates true, and `showToast`
is correctly never called — "Number of calls: 0" is the leaked-backend symptom, not a separate bug.
`e0064815`'s `afterEach` drain (added for exactly the reason recorded in §75) closes this too, which the
table above confirms directly rather than by re-deriving the mechanism.

★★★ **The transferable lesson, which is why this entry stays instead of being deleted — this file's
convention is that a wrong claim stays visible as the instructive artifact.** A defect measured on a
PARTIALLY-FIXED tree can look like a new and unrelated one. Both observers here were careful and both
verified "pre-existing" — but "pre-existing" was checked against a tree with an incomplete fix, not
against a tree with no fix and not against current HEAD, so a fix that was already 90% landed read as
"this bug still exists, untouched by anything we just did." **Re-measure against the CURRENT head before
filing a new entry, not only against whatever baseline is convenient** — a baseline one commit behind
the tip can already contain half the fix for the thing being reported as unfixed.

★ **It was predicted before it was observed.** The gap this entry turned out to be — a `beforeEach`-only
drain being one-directional, protecting intra-describe ordering but not a leftover produced by the LAST
test scheduled in a describe — was flagged by a code-quality reviewer reading `55143042` alone, before
anyone had connected it to a failing seed. `e0064815` closed that theoretical gap; the seed-7 failure
above is empirical confirmation of the same prediction, arrived at independently and from the opposite
direction (a failing test, not a code read). Both routes converged on the same fix.

★ Filed and closed within the same slice: caught only because the entry's own claim ("verified TWICE and
independently... not caused by §75's `mockReset()` fix") was checked against the current tree before
being written into the tracked register, rather than left resting on the two prior observations alone.

---

## 85. ~~StrictMode does NOT double-invoke effects under vitest — cause unknown, so every StrictMode-dependent test may be vacuous~~ — CLOSED, FALSE PREMISE: it does double-invoke here; whether it does on a given mount depends on the wrapper shape, and the rule is pinned by a meta-test

**Cited from:** `strictmode.meta.test.tsx` — this entry cannot be deleted.

**The OBSERVATION was real and is reproducible. The CONCLUSION drawn from it was wrong.** `["mount"]`
— one invocation, no cleanup+remount — is exactly what ONE wrapper shape yields here, and the
meta-test named below now pins that shape as a negative case. What does not follow is what this entry
asserted: that nothing in this repo could pin any StrictMode-dependent behaviour. In the right wrapper
shape it double-invokes normally, and all three mount re-sets this entry called unpinnable are now
pinned.

★★ **WHICH COPY IS NORMATIVE:** this entry and `src/app/strictmode.meta.test.tsx` both state the rule in
full — this one for the reader working out what was retracted and why, the test file for the reader
about to write a StrictMode guard. If they ever disagree, **the meta-test is right**: it is executable
and this is not. AGENTS.md carries a summary of the same rule and is normative for nothing.

★★★ **THE RULE IS ABOUT THE PLACEMENT FLAG.** Everything else is a COROLLARY, and all three earlier
attempts to state this went wrong by promoting one corollary into the rule. Cited by symbol because a
`node_modules` line number rots on the next install: `recursivelyTraverseAndDoubleInvokeEffectsInDEV`
(react-dom development build) descends each branch to the topmost fiber **flagged for placement**,
double-invokes there only if StrictMode is AT OR ABOVE that fiber — the fiber's own type counts, which
is what makes `wrapper: StrictMode` work — and never recurses PAST it either way, so a StrictMode nested
below is never reached.

**Two things carry that flag** (`placeChild`, and `placeSingleChild` for a single child): a BRAND-NEW
fiber (`alternate === null`), and an existing KEYED child that MOVED — with a direction. The test is
`alternate.index < lastPlacedIndex`, where `lastPlacedIndex` is the highest previous index among
siblings already kept in place while scanning the new list left to right, so the flagged child is one
that now sits **AFTER a sibling it used to sit before**. ★★ A child moved to an EARLIER slot is NOT
flagged — the siblings it jumped over are. Measured both ways (an earlier-slot move of a keyed
`<StrictMode>` yields `["mount"]`), and "moved backwards" — the obvious phrase, and the one the fourth
draft used — names exactly the case that does nothing. **"Placed" does not mean "new"** — the sentence
the THIRD wording was built on.

**Corollary 1 — the mount commit.** On the commit that FIRST mounts a tree the only placed fibers are
the root's direct children, so StrictMode double-invokes only when nothing — no component, no host
element — sits between the root and it on its OWN branch (a sibling branch elsewhere does not matter:
StrictMode can be the root's second child and still double-invoke). `wrapper: StrictMode` (renderHook's
wrapper IS the StrictMode component) and `reactStrictMode: true` (RTL renders
`<StrictMode><Wrapper>…</Wrapper></StrictMode>` — an ordinary element placed outside the wrapper, not
something that reaches `createRoot`) both satisfy that. Composing `<StrictMode>` INSIDE a wrapper
function puts a non-StrictMode fiber on the same branch above it and silently turns the double invoke
off for that mount — even with nothing else nested inside it.

**Corollary 2 — later commits, with a limit.** A nested StrictMode is NOT inert in general: once the
wrapper has an alternate it is no longer placed, the walk recurses THROUGH it, and a child mounting in
that commit IS double-invoked. ★★ Unless that wrapper is itself a keyed child that moved — then the
wrapper carries the flag, the walk stops there, and the StrictMode below is never reached.

**Corollary 3 — no new child needed.** A `<StrictMode>` that is itself a moved keyed child is placed, so
a pure REORDER disconnects and reconnects its whole subtree's effects with nothing mounting at all.

Measured 2026-08-05, each one a test in the meta-test rather than a sentence here:

| shape | result |
|---|---|
| nested StrictMode, child mounts on a rerender | `["mount","cleanup","mount"]` |
| the SAME host, child present from the first commit | `["mount"]` |
| the same rerender with no StrictMode anywhere | `["mount"]` |
| `<StrictMode>` is a moved keyed child (pure reorder) | `["mount","cleanup","mount"]` |
| a moved keyed WRAPPER with StrictMode inside it | `["mount"]` |

★ Fragments split the difference and both directions are pinned: the OUTERMOST keyless fragment is
unwrapped during reconciliation and never becomes a fiber, so it does not break the rule; a second one
nested inside it does. ★ Every guard in this repo mounts once and never re-mounts or reorders a child,
so Corollary 1 is the one that governs them.

★ **One exception is stated but NOT pinned**, and is marked so deliberately: an OffscreenComponent
(`fiber.tag === 22`, created for a `<Suspense>` boundary's children **and for `<Activity>`'s** —
`<Activity>` itself is tag 31, so a placed one stops the walk like any other fiber) is special-cased —
a PLACED Offscreen does not stop the walk, and a HIDDEN one (`memoizedState !== null`) is skipped
entirely. Read from source, not measured; nothing in this repo renders StrictMode inside Suspense or
`<Activity>`. A lead, not a fact.

★★ **Every wording of this rule was measured at ONE shape and written as if it held at all of them.**
Four drafts, three of them wrong, each refuted by the next:

| # | wording | refuted by |
|---|---|---|
| 1 | StrictMode must be the OUTERMOST element under the root | a sibling branch — StrictMode can be the root's second child |
| 2 | nothing may sit between the root and it on its own branch | later commits — an existing wrapper is not placed, so the walk goes through it |
| 3 | it is a rule about the mount COMMIT; a fiber is placed only while BRAND NEW | keyed moves — a moved child is placed without being new |
| 4 | the placement flag (current) | — but its first draft said "moved BACKWARDS", which is the direction that is NOT flagged |

Reproduce with `git log -p --follow -- src/app/strictmode.meta.test.tsx | grep "^+// ★★★ THE SHAPE RULE\|^+// ★★★ THE RULE IS"`
— four `+` lines, one per draft, so the count is checkable rather than remembered. ★★ The `^+//` anchor
is load-bearing and the unanchored form was published here first: without it an INDENTED in-test comment
(`+  // ★★★ THE OTHER HALF OF THE SHAPE RULE…`) matches too and the command answers FIVE, so a reader
checking "four" is told the table is wrong. A reproduce command that refutes its own claim is worse than
none — run the command you attach. ★ Note #3 is the
one an earlier version of this paragraph left out of its own count, while folding #3's error into #2's
row; that is how a wrong count survives a proofread. That is why every clause above is now a test
rather than a sentence.

★★★ **The standing instrument is `src/app/strictmode.meta.test.tsx`** — a meta-test asserting a
property of the HARNESS, not of the app. It covers a plain component render, both safe `renderHook`
forms, the nested-shape negative cases, the later-commit positive with its two controls (no-StrictMode,
and the same host on its first commit), all THREE keyed-move shapes (a `<StrictMode>` moved to a LATER
slot, one moved to an EARLIER slot, and a moved WRAPPER) plus a no-StrictMode reorder control, the
sibling and both fragment edges, and that the DEVELOPMENT React build is what resolves — 17 `it(` blocks,
8 of them negatives (`grep -c "^  it(" src/app/strictmode.meta.test.tsx`). ★ This enumeration was stale
within one commit of being written: the commit that added the earlier-slot case — that round's headline
finding — left it out of the list right here.
Read it instead of trusting this paragraph: last time this measurement lived only in prose, the probe
was deleted and every later reader had to take the prose on faith. ★ If that file ever goes red, the
three guard tests below have become vacuous — fix it before trusting them.

★★★ **THIS ENTRY'S OWN "MEASUREMENT ARTEFACT" HYPOTHESIS IS SEPARATELY FALSE — retracted here too, and
it had been ranked as the FIRST thing to check.** It held that a log living in per-instance state, or
in a ref created INSIDE the hook, would be handed a FRESH log by StrictMode's remount, so `["mount"]`
would appear whether or not the double invocation happened. It would not:
`doubleInvokeEffectsOnFiber` (react-dom development build) disconnects and reconnects effects on the
SAME fiber rather than replacing it, so hook state and refs survive and a per-instance log observes
the full `["mount","cleanup","mount"]` cycle exactly like a module-scope one. ★ It was also measured
both ways — per-instance refs and state-held logs — while this was being closed, but that probe is
not committed either, so the MECHANISM above is the part a reader can re-check; the meta-test's header
comment records it. ★★ Left standing, this would have sent the next reader to instrument the log
shape, which is not where the difference is.

**Now pinned** — one guard test per mount re-set. Each test's own comment names the single-line
mutation that fails it:

| re-set | guard test |
|---|---|
| `use-scheduled-jobs.ts` | `still applies the loaded jobs after StrictMode's remount` (`use-scheduled-jobs.test.tsx`) |
| `use-operating-guides.ts` | `still applies the loaded guides after StrictMode's remount` (`use-operating-guides.test.tsx`) |
| `use-storage-backend.ts` | `still emits a save outcome after StrictMode's remount` (`use-storage-backend.test.tsx`, in the `useStorageBackend — StrictMode mount re-set (§72)` describe) |

★★ **What is NOT established: that the shape rule is what actually happened on 2026-08-04.** That
probe was deleted and never recovered, so which wrapper shape it used is unknowable. The shape rule
reproduces the reported symptom exactly and is the likely explanation — it is not a confirmed account
of that run, and writing it as one would repeat the over-reach that produced this entry.

★ Unchanged and still true: StrictMode double-invokes in the real app in DEVELOPMENT, which is what
makes §72's and §76's mount re-sets load-bearing at all. §76 carries the observed before/after
dev-server trace; it is not restated here.

★★★ **The transferable lesson, which is why this entry stays instead of being deleted — this file's
convention is that a wrong claim stays visible as the instructive artifact.** "I could not reproduce
it" is not "it cannot happen", and the distance between those two sentences is where a whole class of
tests gets written off. This entry did not merely record a failed measurement: it concluded that **no**
test here could pin **any** StrictMode-dependent behaviour, and that conclusion was then written into
source comments and into §72's and §76's bodies as the reason shipped guards had no coverage. **A
claim that something is untestable is load-bearing — it licenses shipping code with nothing pinning
it, so it deserves the same scrutiny as a claim that something works.** ★ And the check that would
have broken it was cheap and never run: vary the HARNESS, not the subject. The failing ingredient was
in the wrapper argument, one line away from the thing being measured.

---

## 86. AI cannot read timelog entries — deliberate, no tool exposes them

`Workspace` holds only `timelogLinks?: Readonly<TimelogLinks>` (`workspace.ts`) — user→resource and
project→bucket LINK mappings, additive and optional. The real booked-time entries never enter
`Workspace`; they are fetched live over the `/api/timelog` proxy (`api/timelog/route.ts` +
`_helpers.ts`), which is host-allowlisted and private-IP-guarded via the shared
`api/_shared/proxy-ssrf.ts` and authenticated with the device-sealed `timelogApiToken` secret.

A read tool here would mean the model triggers a live authenticated external call on request — a
different risk class (an outbound request to a third-party host, not a read of local project data) and
a different failure mode: the v2 per-project endpoint has already timed out for large projects once in
production (fixed by widening its request budget to 30s while every other Timelog call keeps 10s — see
CHANGELOG). Building a chat tool on top of that path reintroduces that failure mode as an AI-triggered
one, on a call the user did not directly initiate.

`VIEW_AI_SCOPE.timelog.reading` tells the model outright that it cannot read booked time entries, so it
says so rather than estimating. `ASK_CLAUDE_PROMPTS` deliberately has no `timelog` entry — pinned by
`ask-claude-prompts.test.ts` ("has no chips for the views whose read tools are deferred") — because a
chip there would be a dead prompt.

---

## 87. AI cannot read the activity log — CORRECTED 2026-08-18, stale

★★★ **STALE — a read tool now exists, and this entry's own reasoning is what the fix had to solve.**
`chat-tool-defs.ts` declares a `search_history` tool, and `chat-tools.ts` exposes
`getActivityLog(): readonly ActivityEntry[]` on the dispatcher, consumed inside `chat-tools.ts` to
serve it. The "not part of `Workspace`, so there is nothing for a read tool to query without new
plumbing" claim below is no longer true — the plumbing was built.

The *reasoning* that `task-manager.tsx` is the Phase-3 baselined orchestrator and is deliberately kept
from growing new responsibilities is worth keeping, not deleting — it is exactly the constraint the
`search_history`/`getActivityLog` slice (part of the AI-recall work referenced in the memory index as
B2a) had to design around, rather than route the log through the orchestrator the way §86's reasoning
originally implied a fix would. Do not re-open this as a gap; if the tool is ever removed, that is a
new entry, not a revival of this one.

Original text, kept for the reasoning:

`activity-log-context.tsx` exposes a WRITER only — `LogActivityFn`, delivered through
`ActivityLogProvider`/`useActivityLogger()` — and the log itself is not part of `Workspace`, so there is
nothing for a read tool to query without new plumbing. Reading it would mean threading it through
`task-manager.tsx`, which is the Phase-3 baselined orchestrator (see "task-manager decomposition map"
above) and is deliberately kept from growing new responsibilities.

Same handling as §86: `VIEW_AI_SCOPE.activity.reading` states the model cannot read the log, and
`ASK_CLAUDE_PROMPTS` has no `activity` entry (same test pins both absences together). ★ That guard
pairing may itself be stale now that a read tool exists — not re-verified as part of this correction;
check `VIEW_AI_SCOPE.activity.reading` and the `ASK_CLAUDE_PROMPTS` `activity` entry before relying on
either claim.

---

## 88. `ai-section.tsx`'s own sub-section titles are not real headings — open, a11y

Found while building the view-scoped AI prompts' Settings disclosure (`AiViewScopeDisclosure`,
`settings-sections/ai-view-scope-disclosure.tsx`, unreleased at time of writing). Its own "AI
Assistant" and "Operating guides" sub-section titles in `ai-section.tsx` are styled elements, not
headings:

- **STILL OPEN.** `{t(lang, "aiAssistant")}` renders inside a
  `<span className="... text-sm font-medium ...">` — grep the key in `ai-section.tsx`.
- **CLOSED, verified 2026-08-09.** `{t(lang, "aiGuidesHeading")}` had the same defect in a `<p>`.
  That section has since moved to `ai-guides-section.tsx`, and `settings-view.tsx` renders a shared
  `<h2>` from the rail label instead — so the sub-section carries no heading of its own. A test in
  `ai-guides-section.test.tsx` pins the drop ("does not render its own heading"), because re-adding
  the `<p>` would otherwise double the heading with nothing failing.

★★ Both bullets carried a line number and BOTH were wrong when this was re-checked: the surviving
one was 227 lines off, and the closed one pointed into a file the code had left entirely. Neither
number was ever re-read after it was written — the section was rewritten twice in between. The
doc-claims ratchet caught only the second, and only because `ai-section.tsx` had shrunk past it; a
227-line drift stays green forever. This is the case the "cite the SYMBOL" rule is about.

A screen-reader user navigating that Settings tab by heading (NVDA/JAWS "next heading", VoiceOver
rotor) skips the remaining one — it reads as body text, not a section landmark. `AiViewScopeDisclosure`
was written correctly from the start — a real `<h3>` for its own title — but the pre-existing titles
above it were left alone as out of scope for that task. Not axe-visible: axe has no rule requiring a styled
sub-heading to be a real heading element, so the gate is silent here (same class of gap as §9's
`aria-sort` and §55's colour-only toggles). Fix is
mechanical — swap the remaining `<span>` to `<h3>` with matching classes — but touches visual rhythm
in a settings tab with no eye-verification pass scheduled, so it is recorded rather than fixed here.

---

## 89. AI cannot read absences, and the Resource-calendar view renders them beside meetings

`list_calendar_events` returns `CalendarEvent` series only. Absences are a separate entity and no tool
exposes them (`grep -n "absence" src/app/chat-tool-defs.ts src/app/chat-tools.ts` returns nothing), yet
the `calendar` view draws both on one grid — so a clash or availability question answered from meetings
alone silently omits half the data the user is looking at.

★★ This is a WORSE shape than §86/§87, and that is why it was missed. There the tool is simply absent,
so nothing can answer. Here `list_calendar_events` **succeeds**, returns plausible data, and the model
has no way to know it saw only half the grid. `ask-claude-prompts.test.ts`'s chip↔capability guard
cannot catch it either: it asserts `hasHints || hasDigest`, and `calendar` has two hints — so the rule
it really enforces is chip↔*some* capability, never chip↔*sufficient* capability. ★ Stated precisely
because "some tool" would wrongly imply a digest-only view is unguarded; it is not, the guard just
cannot judge whether the capability ANSWERS the chip.

Handled for now the same way as §86/§87 — `VIEW_AI_SCOPE.calendar.reading` states outright that
absences are not readable and that any clash answer covers meetings only. Unlike those two, the chip
(`aiPromptCalClashBody`, "are any people double-booked in overlapping meetings?") is deliberately KEPT,
because it is answerable as worded; it asks about meetings, not availability.

Building the tool is the real fix and is not hard — absences are in `Workspace` (unlike timelog entries
in §86, which are live external calls) — it was simply out of scope for this slice.

---

## 90. `onCreateResource` is unguarded in a popout and cannot take `guardEdit` — open

Every mutating handler `task-manager` threads to `WorkspaceSection` is either wrapped in
`guardEdit` (`makeEditGuard(isPopout, …)`) or self-guards; `onChangeBudgets` was the exception and was
fixed. `onCreateResource` is the remaining one, and the same fix does **not** apply: it is typed
`(name, email) => number` and the caller assigns the result straight into a foreign key, while
`makeEditGuard` returns `undefined` on the read-only path — wrapping it widens the contract to
`number | undefined`. That is a tsc error rather than a silent break, which is why it was left alone
rather than patched over.

Reachable: RAID is in `POPOUT_TABS`, `RaidPanelToolbar` renders its add button unconditionally, so the
edit modal opens in a popout and typing a new name into the owner picker calls through to
`handleCreateResource` → `setResources` + `logActivity("resource.created")`. The item saving around it
is blocked, so a popout can create a resource it cannot then attach.

★ Blast radius is popout-local for the workspace itself (the save effect early-returns on `isPopout`
and `canSend` disables every outbound broadcast) — but see §91 for the part that is not.

Fix options: give the guard a read-only sentinel return for this shape, or gate the affordance at the
picker on `isPopout`.

---

## 91. A popout can record an undo entry and persist an activity line — open

Two unguarded paths compose into a write that outlives the window.

`onCaptureRaidBulk` / `onCaptureUndo` / `onCaptureFieldEdit` are threaded unwrapped, and
`raid-panel.tsx`'s `applyBulk` calls `onCaptureBulk` **before** its per-row `onSave` — so in a RAID
popout the per-row saves are guarded away while the undo entry still lands. `useUndoHotkey` is then
mounted unconditionally, so Ctrl+Z there calls the unguarded `undoApi.undo` → a real `setRaid`. Only
the visible undo/redo BUTTONS are popout-gated, which is why the affordance is invisible rather than
merely available.

★★ The part that is not popout-local: `undo()` calls `logActivity("undo", …)`, and `use-activity-log`
writes the log to `localStorage` with **no `isPopout` check**. That key is shared with the opener and
holds the whole array written from each window's own in-memory copy — so a popout undo persists a line
that survives the window closing, and can clobber entries the main window added since the popout
mounted. Every other popout write is discarded on close; this one is not.

★ Gating `useUndoHotkey` on `isPopout` closes both the `setRaid` and the persisted activity line in one
edit, and is the reason this is filed as one item rather than two.

---

## 92. The `settings-types` ⇄ `workspace` ⇄ `document-model` cycle is a standing trap for any eval-time snapshot — open

**This is a TRAP, not a defect.** The one instance that bit is fixed and regression-pinned. The
CYCLE it exploited is still there, and the next module-eval snapshot taken anywhere in that graph
fails the same silent way.

The cycle, all three edges VALUE imports (reproduce — each returns one line; ★ deliberately no line
numbers written down here, see the note at the end of this entry):

```bash
grep -n "defaultStorageConfig"     src/app/settings-types.ts | head -1   # settings-types → workspace
grep -n "sanitizeProjectDocuments" src/app/workspace.ts      | head -1   # workspace → document-model
grep -n "EXPORT_SECTION_KEYS"      src/app/document-model.ts | head -1   # document-model → settings-types
```

Entered through `./storage` — how the app actually loads — `document-model` evaluates while
`settings-types` is still mid-evaluation, so anything it snapshots at module scope captures the
**partially-initialised** value. `document-model` had `const SECTION_KEYS = new Set(EXPORT_SECTION_KEYS)`,
which captured an EMPTY set and froze it for the process, silently rejecting every `dataSection`
block — the one block type that embeds live project data. Fixed by reading the array at call time —
see `isSectionKey` in `document-model.ts`.

★★★ **Why this needs a register entry rather than just the code comment: the failing shape is
invisible to the obvious test.** Imported DIRECTLY, `settings-types` finishes evaluating first and
the snapshot is fine — so the module's own suite stayed green while the app was broken. Only an
import-order test reproduces it, which is why `document-model.storage-cycle.test.ts` exists and why
its first line says the import ORDER is the test. A future snapshot elsewhere in this graph gets no
such test for free.

**How to triage a candidate — a structural test, decidable from the import graph.** The bug requires
the EXPORTER of the snapshotted value to transitively import the SNAPSHOTTER. Import declarations are
hoisted and evaluated before any statement in a module body, so where `exporter →* snapshotter`, the
snapshotter can evaluate before the exporter has run a single line and the binding is guaranteed
uninitialized. Where that edge does not exist, the exporter always completes first. Necessary AND
sufficient — no need to reason about entry points case by case.

Verified here rather than taken on faith, with one positive control and one real candidate:

| exporter → snapshotter | reaches? | verdict |
|---|---|---|
| `settings-types.ts` → `document-model.ts` (the known bug) | YES, via `workspace.ts` | at risk — the rule predicts the defect |
| `types.ts` → `sanitize-entities.ts` (`ABSENCE_TYPE_SET`) | no | safe |

★★ **The risk marker is NOT "snapshots an imported value"** — that is common and almost always fine.
It is **a CONSTANTS or TYPES module that imports a VALUE.** `types.ts` and `scheme-apply.ts` are
LEAVES (`types.ts` has exactly one import and it is `import type`; `scheme-apply.ts` has none), which
is why every candidate in the sweep came back safe. `settings-types.ts` is the anomaly: it imports the
VALUE `defaultStorageConfig` from `./workspace`, and that single edge creates the only real cycle
here. So the live-candidate set is: anything snapshotting a value exported from `settings-types.ts`,
or from any module `settings-types` transitively reaches.

**The trap shape:** any `new Set(...)`, `new Map(...)`, `Object.freeze(...)`, `.map()`/`.filter()`
result, or derived constant computed at MODULE SCOPE from an imported value. A lazily-memoized version
has the same failure moved to first call. Read the imported value inside the function that needs it.

★★★ **The `new Set(...)` form is the DANGEROUS one, and that inverts the obvious intuition.**
`new Set(undefined)` is a silently EMPTY set — verified, size 0, and `new Set(null)` likewise — so the
snapshot "succeeds" and every later membership test quietly answers false. Calling a method on the
same uninitialized binding (`X.map(...)`) throws at import time instead (`TypeError`; an untransformed
ESM read of a `const` still in TDZ throws `ReferenceError`). **The LOUD failure is the SAFE one.** A
crash at startup is fixed in minutes; an empty Set ships. So "calling a function at module-eval is
more fragile" is true and beside the point — it is more fragile and LESS dangerous.

★ Counterfactual severity is easy to overstate, so state it precisely. Had `ABSENCE_TYPE_SET` been
reachable, the consequence would NOT have been dropped absences: `sanitizeAbsenceType`
(in `sanitize-entities.ts`) falls back to `"other"` and never returns null, so every
vacation/sick/training row would have been silently REWRITTEN to "other". Type corruption, not data
loss — both bad, but they need different detection and different recovery.

**Fix options**, in ascending order of ambition: (a) leave it and rely on the call-time convention,
(b) break the cycle by moving `defaultStorageConfig` out of `workspace.ts` into a leaf module so
`settings-types` no longer imports a value from it, (c) a lint rule or a guard test that fails on a
module-scope derived constant in this graph. (b) is the only one that removes the trap rather than
documenting it.

★★ **Taking option (b) silently RETIRES the behavioural guard, and that is an accepted DECISION, not
an oversight.** `document-model.storage-cycle.test.ts` can only fail while this cycle exists — it
works by importing `./storage` first so `document-model` evaluates while `settings-types` is
mid-evaluation. Remove the cycle and that condition is gone: the test passes for a new reason, and
nothing announces that it stopped protecting anything. Deliberately NOT guarded against, because the
only way to guard it is to assert the cycle EXISTS — which pins the current architecture as a
requirement, so whoever takes option (b), the one fix that removes the trap rather than documenting
it, would be met with a failing test demanding they put the cycle back. A guard that quietly retires
once its hazard is gone is the right shape.

★ The SHAPE half survives (b). The source scan added in `4fd23a7b` reads document-model's SOURCE
TEXT, so it is order- AND cycle-independent and keeps biting no matter what happens to the graph;
it is also the only guard that can fire from inside `document-model.test.ts`, whose direct-import
path can never reproduce the behaviour. The two are complements: the behavioural test pins the
CONSEQUENCE, the scan pins the SHAPE — and the scan alone would NOT catch a different way of
snapshotting early (a lazy memo, an eval-time `.map`, a derived frozen array), which is why both
stay. Reproduce:

```bash
npx vitest run src/app/document-model.test.ts -t "never snapshots"   # 1 passed | 28 skipped
```

★ **Sweep result, 2026-08-06: CLEAN.** All five candidates were checked and none is reachable, so this
entry has NO unfixed instances behind it — it is purely a trap for future work. Do not re-run the
sweep expecting to find something; re-run the check only when a new VALUE import is added to a
constants or types module, which is the event that can create a new cycle.

★★ **If you write the graph check, handle `export … from`.** The sweep's first parser read `import`
statements only and ignored re-exports. Those are real runtime edges, and a barrel is built entirely
from them — `sanitize.ts` is nothing but `export * from …` lines, one of them `"./sanitize-entities"`
— so the gap made it report that
`sanitize.ts` does not reach `sanitize-entities.ts`, which is false. Any reachability answer produced
without re-export edges is untrustworthy in both directions.

★★ **Cite SYMBOLS here, not line numbers — this entry proved its own point.** Its first draft pinned
the three cycle edges and `isSectionKey` to specific lines. Within the SAME session another agent
edited `document-model.ts`, moving the import from :14 to :29 and `isSectionKey` from :66 to :81, so
two of four citations were stale before the entry was ever committed. The greps above are written to
PRINT the current line instead. A `file:line` in this register is wrong the moment anyone touches the
file, and nothing gates it.

★ **No durable script exists.** The walker behind the table above lives in a scratchpad outside the
repo, so those two rows are reproducible today only by rewriting it. Whether a checked-in version
belongs in `scripts/` is an OPEN DECISION nobody has taken: it would be gate-shaped, and a gate that
scans the import graph needs its own justification, allowlist and failure policy. Until then, treat
the rule as a manual check and the table as a worked example of applying it.

---

## 93. The PPTX truncation notice is a hardcoded English frame around a LOCALIZED title — open

Both PPTX paths build the same sentence from a hardcoded English frame and a section title that the
registry has ALREADY translated, so a German deck gets a mixed-language sentence:

> "Showing the first 100 of 125 **Aufgaben** rows."

Reproduce:

```bash
grep -nE '`Showing the first' src/app/export-pptx.ts src/app/doc-render-pptx.ts   # 2 call sites
grep -n  "Showing the first" src/app/export-pptx.ts src/app/doc-render-pptx.ts    # 3 lines — one is a comment
```

★ Use the first form. The plain-substring search returns THREE lines, not two: the extra one is prose
inside the `doc-render-pptx.ts` comment that describes this very problem, and reading it as a third
call site sends you looking for a site that does not exist.

The two sites are NOT equally documented: `doc-render-pptx.ts` carries a ★★ comment above its
copy explaining the mixed-language problem and why it was deferred; `export-pptx.ts` — the older
workspace-export path, which has shipped this for far longer — has no comment at all. Anyone fixing
this from the code alone will likely find one and miss the other.

The second line, "Export to XLSX for the full list.", is hardcoded English in both places too, but
it is at least monolingual.

**Fix:** an i18n key taking the two counts and the title as positional placeholders — shaped like
`t(lang, "<newKey>", cap, total, title)`, applied at BOTH sites. ★ No such key exists yet and this
entry deliberately does not invent a name for it: a plausible identifier written down in prose gets
grepped for, not found, and then re-created slightly differently by the next person. Name it when you
add it. Deferred because it
means editing `i18n.de.ts`, which has its own handling rules (CRLF, real umlauts, no ASCII
substitutes — see AGENTS.md), and an awkward sentence is much less bad than silently dropping rows.

★ Related but already solved, and worth copying rather than re-deriving: the continuation marker in
the same renderer uses a NUMERIC `(2/3)` instead of a word like "(cont.)" precisely to dodge this
problem for free. Prefer that trick wherever a marker can carry no prose.

---

## 94. PPTX pagination counts LOGICAL lines, so a wrapped line still overflows — open (eye-verify owed)

**Half of this is already fixed — do not re-open the fixed half.** `doc-render-pptx.ts` now derives
`BODY_LINES_PER_SLIDE` from the body box and font size (`:247`) and chunks each slide's lines through
`paginateLines`, so overflow went from UNBOUNDED to BOUNDED.

What remains: the budget counts lines in the array, not lines as RENDERED. `bodyPr` emits
`wrap="square"` with no `normAutofit`/`spAutoFit`, so PowerPoint's no-autofit default lets text run
past the shape rather than scaling it — and one long line wraps to two or three rendered lines while
counting as one. The budget is therefore sound for short lines and optimistic for long ones. A
`dataSection` row rendered as `"Col: value · Col: value · …"` is exactly the long-line case.

★★★ **No test in this repo can catch it, and that is the reason it is filed here rather than left to
CI.** jsdom has no layout, the box is never rendered, and the overflow is invisible in the XML — it
shows up only when a human opens the deck. The module's own comment states this limit honestly; this
entry exists so the OWED EYE VERIFICATION is tracked somewhere a release checklist will see it.

**Verify by hand:** export a document containing a `dataSection` over a register with wide rows (RAID
with long titles is the worst case), open the deck in real PowerPoint, and look for body text
crossing the bottom of the content area.

**Fix options:** (a) emit `normAutofit` and let PowerPoint shrink text to fit — one attribute, but it
makes font size vary per slide; (b) estimate rendered height from a character-per-line budget derived
from the box width and an average glyph width, which is still an estimate but a much closer one;
(c) hard-wrap long lines at a character count before pagination, so the count and the render agree.

---

## 95. No test exercises a real Turso database on ANY path — open

Framing matters here: this is **not** a `documents` gap. It is a known limit of the whole meta-blob
class and of the Turso layer generally, and `documents` merely inherits it.

There is no `@libsql/client` dependency at all — the app reaches Turso over the HTTP pipeline API
(`turso-pipeline.ts`), and tests mock `fetch`. So no test in the repo opens a database, real or
in-memory:

```bash
grep -rn ":memory:" src/app/*.test.ts        # no hits
grep -n "libsql" package.json                # no hits — HTTP pipeline, not a driver
```

`turso-schema.documents.test.ts` (16 tests — `grep -cE "^\s*it\(" src/app/turso-schema.documents.test.ts`;
★ the naive `grep -c "it("` answers 17 because it also matches `.split(`) is a good test of the layer it covers, and it is explicit
about what it does: its `resultsFromStatements` helper REBUILDS the SELECT results by parsing the
INSERT statements the save just emitted. That proves the encode and decode halves agree with each
other. It cannot prove either agrees with SQLite — malformed SQL, a column-type surprise, a quoting
bug, or a driver/endpoint quirk all pass.

The same is true of the other meta-blob fields (`insights`, `knowledgeItems`) and of the entity tables.

**Fix options:** (a) accept it and say so in the test files, which is nearly the status quo;
(b) one integration test against a real SQLite file through the same statement builders, catching the
"is this valid SQL" class without needing a network; (c) a recorded-fixture test replaying a real
pipeline response captured once by hand. (b) is the cheapest real improvement, and it would cover
every entity at once rather than per-field.

★ Do not size this as a documents task. The work is the harness; once it exists, adding a field to it
is minutes.

---

## 96. The preview/print path loads the whole section registry unconditionally — open, priority UNKNOWN

`doc-render-html.ts` backs the in-app document PREVIEW and the print-to-PDF path, so its module graph
loads whenever a user opens a document — not only when they click Download. Extracting
`doc-data-section.ts` removed the OOXML builders and the ZIP writer from that graph (that part is
done and is why the extraction happened). What remains is the section registry itself.

Measured, and the type/value split matters:

| entry | modules reachable | runtime (value imports only) | type-only, erased at build |
|---|---|---|---|
| `doc-data-section.ts` | 84 | **60** | 24 |
| `export-sections.ts` | 83 | 59 | 24 |

★★ So `doc-data-section` adds exactly ONE runtime module on top of `export-sections`, and
`export-sections` alone accounts for 59 of the 60 — it pulls the csv-codecs column definitions, i18n
and the entity types. There is nothing to trim inside `doc-data-section`; the whole cost is the
registry, which the preview needs **only when the document actually contains a `dataSection` block**.

★★★ **An earlier report of this said "84 modules" without separating type-only imports, which
overstates the runtime cost by 24 modules. If you have seen that number quoted, 60 is the one that
means anything.** To reproduce: walk the transitive `./`-relative import graph from the entry file,
resolving each specifier `.ts` then `.tsx`, and count the modules reached — once following EVERY
`from "…"` edge, and once skipping edges whose whole clause is `import type` / `export type` (and
brace lists where every specifier is `type X`). The gap between the two counts is the type-only
tail, which is erased at build and costs nothing at runtime.

**Fix:** make the registry a dynamic `import()` inside `resolveDataSection`, so a document with no
`dataSection` block never loads it. That changes the function to async, which ripples into all three
renderers — so it is a real change, not a one-liner.

★ **Honest state: no bundle measurement has been taken.** Module COUNT is not bytes, Next.js
code-splits, and nobody has reported the preview as slow. This is recorded because the "59 of 60 come
from one conditionally-needed import" fact is non-obvious and expensive to rediscover — NOT because
there is evidence of a user-visible problem. Measure before scheduling it, and close this as
"not worth it" if the bytes are small.

---

## 97. The DOM constraint INVERTED for the document load paths — open (TRAP, safe today)

**Nothing here is broken. The danger is that the rule everyone has memorised is now BACKWARDS for
four specific call sites**, and the failure it produces is silent.

The lore this repo repeats — §36(a), the `templates.ts` guard, the sample-generator landmine — is
*"you must NOT call DOMPurify here, the generator runs under bare node."* For the document load paths
it is now the opposite: **you MUST ensure a DOM exists, or documents are lost without a diagnostic.**
`document-rich-fields.ts` says as much in its own header (the DOM-free rationale is called obsolete
there), but that is a file you only open once you already know to look. This entry exists because the
register is what someone reads while PLANNING.

### Measured, with a negative control

Reproduce by installing JSDOM into `globalThis` before a dynamic import of the codec (exactly what
`scripts/generate-sample-workspace.ts` does in its header), then running the same decode with and
without it:

```
WITHOUT JSDOM:  CSV → documents defined: FALSE · html "<missing>"
                Markdown → documents defined: FALSE · html "<missing>"
WITH JSDOM:     CSV → documents defined: true · html "<p>keep me</p>"   (and <script> stripped)
                Markdown → documents defined: true · html "<p>keep me</p>"
```

With no DOM the DOMPurify call throws, the decoder's own `catch` swallows it, and the documents are
gone. No error, no log, no partial result.

★★ And it is silent even though a reporting channel EXISTS. `csvToWorkspace` / `markdownToWorkspace`
both take an `ImportDiag`, which is how other import problems reach the user — but `csvToDocuments`
and `markdownToDocuments` take no diag, and their caller is a bare `if (docs) ws.documents = docs;`,
so a falsy result is skipped without a word. A user importing a file therefore gets a diagnostics
report that says nothing at all about the documents they just lost. Threading `diag` into these two
is the cheapest partial improvement available.

### The blast radius is NOT uniform — and the worst path is now CONTAINED

Four load paths compose `sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)`. All four now
wrap it in a LOCAL `try/catch`, so a throw costs the documents and nothing else:

| path | on a missing DOM | what is lost |
|---|---|---|
| CSV (`csvToDocuments`) | local catch | documents only |
| Markdown (`markdownToDocuments`) | local catch | documents only |
| Turso (`rowsToWorkspace`) | local catch | documents only |
| JSON (`jsonToWorkspace`) | local catch **(added)** | documents only |

★★★ **The JSON path used to be categorically worse and this is why the entry exists.** It had no
local catch, so the throw reached `jsonToWorkspace`'s outer catch-all, which answers a NON-STRICT load
with `emptyWorkspace()`. A `.json` project file therefore came back not "missing its documents" but
EMPTY — measured, **tasks survived: 0** — losing every task, RAID item and milestone, silently. JSON is
also the most likely thing a bare-node script touches, so the worst severity sat on the most reachable
path. Fixed: the sanitize is wrapped locally, non-strict degrades to documents-dropped and records
`workspace.documentsDropped` in the diagnostics ring, and **`strict: true` still throws** so the sample
generator keeps failing loudly rather than writing a near-empty artifact. Pinned by four tests in
`workspace.documents.test.ts`, one of which was run RED against the old code and reported the
`tasks: 0` above.

★ The containment is deliberately narrow — it wraps those two calls, never the whole decode, because a
broader catch would make real file corruption survivable, which is exactly what `strict` exists to
prevent. Degrading a throw to "documents dropped" also matches what the field already does with
garbage input, so it introduces no new failure mode.

★★ **The underlying DOM dependency is UNCHANGED and this entry stays open for it.** Containment limits
the damage; it does not make the decoders work without a DOM. A bare-node importer still silently
loses every document — it just keeps the rest of the workspace now.

### ★★ The trigger is narrower than "has documents" — measured

The allow-list only runs for a **paragraph** block, so most shapes are unaffected. Without a DOM:

| workspace shape | tasks survived |
|---|---|
| no documents at all | 1 — fine |
| a document with only a heading block | 1 — fine |
| a document with a PARAGRAPH block | **0 — whole workspace lost** |

That narrowness is why this has not bitten yet, and it is also what makes it treacherous: a bare-node
script can pass every test against document-free fixtures and fail the first time someone's real
project contains a paragraph.

### Why it is safe today

Verified by grep, not assumed: no file outside `src/app` imports these codecs directly, the only
DOM-free importer is `scripts/generate-sample-workspace.ts` (which installs JSDOM into `globalThis`
BEFORE its `await import("../src/app/storage")` — the dynamic import is load-bearing, a static one
would hoist above the install), and every runtime decode caller is browser-side.

### What would break it

Removing or reordering the generator's JSDOM install; converting its dynamic import back to a static
one; a NEW bare-node script or codegen step that imports `storage`, the CSV codec or the Markdown
codec; or a test that exercises a decode path in a non-jsdom environment.

**Fix options:** (a) leave it and rely on the comments, which is the status quo; (b) make the decoders
distinguish "no documents" from "could not sanitize" so the failure is loud — the JSON path especially
should not answer a DOM problem with an empty workspace; (c) have the sanitizer detect the absent DOM
and throw a NAMED error, so the catch sites can decide rather than guess; (d) a tiny DOM shim so the
allow-list degrades to a no-op instead of throwing — rejected on sight, because it would silently
store unfiltered HTML, which is the vulnerability the pass exists to close.

★ Cross-reference: §36(a) records the OTHER direction (a sanitizer that must stay DOM-free because it
is in the generator's import graph). Both are true at once, of different modules, which is exactly why
neither should be quoted as a general rule.

---

## 98. `documents` is invisible to both save-time data-loss guards — open (MISSING NET, no known live path)

**Nothing is broken today and this is NOT a regression the documents slice introduced.** It is a
pre-existing boundary that the documents feature makes newly consequential, and it is recorded
separately because the reason it now matters did not exist before this slice.

`nonEmptyCollectionCount` and `workspaceRecordCount` (both in `workspace.ts`) each enumerate the same
THIRTEEN entity collections. `documents` is in neither — and neither are `knowledgeItems`, `insights`,
`timelogLinks` or `settingsOverrides`. **State that scoping whenever this entry is quoted:** four
sibling slices are equally invisible, so anyone reading it as "the documents slice forgot a counter"
will go looking for a bug that is not there.

### Measured, with a positive control

```bash
sed -n '/export function nonEmptyCollectionCount/,/^}/p' src/app/workspace.ts | grep -c "ws\.documents"       # 0
sed -n '/export function nonEmptyCollectionCount/,/^}/p' src/app/workspace.ts | grep -c "ws\.tasks"           # 1
sed -n '/export function workspaceRecordCount/,/^}/p'    src/app/workspace.ts | grep -c "ws\.documents"       # 0
sed -n '/export function workspaceRecordCount/,/^}/p'    src/app/workspace.ts | grep -c "ws\.calendarEvents"  # 1
```

Run 2026-08-06; the `ws.tasks` / `ws.calendarEvents` lines are the control, so a zero from a broken
pattern cannot masquerade as a finding. `knowledgeItems` and `insights` also return 0 from the first
command, which is how the scoping above was established rather than assumed.

### What it defeats, by name

Both counters feed the save-effect choke point in `use-storage-backend.ts`, which computes
`curCollections` / `curRecords` from the outgoing workspace and enforces two invariants:

- **L3, the full wipe** — `curCollections === 0` while the previous save had `>= 2`.
- **Layer B, the unexplained mass deletion** — `isMassDeletion(prevRecords, curRecords)`.

A save that dropped every document while leaving the other slices untouched produces IDENTICAL
`curCollections` and `curRecords`, so neither invariant fires and the destructive write proceeds with
no refusal, no `recordDataLossEvent` entry, and no toast. `allowDestructiveRef` is never even
consulted, because nothing looked destructive.

### Why it matters more than the four siblings it shares the gap with

Documents are user-AUTHORED long-form content: one record can represent hours of work, which is not
true of `insights` (machine-derived) or `settingsOverrides` (reconstructible). And a project holding
ONLY documents counts as **zero** non-empty collections — a completely plausible state for this
feature, since a user can create a project and write a document before entering a single task. That
combination is what is new.

### Why widening the counters is NOT free, and was deliberately not done here

Adding `documents` to both functions is two lines each, but the counters are the INPUT to a
destructive-save guard: raising `curCollections` and `curRecords` shifts the L3 and Layer-B thresholds
for every existing project, changing when saves are REFUSED. That is a behaviour change to the
data-loss machinery and belongs in its own slice with its own tests — not as a trailing edit to the
slice that noticed it. The failure mode of getting it wrong is a guard that refuses legitimate saves,
which users experience as data loss of a different kind.

★ If it is picked up: decide deliberately whether the other four join at the same time. Adding only
`documents` leaves the register's own scoping stale, and a half-widened counter is harder to reason
about than either end state.

---

## Decided — do not re-litigate

**Band lanes reshuffle across window changes** (R5 §1, `occurrence-lanes.ts` `preferredLane`).
Decided 2026-07-27: **not fixing.** ★ The module's own doc comment already states this scope
accurately (commit `992827f9`), so nobody should mistake it for solved and it needs no further
documenting. The `preferredLane` map is rebuilt per call, so it prevents a
series FRAGMENTING within one window but not MOVING between windows. Three things carried the
decision: the cure's failure mode is worse than the disease (a preference carried across windows
pins a series to a lane wrong for a later window, and a ref that never evicts goes stale after any
edit); the keyboard consequence is handled elsewhere (0.202.3's focus-restore effect in
`resource-calendar-band.tsx` re-focuses a surviving chip when the focused one unmounts, which is
what a lane change does to it), leaving only a visual row-jump; and being mechanically easy is not
the same as being right.

If it ever becomes a real complaint, the answer is an **order-stable packer** — pack by `eventId`
rather than first-come, so the same series set always yields the same lanes with no cross-render
memory. It re-baselines all 6 existing lane tests. It is NOT the `useRef` carry-over.

**Rejected by the 2026-06 review (Tier C), still rejected:** `CSV_COLUMNS` meta-programming in the
codecs (directly threatens the byte-stable golden serializers); `array.includes` → `Set.has` in
`sanitize.ts` (unmeasured micro-perf); `use-jira-sync` ref-sync effect consolidation (the "7×
re-renders" premise was false — effects do not trigger re-renders).

**Verified FALSE POSITIVES from that same review — reject these on sight if a tool re-raises them.**
Preserved here because the source doc is deleted and each one is a claim an automated reviewer will
plausibly make again:

- *"`task-manager.tsx` has CRITICAL `set-state-in-effect`, fails lint."* False. Those are
  **conditional** `setActiveTab` navigation effects, guarded by an `if`, committed and CI-green. The
  `react-hooks/set-state-in-effect` ban targets *unconditional* derived-state mirroring.
- *"`jira-settings.tsx` set-state-in-render is an anti-pattern; convert to `useEffect`."* False **and
  actively harmful** — that IS the render-time reconcile pattern AGENTS.md mandates, and converting
  it to an effect is the BANNED shape, so the "fix" would fail CI.
- *"`jira-api.ts` `return data as T` is unvalidated, CRITICAL."* Over-rated. `data` is typed
  `unknown`, the error path throws `JiraApiError`, and callers guard. A real MEDIUM type note at
  most — and the zod fix is a new dependency, so it must be asked for (it is item §7 B4 above).
- *"Pure modules import React/i18n"* (`action-ai.ts`, `ai-project-proposal.ts`,
  `chat-attachments.ts`) — verifiably clean; non-findings.

★ The frame that produced all four is worth keeping: the app is CI-green under
`lint --max-warnings=0` and `tsc --noEmit`, **therefore no committed code can hold a fatal lint
violation** — any finding claiming one is a false positive by construction. Check that before
believing a severity label.

**Dropped:** audit **#38** browser-Back — stale, popstate already handled (`561615ce`).

---

## 99. The e2e seed writes only four of BrowserBackend's ten optional slices, so some axe scans run on an empty state — open, PARTLY CLOSED 2026-08-08

`e2e/seed.ts` writes the sample workspace into IndexedDB from TWO HARDCODED lists: an entity-store
list and a kv-key map. Anything named in neither is dropped without a word. `BrowserBackend`
persists its optional slices as kv entries — `fieldVisibility`, `features`, `steeringCommittee`,
`timelogLinks`, `knowledgeItems`, `insights`, `settingsOverrides`, `calendarEvents`, `documents`,
`documentVersions` — and the seed's kv map carries `documents` (added in S1), `documentVersions`
(added in S2) and, since 2026-08-08, `insights` + `timelogLinks`. Everything else on that list is
still dropped. ★★ The numbers below had already rotted TWICE (an earlier revision said "nine", and the
merge that renumbered this register briefly carried "a minority" and "two of ten" in the same table
row), so treat them as measured-at-a-date, not as durable. **Re-run the commands rather than quoting
the figures:** `grep -c "^const KV_" src/app/browser-backend.ts` (measured 2026-08-08 → **10**, the
optional kv slices listed above).

★★★ THE TWO SIDES ARE NOT COUNTED THE SAME WAY, and an earlier revision of this paragraph glossed
that as "`e2e/seed.ts`'s own `KV` map (→ 4)". **The map has ELEVEN entries, not four.** Four is its
INTERSECTION with the ten optional slices; the other seven (`plan`, `fxRates`, `status`,
`milestones`, `changes`, `stakeholders`, `project`) are core kv slices that were never on the
optional list. A reader who runs a bare count gets 11, sees the entry claim 4, and concludes the
entry is wrong — so quote the intersection and say so. Measured 2026-08-08: map entries **11**,
intersection **4** (`documents`, `documentVersions`, `insights`, `timelogLinks`), dropped **6**
(`fieldVisibility`, `features`, `steeringCommittee`, `knowledgeItems`, `settingsOverrides`,
`calendarEvents`). Reproduce the intersection itself rather than eyeballing the map:

```bash
node -e 'const s=require("fs").readFileSync("e2e/seed.ts","utf8");
const m=s.match(/const KV: Record<string, string> = \{([\s\S]*?)\};/)[1];
const keys=[...m.matchAll(/(\w+):\s*"([^"]+)"/g)].map(x=>x[1]);
const opt=["fieldVisibility","features","steeringCommittee","timelogLinks","knowledgeItems",
"insights","settingsOverrides","calendarEvents","documents","documentVersions"];
console.log("entries",keys.length,"| seeded",keys.filter(k=>opt.includes(k)).join(","),
"| dropped",opt.filter(k=>!keys.includes(k)).join(","))'
```

★★ The consequence is a gate that reads far stronger than it is. A view whose data never arrives
renders its EMPTY STATE, so axe scans a panel with no rows, no per-row controls and nothing that
could collide. The run is green and proves close to nothing.

**PARTLY CLOSED 2026-08-08 — `insights` and `timelogLinks` are seeded now, and `Insights` is no
longer in this position.** Neither slice exists in the curated master, so both are AUTHORED in
`SEED_WORKSPACE` (the same escape hatch `documents` uses) rather than added to
`sample-workspace-small.json`, which would force regenerating `-big`, `-huge` and every
`__fixtures__/golden-*` fixture and make a real format change indistinguishable from a refresh.
Both scans came back CLEAN with rows: `-g "Insights"` 5/5 and `-g "Time bookings"` 5/5, so unlike
`documents` these two hid no violation. `e2e/seed-content.spec.ts` carries the matching guards.

★★★ CORRECTION 2026-08-08 — the seeded insights were first justified as "three insights, not one, so
a duplicate-name failure can render at scan time". **That was false twice over.** (1) The three rows
had three DIFFERENT types, and `insightTitle` (`insights/insight-text.ts:28`) is
`t(lang, TITLE_KEY[insight.type])` — type-driven and nothing else — so three different types give
three different titles and three different accessible names; no collision was possible. (2) Even a
real collision would not reach the gate: axe-core 4.12.1 has NO rule for two BUTTONS sharing an
accessible name, and the only adjacent rule, `identical-links-same-purpose`, is links-only and tagged
`wcag2aaa`, which `e2e/a11y.spec.ts` does not request (it asks for `wcag2a wcag2aa wcag21a wcag21aa`).
The seed now carries FOUR insights of which TWO share the `milestoneSlip` type, so the collision
really does render — but it is pinned by an assertion in `e2e/seed-content.spec.ts`, not by axe. See
§120. ★ Reproduce the axe half:
```bash
node -e 'const a=require("axe-core");console.log(a.getRules().filter(r=>/identical|duplicate|unique/i.test(r.ruleId)).map(r=>r.ruleId+" | "+r.tags.join(",")).join("\n"))'
```

★★ HALF of `timelogLinks` still does not reach a scan, and a green Time bookings run must not be read
as covering it. `timelog-panel.tsx` merges linked-but-unfetched projects into `knownProjectRefs`
under a synthetic name, so `projectLinks` renders real rows with row-qualified controls; the People
table renders `sync.users`, which is network-only, so `userLinks` renders nothing. Covering the
People table needs a route stub, not a seed row.

★ Still open for the six above. `steeringCommittee` and `calendarEvents` are the worse two: the
master DOES carry them, so the seed silently DISCARDS curated data and the e2e app is not a faithful
load of the master — a harness-fidelity bug independent of any scan.

★★★ This is not theoretical, and the evidence is the reason the entry exists. `documents` had the
identical defect; adding `documents: "documents"` to the kv map and seeding a second row turned up a
REAL `serious` violation on the first run — `scrollable-region-focusable` on the preview pane,
across all five scheme combos. That violation had been invisible because the pane had nothing to
scroll. Reproduce the shape of the check with:

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights" --workers=1
```

★★ HONEST CAVEAT, and the reason this was NOT folded into the documents commit: seeding a slice for
the first time can turn a currently-green scan RED, because it exposes markup the gate has never
actually examined. That is the gate working, but it is a finding that deserves its own change with
its own fix, not a surprise inside an unrelated commit.

★ The fix is one line in the kv map when the MASTER already carries the slice (the four remaining
case-(b) ones are not in it, so they need data authored in `SEED_WORKSPACE` too — that is what
`insights` and `timelogLinks` needed). The key name is the same on both sides today (the workspace
field name equals the kv key), but the map's VALUE is the kv key, not the field name, so check the
string against `browser-backend.ts`'s `KV_*_KEY` constants — a wrong one seeds nothing and fails
nothing. The cost is otherwise entirely in whatever the scan then finds.

★ Related trap, same file: the seed hardcodes its `indexedDB.open` version while the app derives it
from `IDB_VERSION`. They agree today; a future store addition that bumps one and not the other seeds
the wrong shape silently. A comment now sits at that line.

## 100. Tab ejects focus from a portaled popover opened inside a modal — open, a11y

**Measured in Chromium 2026-08-06, not inferred.** Open any edit modal → open the field-visibility
popover in its header → press Tab ONCE. Focus lands back on the trigger button **while the popover
stays open**, and the same happens from a checkbox inside the popover. So the checkbox list and the
Reset button have NO keyboard path at all (WCAG 2.1.1). Both probes below were run; the second is
what proves the cause is the portal rather than the radiogroup:

| start | Tab → | popover |
|---|---|---|
| checked tier radio | the trigger | still open |
| a field checkbox | the trigger | still open |

**Cause.** `Modal`'s Tab trap collects focusables from `dialogRef.current` and guards on
`container.contains(active)`. `PopoverPanel` renders through `createPortal` into `document.body`, so
its content is NOT a descendant of that container and `contains` is false for EVERY element inside
it — not merely at the boundary. The first Tab therefore satisfies the "focus escaped" branch
unconditionally and re-focuses the modal's own first/last focusable. The dismissal stack is working
as designed and is not the bug: a popover pushes kind `"layer"`, which deliberately traps nothing so
the modal keeps Tab. The gap is that the modal's trap cannot SEE portaled layer content, so it does
not deliver on that stated intent.

★★ **Pre-existing, and NOT introduced by the field-controls-into-header change.** The old cog
popover held the same checkbox list in the same `PopoverPanel` inside the same `Modal` — the second
probe above is exactly that path. What the move changed is prominence: the whole field-visibility
surface now lives behind the popover, so every keyboard user meets this on their first Tab. The tier
switch itself stays operable, because focus lands on the checked radio and arrows work.

★ **Invisible to every gate.** `modal-field-controls.test.tsx` renders the control STANDALONE, never
inside `Modal`, so no unit test can see it; axe scans views, not interaction-opened modals, and does
not evaluate cross-widget Tab order in any case. A test for this must mount the control inside a real
`Modal` — that mounting, not the assertion, is the load-bearing part.

★ Two directions, neither prescribed: give `PopoverPanel` its own Tab cycle over `panelRef` while
open (Escape and outside-click stay the exit), or teach the modal's trap to include the DOM of any
open `"layer"` above it. The first is contained; the second fixes the class. Either needs a sweep of
all `PopoverPanel` consumers — three of them (`action-cta-controls`, `action-popover-trigger`,
`version-menu`) have no test file at all.

★ Related and separate: nothing restores focus to the trigger when a popover closes. That is a
repo-wide `PopoverPanel` gap — no consumer does it — and worth folding into the same visit.

---

## 101. `SegmentedControl`'s selected segment is colour-only in the three DARK schemes — open, a11y

The checked segment is distinguished from its siblings by fill alone (`--segment-active-bg` against
`--segment-track-bg`). AGENTS.md's own rule for `ToggleButton` treats a lightness difference of
**≥3:1** as the additional non-colour distinction WCAG 1.4.1 requires. Computed from
`builtin-schemes.ts` (reproduce with the WCAG relative-luminance formula on the two tokens):

| scheme | track vs active | |
|---|---|---|
| harbor-light | 10.42:1 | pass |
| meridian-light | 8.73:1 | pass |
| umber-light | 10.54:1 | pass |
| harbor-dark | **2.38:1** | fail |
| meridian-dark | **2.43:1** | fail |
| umber-dark | **2.25:1** | fail |

★★ There is no second cue to fall back on. The selected segment carries
`shadow-[var(--shadow-control)]`, but `--shadow-control` is `none` in `globals.css` and **no scheme
overrides it** (`grep -c "shadow-control" src/app/builtin-schemes.ts` → 0), so that class paints
nothing in any scheme. The light schemes pass on lightness alone; the dark ones have neither.

★ The screen-reader side is NOT affected and needs no fix: this is a real `radiogroup`, so
`aria-checked` carries the state regardless of colour. That is the difference from the `aria-pressed`
family in §55 — the gap here is purely visual, for sighted low-vision and CVD users.

★★ **Pre-existing and repo-wide — not introduced by moving the field tier switch into the primitive.**
The tier switch's previous hand-rolled buttons used the very same two tokens, and the primitive has
**31 invocations across 14 files** (see the reproduce command in `segmented-control.tsx`'s header), so
a fix lands everywhere at once. Deliberately not fixed in the field-controls slice: a token change
touching every segmented control in the app wants its own slice and its own eye-verify.

★ Invisible to both gates: axe 4.12.1's only `wcag141` rule is `link-in-text-block`, and jsdom cannot
evaluate CSS custom-property colour maths. The numbers above are the only coverage this has.

## 102. Hand-rolled UI that should be a shared primitive, and glyphs that should be heroicons — open, ratchet

The full audit is [`docs/handrolled-ui-inventory.md`](handrolled-ui-inventory.md), taken 2026-08-07 on
`63e4d768`. It is the work-list for **both** parts; this entry exists so the register points at it.

**What 0.221.0 actually converted** — 17 call sites across six files (four panes — Insights,
Dashboard, Budget, Milestones — plus the milestone modal), and nothing else:
`insights-panel.tsx` (4) · `insight-recommendation-controls.tsx` (3) ·
`dashboard-sections/insights-card.tsx` (4) all moved `Button` from `variant="ghost"` to
`"secondary"`; `budget-panel.tsx` converted 4 hand-rolled `<button>` to `Button variant="secondary"`;
`milestones-panel.tsx` and `milestone-edit-modal.tsx` each moved the achieved checkbox to
`ToggleButton`. **The remainder is a ratchet, not a scheduled slice** — acting on the inventory and
producing it are separate jobs, and converting 311 elements in one sweep is unreviewable.

The scale, so nobody re-derives it: **341** `<button>` sites in non-test `.tsx` across **152** files;
18 are the primitives' own internals; of the remaining 323, **12 are the word `<button>` in a
comment** and **311 are elements** — 134 correctly hand-rolled, **141 convertible** to `Button`,
**36** to `IconButton`.

★★ **The glyph baseline in the slice plan is not reproducible under the filter that plan's own
command states, and the difference is not drift.** **11 of the 13** quoted figures (`•` 21 · `✓`
17 · `▲`/`▼` 17 · `↑` 12 · `⚠`/`⋮`/`↓` 9 · `▸` 4 · `▾` 3 · `🗒` 2) match `src/app` scanned with the
`--include=*.tsx --exclude="*.test.tsx"` filters **not in effect** — `.ts` files and test files
included. Under the stated filter the same glyphs measure 7 · 10 · 14 · 5 · 8/2/4 · 4 · 3 · **0**.
★ The two that do NOT match are the two the sweep is sized from: `✕` measures **42** (not 47) and
`×` measures **73** (not 75); under the stated filter they are **19** and **20**, not 24 and 22.
Two things follow. The `🗒` count is not UI at all — both hits are in the generated
`operating-guide-builtin.generated.ts`, and there is **no `🗒` glyph anywhere in the app's markup**
(the notes badge renders an icon at `notes-badge-button.tsx:32`). And `×` inflates 20 → 73 mostly
because test comments are full of arithmetic, so the multiplication-vs-close-glyph triage the plan
calls "the main manual work" is about a third the size it looks: of **20** real `×` lines, **6** are
multiplication or prose and 14 are close glyphs.

★★★ **DO NOT VERIFY `🗒` WITH `grep` — it fails silently, in both directions.** `🗒` is U+1F5D2,
outside the BMP, and this environment's grep mishandles it: `grep -rlF '🗒' .` finds **nothing**
though the glyph is really in nine files, while a bracket expression containing it matches **every**
non-BMP emoji (`printf 'a 📎\nb 🚀\nc 🗒\n' | grep -c '[✓🗒★]'` → **3**). The `🗒` = 2 figure above
was confirmed with node, not grep, and is correct. Any glyph count attached to a reproduce command
must keep non-BMP characters out of the pattern.

★★★ **Six source sites have their glyph pinned by a test assertion, not the two the plan names.**
`report-table.tsx:148` (`report-table.test.tsx`, and again via `SortResizeTh` in
`calendar-series-list.test.tsx`) were known. The four that were not: `task-status-glyph.tsx` 54/56 ·
`dashboard-panel.tsx:364` · `entity-link-picker.tsx:222` · `milestone-horizon-strip.tsx:46`.
Distinguish them from the ~10 test files that merely mention a glyph in an `it(...)` title — the
inventory lists both sets so the distinction is not re-derived.

★★★ **A fifth was listed here as pinned and is NOT: `raid-panel-rows.tsx`.** `raid-panel.test.tsx`
115/122/131 match it with `getByRole("button", { name: /^Severity( [▲▼])?$/ })` — the glyph sits in
an **optional** group, so the name `"Severity"` matches just as well and blanking the glyph does not
fail the test. It is a locator written to *tolerate* the glyph, not an assertion that requires it.
★★ **A `getByRole` name regex containing a glyph looks identical to one asserting it** — check for a
`?`/`*` around the glyph before calling anything pinned. Nothing else in that file reads `▲`/`▼`.

★★★ **THE `raid-panel-rows` a11y CONCLUSION PREVIOUSLY RECORDED HERE WAS FALSE, AND IT INVERTS.**
This entry claimed its seven `<th>` were "raw `<th>`s with no `aria-sort` (unlike `SortResizeTh`)",
so blanking the glyph "would leave sort direction with **no** channel to assistive tech at all".
**All seven set `aria-sort`** — `raid-panel-rows.tsx` 107, 115, 123, 131, 140, 148, 156;
`grep -c aria-sort src/app/raid-panel-rows.tsx` → **7**. `AGENTS.md:965` already said so
("`change-panel.tsx` + `raid-panel-rows.tsx` + `stakeholders-panel.tsx` set aria-sort AND keep a
▲/▼ inside the button's name"), so a correct line of the always-loaded file was contradicted here
for a whole release. What is actually true is the opposite: RAID sets `aria-sort` **and** repeats
that state in the accessible name — the same **double announcement** `SortResizeTh` was changed to
eliminate. Blanking the glyph removes a redundancy and leaves `aria-sort` standing, so **RAID is an
argument for the sweep, not a hazard against it**. ★ Six of the seven headers carry the glyph in
their name; the seventh (`id`, button at `:108`) has `aria-label={t(lang,"id")}`, which overrides
content, so its glyph is in `textContent` only.

★★★ **The "no channel at all" warning is real and belongs to three OTHER files** —
`activity-log-panel.tsx`, `resource-directory.tsx` and `roles-editor.tsx`, whose `aria-sort` count is
**0** each. There the glyph IS the only sort-state channel and an `aria-hidden` SVG would delete the
information. **Any glyph sweep must `grep -c aria-sort` the file before touching the indicator** —
that one command distinguishes the two groups, and it is cheaper than the review round that missed it.

★★ **`Button` is step one; the variant is step two.** The insights panes in this very release already
had `Button` — what changed was the variant, because ghost renders no border. Converting a
bordered-surface `<button>` to `Button variant="ghost"` deletes its border silently, and jsdom cannot
see it. Match the variant to the current look and eye-verify.

★★★ **AND THIS RELEASE'S OWN BUDGET CONVERSION BROKE THAT RULE IN THE OTHER DIRECTION — eye-verify
it.** Three of the four `budget-panel.tsx` sites (now `<Button>` at 668, 675, 684) read
`rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground
hover:border-ui-dark-blue hover:bg-surface-muted` at `4dd13660` (`git show
4dd13660:src/app/budget-panel.tsx`) — a **ghost**-looking control that only grows a border on hover.
Moving them to `secondary` gives them a permanent border they never had. Only the fourth (`:380`,
`border-ui-dark-blue bg-surface px-2.5 py-1.5`) was a genuine bordered-surface button. So the
worked example the inventory offered for this rule was in fact a counter-example, and it was
described as having carried the bordered class string "verbatim", which none of the four did.
★ The rule stands; the release may need a follow-up to `ghost` on those three if the new border is
unwanted. That is a look decision, so it needs eyes, not a test.

★★ `ButtonVariant` is `"primary" | "secondary" | "ghost" | "destructive"` (`button.tsx:15`). There is
**no `danger` variant on `Button`** — `danger` belongs to `IconButtonVariant` (`icon-button.tsx:14`),
and the inventory named it twice for `Button`, where it would not compile.

★ Two deliberate non-conversions, recorded so they are not re-litigated: the budget bucket drag
handle (`budget-panel.tsx:455`) carries `draggable`, the drag lifecycle **and** arrow-key reordering,
none of which `Button` forwards; and `milestone-edit-modal.tsx`'s `linkedTasks` checkboxes stay real
checkboxes, because a multi-select list is not a binary toggle and `aria-pressed` would announce each
row as a button rather than a checked item in a set.

★ The largest single conversion family is ~26 close/remove/clear controls spelling the same idea
three ways (`×` U+00D7, `✕` U+2715, `&times;`), all already carrying an `aria-label`. `XMarkIcon` is
imported in 13 files already, so converging them adds no dependency — and since each is also an
`IconButton` candidate, the element and the glyph are one edit, not two.

★ Nothing here is gated. `npm run docs:symbols:check` proves only that a backticked mixed-case name
exists somewhere in the tree, and skips every `SCREAMING_CASE` name outright; axe has no rule for a
hand-rolled control that a primitive would have done better. Re-measure before quoting any count
above.

---

## Provenance — where these items came from, and what already closed

Absorbed from three now-unreachable documents. Kept because it explains why an item is worded the way
it is, and because several entries are **negative results** — work already done that returned nothing,
which is exactly the kind of thing that gets re-run.

### post-0.226.0 — the snapshot baseline-poisoning slice (§77 closed · §78 half)

Triage slice 1 of the harm-ranked pass over this register. No version bump — no user-visible surface
changed, only what the Trends auto-capture is willing to write.

| was | what closed it |
|---|---|
| §78 empty project auto-captures, and that row is the BASELINE | pure `hasCapturableContent` in `snapshot.ts`; the auto-capture effect declines. Gates the CAPTURE, not `isFirstEver` — `pickBaseline`'s earliest-row fallback defeats gating the flag. ★ Only the ALL-null case closed; §78's partial-KPI case is still open, see its body |
| §77 the capture gate is a one-way latch | `loadedBackend === backend` derived in RENDER, plus a re-stamp in the load effect's suppress branch |

★★ **An entry's suggested fix is a hypothesis from the day it was written, not a finding** — this
file has no gate over it. §77 prescribed ref+state; deriving in render is strictly stronger and
simpler, and was forced anyway by fatal `react-hooks/set-state-in-effect`.
★★★ **But CHECK what an entry actually said before crediting it with an error.** A draft of this
block led with "both entries' own prescriptions were wrong". §78's did not: it read *"gate
`isFirstEver` (or the auto-capture itself) on the workspace having content"* — the parenthesis is
exactly what shipped. Only the IN-CODE comment derived from it named just the wrong half. **That
sentence was a new falsehood written inside a correction of an old one**, in the block whose own
lesson is that corrections are where falsehoods breed. A cold fact-check caught it; nothing else
would have.

★★★ **§77's own objection (a) came true against the fix that was supposed to avoid it.** The plain
identity change strands the gate closed on the `suppressNextLoadRef` path — exactly the failure the
entry named as disqualifying — because `applyWorkspace` is a plain render-scope function and stamps
the PREVIOUS backend. It was caught by re-reading the entry's warning against the new code, *after*
the change had been reported green. **A green suite is not a disproof of a documented hazard** when no
test drives the hazardous path — and none did, which is why test 2 in §77 exists. When an entry names
a failure mode as disqualifying, re-run that argument against whatever you replace it with.

★★ The measured arm-site count is **seven**, not the six the plan assumed — `onRequestStorageSwitch`
arms the ref without calling `applyWorkspace` at all. Reproduce with the grep in §77's body. The extra
site strengthened the fix: it forced the invariant to be stated as "render scope holds the workspace
that BELONGS to this backend" rather than the narrower "was loaded from it".

★★ **TWO cold passes were needed, and they found disjoint things.** One over the CODE found no
correctness defect but several inaccurate comments — including a ★★ rationale that was exactly
backwards (it claimed a shared mock would make a test pass either way; it makes it FAIL either way)
and a `file:line` citation **broken by the very hunk that wrote it**. Cite the SYMBOL. A second pass
over the PROSE ALONE, run because this slice had just rewritten a lot of it, then found three false
claims the code reviewer had read straight past — including the one retracted above. **Reviewing code
and fact-checking prose are different jobs; a reviewer doing the first will not do the second.**

★ In both passes, roughly one finding in six was itself wrong on analysis (the code reviewer read the
empty-load guard's shut gate as a regression; a shut gate is correct there). That is the expected
yield from a cold read — take the findings, re-derive each one, and say which you rejected.

### post-0.216.0 — the cancelled-work leftovers (§66 · §67 closed · §64 · §65 half)

Branch `fix/cancelled-work-leftovers`; no version bump decided at time of writing. Slice 2 of the
harm-ranked triage of this register, taken because 0.213.0 fixed the Reports and Dashboard headline
surfaces and then stopped at the branch boundary.

| was | what closed it |
|---|---|
| §65 (half) tooltip says "completed" under a ✕ | a THREE-way health driver — `cancelled` / `completed` / `closed` — plus the `healthDriverClosed` key. Its SECOND symptom — the UI calling such a row "cancelled" — is open, and this slice added two more strings that do |
| §66 R/A/G counts a cancelled task Green | out-of-scope work leaves the tally into `GroupHealth.outOfScope`, surfaced on the tile and the reports cards |
| §67 committed NUL byte | the source escape `\u0000`, plus `no-nul-bytes.test.ts` as a ratchet |
| §64 (half) presentation + model feeds | portfolio table + `avgCompletionPercent` + steering draft + AI snapshot; the two PERSISTED figures stay open by decision |

★ One shared predicate underpins all of it: `isTaskOutOfScope` (`task-closed.ts`), which `scopeCounts`
and `computeGroupHealth` now both call. Those two render side by side in ONE dashboard card, and a
second copy of `isTaskClosed(t) && !isTaskDelivered(t)` is the drift `hasNoActiveScope`'s own doc
comment records having already caused once.

★ **TWO of the four entries carried a faulty prescription.** §67 weighed `|` and a space, noted both
were merely UNLIKELY to collide rather than unable to, and accepted that instead of looking for the
option with no drawback. §65 wrote "**Fixing the drivers fixes both**" — and it does not: the second
symptom is gated on `hasNoActiveScope` → `scopeCounts` → `isTaskOutOfScope`, which never consults a
health driver, so no driver change could reach it. (§65's OTHER prescription, "not `status` alone",
was right but UNDERSPECIFIED — it does not say the split is three-way.) §66 was sound. §64's
DIAGNOSIS was incomplete — its surface list missed `aggregatePortfolio`.

★★★ **THAT NUMBER HAS NOW BEEN WRONG IN BOTH DIRECTIONS, BY THE SAME MECHANISM.** Draft 1 said
"all three". Draft 2 — a correction — said "TWO of the four" and listed three items under it. Draft 3
— a correction of the correction — said "ONE", and got there by stopping at the §65 clause it had
already argued about ("not `status` alone") without reading the entry's OTHER prescriptive clause
four lines below it. Over-count and under-count are the same failure: **deciding the shape of the
answer first, then reading only far enough to confirm it.** Draft 3 also asserted §65 was "recorded
as sound in its entry" while §65's own text said "UNDERSPECIFIED" — flattening a concession the same
author had written.

Each wrong draft is worth keeping, because the two DIRECTIONS of error had different causes.
Over-counting came from misquoting; under-counting came from stopping early.

- **§65, over-counted** — draft 1 paraphrased "consult `completedDate`, **not `status` alone**" as
  "INSTEAD OF `status`" and refuted the paraphrase. The clause means consult BOTH, which is what
  shipped. But draft 3 then over-corrected to "sound": the entry's OTHER prescriptive clause,
  "Fixing the drivers fixes both", IS wrong. Both drafts read one clause and stopped.
- **§66, over-counted** — draft 1 attributed an `overallComputed` clause to the entry. The entry
  never mentions it: `git show f9e17f9e:docs/open-followups.md | grep -c overallComputed` → **0**.
  That one was a clean over-count; §66 really was sound.

Same error, same document, same commit — and the commit that fixed §65's misquote published the rule
("quote the entry inline before criticising it") while leaving §66's standing, because it searched
for the §65 WORDING instead of the SHAPE. **Slice 1 (§77/§78) made this identical mistake a week
earlier.** Four drafts, three of them wrong, every one written while criticising someone else's text.

★★ The durable lessons, in order of how much they cost here: **(1)** a pattern you are pleased to
have found is the one to re-check — a category claim ("all three", "every X") invites pressing
non-instances into it, and then over-correcting invites pressing real instances OUT; **(2)** when you
retract one instance of an error, grep for its SHAPE, not its words; **(3)** quote inline, because
every claim in this block that survived scrutiny is one where the quote is present; **(4)** read the
WHOLE entry before judging its prescription — §65 has two prescriptive clauses four lines apart and
three drafts in a row read only one of them.

★ Opened by nothing. The one new surface found (`avgCompletionPercent`) was folded into §64 rather
than numbered, because it is the same defect on the same value, one call frame up.
### post-0.212.0 — the machine-unblocking slice (§2 closed · §58 half · §51 hardened)

Branch `chore/machine-unblocking-slice-1`; no version bump (nothing user-facing shipped).

| was | what closed it |
|---|---|
| §2 planner over the ratchet | two verbatim extractions — `use-reference-data.ts` (308) + `use-resource-directory.ts` (344); planner 1043 → 553, baseline re-recorded 554 |
| §58 axe gate can scan a stale server | `data-app-version` on the server-rendered `<html>` + a guard test in `e2e/a11y.spec.ts`; **half** — the sibling-worktree case is untouched |
| §51 fragile `/dup/i` matcher | `findByRole(/merge selected/i)`; the flake **mechanism is still unestablished** and the entry stays open |

★★ **Every quantified claim in the entries this slice touched had to be re-measured, and two were
wrong.** §2 recorded 1037/1038 when the real state was 1043/1043 — zero slack, not one line — because
0.212.0 had grown and re-baselined the file without revisiting the entry. §2 also named the wrong
extraction precedent (`use-storage-file-ops.ts`, which is for `task-manager.tsx` orchestration) when
the applicable one was `use-calendar-events.ts`, extracted from the same file for the same reason.
Neither error was visible from the entry itself; both surfaced only on measuring. **This is the
mechanism this whole file warns about** — the prose has no gate, and a number written eight releases
ago is a historical record, not a fact.

★ Opened by the slice: **§59** (eye verification owed, third release running), **§60** (the ratchet
ignores sub-limit files, so §2's new baseline entry is inert), **§61** (three residuals from the
split), **§62** (two handlers with no production consumer, pre-existing).

★★ **And the review of the slice found four more falsehoods in prose the slice itself had just
written**, two of them inside corrections of earlier falsehoods: `use-reference-data.ts`'s header
asserted "14 of the 15 reach only RolesPanel" while correcting a different wrong claim (the true
split is 12 / 1 / 2 dead); §2's bullet said "reach only `RolesPanel`", contradicting the very header
comment it defers to; and §60's index row plus §2's cross-reference both still pointed at the
`--update` trap that §60's own body had retracted **in the same commit**. Correcting a claim is when
you are most likely to write a new one — re-measure the replacement, and grep every pointer to a
paragraph you just rewrote.

### 0.211.1 — the small-correctness batch (§11 · §14 · §15 · §29)

| was | what closed it |
|---|---|
| §11 abort check misreports a cancel | pure `abort-error.ts` `isAbortError` (reads `.name`, never `instanceof`), applied at all four sites; the two that also read `signal.aborted` keep that short-circuit |
| §14 two per-device keys | actuals cache re-keyed to the canonical id, **no fallback** — a pre-existing cache is orphaned and refetched once |
| §15 two file-picker shapes | `FilePickerButton`; theme-gallery, color-scheme-editor **and** branding-image-input migrated |
| §29 dead `form.noteLog` | field removed from `emptyForm`, so the derived `TaskFormDraft` dropped it and `tsc` found every stale literal |

★★★ **THE BATCH'S OWN LESSON: three of the four entries were WRONG about their own fix, and only
review caught it.** §11 recommended leaving two sites alone (defensible, overridden — see there) —
and, it later turned out, was wrong about the defect *existing at all* (see §11's own correction).
§14 specified a read-both migration that shipped and had to be **reverted**, then a migrate-once
variant that was specified and rejected before it was built. §15 scoped itself to two call sites when
there were three, and looking at the third and the excluded fourth produced §46 and §47. An entry in
this register records what was known when it was written, and that is not the same as what is true when
you come to act on it — **re-derive the fix, do not just execute the entry.**

★★ **Vacuity kept being the real risk, not correctness.** Most tasks ended with a deliberate mutation
to prove the tests discriminate, and that step earned its keep repeatedly: 6 of 7 new store tests
passed *before* the fix (extra arguments are runtime no-ops in JS, so a two-arg call against a one-arg
function ignores the second silently); a control test asserting a genuine error still errored passed
both before and after; and the §14 panel wiring turned out to be pinned by **nothing** until a test was
added for it specifically. A green suite said almost nothing on its own.

★★★ **AND THE MUTATION STEP WAS ITSELF SKIPPED ONCE — this paragraph originally claimed "every task",
which review disproved.** `file-picker-button.test.tsx`'s "fires again when the same file is picked
twice" shipped VACUOUS: it minted a **fresh `File` per upload**, and user-event skips the change event
only on OBJECT IDENTITY (`upload.js`, `files.every((f, i) => f === input.files.item(i))`), so the event
fired regardless and deleting `e.target.value = ""` left it green. The one property of the new
primitive with no other coverage had a test named for it that could not fail. Fixed by hoisting a
single `File` instance and re-mutating: reset removed ⇒ that test alone fails; `aria-hidden` removed ⇒
the new AT test alone fails. ★ **Both reviewers found this independently**, one primed and one cold —
the strongest possible signal, and worth more than either verdict alone.

★ Not fixed, recorded instead: the `-strong`-token and `dup:check` observations stand, and the three
hand-written correct abort reads (`chat-panel`, `use-alloc-plan`, `use-raci-suggest`) were left alone.

★★ **Review round 2 (post-release, pre-merge) also corrected the DOCS in three places** — each a claim
contradicted by the code it described, in the batch's own final docs commit: AGENTS.md said the
note-count was "a literal `0`" when the code shows none; it called `FilePickerButton` the "ONLY
sanctioned way to open a file dialog", which reads as flagging `step0-import-panel.tsx`'s perfectly
correct VISIBLE input; and the note-log guarantee was written as if app-wide when RAID still has the
whole defect (§48). The register is not exempt from the rule it exists to enforce.

### 49-finding audit campaign (2026-07-06 → 07-10) — **37/49 merged**

Batches A (data-integrity/error-transparency, MR !212) · B (render-perf, !213) · D
(small-correctness, !214) · C (a11y/interaction incl. the branded `ConfirmDialog`, !215) · E (search
+ cross-view focus + activity diff, !216) · design sub-batch (calendar roving grid + collapsed-rail
flyout + mobile drawer, !217) · #24 workload-actionable (!219) · #23 Gantt milestone ghost bars
(0.171.0 "Gibson", !233) · #7 weekly status digest (0.172.0 "Corey", !234) · #11 undo (0.173.0
"Jordan" + 0.174.0 "Egan"). Batch F is complete. What survived is items §4, §5 and §6 above.

★ **Systemic entity id-mint race — fixed 0.170.2 "Doctorow" (!232); the landmine is now recorded in
AGENTS.md** (Phase-3 extraction conventions, "Per-entity CRUD hooks"), added 2026-07-27 because it
had survived only in this campaign doc and the memory files. Entity "Add" modals precompute an id at
modal-OPEN; save handlers decided create-vs-update by id-EXISTENCE, so a concurrent writer taking
that id between open and save made the save follow the replace path and **silently clobber the
concurrent row**. Fix: pure `entity-id-mint.ts` `resolveEntitySave` decides by the modal's **intent**
and re-mints when the open-time id was taken.

★ Re-verified against 0.203.0 while promoting it, and the campaign doc's coverage claim was already
out of date: `resolveEntitySave` now has **five** call sites — calendar events joined in R5 — and the
"only Resources was safe" line needs two corrections. Resources is not an exception to the pattern; it
hand-rolls the same semantics inline plus an extra concurrent-delete guard the helper's callers lack.
And **tasks were never exposed at all**, deciding on `editingId !== null` rather than id-existence.

### 0.210.0 "Larbalestier" — nine of the twelve rich-text items closed

Slice B (0.209.0) opened §16–§28. This release closed eight of them outright and narrowed a ninth.
Recorded here rather than deleted, because two of the nine did not end where they started.

| was | what actually closed it |
|---|---|
| §17 exports run on one line | `separateBlockBoundaries(html, sep)` and `htmlPlainProjection(html, {preserveBreaks})` took opt-in break modes, default byte-identical; `descriptionTextWithBreaks` composes them; the renderers map the newline (`<br>` in HTML/PDF, `<w:br/>` in DOCX, one `<a:p>` per line in PPTX, XLSX already preserved it and is now pinned) |
| §18 tasks export raw HTML | `TASK_RICH_COLUMNS` — `Task.description` exports as projected text |
| §19 descriptor names `notes` | renamed to `description`; `chat-tools` keeps `notes` as a deliberate **write alias**, because a stored insight recommendation replays its `proposedCalls` verbatim |
| §20 `applied[f]` untestable | `FieldDiff.raw` exposes the verbatim applied value |
| §23 five consumers fuse boundaries | all five moved to `descriptionText` |
| §25 guard doesn't follow imports | pins import **specifiers** (any quote style, static or dynamic) and sweeps the reverse direction, with a scanned-file count so it cannot pass vacuously |
| §26 Enter-submit counts an unapplied truncation | the plain-text caps now apply on the saved object |
| §27 three doc claims | 1–2 corrected in comments; 3 fixed — `CharCounter` is fed the upgraded value `capRich` measures |
| §24 numeric entities | **narrowed, not closed** — see §24 above; the named tail is still open |

★★ **§17 needed a third change the plan did not call for.** `htmlToText`'s default `\s+` collapse
destroyed the very newline the caller had just inserted, so it took `{preserveBreaks}` too. A
break-preserving projection composed in front of a whitespace-collapsing one is a no-op — worth
knowing before designing the equivalent for any other pipeline.

★★★ **§20 was not the tidy seam it was filed as — making the invariant observable proved it FALSE.**
The entry said the raw-vs-projected distinction "is correct today and is load-bearing", unobservable
but sound. It was not sound: `use-inline-entity-edit.ts` applied `diff.after`, the **projected preview
text**, so every inline "Ask Claude" edit of a rich field wrote flattened plain text over the user's
markup — all seven `RICH_FIELDS`, live since the feature shipped. Fixed in the same release
(`a502c081`, `diff.raw ?? diff.after`; the `?? after` arm is load-bearing for sanitizer-induced enum
resets, which carry no `raw`). ★ This was a live data-loss bug **found by the fix that made it
visible**, not a known issue anyone had deferred — the register had it filed as a testability chore.
The general lesson is the one to keep: an invariant defended only by a code comment is a claim, and
the cheapest way to find out is to expose it.

★ §19's rename forced `RICH_FIELDS` to move in lockstep — its keys are entity-qualified
`task.<field>`, read off the descriptor's spelling, so renaming one without the other drops the task
out of the set and silently stops projecting the preview. `plan.test.ts:228` pins that coupling.

★ The old §27 carried a fourth, unrelated observation about `form.noteLog`. It was **not** a doc
claim and was not fixed — it is now **§29**, so closing §27 did not quietly retire it.

### R5 calendar overhaul (0.202.0 "Beukes") and its three follow-up batches

- **0.202.1** — calendar-event activity log + undo, the de-recurring hint, empty-`localModifiedAt` in
  `sanitizeAbsence`/`sanitizeShift`, `gantt-engine`'s duplicate `addDays`.
- **0.202.2** — band chips folded into a roving group, series-list sorting, `RaidCausedByField` and
  `TaskLinkPicker` unified behind `EntityLinkPicker`.
- **0.202.3** — the a11y batch: `SortResizeTh` emits `aria-sort` with the glyph `aria-hidden`;
  `EntityLinkPicker` became a real combobox; the inert chip's remove button names the entity; band
  chips took a keyboard reschedule; focus returns to a surviving chip on unmount; colliding chip names
  get a discriminator; `--ui-purple-strong` is derived against the composited purple tint instead of
  `--surface-muted` (guarded by `scheme-purple-hover.test.ts` across the built-ins **and** the shipped
  `public/themes/*.json`).

★★ **Negative result — do not re-run this sweep.** After the `--ui-purple-strong` fix, a repo-wide
scan for lines carrying both a `-strong`/`-text` token **and** a `hover:bg-*` tint returned **16
sites**. Fifteen are the `ui-pink-strong` family and **every one clears AA in all six built-in
combos**, worst case 4.71:1. The RAID chip was the only real failure. It was a point fix plus a guard,
not a systemic problem.

★ Also already-resolved when that batch started: the `package.json` / `version.ts` drift — both
already read `0.202.2`.

---

## Standing notes for whoever picks these up

★ **Not one of the a11y items here is covered by the axe gate — for two different reasons.**
*Never scanned:* Resources defaults to the directory sub-tab so Calendar is never reached (§1, §10);
the Kanban board is not scanned (§5, the gate sees the table view); the link picker only lives inside
edit modals the gate sees closed; the tour is not in `A11Y_VIEWS` (§8). *Scanned but invisible to
axe:* there is no rule for `aria-modal` without a focus trap (§8) and none for a missing or duplicated
`aria-sort` (§9), so RAID and Activity pass at 85/85 with the defect present. The vitest suites are
the only automated coverage for any of it.

★ **One stale AGENTS.md claim was found during this sweep and CORRECTED in place (2026-07-27), not
carried here.** Its `CalendarEvent` section said the empty-string `localModifiedAt` bug was "still
live in `sanitizeAbsence` and `sanitizeShift` … deliberately left alone in this release". It was
not — 0.202.1 fixed both (`sanitize-entities.ts:100` and `:185` read
`sanitizeText(raw.localModifiedAt, 1024) || undefined`) and the sentence outlived the fix. The bullet
now states the general rule instead, and adds the distinction that bit nobody yet: the
`sanitizeResource` / `sanitizeRole` / `sanitizeNamedRef` / budget-bucket arms use
`if (typeof x === "string" && x)`, which is truthiness-guarded and already correct — so a reader
sweeping for the pattern does not "fix" four call sites that were never broken.

★ Worth knowing for the next sweep: that claim survived because a landmine bullet's *tail* is where
resolution status lives, and nothing re-reads tails. When closing a follow-up, grep AGENTS.md for the
symbol you fixed — not just the register.

★ **Release procedure** (learned during the audit campaign, still binding): NEVER
`glab mr merge --auto-merge` — it checks the BRANCH-head pipeline, not the
`refs/merge-requests/<iid>/head` pipeline, and merges INSTANTLY pre-green (bit twice). Push → create
MR → poll the MR-ref pipeline to `status:success` yourself → plain
`glab mr merge <iid> --remove-source-branch --yes` → sync main → confirm the post-merge MAIN pipeline
green. Gates: `npx tsc --noEmit` · `npm run lint` · `npm run size:check` · `npm run test:run` ·
`npm run dup:check` · palette guards · axe. Internal a11y/refactor work = **no version bump**.

## 103. An over-cap load silently and permanently destroyed the excess documents — CLOSED

**This is NOT a regression the S2 slice introduced, and it is not theoretical — it destroys
user-authored content today.** `MAX_DOCUMENTS` and its `break` arrived with the document model in
`90199c26` ("feat: canonical project document model and sanitizer"), which is an ancestor of `main`
and **shipped in 0.219.0 "Elgin"**. S2 introduced only the phantom-deleted-documents *consequence*
(see below), not the loss. Establish that before quoting this entry — reading it as an S2 regression
sends someone hunting through this slice's diff for a cause that is not there.

```bash
git log --oneline -S "out.length >= MAX_DOCUMENTS" -- src/app/document-model.ts   # 90199c26 only
git merge-base --is-ancestor 90199c26 main && echo "already shipped"              # already shipped
```

### What was measured

`sanitizeProjectDocuments` (`document-model.ts`) stops at `MAX_DOCUMENTS` (**200 at the time of this
measurement**; the fix raised it to 1000 — everything below records the defect as found) with a bare `break`.
Nothing records that it truncated. Load an over-cap file, let autosave fire, and the excess documents
are gone from storage:

```
--- RE-SAVE ---
original file: 205 docs / 205 versions
after load:    200 docs / 205 versions
after re-save: 200 docs / 205 versions
documents PERMANENTLY LOST by load->save: 5 ["Doc 201","Doc 202","Doc 203","Doc 204","Doc 205"]
```

**All six write paths, identically** — the cap is not per-path, so JSON · IndexedDB · Turso single ·
Turso tenant · CSV · Markdown all inherit it:

```
--- OVER CAP n=205 (MAX_DOCUMENTS=200) ---
json          in 205d/205v -> out 200d/205v | phantoms 5 | discriminator(ai+delete) kept 205
csv           in 205d/205v -> out 200d/205v | phantoms 5 | discriminator kept 205
markdown      in 205d/205v -> out 200d/205v | phantoms 5 | discriminator kept 205
turso-single  in 205d/205v -> out 200d/205v | phantoms 5 | discriminator kept 205
turso-tenant  in 205d/205v -> out 200d/205v | phantoms 5 | discriminator kept 205
indexeddb     in 205d/205v -> out 200d/205v | phantoms 5 | discriminator kept 205
```

★★ **Reproduce**: a temp vitest file (jsdom + `fake-indexeddb` come from `vitest.setup.ts`, so no
manual JSDOM install is needed) that builds a 205-document workspace and round-trips it through
`workspaceToJson`/`jsonToWorkspace`, `workspaceToCsv`/`csvToWorkspace`,
`workspaceToMarkdown`/`markdownToWorkspace`, `workspaceToStatements`/`rowsToWorkspace`,
`tenantWorkspaceToStatements`/`rowsToWorkspace`, and `BrowserBackend.save`/`load`. **Keep it out of
`src/app`** — a `*.test.ts` there is picked up by the lint gate and the full-suite glob while it
exists, which cost another agent a red `eslint --max-warnings=0 src/app` run when this was measured.

★★ **The control is what makes the numbers mean anything.** A probe where the structural sanitizer
silently dropped *every* version would print `phantoms 0` and read as a clean result. Two controls
rule that out: at n=195 every path returns `195d/195v` with **0** phantoms, and the
`discriminator(ai+delete) kept 205` column counts versions carrying `source:"ai"` + `op:"delete"` —
neither is a sanitizer fallback (`"user"` / `"update"` are), so 205 proves real data crossed all six.
The fixture also deliberately avoids `op:"restored"`, which the tombstone derivation excludes and
which would have hidden the very artifact being measured.

### It is independent of `documentVersions`, and the engine cap does not touch it

`document-mutations.ts` now refuses creates past the cap — verified: 205 `create` calls through
`applyDocMutation` yield `200 docs`. That stops the app **building** an over-cap state; it does
nothing about **loading** one. The exposure is any workspace not produced by the current engine: a
hand-edited JSON, a third-party or imported file, or data written before that guard existed.

### Related, same delegation: silent per-version block truncation

A version carrying more than `MAX_BLOCKS_PER_DOC` (500) blocks loads truncated, because
`sanitizeDocumentVersions` delegates per item to `sanitizeProjectDocuments`, which slices:

```
--- REVERSE (block cap 500) ---
blocks per version: in 525, out 500
version COUNT cap probe: in 1200 versions -> out 1200
```

So restoring such a version hands back a **truncated document body with no indication**. History
corruption rather than loss, and lower severity — but silent by the same mechanism, which is why it
belongs in this entry rather than its own. ★ Note the second line: there is **no count cap on
versions at all**, so history is never truncated while documents survive. That direction was checked
and is clean.

### The decision that was taken — CLOSED

All three candidate ends were on the table (surface it · refuse the load · raise the cap). **The
third was chosen and combined with the first**, because neither alone is sufficient: raising the cap
alone still destroys data for whoever exceeds the new number, and surfacing alone leaves the data
dying with a warning attached. Refusing the load was rejected outright — it locks a user out of
their own legitimate project with no in-app route to get back under the cap.

What shipped:

1. **`MAX_DOCUMENTS` 200 → 1000**, and deliberately still **ONE constant serving TWO doors** — the
   load-time truncation *and* the engine's create/duplicate/restore refusals. A separate
   `MAX_DOCUMENTS_LOAD` was considered and rejected: a load cap above the create cap means a
   legitimately-loaded project cannot be edited, which is the "one door of two" shape that produced
   six defects in S2.
2. **The truncation is counted**, via an optional `DocTruncationDiag` threaded into
   `sanitizeProjectDocuments` and `sanitizeDocumentVersions`. It counts **raw array entries** past
   the cap, not validated documents — an exact count means sanitizing the whole tail, which is the
   unbounded work the cap exists to refuse. It is an UPPER BOUND, never an undercount, which is why
   every user-facing string says "entries".
3. **Every backend publishes `lastLoadTruncation`**, netted by
   `backend-truncation-registry.test.ts` — a vitest unit test (NOT a build step) scanning a
   hardcoded list of the four backend files. The cautionary precedent is `lastImportDroppedRows`,
   which reached two of the FOUR backends for its whole life without anything noticing — Turso and
   IndexedDB silent throughout — because its consumer sits in `use-storage-file-ops`.
   ★★★ THAT NET GUARDS THE PRODUCER SIDE ONLY, AND THE FIRST VERSION OF THIS ENTRY DID NOT SAY SO.
   It shipped calling itself "the one-door-of-N guard" while the CONSUMER reached one load path of
   seven — the six others (project switch, file open, Turso switch, reload) suppress that effect via
   `suppressNextLoadRef` — so the register recorded this as closed while the original data loss was
   still fully live on every route except first mount. Fixed by routing all of them through
   `truncationOps.reportFor`, with a behavioural test per path. **A source scan proving a name
   exists is not a claim that anything reads it.**
4. **One consumer**, reached from every load path that applies a workspace — diagnostics-ring entry,
   toast, and a STICKY flag. Sticky is load-bearing: `suppressNextSaveRef` beside it is one-shot AND
   is set by every load, so it clears on the first debounce cycle and the loss lands on the *next*
   save. Reusing it would have bought nothing. ★ Two loads deliberately do NOT report and say why at
   the call site: the empty-load refusal applies nothing, and `onOpenStorageFile` applies tasks+raid
   only and never the loaded documents. ★★ A CLEAN load must LOWER the flag — it did not at first,
   so one over-cap project blocked saves in every project opened after it while the banner asserted
   the innocent project's documents could not be opened.
5. **Saves are paused** until the user decides, so the stored project keeps what was never loaded.
   Neither existing invariant would have caught this: dropping 205 of 1205 leaves 83%, nowhere near
   guard B's ≤10% threshold, and documents are not counted by those guards at all (§98).
   ★★★ "AUTOMATIC saves are paused" is what this entry said first, and it was FALSE — the refusal
   sat only in the debounced effect, while SEVEN other sites wrote the live workspace directly
   (four project-switch flushes, the Turso flush, `onPickStorageFile`, `onRequestStorageSwitch`).
   The pre-switch flush was the cruellest: the banner told the user saving was paused, and switching
   project — a reasonable response — committed the loss. All writes now go through `flushCurrent` /
   `guardedWrite`; the two explicit user actions refuse LOUDLY and skip their success toast, because
   a save the user asked for must never appear to have happened.
   ★ The truncation refusal also CONSUMES `allowDestructiveRef`. It did not at first, so a one-shot
   destructive bypass armed during a paused period stayed armed indefinitely and could authorise an
   unrelated mass deletion later.
6. **A persistent banner with an explicit "Save anyway"**, not merely a toast. ★★★ This is not
   polish — it is what stops the guard being a LOCKOUT. **The user cannot get under the cap by
   editing**: the excess documents were never loaded, so the rows that would have to go are exactly
   the ones that are not there. A sticky flag with no escape would be a permanent block on saving,
   a worse defect than the one being fixed.
   ★★★ DISMISSING IT WAS THAT LOCKOUT FOR ONE REVISION. `truncationBannerDismissed` was never reset
   and the refusal was a bare `return` with no toast, so a single ✕ silently dropped every later
   edit to every entity for the session while the storage indicator read healthy. The sidebar footer
   now carries a "saving paused" state that is CLICKABLE to bring the banner back, so dismiss means
   "stop shouting", never "stop telling me". ★ `loadWasTruncated` is deliberately NOT folded into
   `storageOk`: two of that value's three consumers read it as "configured", so folding it in made
   `storage-config` print three FALSE diagnoses on a healthy file (write-permission-needed, a
   Grant-access button, Turso-needs-configuration). The term is applied at the footer call site only.

★ The fix landed at the load boundary and **not** in `sanitizeDocumentVersions`, as this entry
originally warned it must: making that function drop versions for truncated documents would delete
the only surviving copy of that content, turning a display defect into a second data-loss bug.

★★ Block truncation is counted by the same diag and surfaces through the same banner, with its OWN
string. Three traps for whoever edits that wording, all of them shipped-and-fixed rather than
theoretical:
  · The toast originally interpolated only the ENTRIES count while triggering on
    `entries + blocks > 0`, so a blocks-only truncation announced "0 document entries could not be
    opened". A test pins that case now.
  · The count originally compared `raw.blocks.length` against the POST-FILTER length, and
    `sanitizeDocument` both caps blocks AND drops invalid ones — so a single malformed block
    reported as truncation and, because any non-zero count arms the sticky guard, paused saving for
    the whole workspace. Reachable with no hostile file at all: a `dataSection` block whose key
    leaves `EXPORT_SECTION_KEYS` is dropped on every load thereafter, forever, after an ordinary
    refactor. It now counts against `MAX_BLOCKS_PER_DOC`.
  · LIVE documents were not counted at all — only stored versions. A 600-block document loaded as
    500 with an empty diag, on the same write-back path. Both are counted now, which is why the
    string says "stored documents" and not "stored document versions".
★ **No string may say the cap did the cutting.** The reason has CHANGED and the old one is stale:
it used to be that the counter included blocks dropped as invalid. It no longer does. The rule
survives because the count is raw entries past the cap, some of which the validator would have
rejected anyway — so it still over-claims rather than under-claims.

### How many rounds this took, and why that is the useful part

Two cold review rounds after the fix was "done", **seven CRITICALs total**, every one on a fully
green gate board — `tsc` · `eslint --max-warnings=0` · size · dup · docs-symbols · coverage (10k+
tests, floors met) · shuffle · build · axe. **The gates never once disagreed with a broken tree.**

Round 1 (4 reviewers) found the disclosure reached 1 load path of 7 and the refusal 1 write path of
8, the dismissal lockout, and the flag that never lowered. Round 2 (2 reviewers), against the FIX,
found three more:
  · `migrateCurrentProjectToTurso` — the same "abandon the original" shape, unguarded, then
    repointing the app at the short copy and reloading, after which the flag never re-raises.
  · **The classic layout still had the dismissal lockout.** `SidebarFooter` has ONE mount and it is
    inside `modernTree`. This was flagged during the fix as a "residual gap" and accepted as one; it
    was the same silent, permanent, session-wide save lockout, live in one of two layouts.
  · Two of round 1's own fixes had NO KILL LINE — deleting them left every gate green, because the
    `guardedWrite` backstop refuses through the SAME implementation and the states are
    indistinguishable to the existing assertions.

★★★ **THE GUARDS AIMED AT THE WRONG SIDE OF THE BOUNDARY, TWICE.** The registry test proved every
backend ASSIGNS the field and said nothing about anything READING it. Its replacement, a `.save(`
census, COUNTED rather than enumerated — so every added `guardedWrite(` bought back one ungated
write, a `guardedWrite(` inside a COMMENT counted the same, and the measured slack was 1. Both were
written specifically to catch this class of defect and both certified coverage that did not exist,
each while carrying a header asserting the broader reach. **A scan proving a NAME exists is not a
claim that anything reads it, and a scalar cannot express a per-site property.** The census now
enumerates by file and callee.

★ Owed and NOT closed by any of this: nothing has rendered the banner or the paused indicator in a
real browser. jsdom has no layout and the axe seed is nowhere near the cap, so the green axe run
never drew either surface.

### What is NOT in this entry

The **phantom deleted-documents** consequence — a truncated document's surviving version has no
matching document, which is exactly the tombstone shape, so `deletedDocumentVersions` reports it as a
deleted document. That is being closed separately by requiring `op === "delete"` in the derivation
(a real engine delete always leaves that op newest; measured 6 phantom rows → 1, the genuinely
deleted one). Do not read this entry as covering it, and do not re-open it here.

★ The two interact in a way worth knowing if the phantom fix lands first: after a truncating load the
document count sits at **exactly** `MAX_DOCUMENTS`, so the engine's own
`state.documents.length >= MAX_DOCUMENTS` guard refuses every restore —
`rejected=["document limit reached (<MAX_DOCUMENTS>)"]`. Any surface built on the deleted-documents
list will show rows whose Restore button always fails, with a message that makes no sense to a user
trying to recover a document. ★★ Do not quote a literal there: the number moved 200 → 1000 in this
fix, and two `documents-panel` tests broke because a FIXTURE encoded the old value implicitly — it
generated ids `10..MAX_DOCUMENTS+9` and pointed a tombstone at a hardcoded `999`, which sat outside
that range at 200 and inside it at 1000, so the restore resolved against an existing document and
the cap never refused.

---

## 104. The `ai.documentWrite` deep-link is still dead — `activityViewOf` has no production caller — open

`d7f1e0b9` wired the emitter: `use-document-tools.ts` now writes an `ai.documentWrite` row on every
AI create / update / delete that actually CHANGED something. Before it, the kind was registered in
four places and emitted from none.

★★★ **That did NOT make the deep-link work, and the reason is not the one the S2 review first
assumed.** The review recorded the deep-link as "unreachable for want of rows". Measured — wrong
mechanism:

```bash
grep -rn "activityViewOf|dashboard-activity-nav" src/ e2e/
#  -> src/app/dashboard-activity-nav.ts        (the definition)
#  -> src/app/dashboard-activity-nav.test.ts   (its unit test)
#  and nothing else
```

So `activityViewOf` has never been called from production code, for ANY activity kind — not just
this one. Rows now exist and carry `(id, title)` args; nothing routes a click on one anywhere.

★ The only consumer of `ActivityEntry.args` anywhere is `activity-log-panel.tsx`, which renders
`t(lang, ACTIVITY_KIND_TO_KEY[e.kind], ...e.args)`. And `activityAiDocumentWrite` has **zero**
placeholders in both EN and DE, so the id and title are stored on the entry and rendered by nothing
today. That is deliberate and matches `ai.inlineEdit`, whose string is also placeholder-free while
it passes `(id, title)` — the args are there for a future surface, not for the current label.

★★ Do NOT "fix" this by adding placeholders to the string. The open question is where a click on an
activity row should GO and which surfaces own that routing — a decision, not a one-liner. Wiring
`activityViewOf` for one kind while every other kind stays unrouted would be the same
one-door-of-two shape this slice hit six times.

---

## 105. CSV section markers are matched on RAW LINES, so a newline inside a quoted cell can switch the parser's section mid-row — CLOSED 2026-08-16

**Where:** `csv-codecs-decode.ts` `splitCsvSections` — the block below is the **PRE-FIX** code, kept
to show the defect; the quoted first line is today `const { lines, unterminatedQuote } = splitCsvLines(csv);`.

```ts
const lines = csv.split(/\r?\n/);          // PRE-FIX: raw split, BEFORE any tokenizing
for (const line of lines) {
  const trimmed = line.trimStart();
  // … 13-line comment elided — it is the one discussed below …
  if (trimmed.startsWith(CSV_SECTION_BUDGETS)) { mode = "budgets"; continue; }
  // …26 more markers
```

★ Count reproduce: `grep -c "trimmed.startsWith(CSV_SECTION" src/app/csv-codecs-decode.ts` → **27**,
so 26 follow the one shown. (An earlier revision of this entry said "24 more", derived by eye.)

The section splitter runs over **physical text lines**, before the CSV tokenizer. A quoted cell
legitimately contains newlines, so its continuation lands on its own physical line — and if that
continuation begins with a section marker, `startsWith` fires and the parser switches section
**mid-row**. The remainder of the row is appended to the wrong buffer and decodes as absent.

**Measured, not reasoned** (four tasks, one carrying the hostile value):

```
tasks in  : 4      tasks out : 1      ids out : [1]
blockers  : "step one"              droppedRows : 0
```

★★ THE ORIGINAL ENTRY'S FIXTURE HAD ONE TASK AND THAT HID THE REAL DAMAGE. It
reported only `blockers` truncating. Tasks 2–4 are destroyed outright, and a
one-task fixture passes against a fix that still misroutes the rest.

★★★ THE ROWS ARE ABSORBED, NOT REJECTED, which is why `droppedRows` was 0
despite `decodeCsvSection` counting every reject. The split leaves an orphan `"`
at the head of the next buffer; `parseCsv` reads it as an opening quote and
swallows the entire rest of the section into ONE cell, which `decodeCsvSection`
then takes as its header row — so `build` is never called and nothing is ever
rejected. Any detector built on reject-counting, or on "rows found vs entities
produced", is structurally blind to this class. Two such detectors were designed
and discarded before the unterminated-quote signal was measured.

Silent: no throw, no `ImportDiag` entry, nothing in the UI. `trimStart()` means leading whitespace
does not protect the value either.

★★ **The existing comment in that function reasons carefully about the WRONG collision.** It is a
long, correct analysis of markers colliding with *each other* (prefix ordering, the
`# DOCUMENTS` / `# DOCUMENT VERSIONS` near-miss) and pins that invariant with a reflective test. It
never considers a marker appearing inside quoted CONTENT. The blind spot is one level up from where
the author was looking — which is why the reflective marker-prefix test cannot catch this.

★ **Markdown is immune by construction**, and for a reason worth preserving: `mdEscape` turns every
newline into a literal `<br>`, so no MD cell can ever begin a line. Do not "simplify" that away.

★ Applies to **every entity the CSV backend writes**, not just tasks. Reachability differs by field:
`description` is HTML and `noteLog` is escaped JSON, but `blockers` is plain multi-line free text,
and any imported / AI-written / backend-converted workspace can carry a newline in any of them. The
mechanism is proven; the claim that a UI writer actually puts a newline in `blockers` is argued, not
traced — settle that before pricing a fix.

**Fixed** by `splitCsvLines` (`csv-line-scan.ts`), which splits on a break only
when outside a quoted cell. ★★ Its `text.replace(/\r?\n/g, "\r\n")` first step
is LOAD-BEARING: the old raw-split/rejoin turned a newline inside a quoted cell
into CRLF by accident, and the live round-trip property pins that
(`taskName: csvNewlines(v.taskName)`), so a splitter that keeps the cell intact
without normalizing first turns those tests red. ★ A bare `\r` is deliberately
untouched — `split(/\r?\n/)` did not break on one either, and normalizing it
would collide with §106.

**Reachability, now traced** (the entry previously flagged this as argued):
`blockers` is a `<textarea>` in `task-form-fields.tsx`, an inline textarea in
`task-row.tsx` (`renderInlineTextarea`), and an AI-writable field via
`use-chat-dispatcher.ts`. Pressing Enter is sufficient.

**Pinned:** `codec-roundtrip.property.test.ts` holds the property this satisfies, live and
unskipped since `3de672bb`, alongside a losslessness property and a no-line-ends-mid-quote
property.

---

## 106. The Markdown codec is not a fixed point when bare CRs precede a newline — open, minor, progressive

**Where:** `markdown-codecs-core.ts` `mdEscape` / `mdUnescape`.

`mdEscape`'s `/\r?\n/` consumes the ONE carriage return nearest the LF; `mdUnescape` emits a bare LF;
the next pass then has a fresh `\r\n` to eat. So a run of bare CRs loses one per save/load cycle
**with no edit in between**:

```
"a\r\r\r\nb" → "a\r\r\nb" → "a\r\nb" → "a\nb" → "a\nb"     (one arrow = one full round-trip)
```

It converges, and only ever loses CRs, and `\r\n → \n` on the FIRST pass is accepted behaviour (this
repo's markdown format is LF) — so this sits well below §105. Recorded because "the stored value
changes on a load that made no edit" is the kind of thing that later reads as corruption.

★★ **Found only at `numRuns: 1500`; twenty runs missed it on the first seed.** The live fixed-point
property therefore excludes bare CR explicitly, and the skipped block carries both the unrestricted
property and a deterministic companion. ★ The skipped PROPERTY is itself seed-dependent at low run
counts — on the run where it was unskipped, the deterministic companion failed while the property
passed. **The deterministic case is the reliable reproduction**; reach for that one, not the property.

---

## 107. `HTML_START` and `sanitizeTemplateHtml` disagree about `u` / `h1` / `h2`, so a model description LEADING with a heading is stored as escaped literal markup — CLOSED 2026-08-10

**Where:** `narrative-html.ts` `HTML_START` vs `sanitize-html.ts` `ALLOWED_TAGS`.

| List | Tags |
|---|---|
| `HTML_START` — decides "is this stored value already HTML?" | `p br strong em ul ol li a` (8) |
| `sanitizeTemplateHtml` `ALLOWED_TAGS` — what a MODEL may store | `p br strong em ` **`u h1 h2`** ` ul ol li a` (11) |

`sanitizeAiRichText` runs `sanitizeRichText` **first**, so `descriptionHtml` tests `HTML_START`
before DOMPurify is ever reached. A value opening with `<h1>` fails that test, is treated as legacy
plain text, and `plainToHtml` **escapes the whole thing**. Layer 2 then sees only inert entities and
passes them through.

**Measured** via `sanitizeAiRichText`:

```
"<h1>Title</h1><p>body</p>"      → "<p>&lt;h1&gt;Title&lt;/h1&gt;&lt;p&gt;body&lt;/p&gt;</p>"
"<u>Title</u><p>body</p>"        → "<p>&lt;u&gt;Title&lt;/u&gt;&lt;p&gt;body&lt;/p&gt;</p>"
"<p>Title</p><h1>Section</h1>"   → "<p>Title</p><h1>Section</h1>"          ← unaffected
```

★★★ **POSITION DECIDES, AND THE BLAST RADIUS IS THE WHOLE VALUE.** The same `<h1>` is preserved
mid-value and, when it LEADS, escapes the entire description — not just the heading. The result is
permanent: every reader and every export renders visible `<h1>` as literal text.

★★ `h3` / `div` / `table` hit the same escape path (any leading tag outside the 8), but `u` / `h1` /
`h2` are the sharp cases: the allow-list explicitly says a model MAY write them. AGENTS.md records
that `sanitizeTemplateHtml` was chosen over `sanitizeNoteHtml` *precisely because* a model
legitimately emits headings — so a description leading with one is the ordinary case, not an exotic
one.

★ The comment at `sanitize-html.ts:35` ("`HTML_START` mirrors this list… Edit both together") is
**accurate but scoped to the wrong list** — it sits above `NOTE_ALLOWED_TAGS`, which `HTML_START`
does mirror exactly. Nothing pairs `HTML_START` with the wider TEMPLATE list, which is where the
drift is.

**Fix shape — undecided AS FILED; since decided, implemented and shipped (see the CLOSED block at the
end of this entry). Kept because the retraction below is the argument that ruled this shape out:**
~~widening `HTML_START` to the template list is the obvious move, but
it changes what counts as "already HTML" for EVERY stored value on every load path, so it needs the
byte-stability suites run and probably a golden check. Do not treat it as a one-line edit.~~

★★★ **THAT FIX SHAPE IS WRONG AND WOULD SHIP A DATA-LOSS REGRESSION. Corrected 2026-08-08 while
planning the documents roadmap (§113), by reading `narrative-html.ts` rather than reasoning from
this entry.** `HTML_START` is not a stale parallel of the template list — it is DELIBERATELY aligned
to a *different* sink, and ONE constant serves TWO classifiers:

| Consumer | Sink | Tags | `KEEP_CONTENT` |
|---|---|---|---|
| `narrative-html.ts` `narrativeToHtml` | `sanitizeNoteHtml` | 8 | **`false`** — deletes a non-listed element WITH its text |
| `rich-text-plain.ts` `descriptionHtml` | `sanitizeTemplateHtml` (six rich fields + documents) | 11 | default — unwraps, keeps the words |

★★ The two line numbers that used to sit in that table were broken by the fix — `narrative-html.ts`
went from 89 lines to 46 when the classifier moved out to `html-start.ts`. They are converted to
symbols rather than renumbered, per this repo's standing rule.

`narrative-html.ts`'s header comment stated the alignment as intentional — "The set is EXACTLY sanitize-html.ts's
`NOTE_ALLOWED_TAGS` … **Recognising a tag the sink STRIPS is worse than not recognising it at all**"
— and records the precise bug widening re-creates: "h1-6, blockquote and div used to sit here … in
fact it made `<h1>Q3</h1><p>ok</p>` render as just 'ok' and `<div>Status</div>` render as nothing at
all." So widening the shared constant fixes the description path by **re-breaking the narrative
path**, restoring a bug already found and fixed once.

★★ **That comment has since been REWRITTEN — the quotes above are what it said when this entry was
written, not what the file says today.** Both halves of the rule now live in `html-start.ts`'s header
("never recognise more than your own sink KEEPS", plus the same `<h1>Q3</h1><p>ok</p>` → "ok" and
`<div>Status</div>` → nothing examples), which is the right home for it once the classifier stopped
being one shared constant. Quoted verbatim here rather than re-quoted from the new file, because the
retracted-fix argument only makes sense against the wording that motivated it.

★★ **The correct shape: each classifier derives from ITS OWN sink's list.** `descriptionHtml` takes
the tag set as a parameter (or gains a sibling); narrative keeps deriving from `NOTE_ALLOWED_TAGS`.
Blast radius is **the six rich entity fields, not just documents**, which is why it is its own task
rather than a rider on a documents slice. ★ Reproduce the two-consumer fact with
`grep -rn "HTML_START" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."` — definition,
plus one `.test(` in each of `narrative-html.ts` and `rich-text-plain.ts`.

★ Until it landed, documents inherited the 8-tag classification. That was SAFE — it escapes rather
than deletes — so a document leading with a new tag was merely escaped, not lost. That was §114, and
it is discharged.

**CLOSED 2026-08-10 — the derive-per-sink shape prescribed above was implemented.** `HTML_START` no
longer exists in the code; the name survives only in comments and in this register, deliberately, as
history. Reproduce with
`grep -rn "HTML_START" src/ --include="*.ts" --include="*.tsx"` — every hit is a comment. The
replacement is `html-start.ts`: a `htmlStartRe(tags)` factory, a `SINK_TAGS` map, and
`isHtmlStart(value, sink)` over a `RichTextSink` union. `descriptionHtml(stored, sink)` and
`sanitizeRichText(raw, max, sink)` take the sink with **no default**, so tsc enumerated every call
site rather than leaving one silently on the old 8-tag behaviour.

The two consumers this entry's correction block separated now derive independently: narrative from
`NOTE_ALLOWED_TAGS` (the factory drops that array's `#text` member, which is not a tag name), the six
rich entity fields from `TEMPLATE_ALLOWED_TAGS`. So the regression the widening fix would have caused
— `<h1>Q3</h1><p>ok</p>` rendering as just "ok" on the narrative path — is now prevented by
construction rather than by a comment asking two arrays to be edited together.

★★ **EVERYTHING ABOVE STAYS.** The retraction block is the only record of why widening the shared
constant was wrong, and a reader arriving from the code comments that still name `HTML_START` needs
it.

★★★ **AND CLOSING THIS OPENED SOMETHING ELSE — READ §137 BEFORE ACTING ON THIS ENTRY.** Storing a
model's `<h1>` as REAL markup instead of escaped text is correct, and it converted a
visible-but-lossless defect into a silent LOSSY one on a path this entry never mentions: the HUMAN
save of `Task.description` runs `sanitizeNoteHtml` (8 tags, `KEEP_CONTENT: false`), which deletes the
heading's TEXT along with its tag. Measured, with the numbers, in §137.

★★★ **AND CLOSED IS QUALIFIED IN A SECOND WAY — THIS ENTRY'S USER-VISIBLE PAYOFF DOES NOT SURVIVE A
LOAD.** The classifier defect is genuinely fixed and the closure stands on that. But "the model's
`<h1>` is now STORED as real markup" is only true until the workspace is read back:
`sanitizeRichFields` (`note-log.ts`) applies `sanitizeNoteHtml(descriptionHtml(value, "note"))` to
every rich field it is given, and all four per-entity normalizers are that one function with a
different field list. Both whole-object load boundaries call all four — `jsonToWorkspace`
(`workspace.ts`, every JSON load) and the IndexedDB load (`browser-backend.ts`, the DEFAULT backend).
A value LEADING with `<h1>` is not in the `note` sink's 8 tags, so it is classified as plain text and
`plainToHtml` escapes the whole thing back. Measured 2026-08-10 through the real exported functions:

```
AI write boundary stores : "<h1>Title</h1><p>body</p>"
after ONE load (raid)    : "<p>&lt;h1&gt;Title&lt;/h1&gt;&lt;p&gt;body&lt;/p&gt;</p>"
after ONE load (task)    : identical
after TWO loads (raid)   : identical to one load — it escapes ONCE, it does not compound
descriptionText BEFORE   : "Title body"
descriptionText AFTER    : "<h1>Title</h1><p>body</p>"   <- literal markup in search / AI digests / exports
```

★★ **PRE-EXISTING, and do NOT read it as a regression from this slice.** `git diff 528dd5fe...HEAD --
src/app/note-log.ts` is a ONE-LINE change — the explicit `"note"` argument — and the `note` list
(`NOTE_ALLOWED_TAGS` minus its `#text` member) is the SAME eight tags the retired shared constant
carried, so this path classified identically before and after. What the slice changed is the value
that ARRIVES here: the AI boundary is 11 tags wide, so it now hands the load path markup the load
path will not keep.

★ **Documents are genuinely exempt — verified, not assumed.** `sanitizeDocumentRichFields`
(`document-rich-fields.ts`) calls `sanitizeDocumentHtml` and nothing else: no `descriptionHtml`, no
`note` classification. Measured on the same input, a document paragraph holding
`<h1>Title</h1><p>body</p>` comes back byte-identical.

★ Recorded as a follow-up under **§137**, NOT as its own number — same function, same seven fields,
same two load boundaries that entry already dissects, and the same single closure slice. Adding a
§138 would have restated a measurement §137 already prints.

---

## 108. The meeting-report HTML is truncated by a raw `.slice`, so it can cut mid-tag AND split a surrogate pair — open

**Where:** `sanitize-records.ts`, the `MeetingReport` guard — `rr.html.slice(0, REPORT_HTML_MAX)`.

Split out of §22 rather than folded into it, because it is the same shape but a strictly larger
problem. §22's one-line back-off fixes the surrogate half and does nothing for the other half: the
value is **HTML**, so a raw cut can also land inside a tag (`<stro`) or between a tag and its
closer, and the stored result is then malformed markup rather than merely a damaged character.

★ The rich-text layer already solved exactly this: `capHtmlText` (`rich-text-plain.ts`) projects to
text, truncates, and **re-wraps** so the result is always well-formed, accepting the loss of
formatting on overflow. That is the shape to copy — not `clipText`, which is correct only for
plain-text fields.

★★ Do NOT "fix" this by routing it through `sanitizeText`. That would give it the surrogate back-off
and leave the mid-tag cut in place while making the call site LOOK guarded — the more dangerous of
the two states, because the next reader sees a sanitizer call and stops looking.

★ Reachability is narrow: it needs a meeting report whose HTML exceeds `REPORT_HTML_MAX`, which no
sample fixture does. Unmeasured in the wild — the mechanism is read from the code, not observed.

---
## 109. Icon-only controls with no hover tooltip, and one control named only by its `title` — open, ratchet

★ **Filed as §103** on `feat/ui-batch-slice-2`, renumbered to §105 when that branch first merged
(main had already taken 103 for the over-cap document load), then renumbered AGAIN to §109 when
main took 105–108 as well. Every commit message on that branch says §103 and none can be edited.
Same two hops for §110, filed as §104; §111 was filed as §107 and has moved once.

The full audit is [`docs/tooltip-inventory.md`](tooltip-inventory.md), taken 2026-08-07 on
`176b823a` (an earlier revision said `2d31abe5`, which is a dangling pre-amend duplicate NOT in the
branch — `git merge-base --is-ancestor` exits 1). This entry exists so the register points at it, and so the **unapplied** half does not
have to be rediscovered.

**Scale, so nobody re-derives it.** Element-level, over non-test `src/app/*.tsx` (the inventory
carries the parser that produces these — an opening tag spans lines and a `className` can contain a
`>`, so `grep` cannot do it): **573** button-family elements, **142** carrying a `title`; **87** are
icon- or glyph-only, of which **49** already have a `title` and **38** do not. Of those 38, **13 are
the word `<button` inside a comment** and 2 are a primitive's own element, leaving **23 real
controls**: **19 Class A**, **3 Class B**, **1 blocked on i18n**.

★★ **Those are SNAPSHOT numbers and the fixes have since landed — do not read 38 as today's open
surface.** At the snapshot the split was 573 / 142 titled / 87 icon-only / 49 titled / 38 untitled;
after Tasks 14 and 16 it is 573 / 176 / 87 / 70 / **17**. The attribute-level `grep -rho 'title='`
moved 388 → 422. "So nobody re-derives it" is about the METHOD being expensive, not about the numbers
being current — re-run the parser in the inventory before quoting any of them as a present-tense
count.
★★ **AND THAT GUARD EARNED ITSELF WITHIN ONE DAY.** Every figure above reproduced EXACTLY at the
branch tip `70395bc5` and every one of them moved when main's 98-commit document-authoring slice
merged in on 2026-08-08. At `9927d045` the split is **583 / 178 / 88 / 70 / 17**, `grep -rho 'title='`
is **426** (non-test), and files carrying an `aria-label` are **194**. The one number that did NOT
move is the open surface itself: still **17** untitled icon-only controls, and
`workspace-section-chrome.tsx` is still the only control named by `title` alone. ★★★ The parser says
**18**, and the extra one is a PARSER ARTIFACT, not a control — see the apostrophe limitation
recorded in the inventory's Reproduce section. `documents-history-modal.tsx` renders
`{t(lang, "documentsRestore")}` as visible text; it is not icon-only. Do not open a row for it.

**What slice 2's Task 14 applies, and what it does not.** Task 14 takes the **Class A** rows only —
add `title={<the expression already in the accessible name>}`, zero new strings, no approval needed.
Everything below is what remains open after it:

- ★★ **Class B — 14 rows / 16 sites, each needing new EN+DE copy and row-level approval.** These are
  the ones where the mechanical fix is *worse than nothing*: copying a bare noun into a `title`
  produces the appearance of coverage and nobody re-opens the row. The clearest are the insights
  verbs "Acknowledge" / "Act", where the label actively misleads — `onActInsight`
  (`task-manager.tsx`, grep the symbol — it was `:832` when written and main's merge moved it to
  `:840`) applies `metricAtActionPatch` on first act, a one-shot side effect the
  word "Act" gives no hint of.
  ★★ **RESOLVED 2026-08-07 except one row.** The user approved **13 of the 14** at row level and
  slice 2 implements them: B2–B14. **B1 (the settings cog, `settings-menu.tsx:59`) is HELD** and is
  the only Class B row still open. It was held for a reason worth keeping: that cog renders in the
  **classic** `AppHeader` only — `grep -rn "SettingsMenu" src/app --include=*.tsx | grep -v test` returns just
  `app-header.tsx` and the file itself, and it mounts at `app-header.tsx:149`, OUTSIDE the
  `ActionMenus` element that `buildShellChrome` feeds to the modern shell's `topBarMenus` slot. The
  modern shell is the DEFAULT layout, so most users never see this control at all. Before wording
  its tooltip, establish the modern shell's own route to Settings — the answer may be that the
  tooltip is not the finding here. (An earlier revision of this bullet called it "the top-bar cog",
  which is exactly the assumption the measurement disproved.)
- ★ **Five of the Gantt View menu's eight `ToggleButton`s carry no hint** while three do
  (`ganttCriticalPathHint` · `ganttBaselineHint` · `ganttMilestonesInlineHint`). The split is by
  author, not by importance. Cheapest coherence win in the set.
- ★★ **One name defect: `workspace-section-chrome.tsx:165`.** A collapse/expand chevron with
  `title`, `aria-expanded`, `aria-controls` and an `aria-hidden` icon — and **no `aria-label`**. Its
  accessible name therefore comes only from `title`, the accname algorithm's last resort. **axe
  passes it** (a name exists), so no gate will ever report it. Fix is `aria-label`, not `title`;
  `title` is hover-only — no keyboard focus, unreachable on touch — and is never the fix for a
  missing name. It is the only such control in the app.
- ★★ **Fifteen hardcoded-English accessible names across nine files**, found while quoting the
  "existing name" column (two greps, both in the inventory; the `task-editor-raid-mini.tsx` pair is
  only half-literal and is arguably fine — "RAID" is a proper noun in the DE UI too).
  `npx tsc --noEmit` enforces EN/DE **key parity** and structurally cannot see a string that never
  became a key. Worst two: `create-project-wizard.tsx:389`/`:397` and
  `settings-sections/mode-section.tsx:80`/`:88` pair a *translated* visible label with an
  *untranslated* `aria-label`, so a German user sees "Einfach" and hears "Apply Simple preset"; and
  `budget-panel-totals.tsx:94`/`:111` use a machine-readable test hook
  (``aria-label={`budget-${ariaPrefix}`}``) as what a screen reader announces for every budget cell.
  ★ `stakeholder-recipient-input.tsx:160` is Class A in every respect **except** that its name is a
  hardcoded ``` `Remove ${name}` ```; translate it first, then it is a plain Class A row.

★★ **Two sites were reported into this audit as inventory misses. Both are already `title`-complete,
and only one of the two reports was correct** — recorded because the *mechanism* of the real miss
will recur. `modal-header.tsx` `:77`/`:88` are genuinely absent from §102's offender tally, and not
because a grep missed them: the file is listed in `docs/handrolled-ui-inventory.md`'s "Distribution"
block among the thirteen whose `<button` occurrences are **subtracted as primitive internals**. Two
hand-rolled buttons hid inside a shared component. By contrast `knowledge-panel.tsx` `:451`/`:517`
**is** already inventoried — `handrolled-ui-inventory.md:396` lists it in the Part 2 `replace` row —
it is merely absent from Task 12's narrower thirteen-file list. Check the wider table before calling
anything missing.

★ Nothing here is gated either. axe has no rule for a missing `title`, and the one name defect above
is a control axe passes. The counts are reproducible with the script embedded in the inventory; the
A/B judgement is not automatable and the inventory records every borderline call it made.

---

## 110. `IconButton` cannot express a non-`rounded-md` / non-`p-1` control — open

★ **Filed as §104** — see the renumbering note at the head of §109.

Found 2026-08-07 while converting the close-button family in slice 2 (§102's programme). User
decided it is its own slice rather than something to force inside a conversion task.

`raci-chip-picker.tsx` holds the case. That ✕ is the **fifth of five sibling chips** — R / A / C / I
plus clear — all sharing `CHIP_BASE` (`raci-chip-picker.tsx:32`, used at `:87` and `:112`), which is
`flex h-5 w-5 … rounded-full border text-[11px]`: a 20px circle. `IconButton` hard-codes `rounded-md`
in `BASE_CLASS` and `p-1`/`p-1.5` in `SIZE_CLASS`.

★★★ **A caller `className` cannot reliably override either, and this is the part that makes it a
primitive problem rather than a call-site one.** Tailwind resolves conflicting utilities by
**stylesheet source order**, not by the order they appear in the class attribute — and `p-1` sorts
AFTER `p-0`, so a caller passing `p-0` loses outright. Converting therefore yields a square,
differently-padded chip beside four round ones.

★★ **No unit test could catch that regression** — jsdom has no layout, so nothing in the suite can
see shape or padding. It is eye-verify-only, which is precisely why the primitive should express it
rather than each call site improvising.

**Current state:** the glyph was swapped to `XMarkIcon` (that part is safe and shipped); the wrapper
stays hand-rolled, with the reason recorded in code beside it. So this is a KNOWN, DELIBERATE
hand-roll, not an oversight — do not "finish the conversion" without first giving the primitive a
shape/size escape hatch.

**Shape of the fix, not yet decided:** a `shape?: "square" | "circle"` and/or a `size` that can opt
out of `SIZE_CLASS`, so `CHIP_BASE`-style controls become expressible. Whatever the API, it must keep
`disabled` a real attribute (§the `aria-disabled` lookalike trap) and must not weaken the required
`label`.

★ A related but SEPARATE item: `knowledge-panel.tsx` `:451`/`:517` are already-`IconButton` controls
still passing a bare `✕` child — glyph-only work in the family `roles-editor` got folded into slice
2's Task 12. Already inventoried at `handrolled-ui-inventory.md:396`; merely outside that task's
thirteen-file list.

---

## 111. Document row controls are named by a title that is NOT unique, and the comment says it is — open, a11y

★ **Filed as §107** — see the renumbering note at the head of §109.

Found 2026-08-08 by a merge review, in main's code, not the branch that filed this. Filed rather
than fixed: it belongs to the document-authoring slice, and fixing another slice's freshly-shipped
feature from inside a settings-tooltips branch is the scope creep this register exists to avoid.

`documents-list.tsx` names every per-row control with the document's title — the selection button
(whose accessible name IS `doc.title`) plus Download / History / Rename / Duplicate / Delete, six
controls per row. The comment above the selection button asserts the title is **"row-unique by
construction"**.

★★★ **It is not, and the comment is the defect** — a false invariant in a comment outlives the code
it describes, because the next reader stops checking. `uniqueDocumentTitle` runs at exactly two of
the four title-writing paths (reproduce: `grep -rn "uniqueDocumentTitle" src/app --include=*.tsx
--include=*.ts | grep -v "\.test\."` — definition plus `kind:"create"` and `kind:"duplicate"` in
`documents-panel.tsx`). The two that bypass it:

- `commitRename` (`documents-panel.tsx`) sends the raw trimmed draft straight to
  `mutate({kind:"rename", …})`. Rename "Q3 report (copy)" back to "Q3 report" and the collision is
  stored.
- `createDocument` (`use-document-tools.ts`) passes the MODEL's title through untouched —
  `sanitizeAiDocBlocks` and the block-count checks guard the blocks, nothing guards the title. Two
  `create_document` calls with the same title collide.

`document-model.ts` holds no uniqueness check either, so nothing downstream rejects it.

★★ **The axe gate cannot catch this and being in `A11Y_VIEWS` does not help.** Documents IS scanned
and `e2e/seed.ts` DOES seed two documents — with DISTINCT titles, so the duplicate names never
render at scan time. This is the exact pattern AGENTS.md warns about under the a11y gate ("N
identical labels is a WCAG 2.4.6 fail, but axe can PASS it when the seed renders only one row").
Six duplicate-name pairs in one list is what a speech-input user hits when they say "click Delete
Q3 report" and nothing resolves.

★ **main's own newer code states the opposite standard**, which is why this reads as an oversight
rather than a decision: `documents-history-modal.tsx` ("title+timestamp collides on real data. Only
the version id cannot") and `chat-tool-block.tsx` both qualify by id. The History button in
`documents-list.tsx` is itself NEW on main — the hole was left open in the one surface that was
extended rather than written fresh.

### Same family, weaker: the `#docId` qualifier does not disambiguate what it claims

`chat-tool-block.tsx` qualifies its card controls with ` – #${docId}` and the comment gives two
reasons: two cards can carry the same title "either because the same document was touched twice in
one conversation or because two documents are genuinely named alike". **In the first of those the
id is the same too**, so the qualifier produces identical names — `create_document` then
`update_document` on one document, or two successive `update_document` calls, is the ordinary
write-then-revise pattern and puts two cards in the transcript.

★ Graded lower deliberately: both cards' buttons act on `liveDoc`, the CURRENT document, so the
duplicate names sit on functionally identical controls — a far weaker 2.4.6 problem than the list
above. **The part worth fixing is the RATIONALE**, which is recorded as proof that collision is
impossible, is not, and has already been cited by `documents-history-modal.tsx` as precedent.

---

## 112. The settings rail's `role="group"` breaks the wrapped narrow-viewport layout — CLOSED 2026-08-08

Found 2026-08-08 by an eye-verify pass on a seeded Playwright run (Chromium, a fresh dev server on
`PORT=3100`). That is the only place it is visible: jsdom has no layout, and the axe gate scans one
desktop viewport and has no rule for wrap order.

`settings-view.tsx` renders each rail branch as a real box — `<div role="group" aria-label={…}
className="flex flex-col gap-1">`. On DESKTOP that is pixel-identical to the flat list it replaced.
Below the nav's `flex-row flex-wrap` breakpoint the group becomes ONE flex ITEM among the rail's
other entries, and two things follow:

- The active PARENT pill stretches to the FULL HEIGHT of the group box. Measured at 760px wide it is
  a solid ~120px tall block beside its three stacked children, because it is a row-level sibling of
  a three-row item.
- The children stack in a column, so unrelated TOP-LEVEL entries land on the same visual ROW as a
  child. At 760px `Integrations`, `Information flows` and `Diagnostics` sit on the `Views` row and
  read as AI Assistant's children. At 520px the interleaving is the same with different neighbours.

★ The `<hr>` separators that carry the grouping on desktop are horizontal rules across the whole
rail, so in the wrapped layout they no longer bound anything. The one cue that survives the reflow
is the indent, and the interleaving defeats it.

★★ This is the COST of the choice recorded when the group landed, not a regression against it.
`display: contents` was rejected because its a11y-tree exposure is browser-version dependent and
being ANNOUNCED is the fix the group exists to deliver. A real box announces reliably and lays out;
a contents box lays out invisibly and may not announce. Do NOT "fix" this by reaching for it.

★ Reproduce: seed a project, open Settings, activate the AI Assistant branch, THEN narrow the
viewport to 760px. Narrowing first does not reproduce it — the shell drops the rail's labels at that
width before the branch renders, so there is no group to reflow.

---

## 113. The documents roadmap — block editor, entity attachment, images — designed, UNIMPLEMENTED

★★★ **Recorded here for the reason §44 exists.** The design document lives in the gitignored tree,
so on any other machine it does not exist. Per this file's own rule there is no link to it; the
decisions are reproduced below in enough detail to resume without it. Designed 2026-08-08 against
0.222.0 "Charnas" (`e2316f4f`). It supersedes the ~18-line S3/S4 outlines that shipped inside the
S1 design document and **reorders them**.

**Four releases, in this order — S4 moved AHEAD of the editor**, because it settles the dangling
pattern and the versioning policy on a `{kind, id}` pair instead of on images.

| | Ships | New persisted state |
|---|---|---|
| **S3a** | a documents-only allow-list · mark-aware DOCX/PPTX · the three policies below | none |
| *(before S3b)* | ~~**§54** — spike first~~ **DONE, §54 CLOSED 2026-08-09.** No spike needed. ★★ The parenthetical this cell used to carry — "Next applies nonces during SSR; §54's offender is injected at runtime by a client chunk" — was RIGHT on both clauses, and is precisely why Next's own nonce machinery could not cover this and `readCspNonce()` has to read the nonce off the DOM. An earlier correction here declared it wrong; that was an over-correction against a claim it never made (it says "client chunk", not "Turbopack-shipped CSS chunk"). The theory that was actually disproved — Turbopack shipping prosemirror CSS in a lazily-loaded chunk — lived in §54, not in this cell. The injector is `@tiptap/core`'s own `Editor.injectCSS()` over a JS string constant. Fixed via Tiptap's `injectNonce`; the CSP is unchanged. · the `HTML_START` classifier split, six rich fields in scope | none |
| **S4** | `linkedEntities` on `ProjectDocument`, chips on task/milestone/RAID/change, filter, deep-link, dangling | free — a field inside the existing `documents` blob |
| **S3b** | the editor: in-place block editing, all marks, per-type editors, block-CONTENT editing | free — same blob |
| **S3c** | images end to end, Turso-gated | metadata slice + one out-of-`TABLE_NAMES` side table |

### The decisions that are expensive to re-derive

★★ **Tiptap's Simple Editor template is HARVESTED, never installed.** It is a single ProseMirror
document; `DocBlock` is a typed array, and adopting it wholesale abandons `dataSection`, the
block-keyed renderers and per-block version before-images. Its styles are SCSS and its CLI injects
`@import '_variables.scss'` into `src/app/globals.css` and installs `sass`. `starter-kit@3.27.1`
already bundles bold/italic/**underline**/strike/code/codeBlock/blockquote/heading/horizontalRule/
lists/link — only highlight, subscript and superscript need new packages.
★ **DONE** — those three packages are installed and registered, and the shared toolbar
(`rich-text-toolbar.tsx`) exposes the whole Simple control set. Nothing further is owed here.
★★ `@tiptap/extension-list` is ALSO already a `starter-kit` dependency (reproduce:
`node -p "Object.keys(require('./node_modules/@tiptap/starter-kit/package.json').dependencies)"`),
so **task list needs no new package either** — it needs the ATTRIBUTE boundary (§140). Only
`@tiptap/extension-text-align` is a genuinely new dependency.

★★★ **ALIGNMENT IS REPRESENTABLE AS MARKUP — an earlier revision of this bullet said it was not, and
the mechanism it named does not apply.** `ALLOWED_URI_REGEXP` IS tested against every attribute
value, and that IS why `target`/`rel` never survive (§38) — but `style`, `class`, `title` and `id`
are members of DOMPurify's `DEFAULT_URI_SAFE_ATTRIBUTES`, so the value test never reaches them.
Measured 2026-08-11 on dompurify 3.4.13 WITH CONTROLS: listing `target`/`rel` still strips them and
listing `lang` still strips it (so the regexp was armed), while `style="text-align:center"` and
`class="text-center"` both SURVIVE. What actually blocks alignment is the VALUE: nothing constrains
what a surviving `style` contains — `position:fixed;inset:0;z-index:99999` passes verbatim, and these
fields are AI-writable. ★ The same probe also passed `background:url(javascript:alert(1))` through
untouched: DOMPurify does not parse CSS values at all. Browsers block that particular URL scheme in
CSS, so treat it as evidence about the ABSENCE of value filtering, not as a live XSS.
So alignment needs a value allow-list enforced by `uponSanitizeAttribute`, which is **§140**'s slice,
not a list entry. Do not read the old claim as a reason it cannot be built.
★★ What DOES survive from the old bullet: **no toolbar in this app may introduce a new HTML attribute
on its own** — the attribute surface is shared by every rich field and by documents, so it is a
security boundary and gets a designed slice plus a review, not a toolbar button.
★ The **editor** half of S3b is now smaller than designed: the unified `RichTextEditor` (one schema,
one toolbar, `sanitizeRichHtml`) already exists, so S3b inherits marks, headings, lists, blockquote
and code block rather than building them.

★★★ **Documents get their own allow-list; widening the shared one is forbidden.**
★★★ **THE SECOND HALF OF THAT SENTENCE INVERTED, 2026-08-11 — documents no longer HAVE their own
list in the sense meant here.** `DOCUMENT_ALLOWED_TAGS` is now `[...RICH_ALLOWED_TAGS, "img"]`: it
SPREADS the shared array, so widening the shared one widens documents **in the same edit**, and the
two can never disagree about a heading level again. The hazard the bullet warns about is therefore
STRICTER now, not gone — the shared `RICH_ALLOWED_TAGS` serves comm templates, meeting reports, the
seven rich entity fields AND documents, so widening it changes what a model may store everywhere,
retroactively, including how already-stored HTML renders. ★ The named symbol was
`sanitizeTemplateHtml`, RETIRED; its successor is `sanitizeRichHtml`.
★ "`rich-text-editor.tsx` records that hazard as the reason an earlier slice disabled input rules" is
also stale: the markdown input rules are back ON, and that file now records why. ★★★ **An earlier revision
of this bullet added "and `HTML_START` must be DERIVED from its list" — that is UNDER-SPECIFIED to
the point of being dangerous, and the correction now sits in §107 above: there is no single "its
list", because ONE constant serves TWO classifiers whose sinks differ in both tag set and
`KEEP_CONTENT`. Each classifier must derive from ITS OWN sink. The naive derivation re-breaks the
narrative path.** That work is its own task with the six rich entity fields in scope, sequenced
before S3b — NOT part of S3a.

★★★ **The Turso gate is the IMAGE FEATURE, not the Documents view.** Gating the view was priced and
rejected: Documents is one of the 17 `A11Y_VIEWS`, a Turso-only view must be kept out of that list
(the file-mode seed cannot reach it), so scans would drop 90 → 85 and **§95 makes it unrecoverable**.
It also buys no simplification — the six write paths must stay or existing file/IndexedDB users lose
documents they already have. Gate on `tursoConfig !== null`, never on `storageConfig.kind`.

★★★ **Asset BYTES go in an out-of-`TABLE_NAMES` side table** (the `comm_templates` /
`color_schemes` / `committee_report_versions` pattern, named at `turso-schema.ts`). Two rejected
alternatives, both measured:
- **A meta-blob is catastrophic here.** `dirtyWorkspaceTables` maps TEN slices onto `meta` — `status`,
  `fieldVisibility`, `features`, `steeringCommittee`, `timelogLinks`, `knowledgeItems`, `insights`,
  `documents`, `documentVersions`, `settingsOverrides` — and the save emits an unconditional
  `DELETE FROM meta` + full re-INSERT when any one is dirty. Every insight write would re-upload the
  entire image library.
- **Row-level diffing was rejected on the INVARIANT, not the effort.** `DELETE FROM t; INSERT …` is
  self-healing — after a save the table matches the workspace whatever state it was in. Diffing is
  correct only while the baseline is accurate, and it can be wrong (§4's second tab; a partially
  failed save). The resulting orphan or missing rows are never repaired by a later save, and §95
  means this repo cannot detect that class today.

The side table needs none of it: the workspace save never touches it, so writes cost one row and the
invariant is untouched because it does not apply. ★ Accepted costs: orphans become possible (needs a
defined write order plus a reclaim action), bytes do NOT travel in the workspace JSON export, and
project deletion must clean up explicitly with `project_id` in tenant mode.

★★ **Images are referenced by id — `<img data-asset-id>` — never by src.** No URI in stored bytes, so
the sanitizer never needs a `data:` widening (`data:text/html` is an XSS vector). Rename, automatic
delete-propagation and single-copy storage all fall out of the indirection rather than being built.
★★ **Delete MARKS, it does not remove:** an asset delete is not a document mutation, so
`applyDocMutation` never fires and **no version before-image is captured** — a cascade would be
unrecoverable, because version history is the only recovery path documents have.

**Budget:** PNG + JPEG, SVG excluded permanently (the branding precedent's XSS reasoning); a 25 MB raw
upload ceiling; an 8 000×8 000 source-dimension ceiling read from the header (a decompression-bomb
guard — a 50 KB PNG can expand to 30000×30000); downscale to 1920×1080;
**5 MB stored cap applied AFTER the downscale** (checking the raw file first would reject the photo
downscaling exists to rescue), keeping the original when it was already smaller; unlimited per
workspace with a visible total; **20 distinct images per document** — the cap belongs per document
because a `.docx`/`.pptx` export is the only moment images are held together, assembled as one
in-memory Blob; content-hash dedup. Metadata records `{width, height}` post-downscale because the
OOXML writers size in EMU and cannot backfill without decoding every image.

★★★ **ONE MEASUREMENT CAN INVALIDATE THAT CAP AND IT HAS NOT BEEN TAKEN.** A 5 MB image is ~6.7 MB of
base64 and `SqlArg.value` is string-only, so one statement carries a 6.7 MB text argument in a single
Turso pipeline request. Turso's request-size limit is UNKNOWN — do not guess it. Measure against a
real database before planning S3c; **§95 means CI cannot.** Under ~7 MB, the per-image cap drops or
uploads chunk.

### Three cross-cutting decisions, to be settled in S3a

Each is asked 2–4 times across the roadmap; answering them per-slice is how S2's "one door of two"
shape recurred six times in one release.

1. **What counts as a versioned mutation?** `DocMutation` is a discriminated union, so every new kind
   forces the answer at the compiler. Policy: **content versions; references and metadata do not.**
2. **ONE dangling-reference presentation** — three producers (deleted linked entity, missing asset,
   the existing dangling resource). The existing one already solved the a11y half: a non-colour
   marker plus a distinguishing `title`, because colour alone fails 1.4.1.
3. **Derive, never duplicate**, for every allow-list/`HTML_START` pair.

### Deliberately out of scope, recorded so it is not an accidental gap

Block add/remove/reorder and a figure block (a later structural slice — so S3b's gutter carries the
kind chip and ⋮ but **no drag handle**; a handle that does nothing is worse than none); search and
replace (extension licence unverified); marks inside `heading.text`, `bullets.items` or table cells
(all plain `string`); AI link/unlink tools and letting the model see a task's attached documents —
**named explicitly so it does not become a fourth accidental gap beside §86 / §87 / §89**.

---

## 114. `HTML_START` does not know the documents allow-list's nine tags — CLOSED 2026-08-10

★★ **A second instance of §107, not a restatement of it.** Read §107 for the mechanism and for why
the obvious fix was retracted; only what is NEW to documents is recorded here.

`HTML_START` (`narrative-html.ts`) classifies a stored value as "already HTML" from its FIRST tag:

```
/^\s*<(p|br|strong|em|ul|ol|li|a)\b[^>]*>/i
```

`DOCUMENT_ALLOWED_TAGS` adds `s code pre blockquote hr mark sub sup img`. `HTML_START` knows none of
them, so `descriptionHtml` reads such a value as PLAIN TEXT and `plainToHtml` escapes it. A model
returning `<blockquote>quoted</blockquote>` as a whole paragraph is stored as
`<p>&lt;blockquote&gt;quoted&lt;/blockquote&gt;</p>` — literal tags, in the field, in every renderer
and every export, permanently.

★★★ **The mitigation in place is an INSTRUCTION, and an instruction is not a guard.**
`chat-tool-defs-documents.ts` tells the document-authoring model to wrap every paragraph in `<p>`,
and `p` is one of the eight — so the shape the tool asks for is classified correctly. That covers the
common case and nothing else. It is the only mitigation, it lives in a prompt, and a model that
emits a whole-paragraph `<blockquote>` or `<pre>` (both legitimately in the allow-list, both
advertised to it) defeats it while doing exactly what the tool permits.

★ Severity is bounded by the direction: this ESCAPES, so the content survives and a fix can repair
stored values. §32 is the same classifier failing the OTHER way — plain prose taken FOR markup — and
there the words are DELETED. ★★ The mechanism is NOT `KEEP_CONTENT: false`, which an earlier
revision of this line named: all four of §32's documented cases wrap ALLOW-LISTED tags
(`a` / `em` / `li` / `p`), so that flag never fires. Measured both ways through the note config,
`"<a note about pricing> is attached"` yields `"<a> is attached</a>"` with `KEEP_CONTENT: false` AND
with the default — byte-identical. §32 names its own mechanism as "the `TAG` pass"
(`rich-text-plain.ts:58`, `/<\/?[a-zA-Z][^>]*>/g`, which removes a pseudo-tag together with
everything inside its angle brackets); on a render path the stray words are attribute NAMES and the
attribute test strips them. `KEEP_CONTENT: false` is the NARRATIVE path's hazard (§107's correction
block) — citing it here sends a reader to change a flag that would alter nothing about §32. Do not
merge the two into one "HTML_START is unreliable" note — the remediations differ.

★★ Why it was not fixed in S3a: widening `HTML_START` changes what counts as already-HTML for every
stored value on every load path, which is a byte-stability and golden-fixture change, not a one-line
edit — and §107's own correction block retracts the widening shape because it re-breaks the
narrative path. The policy the roadmap settles on is derive-per-sink: each sink derives its
classifier from its OWN allow-list, so a third list cannot drift from a shared regex. That work
moved out of S3a entirely (§113).

**CLOSED 2026-08-10** by that derive-per-sink work, which is exactly what this entry said it was
waiting on — see §107 for the implementation. The `document` sink derives its classifier from
`DOCUMENT_ALLOWED_TAGS` (20 tags: the 11 template ones plus the nine named above), so a stored
`<blockquote>quoted</blockquote>` is classified as markup and survives instead of being escaped.

★★ **The "an INSTRUCTION is not a guard" note above STAYS and is still true.**
`chat-tool-defs-documents.ts` still tells the model to wrap every paragraph in `<p>`, and that is
still only an instruction — it is simply no longer the ONLY thing standing between a model and an
escaped value for these nine tags. Everything else that file asks the model for is still
instruction-only.

★ The §32 comparison above is UNTOUCHED by this fix. §32 is the classifier failing the other way —
plain prose taken FOR markup, words DELETED — and its mechanism is the `TAG` pass, not this one. Do
not read this closure as covering it.

★ A THIRD sink was needed on top of these two, at the RENDER boundary, and no allow-list could
express it — that is §118.

---

## 115. One of the two sanitizers admits arbitrary `data-*` — CLOSED 2026-08-13 by §140

★★★ **RESCOPED 2026-08-11 by the unify-rich-text slice, and the count moved in BOTH terms — do not
read the old title as "one got fixed".** This entry read "Two of the three sanitizers" while
`sanitize-html.ts` exported three: `sanitizeDocumentHtml`, `sanitizeTemplateHtml` and
`sanitizeNoteHtml`. The latter two are now DELETED and replaced by ONE, `sanitizeRichHtml`. So the
defect is unchanged in KIND and its blast radius GREW: the surviving offender covers every rich
surface at 21 tags where the wider of its two predecessors covered 11.

`sanitize-html.ts` exports two DOMPurify sanitizers. Only `sanitizeDocumentHtml` sets
`ALLOW_DATA_ATTR: false`; `sanitizeRichHtml` leaves DOMPurify's default, which is TRUE
(`node_modules/dompurify/dist/purify.cjs.js` — `ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false; //
Default true`). So on that one the explicit `ALLOWED_ATTR` list is not the whole gate — any `data-*`
attribute passes it regardless of what the list says.

★★ **THE "EMPTY SET" ENUMERATION BELOW WAS RE-RUN AGAINST THE NEW EDITOR, 2026-08-11, and still
holds — but its MARGIN is thinner and one config flag would end it.** The editor now registers
`Highlight`, `Subscript` and `Superscript` on top of `StarterKit`. Scanning their dist for `data-`:
subscript and superscript emit none, and `@tiptap/extension-highlight` emits **`data-color`** — but
only under `multicolor`, whose default is `false`, and `rich-text-editor.tsx` registers `Highlight`
bare. Reproduce:
`grep -n "multicolor\|data-color" node_modules/@tiptap/extension-highlight/dist/index.js`
— the extension returns no attributes at all when the flag is off. **Enabling `multicolor` would make
the re-admission set non-empty and turn this into a real two-part fix.** Note that the fix is now
literally ONE line rather than two, since there is one sanitizer left to change.
★★ This is the second `data-*` producer sitting one config flag away; §140 carries the first
(task list's `data-type`/`data-checked`) and OWNS closing this entry, because the attribute
boundary has to be designed once for both.

★ Reproduce: `grep -n "ALLOW_DATA_ATTR: false" src/app/sanitize-html.ts` returns exactly one
line. ★ Deliberately no line NUMBER: the first revision of this entry cited one, and the
same change set that wrote it inserted comment lines above and broke it. ★★★ **GREP THE SETTING, NOT THE BARE NAME** — the bare `ALLOW_DATA_ATTR` returns THREE
lines, because that sanitizer's own comment discusses the flag twice, and the first revision of this
entry shipped the bare-name form asserting "exactly one line". The command refuted the sentence it
was attached to. That is the same failure this file records against the CI-bypass bullet
(AGENTS.md's ★★★ "Attach the command and run it") — it has now happened more than once, in more
than one file. (The file's fourth `DOMPurify.sanitize` call is the strip-everything projection —
`ALLOWED_TAGS: []`, `ALLOWED_ATTR: []` — and is unaffected.)

★★ **The mechanism, and why `data-asset-id` needed `ADD_URI_SAFE_ATTR`.** Setting
`ALLOW_DATA_ATTR: false` removes the `data-*` SHORT-CIRCUIT — at `purify.cjs.js:1846` the `data-*`
branch skips the WHOLE remaining chain, name test and value test alike — which drops every such
attribute into the value chain, where `ALLOWED_URI_REGEXP` is tested against EVERY attribute value,
not only URI-bearing ones, and a non-URI value is rejected. Any `data-*` a fix wants to KEEP must
therefore be re-admitted by name AND exempted from the value test.

★★ **It is a TWO-LINE FIX — one `ALLOW_DATA_ATTR: false` per sanitizer — because the set needing
re-admission is EMPTY.** An earlier revision said the opposite ("NOT a one-line fix… first enumerate
which `data-*` names those two sanitizers' call sites actually depend on"), which is the expensive
direction: it prices a two-line change as a slice and nobody starts it. The enumeration was then
actually run, 2026-08-08:

★★ **THE FOUR BULLETS BELOW ARE THE 2026-08-08 RUN, KEPT VERBATIM — their commands name symbols that
are now DELETED and will return nothing.** They are not renumbered to today's tree for the same
reason a dated audit snapshot is not: rewriting a signed measurement to match the current code
destroys the only thing it is good for. Substitute `sanitizeRichHtml` for the two retired names when
re-running; the conclusion was re-verified above.

- Every non-test call site, via `grep -rn "sanitizeTemplateHtml\|sanitizeNoteHtml" src/ scripts/ e2e/
  | grep -v "\.test\."` — including the indirect ones (`sanitizeAiRichText` → `withAiRichFields`, and
  the four `sanitize*RichFields` wrappers, which call `sanitizeNoteHtml` at `note-log.ts:157`). None
  depends on a `data-*` name. ★ Neither sanitizer is ever passed by REFERENCE into a `.map`/
  `buildList` callback — the only indirection is `rich-text-editor.tsx:123`'s ternary alias, which
  the bare-name grep catches anyway.
- The EDITOR is the one producer that could legitimately emit `data-*`, and does not.
  `rich-text-editor.tsx` loads `StarterKit` alone, which registers Blockquote · BulletList ·
  CodeBlock · Heading · HorizontalRule · Link · ListItem · OrderedList · Underline — and NOT
  TaskList/TaskItem. Scanning every enabled extension's dist for `data-` returns nothing. ★ The only
  `data-*` in the Tiptap tree is `data-checked` / `data-type` in `@tiptap/extension-list`, and its
  context (`tag: 'li[data-type="…"]'`) shows it belongs to the unregistered taskItem — finding those
  strings by a package-wide grep and stopping there is how this gets called non-empty.
- Nothing stored carries one either: `grep -rn "data-[a-zA-Z-]*=" src/app/__fixtures__/
  src/app/sample-workspace-*.json` returns nothing, and `grep -c "data-" src/app/i18n.ts
  src/app/i18n.de.ts` returns 0 and 0.
- ★★ `data-asset-id` is REAL but belongs to the THIRD sanitizer and cannot reach these two. It is
  only ever emitted on `<img>`, absent from both narrow tag lists, so such markup loses the TAG
  before the attribute question arises — and documents never route here anyway:
  `document-preview.tsx` and `doc-render-html.ts` both use `sanitizeDocumentHtml`, and
  `RichTextView` (the `sanitizeNoteHtml` sink) has two production consumers —
  `dashboard-narrative.tsx` and `note-log-panel.tsx` — neither of them documents.
  ★ Reproduce with the IMPORT, not the bare name — and note the `\.\.?`, which is
  load-bearing: one consumer sits in `dashboard-sections/` and imports `../rich-text-view`,
  so a `\./`-only pattern silently returns one file instead of two.
  `grep -rlnE 'from "\.\.?/rich-text-view"' src/app --include="*.tsx" | grep -v '\.test\.'`
  ★★ TWO earlier revisions of this line shipped a command that did not produce the
  sentence beside it. The bare-name grep returns FIVE files (the symbol is also named in
  its own module and in TWO test files, so "discounting its own module and test" leaves
  three, not two); the `\./`-only import grep returns ONE. Both were caught by running
  them. Run yours.

★ The one behaviour change a fix DOES make: model-authored HTML arriving through `sanitizeAiRichText`
would lose any `data-*` a model happens to emit. That is the flag working, not a cost.

★ No known exploit. `data-*` carries no script and no navigation; the concern is that the allow-list
does not mean what it appears to mean, which is the state that produces a wrong review conclusion
later. Recorded for that reason, not as a live vulnerability.

### 2026-08-11 — what the surviving offender now spans, and why NOT to flip it in this slice

The KIND is unchanged (both retired sanitizers had the default too), but say the reach out loud
rather than leaving it at "21 tags": `sanitizeRichHtml` is the boundary for the seven rich entity
fields (`Task.description` plus the six in `AI_RICH_FIELDS`), every `noteLog[].html`, the dashboard
narrative, meeting reports and comm templates. A stored `<p data-x="…">` therefore persists through
all six write paths and comes back out at a `dangerouslySetInnerHTML` sink (`RichTextView`,
`comm-send-preview-modal.tsx`, `meeting-report-panel.tsx`). Measured on dompurify 3.4.13:
`sanitizeRichHtml('<p data-foo="1">a</p>')` → `<p data-foo="1">a</p>` · `sanitizeDocumentHtml(...)`
→ `<p>a</p>`. Inert today, for the reasons above.

★★★ **DO NOT FLIP IT HERE, and the reason is a VERIFIED dependency rather than caution.** The
task-list markup §140 plans depends on DOMPurify's `data-*` default: `@tiptap/extension-list` renders
`taskList` as `<ul data-type="taskList">` and `taskItem` as `<li data-type="taskItem">`, and the
item's `checked` attribute renders as `data-checked` **on the `li`** (its `parseHTML` reads it back
from the same `li`). Both tags are already on `RICH_ALLOWED_TAGS`, so today the attributes survive
purely because the flag is TRUE — flip it and a task list round-trips to a plain bullet list with
every checkbox reset. Reproduce:
`node -e "const s=require('fs').readFileSync('node_modules/@tiptap/extension-list/dist/index.js','utf8'); for (const m of s.matchAll(/data-type\": this.name/g)) console.log(s.slice(m.index-260, m.index+120).replace(/\n/g,' | '))"`
and `grep -o '.\{0,60\}data-checked.\{0,40\}' node_modules/@tiptap/extension-list/dist/index.js`.
★★ So §140 must design the attribute boundary — a NAMED `data-*` allow-list plus the
`ADD_URI_SAFE_ATTR` exemption the mechanism note above describes — and flip the flag in the same
change. Flipping first breaks a feature that has not shipped yet; flipping never leaves the gate
meaning less than it looks. ★ This is the SECOND independent producer confirmed one config flag away
(`@tiptap/extension-highlight`'s `data-color` under `multicolor` is the first), which is the argument
for doing it once, in §140, rather than twice.

### CLOSED 2026-08-13 by §140

`sanitizeRichHtml` now sets `ALLOW_DATA_ATTR: false` (`src/app/sanitize-html.ts`), closing the
short-circuit this entry is about. Measured on the current code: `sanitizeRichHtml('<p
data-foo="1">a</p>')` → `<p>a</p>`, matching `sanitizeDocumentHtml`'s output — the offender this
entry named is gone, not merely narrowed.

★★★ **THIS ENTRY'S OWN ANALYSIS SAID THE FIX WAS TWO LINES BECAUSE THE RE-ADMISSION SET WAS EMPTY, AND
THAT REASONING DID NOT SURVIVE §140.** By the time the flag was flipped, the set was no longer empty —
§140 needed to re-admit exactly the three names task list and alignment depend on
(`data-align`/`data-type`/`data-checked`), plus wire each through `ADD_URI_SAFE_ATTR` (this entry's own
mechanism note, ★★ above) and guard every one with a VALUE predicate, not just a name. So the actual
fix was the whole §140 slice — a literal `ATTR_VALUES` table plus a lazily-registered
`uponSanitizeAttribute` hook — not the two-line change this entry predicted for the empty-set case.
Recorded so a reader who remembers "two lines" does not go looking for a change that small.

---

## 116. The duplication gate reads TOTAL duplicated LINES — the per-format token figure is a decoy — open, a decision

★★ **This entry shipped with its central claim inverted, and the inversion was INHERITED rather than
invented.** The first revision said the gate reads the per-format TOKEN percentage, put tsx at 1.70%
"0.05pp from blocking", and warned the reader off the two figures nearer the truth. `AGENTS.md` said
"per-format" in two places — the `dup:check` Commands line and the CI pipeline bullet — and this
entry turned that into a number. Both are corrected. Recorded rather than quietly rewritten, because
the word "Measured" sat above a table that WAS measured and a sentence about which cell the gate
reads that was NOT.

Measured 2026-08-08 on the S3a branch (`npm run dup:check`, exit 0):

| Format | Duplicated tokens | Duplicated lines |
|---|---|---|
| tsx | 6677 / 391620 = 1.70% | 899 (1.34%) |
| typescript | 5249 / 379661 = 1.38% | 713 (1.04%) |
| **Total** | 11926 / 778582 = 1.53% | **1612 (1.19%)** ← the only cell the gate reads |

★★ **The gating number is the TOTAL duplicated-LINE percentage: 1.19% against `--threshold 1.75`, so
0.56pp of headroom.** Not per-format, not tokens. The console flags none of the six cells, so the
exit code is the only witness — run `dup:check`'s own jscpd invocation with the threshold overridden:

| `--threshold` | EXIT | what a 1 would have meant |
|---|---|---|
| 1.60 | 0 | per-format TOKENS gate (tsx 1.70%) — ruled out |
| 1.52 | 0 | TOTAL TOKENS gate (1.53%) — ruled out |
| 1.30 | 0 | per-format LINES gate (tsx 1.34%) — ruled out |
| 1.19 | 0 | — |
| 1.18 | **1** | `ERROR: jscpd found too many duplicates (1.2%) over threshold (1.2%)` |

Only the last pair moves, and it brackets 1.19%. ★ The printed `1.2%` is the total LINE figure
rounded to one decimal; total tokens would have printed `1.5%`.

★ jscpd is 5.0.11, which ships a native Rust `cpd` binary (`node_modules/jscpd/run-jscpd.js` spawns
it) and documents `--threshold` as a single "Max duplication % before exit 1". Whether an older JS
implementation ever thresholded per format is unknown and does not matter — it does not today. If
the dependency is bumped, re-run the bisect rather than trusting this table.

★ The decision this entry exists for still stands, on honest numbers: S3b is the block editor
(§113), the roadmap's main UI slice, and per-block editor components are the kind of code jscpd
finds repetitive. 0.56pp of total-LINE headroom is more room than 0.05pp of tsx tokens looked like,
but a large repetitive slice can still spend it — and the gate counts `.tsx` lines into the same
total, so tsx growth moves the gating number directly. Decide during S3b planning — refactor the top
clones, or raise the threshold with a recorded justification — not against a red pipeline.

---

## 117. Three S3c image prerequisites, all inert today — (b) CLOSED 2026-08-13 by §140, (a) and (c) still open

★ ONE entry rather than three because all three share a trigger: they become live the
moment S3c wires the asset store, and whoever implements it needs the whole checklist.
Lettered parts follow §36(a)'s precedent.

★★ NONE OF THESE IS A LIVE DEFECT. Nothing writes `data-asset-id` today and `src` is not
allow-listed, so every one of them is currently unreachable. They are recorded because
each is measured, and each is the kind of thing a later slice assumes rather than checks.

**Reproduce (all three).** Needs a DOM, so it cannot run under bare node. Save the probe
OUTSIDE the repo and run it FROM the repo root, so `node_modules` resolves: bootstrap
`window`/`document` from a `jsdom` instance, then dynamically import
`src/app/sanitize-html` and `src/app/document-model`, and run with `npx vite-node`.

### (a) An image-only paragraph is DELETED on every load path

`document-model.ts` `sanitizeBlock` drops a paragraph block with no visible text:

    grep -n "htmlTextLength(html) === 0" src/app/document-model.ts

→ one line: `if (htmlTextLength(html) === 0) return null;`. An `<img>` contributes no
text, so a paragraph containing only an image measures 0 and the whole block is removed.
Measured 2026-08-08 — `sanitizeProjectDocuments` over two blocks returned only the second:

| input blocks | returned |
|---|---|
| `[{paragraph, html:'<p><img data-asset-id="7"></p>'}, {paragraph, html:'<p>ok</p>'}]` | `[{"type":"paragraph","html":"<p>ok</p>"}]` |

★ A paragraph with text AND an image survives; only the image-ONLY case is lost.

★★ THIS MAKES A SHIPPED COMMENT FALSE. `sanitize-html.ts` justifies allow-listing `img`
with "allow-listed here so stored markup written by a later slice is never retroactively
stripped by this one" — true of that sanitizer and defeated by a different layer that
also runs on load. The structural validator strips it regardless. That is §111's class:
the invariant outlives the code, and the next reader stops checking.

★ The fix is a DECISION, not a one-liner: `htmlTextLength` is the same helper the cap
uses, so "visible text" would have to learn that a void element counts as content, or
`sanitizeBlock` needs an image-aware arm. Either way it changes what an empty paragraph
means on all six write paths.

### (b) `data-asset-id` values are entirely unvalidated — CLOSED 2026-08-13 by §140

`ADD_URI_SAFE_ATTR: ["data-asset-id"]` exempts the attribute from the value chain
altogether — which is the whole reason it is there (`ALLOWED_URI_REGEXP` is tested
against EVERY attribute value, so an opaque id fails it). The cost was that NOTHING
checked the value. Measured, on the PRE-§140 code:

| input | output |
|---|---|
| `<p data-asset-id="7">x</p>` | unchanged |
| `<p data-asset-id="javascript:alert(1)">x</p>` | **unchanged, verbatim** |
| `<p data-asset-id='a&quot;b<c'>x</p>` | **unchanged** — a raw `<` survives in the value |

★★ "Opaque key" is NOT the same as "safe to interpolate". Harmless at the time because nothing
read it, and both OOXML renderers escape everything they emit. It would have stopped being harmless
the moment the value was used to build a URL, a filesystem path, a lookup key, or was
concatenated into markup.

★★★ **CLOSED, not deferred to the consumer.** §140's `ATTR_VALUES` table (`sanitize-html.ts`) now
guards `data-asset-id` with a conservative charset/length predicate —
`/^[A-Za-z0-9_-]{1,64}$/` — applied through the SAME `uponSanitizeAttribute` hook that guards
`data-align`/`data-type`/`data-checked`. Deliberately silent on FORMAT (admits uuid, ulid, nanoid, a
content hash or an integer, so it cannot constrain whatever id a future images slice mints) and strict
on CHARSET and LENGTH (rejects empty, whitespace, quotes, angle brackets, path separators and 65+
chars). Re-measured on the current code: `sanitizeDocumentHtml('<img data-asset-id="javascript:alert(1)">')`
drops the attribute; `sanitizeDocumentHtml('<img data-asset-id="a1-B2_c3">')` keeps it verbatim.
A future images slice inherits this guard for free — it does not need to invent its own validation,
only to widen `ATTR_VALUES`' predicate if the id shape it mints ever needs a wider charset.

### (c) Adding `src` opens `data:` URIs on `img`, bypassing the URI allow-list

`img` is in DOMPurify's default `DATA_URI_TAGS`, and `_isValidAttribute` short-circuits
for `src` on such a tag BEFORE `ALLOWED_URI_REGEXP` is consulted. Measured on the real
config with `src` added to `ALLOWED_ATTR` and nothing else changed:

| input | result |
|---|---|
| `<img data-asset-id="7" src="data:…">` (TODAY, no `src` in list) | `<img data-asset-id="7">` — inert |
| `<img src="data:image/svg+xml;base64,…">` (with `src`) | **survives** |
| `<img src="data:text/html;base64,…">` (with `src`) | **survives** |
| `<img src="javascript:alert(1)">` (with `src`) | dropped |
| `<a href="data:text/html;base64,…">` (with `src`) | **dropped** |

★★★ THE `<a>` ROW IS THE PROOF, not decoration. The identical config drops `data:` on an
anchor and keeps it on an image, which isolates the cause as the per-element
`DATA_URI_TAGS` short-circuit rather than a general failure of the regexp. Without that
control the other rows are consistent with "the regexp does not work", which would send a
fixer to the wrong place.

★ SVG runs script, so `data:image/svg+xml` is an XSS vector, and `data:text/html` is one
outright. `javascript:` is still dropped — that is the one thing the short-circuit does
not cover, which is why the gap reads as safe on a casual test. A slice shipping image
`src` must constrain `DATA_URI_TAGS` or `FORBID_ATTR` itself; widening
`ALLOWED_URI_REGEXP` does nothing here.

---

## 118. A legacy plain-text paragraph collapses in every renderer, and the obvious fix destroys markup — CLOSED 2026-08-10

A `paragraph.html` holding literal plain text with newlines renders as ONE fused line.
Measured base-vs-head on the S3a branch with `html: "a\nb"`:

| | DOCX `word/document.xml` |
|---|---|
| before the mark-aware slice | `<w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r>` |
| after | `<w:r><w:t>a b</w:t></w:r>` |

PPTX went from two `<a:p>` paragraphs to one. ★ HTML/PDF has ALWAYS collapsed it — that
renderer never upgraded — so the slice made all three CONSISTENT rather than making two
newly wrong. It is still wrong in all three.

★★ REACHABLE ONLY BY IMPORT, never by normal use. The AI write boundary upgrades before
storing (`sanitizeAiDocumentRichText("a\nb")` → `"<p>a<br>b</p>"`), and the model is the
only in-app author today. But measured through the real composed load pipeline
(`sanitizeProjectDocuments` then `sanitizeDocumentRichFields`, as every load path calls
them), `{"type":"paragraph","html":"a\nb"}` survives byte-for-byte — neither pass
upgrades. So hand-edited or externally-produced workspace JSON, and any document predating
the rich-text work, reaches the renderer un-upgraded.

★★★ **THE OBVIOUS FIX IS UNSAFE, AND THIS IS THE POINT OF THE ENTRY.** Composing
`descriptionHtml` in front of `htmlToRichLines` at the two OOXML call sites was
implemented, measured and REVERTED on 2026-08-08. It turned two passing tests red:
`descriptionHtml` gates on `HTML_START`, which knows only `p|br|strong|em|ul|ol|li|a`, so
a paragraph whose FIRST tag is `blockquote` — already valid, already sanitized, already
stored — is classified as PLAIN TEXT and `plainToHtml` escapes the entire value to
`&lt;blockquote&gt;…`. Observed: expected paragraph styles
`['Title','Quote','CodeBlock','CodeBlock']`, got `['Title']` — the formatting did not
degrade, it vanished.

★★ **So this and §114 are the SAME defect, and this direction is worse.** §114 escapes a
value at the WRITE boundary, where the model can be told to wrap in `<p>`. This would
escape a value already STORED as valid markup, at the RENDER sink, where nothing can be
told anything — for ALL NINE document-only tags. ★★ Nine, not eight: an earlier
revision of this entry said "8 of the 9", which contradicted §114 in this same file
and understated the entry's own case. Measured one leading tag at a time through the
real `descriptionHtml` — `s` `code` `pre` `blockquote` `hr` `mark` `sub` `sup` `img`
all escape. `<s>` does not match `strong`, and `<sub>`/`<sup>` do not either.
The load boundary does not protect it:
`sanitizeDocumentHtml` is DOMPurify, which parses the whole tree and does not care which
tag comes first, so such a value passes through as real markup.

★ ORDER OF WORK: fix the classifier first — §113 schedules the `HTML_START` split in its
*(before S3b)* row, and §107 records why widening the shared regex in place is the wrong
shape. Only then can the upgrade be composed. Do not re-attempt the composition before
that; it is not a one-line fix waiting to be typed, it is a fix waiting on a dependency.
(That order was followed. The classifier split landed first — §107 — and the composition
was then re-attempted. It was still wrong. See the CLOSED block at the end of this entry
before reading the paragraph above as the whole recipe.)

★★ THE LOAD-BOUNDARY VARIANT IS WORSE, NOT BETTER. Composing the upgrade into
`sanitizeDocumentRichFields` would fix all three renderers from one place — and would be a
MUTATION ON LOAD that the next save PERSISTS: it rewrites stored bytes on all six write
paths for documents nobody edited, makes `documentVersions` before-images record a diff no
user made, and moves byte-stable golden fixtures for an input that did not legitimately
change. It is the same class as the standing rule that an AI rich-field boundary is applied
to the model's INPUT and never to the merged entity. It also blurs that module's stated
contract, which is the allow-list, not format normalisation.

★ A CORRECTION worth keeping, because it was asserted before it was measured: composing
the upgrade would NOT have restored the old `<w:br/>` shape even where it is safe.
`htmlToRichLines` treats `<br>` as a line break, so `"<p>a<br>b</p>"` yields TWO
`RichLine`s and therefore two `<w:p>` paragraphs — not one paragraph containing a break.
That is consistent with how this slice treats every other block boundary, but it is not
what the earlier base-vs-head comparison was taken to imply.

**CLOSED 2026-08-10 — in TWO commits, and the FIRST was wrong in a NEW way.** Recorded in
full, because this entry predicted only half of it.

`94b7fd21` did exactly what the ORDER OF WORK note prescribes: with §107's classifier
split landed, it composed `descriptionHtml(html, "document")` in front of the three
renderers. That fixed the fusing AND turned the falsification test above green
(`doc-render-docx.test.ts`, `pStyles` back to `["Title","Quote","CodeBlock","CodeBlock"]`).
It ALSO regressed every paragraph opening with a tag `DOCUMENT_ALLOWED_TAGS` omits.
Measured, one leading tag at a time, before vs after:

| stored `paragraph.html` | before `94b7fd21` | after |
|---|---|---|
| `<h3>Sub</h3>` | `Sub` | `<p>&lt;h3&gt;Sub&lt;/h3&gt;</p>` |
| `<div>Status</div>` | `Status` | escaped the same way |
| `<table>…</table>` | the cell text | escaped the same way |

`58b26e5b` fixed it by adding a FIFTH sink, `render` — the one member of `RichTextSink`
with no allow-list behind it.

★★★ **THE RULE, and it is the generalisation this entry exists to leave behind: AT A
RENDER BOUNDARY NO ALLOW-LIST-DERIVED CLASSIFIER IS NARROW-SAFE.** The whole split is
built on "never recognise LESS than your sink keeps", and these sinks keep EVERYTHING:
`sanitizeDocumentHtml` runs DOMPurify at the `KEEP_CONTENT` default, so an unlisted tag is
UNWRAPPED and its text survives, and `htmlToRichLines` parses whatever it is handed and
keeps any tag's text. `DOCUMENT_ALLOWED_TAGS` is the widest list there is and was STILL
too narrow. A miss there is strictly worse than having no classifier at all: the sink
would have unwrapped ONE tag, the classifier escapes the WHOLE value. The upgrade is still
needed — that is this entry's own fused `"a\nb"` — so the answer was not to drop the
classifier but to ask the other question, "is this plain text at all?"

★★ The `render` sink is not a bare "match anything": it reuses the factory's shape and so
keeps all three guards — the tag must actually CLOSE, it must start with a LETTER, and a
CLOSING tag does not match. `<li 3 items`, `<3 open` and `</p> means close` all still take
the plain-text path. ★ What it does NOT keep is the factory's `^\s*` ANCHOR: the four
derived sinks ask "does this START with a tag my sink keeps?", `render` asks "does this
CONTAIN a tag anywhere?". The first shipped anchored and escaped real markup that did not
happen to OPEN with a tag — `"Intro <strong>bold</strong> tail"` reached Word, PowerPoint,
HTML and PDF as literal `&lt;strong&gt;`. Anchoring is right for a STORAGE sink, where the
escaped form persists; it is wrong here, where nothing is stored and every tag's text is
kept, so the only failure mode is escaping markup that was real.

★★ **A GREEN TEST SAT THROUGH THE WHOLE REGRESSION AND THAT IS THE OTHER LESSON.**
`doc-render-html.test.ts`'s "unwraps a non-allow-listed tag inside paragraph html but keeps
its text" asserted `not.toContain("<h3")` — which the ESCAPED form `&lt;h3` satisfies. It
was green for the wrong reason at exactly the moment it was needed. It now asserts the
escaped form absent BY NAME, and a sibling test pins `<div>` and `<table>` the same way. A
negative assertion about markup must name the escaped form too, or it cannot see this
class.

★ The ★★ "load-boundary variant is worse" block above is untouched and still governs: the
fix is at the three RENDER sinks, so nothing rewrites stored bytes, nothing moves a golden
fixture, and `documentVersions` records no diff a user did not make.

---

## 119. `<a href>` is dropped by both OOXML renderers — open

A link inside a document paragraph reaches `.docx` and `.pptx` as plain text: the words
survive, the target does not. The HTML/PDF renderer keeps both, so the same document
carries a working link in one format and a dead phrase in two others. Meanwhile
`chat-tool-defs-documents.ts` advertises `a` to the document-authoring model, so the model
is invited to emit links the majority of the export paths silently flatten.

★ Pre-existing, NOT introduced by the mark-aware slice — the flat projection it replaced
dropped the href too. Confirmed rather than assumed, three ways:

    grep -n "w:hyperlink\|hyperlink" src/app/doc-render-docx.ts src/app/ooxml-docx-primitives.ts
    grep -n "hlinkClick" src/app/doc-render-pptx.ts src/app/ooxml-pptx-primitives.ts
    grep -n "href" src/app/rich-text-runs.ts

All three return nothing. `A` is in neither `MARK_BY_TAG` nor `LINE_TAGS`
(`rich-text-runs.ts`), so an anchor falls through to the plain recursion and contributes
only its text — which `rich-text-runs.test.ts`'s "carries no mark for a tag that only
wraps (a link)" already pins as the intended behaviour of the parse.

★ Not a one-line fix in either format, which is why it is filed rather than done: a real
`.docx` hyperlink is a `w:hyperlink` element carrying an `r:id` into a RELATIONSHIP part,
so `buildDocxPackage` would have to collect per-part relationships it does not model
today; `.pptx` needs the equivalent `a:hlinkClick` plus its own slide relationship. The
shared parse would also have to start carrying a href on `TextRun`, which is a change to
the type both renderers consume.

---
**CLOSED 2026-08-08 by `max-md:basis-full` on the group.** The group claims its own row, so the
parent pill is a single-row sibling again and no top-level entry can share a row with a child.

★★★ **`max-md:` is the whole fix — a bare `basis-full` (which is what the "likely fix" line above
proposed) would BREAK the desktop rail.** Above the breakpoint the nav is `md:flex-col`, where
`flex-basis` resolves against the MAIN axis — HEIGHT — so an unqualified `basis-full` sets the group
to 100% of the nav's height. The `max-md:` variant is provably inert above the breakpoint: the
measurement below reads the group's computed `flex-basis` as `auto` at 1280px and `100%` at 760px,
from the same build.

★ Measured in Chromium against a fresh `PORT=3100` dev server, seeded via `e2e/seed.ts`, in a
throwaway spec reading `getBoundingClientRect` (deleted after use — nothing in the unit suite can see
any of this, and the axe gate scans one desktop viewport with no wrap-order rule). Active parent pill
("AI Assistant") height, before → after:

| viewport | pill height | group width | group `flex-basis` | nav height |
|---|---|---|---|---|
| 1280px before | 36px | 224px | `auto` | 559px |
| 1280px after | 36px | 224px | `auto` | 559px |
| 760px before | **116px** | 136.02px | `auto` | 160px |
| 760px after | **36px** | 712px | `100%` | 240px |

★ The narrow nav growing 160px → 240px is the fix working, not a side effect: the group now occupies
a row of its own instead of being packed beside three unrelated top-level entries.

★ The nested `<ul>`/`<li>` nav structure raised in the same review remains the richer alternative and
is announced by more AT — not adopted here, because a one-class layout fix does not justify rewriting
the rail's markup and re-verifying every announcement.

## 120. The background insight-recommendation runner has no `AbortController` at all — open, billed

★ **Filed as §113** on `feat/ui-batch-slice-3`, renumbered to §120 when that branch was prepared for
merge: main had independently taken 113 (the documents-roadmap entry, `bba9b6a9`). Main is the trunk
and the branch moves. Every commit message on this branch says §113 and none can be edited. The same
one-hop shift applies to the four entries below — filed as §120, §121, §122, §123, now §121, §122,
§123, §124.

Found 2026-08-08 while auditing the AI trigger sites for the shared `AiTriggerButton` (slice 3's
"every AI trigger offers Stop"). The slice covers TRIGGERS; this path is not one, which is why it is
recorded here rather than fixed there.

`use-insight-recommend-runner.ts:84` awaits `runInsightRecommendation({ apiKey, model, context,
index, today })` inside a `for (const insight of candidates)` loop. **There is no `signal` key in
that argument object**, and the file creates no `AbortController` anywhere — grep it. The call
already ACCEPTS a `signal` (the on-demand sibling `use-insight-recommend.ts` passes one through
`useAbortableAi`), so the gap is a missing thread, not a missing capability.

★ Blast radius is bounded but real: `MAX_BG_RECS_PER_TICK` (`insights/insight.ts:99`) is **3**, and
the loop is serial, so at most three billed Anthropic calls per tick run with no way to stop them —
including across an unmount, since with no controller there is nothing for a cleanup to abort. The
`break` on a `limit`/`auth` `AiHttpError` stops the REMAINING candidates; it cannot stop the one in
flight.

★★ Consequence for the prose: after slice 3, "every AI TRIGGER in this app is cancellable" is true
and **"every AI CALL in this app is cancellable" is not**. Do not let the second sentence into
AGENTS.md, a CHANGELOG entry or a commit body — this entry exists because the slice's own commit
message was corrected for exactly that overclaim.

★ Likely fix: give the runner an `abortRef`, pass `controller.signal` into the call, abort on
unmount, and treat `isAbortError` as a silent stop (the established shape — `use-abortable-ai.ts`).
Left open because the runner is background/unattended: there is no user-facing control to hang a
Stop on, so the design question (does an unattended tick get cancelled on unmount only, or does the
Insights view grow a "stop background recommendations" affordance?) is a slice of its own.

## 121. `use-tasks-dedup.tsx` never aborts its in-flight call on unmount — CLOSED 2026-08-08

★ **Filed as §120** — see the renumbering note at the head of the entry above, §120.

Found 2026-08-08, same audit as §120 (which was filed as §113).

`use-tasks-dedup.tsx` owns an `abortRef` and aborts correctly in its `reset` callback, but AT AUDIT
TIME the file contained **no `useEffect` at all** — `grep -n "useEffect"
src/app/use-tasks-dedup.tsx` returned nothing. So when the pane holding the trigger unmounted
mid-`"thinking"`, the billed `runDedupProposal` call kept running to completion with its result
discarded. (Line numbers are deliberately omitted: a fix to this very file moves them. See the STATUS
block below before treating this as current.)

★★ Measured against its peers, and **this hook is not the exception — half the trigger set behaves
the same way.** Take the six sites the slice gave an `AiTriggerButton` and ask, for each, which hook
owns its `AbortController` and whether that hook aborts on unmount:

★★★ THE TABLE BELOW CARRIED `file:line` CITATIONS AND THEY WERE ALREADY WRONG. They were exact at
`2e1087e1` and rotted within the same branch — `inline-ai-edit-popover.tsx:77` is now 88 and
`use-tasks-dedup.tsx:181` is now 198, moved by the very fix rounds this entry describes. Worse, the
paragraph directly above says line numbers are DELIBERATELY OMITTED, so the table contradicted its
own entry. They are dropped here in favour of file + symbol, which is this repo's standing rule
precisely because a line can be broken by the commit that writes it. Do not reintroduce them.

| trigger mount | backing hook | aborts on unmount? (AT AUDIT TIME) |
|---|---|---|
| `insight-recommendation-controls.tsx` | `use-insight-recommend.ts` → `use-abortable-ai.ts` | **yes** |
| `use-alloc-plan.tsx` | `use-alloc-plan.tsx` | **yes** |
| `use-raci-suggest.tsx` | `use-raci-suggest.tsx` | **yes** |
| `actions-panel.tsx` | `use-action-analysis.ts` | **no — the file had no `useEffect` at all** |
| `inline-ai-edit-popover.tsx` | `use-inline-entity-edit.ts` | **no — see below** |
| `use-tasks-dedup.tsx` | `use-tasks-dedup.tsx` | **no — this entry** |

★★★ **CLOSED for THIS hook, and the table above is now HISTORY — it is the audit taken before slice
3's fix round, kept because the count is the point.** `use-tasks-dedup.tsx` gained the cleanup-only
`useEffect(() => () => abortRef.current?.abort(), [])` in slice 3's review round, pinned by a test
that captures the signal, asserts `aborted === false` before unmount and `true` after (mutation-proved
red with the effect deleted). The gap remaining **when this entry was closed** was two of six —
`use-action-analysis.ts` and `use-inline-entity-edit.ts`, which that change does not touch — and it
was filed as **§127** — **which is now CLOSED too**: both hooks were fixed later the same day, in the
review round that followed, so all six abort on unmount. Neither this entry nor §127 describes a live
defect; both are kept for the count and the reasoning. Re-run the sweep below rather than quoting
either.

So THREE of the six lacked it at audit time, not one. ★★★ **AT AUDIT TIME (2026-08-08, before slice
3's fix round) exactly THREE files carried the cleanup-only shape** `useEffect(() => () =>
abortRef.current?.abort(), [])` — `use-abortable-ai.ts`, `use-alloc-plan.tsx`, `use-raci-suggest.tsx`.
That sentence used to be written in the present tense with the number three, and it was FALSE the
moment `use-tasks-dedup.tsx` gained the shape in the round that closed this very entry — the fix and
the claim it falsifies landed together. Treat the figure as historical and **re-run the sweep** — it
moved again when §127 was worked, and reads **6** today:

```bash
grep -rlF "() => () => abortRef.current?.abort()" src/app; echo "EXIT=$?"
```

(No pipe — read the exit code unpiped, per the AGENTS.md landmine.) Re-measured 2026-08-08 while
writing this correction: **6** files, i.e. all six hooks in the table. That reading includes
UNCOMMITTED work in the tree and is therefore evidence about a moment, not about `main` — §127 is
the entry that owns the remaining gap, and its STATUS block is the authority on whether it is real.

At audit time the two remaining files failed in DIFFERENT ways, and the distinction is what §127
carries forward: `use-inline-entity-edit.ts` HAD a `useEffect`, but it fired on
`paneActive === false` and returned no cleanup, so it aborted on DEACTIVATION and never on unmount;
`use-action-analysis.ts` owned a controller and a `cancel` and contained no `useEffect` whatsoever.

★★ **Do not write "all the others already do this"** — an earlier revision of this entry warned
against exactly that framing and then committed it, by counting `use-action-analysis.ts` as not
existing. Reproduce the sweep before quoting any figure here:

```bash
grep -rn "new AbortController" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
grep -rn "<AiTriggerButton" src/app --include="*.tsx" | grep -v "\.test\."
grep -rn "abortRef" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Measured 2026-08-08: **13** non-test `new AbortController` sites in `src/app`. Six are the hooks in
the table above; the other **seven** are outside the trigger set — `api/stt/_helpers.ts:84`,
`chat-panel.tsx:281`, `step0-import-panel.tsx:195`, `turso-pipeline.ts:42`, `use-chat-models.ts:35`,
`use-digest.ts:86`, `use-timelog-sync.ts:96`. And **6** `<AiTriggerButton>` mounts, which is the
number the CHANGELOG's "six AI trigger sites" refers to — it is the count of sites this slice
covered, NOT a count of the app's billed AI calls (see §120, and the two uncovered controls in
§125).

★★ The reach is larger here than for the other triggers: `useTasksDedup` is mounted TWICE
(`tasks-section.tsx`, `gantt-view.tsx`, see `dedup-trigger-qualifier.test.tsx`), and in the modern
shell a view UNMOUNTS on every navigation away. Starting a dedup and switching tabs is the ordinary
path, not an edge case.

★ The fix WAS one line beside the existing `reset` — the cleanup-only shape above, which sets no
state and so stays clear of the `react-hooks/set-state-in-effect` ban. It was filed rather than done
at the time only because slice 3's task 8 was scoped to replacing the rendered control and was
explicitly forbidden from changing any feature's cancel semantics; the review round that followed was
not, and closed it.

★★ Past tense throughout, on purpose. This entry spent one commit reading as though the fix were
still owed, because the closure was written at the top and the prescription left at the bottom. When
you close an entry, read it to the END — see the same failure recorded in §127's STATUS block.

## 122. The budget people rows and the role row above them read BOOKED from two different sources — open, data-integrity

★ **Filed as §121** — see the renumbering note at the head of §120.

Found 2026-08-08 while wiring slice 3's task 11. Not a regression: the people rows are new, and the
divergence is created by giving them a source at all.

Two numbers are now stacked vertically in the same table, both called booked/actual, and they come
from different places:

* **The role row** (`budget-panel.tsx:663`) renders `a.actualHours[p.key]` — PERSISTED workspace
  data on the `BucketAllocation`. It is written only when a user runs Apply in the Timelog panel
  (`timelog-apply.ts:281` `applyActualsToBuckets`), and it is HAND-EDITABLE in the cell.
* **The people rows beneath it** (`budget-panel.tsx:678` → `budget-bucket-people.ts:67`) render the
  per-resource breakdown from the PER-DEVICE Timelog cache, read at
  `workspace-section.tsx:247` (`loadActualsCache(projectId)?.aggregates?.byBucket`) and written by
  every fetch (`use-timelog-sync.ts:219` `saveActualsCache`). Apply never touches it; nobody can
  edit it.

★★ **Nothing in the UI says they can disagree**, and their layout says the opposite: a disclosure
opening directly under a figure reads as a BREAKDOWN of that figure. They are not one, and they do
not reconcile by construction — the engine drops bookers whose role has no line on this bucket
(those hours stay in `unattributed`, `budget-bucket-people.ts:41-54`), so the people column does not
sum to the role row even when both sources are perfectly fresh.

Four ways they diverge in ordinary use:
1. Fetched but not yet applied — people rows show the new bookings, the role row still shows the old
   total. This is the DEFAULT state after every fetch.
2. Applied, then the cell hand-edited — the role row moves, the people rows do not.
3. Cache absent (another device, after `clearAppConfig`, or before the first fetch) — every person
   reads "—" while the role row shows real hours.
4. Multi-device Turso: the workspace carries another device's applied actuals while this device's
   cache holds an older fetch, so the people rows are OLDER than the row above them.
5. ★★ **A PARTIAL fetch (§172).** When a TimeLog project is lost to a fetch error, the cached
   aggregate is short, so every person who booked on that project reads LOW here — while the role
   row above shows the last applied total, which is complete. Added by the §172 slice, which marks
   such an entry `partial` and blocks APPLYING it; these rows are display-only and are deliberately
   NOT suppressed, because case 3 above is what suppression looks like and a missing figure is not
   better than a short one. §172's own enumeration of cache consumers names this as the third one.

★ The read is memoised on `projectId` alone, so it does not refresh while the Budget view stays
mounted — a fetch in the Timelog panel does not move these figures until the view remounts. That is
the accepted cost of not threading live `useTimelogSync` state through `workspace-section`
(explicitly chosen 2026-08-08, not an oversight).

★ Fix is one of two, and it is a product decision, not a mechanical one: (a) show a visible
staleness/source cue on the people body — the cache carries `fetchedAt` for exactly this, and it is
already read at `use-timelog-sync.ts:58` — or (b) give both rows ONE source, which means either
driving the people rows off persisted per-resource actuals (a new `Workspace` field, so the six
write paths) or accepting that the role row is the only trustworthy total and dropping the per-period
booked figures from the people rows entirely.

★★ A tooltip is NOT the fix and was deliberately not used: `budgetPeopleFigureHint` explains WHICH
figure is which ("Booked / planned hours"), and extending it to carry a correctness caveat would put
a data-integrity warning in a hover-only channel that no keyboard or touch user reaches.

Reproduce the two reads:
```bash
grep -n "actualHours\[p.key\]\|actualsByPeriod={" src/app/budget-panel.tsx
grep -n "loadActualsCache" src/app/workspace-section.tsx
```

## 123. The budget people-row disclosure clips its own label mid-glyph, with no ellipsis — CLOSED 2026-08-08

★ **Filed as §122** — see the renumbering note at the head of §120. ★★ The code comments in
`budget-panel-people-rows.tsx` and `budget-panel-people-rows.test.tsx` still cite §122; they point at
main's entry now and must be changed to §123 in the same commit as this renumber.

Found 2026-08-08 in slice 3's task-14 eye-verify. Not a regression — the control is new — and it is
the case AGENTS.md already documents in the abstract ("`text-overflow` does not apply to an
inline-flex button") reaching a surface where the clipped string is a real, variable-length data
value rather than a short column header.

`PeopleDisclosureLabel` (`budget-panel-people-rows.tsx:28`) renders a `ToggleButton
variant="disclosure"` AS the role line's label, inside the bucket table's role `<td>`, which is
clamped to the LIVE role-column width (`BUDGET_COL_WIDTHS.role` = 160 by default) and carries
`truncate`. `truncate` is `overflow:hidden` + `white-space:nowrap` + `text-overflow:ellipsis`, but
the cell's only child is an atomic inline-flex box, so the ellipsis never applies: the button is
simply cut at the cell edge, mid-glyph.

Measured in Chromium against `sample-workspace-small.json` (viewport 900×850, computed
`getBoundingClientRect`), role column at its 160px default:

| role label | button width | cell width | cut |
|---|---|---|---|
| Business Analyst Consultant | 185.6 | 160 | **25.6px** |
| Project Manager Senior | 160.0 | 160 | 0 (zero headroom) |
| Developer Consultant | 150.5 | 160 | fits, 9.5px spare |
| Developer Senior | 127.8 | 160 | fits |
| Developer Lead | 119.8 | 160 | fits |

So two of the seven role lines the sample renders are already cut at the DEFAULT width, and a third
sits exactly on the boundary. Dragging the role column to 90px (a normal thing to do — the column is
user-resizable) cuts every one of the seven, the worst by 107.6px, i.e. more than half the label
gone with nothing indicating it.

★★ CORRECTION, from re-measuring the same 7 lines on 2026-08-08 while fixing this: the table's `cut`
column compares the button against the column's DECLARED 160px, but the cell clips at its PADDING
edge, and the button starts `px-3` (12px) in — so the width actually available to the button is
`160 − 12 = 148`, not 160. Against that boundary **FOUR of the seven lines are cut at the default**,
not two: Business Analyst Consultant ×2 by 37.6px, Project Manager Senior by 12px, Developer
Consultant by 2.5px; Developer Senior ×2 and Developer Lead fit. The 90px figures need no
correction — `185.6 − (90 − 12) = 107.6` is the padding-edge number already. The entry understated
the default-width case; it did not overstate it.

★ The disclosure chrome is what pushes it over: the label text alone fits; the `ToggleButton` adds
its own padding plus the `data-pressed-marker` glyph, which by design renders in BOTH states so the
button keeps one width.

★★ The obvious fix is NOT the one AGENTS.md warns against. The warning there is about
`SortResizeTh`'s pinned HEADER, where swapping `overflow-hidden whitespace-nowrap` for `truncate`
was measured to change nothing, because the content is a button either way. Here the fix is to make
the button itself shrinkable and put the ellipsis INSIDE it, on the text node where `text-overflow`
does apply.

### FIXED — `PeopleDisclosureLabel` passes `className="max-w-full [&>span]:min-w-0 [&>span]:truncate"`

At the CALL SITE, not in `ToggleButton`: every other consumer of that primitive is a short fixed
label in an unclamped toolbar, so changing the primitive would alter them all to fix one caller. The
`&>span` reaches into the primitive's markup — that is the price of not changing it for everyone,
and `budget-panel-people-rows.test.tsx` pins both the class list and the one-direct-child-span
structure the selector depends on.

Re-measured in Chromium the same way (fresh `PORT=3100` server, `e2e/seed.ts`, viewport 900×850,
`getBoundingClientRect`), same 7 role lines, before → after:

| role label | 160px button W | 160px span scroll/client | 90px button W | 90px span scroll/client |
|---|---|---|---|---|
| Developer Senior | 127.8 → 127.8 | 86/86 → 86/86 (fits) | 127.8 → **66** | 86/86 → **86/24** |
| Business Analyst Consultant | 185.6 → **136** | 144/144 → **144/94** | 185.6 → **66** | 144/144 → **144/24** |
| Project Manager Senior | 160.0 → **136** | 118/118 → **118/94** | 160.0 → **66** | 118/118 → **118/24** |
| Developer Lead | 119.8 → 119.8 | 78/78 → 78/78 (fits) | 119.8 → **66** | 78/78 → **78/24** |
| Developer Senior (2nd) | 127.8 → 127.8 | 86/86 → 86/86 (fits) | 127.8 → **66** | 86/86 → **86/24** |
| Developer Consultant | 150.5 → **136** | 108/108 → **108/94** | 150.5 → **66** | 108/108 → **108/24** |
| Business Analyst Consultant (2nd) | 185.6 → **136** | 144/144 → **144/94** | 185.6 → **66** | 144/144 → **144/24** |

The button now stops at the cell's content box (136 at the 160px default, 66 at 90px) — overflow
past the clip edge is ≤ 0 on every line at both widths — and the label span's computed
`text-overflow` went `clip` → `ellipsis` with `scrollWidth > clientWidth` wherever the text no
longer fits. The glyph was also confirmed by screenshot, not only by the scroll/client ratio: the
long label renders "Business Analys…" at 160px and "Bu…" at 90px, inside an unbroken button border.

★★★ `min-w-0` MEASURED INERT — the entry's own suggested fix was half wrong about the mechanism.
`truncate` sets `overflow: hidden`, and a flex item whose computed overflow is not `visible` already
has an automatic minimum size of 0 (CSS Flexbox §4.5), so the label span shrinks with or without it:
dropping `[&>span]:min-w-0` and re-measuring produced byte-identical geometry on all 7 lines
(136/136/136 buttons, span 144/94, 118/94, 108/94). **`max-w-full` is the load-bearing half** — it is
what stops the inline-flex button overflowing the clamped `<td>`. `min-w-0` is kept as a statement of
intent that a later `overflow` change must not silently revoke, and the unit test pins its PRESENCE
only; do not read that assertion as proof the class does anything.

★ The three pinned leading cells are unaffected, checked mid-horizontal-scroll rather than by
computed style alone: at 160px the role row and the person rows both sit at 0 / 28 / 188 px from the
scroller's left edge (0 / 28 / 118 at 90px), the role cell's right edge exactly meets the Total
cell's left edge (overlap 0.0px), and the button's right edge stays inside the role cell
(233.8 ≤ 254 at 160px; 172 ≤ 184 at 90px).

★ jsdom cannot see any of this (no layout) and axe has no rule for a clipped label, so nothing in
CI will report a regression here either way. Reproduce with a Playwright measurement, not a unit
test:

```bash
# in a seeded spec, on Budget, after narrowing the viewport to 900px:
#   button.getBoundingClientRect().width  vs  button.closest("td").getBoundingClientRect().width
#   span.scrollWidth > span.clientWidth   ⇒ the ellipsis is actually rendering
grep -n "PeopleDisclosureLabel" src/app/budget-panel-people-rows.tsx src/app/budget-panel.tsx
```

## 124. A popover opened by a click that also scrolls its ancestor never mounts — open, UI

★ **Filed as §123** — see the renumbering note at the head of §120.

Found 2026-08-08 while driving the Open Points row ⋮ menu for slice 3's task-14 eye-verify.
PRE-EXISTING and untouched by slice 3 — `popover-panel.tsx` is not in that branch's diff — but it
cost real debugging time and it is not written down anywhere.

`PopoverPanel` renders nothing until it has measured its anchor: the gate is `open && pos`. ONE
effect does both jobs (`popover-panel.tsx:56-91`, deps `[open, anchorRef, onClose]`): it measures the
anchor and calls `setPos`, and then in the same pass registers a capture-phase `window` `scroll`
listener (`:85`) whose handler calls `onClose()` for any scroll outside the panel. So a scroll
arriving after that effect has run — but before the user has seen anything — closes a panel that has
never been in the DOM. A click that focuses a trigger sitting in a horizontally scrollable container
makes the browser scroll that container to reveal the trigger; that scroll event is dispatched after
the click handler and its effects, so it lands on the freshly registered listener and
`aria-expanded` goes back to `false`.

★★ CORRECTION 2026-08-08: an earlier revision of this entry described "a SECOND effect (`:85`)"
racing the first. There is no second effect — `grep -n useEffect src/app/popover-panel.tsx` returns
56, 100, 138 and 153, and `:85` is a statement inside the effect that starts at `:56`. The
mechanism is one effect doing two things, not two effects racing, and the fix below changed with it.

Measured with a document-level capture listener over the Open Points row ⋮ button. Real pointer
click, event order:

```
pointerdown:BUTTON  mousedown:BUTTON  focusin:BUTTON  mouseup:BUTTON  click:BUTTON  scroll:DIV
```

Result: `aria-expanded="false"`, `document.querySelectorAll('[role="menu"]').length === 0`, and a
MutationObserver counting menu appearances recorded **0** — the menu never mounted at all, so this
is not "opened then closed", it is "never opened". A synthetic `element.click()` on the same button,
which fires no focus scroll, opens it every time (`aria-expanded="true"`, one `[role="menu"]`, items
`["Edit","Delete"]`).

★★ What is NOT established: that a human pointer reproduces it. The trace above is Playwright's
click, and Playwright scrolls an element into view before clicking. The MECHANISM is real and
browser-driven either way — it is `focus()` scrolling the nearest scroller, not anything the driver
injects — so a user clicking a ⋮ that is only partly inside the table's horizontal scroll window
should hit it; that has not been reproduced by hand and should not be written up as if it had.

★★★ **THE FIX SHAPE IS NOT DETERMINED, and the one this entry used to propose does not work.** It
said: "gate the `:85` listener on `pos !== null`, not on `open`". Two things are wrong with it, and a
reader who implements it as written ships a regression:

* `pos` is not in that effect's dep array (`[open, anchorRef, onClose]`), and `setPos` is called in
  the same effect body, so an early `return` on `pos === null` registers the listener **never** —
  close-on-scroll is silently deleted for every popover in the app, and nothing in the unit suite
  would notice.
* Even done properly — splitting the registration into its own effect keyed on `[open, pos, onClose]`
  — it does not look like it fixes the symptom. The trace below is MEASURED and puts `scroll:DIV`
  after `click:BUTTON`; React flushes a discrete-event state update and its effects inside that click
  dispatch (reasoned, not measured here), so on either arrangement `pos` is already set and the
  listener already live when the scroll event arrives. The best case is turning "never opened" into
  "opened, then closed a frame later", which is not better.

Two candidate directions, **neither implemented nor measured** — do not quote either as the fix:
(a) arm the listener a frame after the panel first mounts (a `requestAnimationFrame`-set ready flag
the handler checks), so the scroll caused by the opening click cannot reach it; (b) REPOSITION on
ancestor scroll instead of closing, which retires the whole race class but is a behaviour change for
every consumer. Do not "fix" it by dropping close-on-scroll — that listener exists because a
fixed-position panel detaches from its anchor when an ancestor scrolls.

★ Consequence for anyone writing an e2e spec here: a popover, menu or dropdown anchored inside a
scrollable pane cannot be driven with `locator.click()`. Use a DOM click
(`page.evaluate(() => el.click())`), which is what `e2e/a11y.spec.ts` already does for the Kanban
Board toggle — for a different stated reason (the tour overlay), so the workaround is in the repo
but this cause is not.

Reproduce:
```bash
grep -n "close-on-scroll\|addEventListener(\"scroll\"" src/app/popover-panel.tsx
```

## 125. Two more controls start a billed Anthropic call with no way to stop it — open, billed

Filed 2026-08-08 while fact-checking the 0.224.0 "Emshwiller" CHANGELOG. Slice 3 gave six trigger
sites a Stop affordance (`AiTriggerButton`) and the entry read "a Stop affordance on all six AI
trigger sites", which invites the reading that the app HAS six AI triggers and every one of them now
stops. It has more, and at least two of the rest are ordinary user-facing buttons:

* **Dashboard digest — "Generate now"** (`dashboard-sections/digest-card.tsx:44-51`): a plain
  `<button disabled={busy}>`. `use-digest.ts:86` DOES construct an `AbortController` for the
  narrative call, but it is a local `const` inside `generate` with a `setTimeout(AI_TIMEOUT_MS)`
  attached and no ref — nothing outside the call can reach it, so there is no `cancel` for a Stop
  control to call. Wiring one means giving the hook a handle first.
* **Steering meeting report — "Draft with AI"** (`meeting-report-panel.tsx:129-138`): a `Button`
  with `disabled={generateBusy}`. Its owner `use-meeting-report-actions.ts` contains no
  `AbortController`, no `signal` and no `abort` at all — `grep -n "AbortController\|signal\|abort"
  src/app/use-meeting-report-actions.ts` returns nothing.

★ Both therefore behave the way every trigger did before slice 3: the button greys out and the user
waits. Not a regression, and not something slice 3 broke — it is the boundary of what slice 3
covered, recorded so the next reader does not mistake "six sites" for "every site".

★★ Scope note, so this does not get quoted as the complete list: §120 records a THIRD uncovered path
(the background insight-recommendation runner, which has no controller at all and no user-facing
control to hang a Stop on), and `chat-panel.tsx`, `step0-import-panel.tsx` and `use-timelog-sync.ts`
own controllers with their own bespoke cancel UI. The sweep that produced this list is in §121; re-run
it rather than trusting this bullet.

## 126. Two same-type Insight rows produce identically-named per-row controls, and no gate can see it — open, a11y

Found 2026-08-08 while correcting the e2e seed's stated rationale (§99). CAUSED by a deliberate seed
change in the same commit: the seed now renders the collision instead of hiding it.

`insightTitle` (`insights/insight-text.ts:28`) is `t(lang, TITLE_KEY[insight.type])` — derived from
`type` and nothing else. Every per-row control in `insights-panel.tsx` names itself with that title:
`insightOpen` (`:232`), `insightAcknowledge` (`:244`), `insightAct` (`:255`), `insightDismiss`
(`:266`), plus `insight-recommendation-controls.tsx`'s generate CTA (`:63`, via `nameQualifier`) and
its Apply/Reject pair (`:94`, `:102`). So ANY two rows of the same type and comparable status render
pairs of buttons with byte-identical accessible names pointing at different insights — WCAG 2.4.6.

★★ This is the ordinary case, not a contrived one: `detect.ts:53` mints one `milestoneSlip:<id>` per
overdue milestone, so a project with two slipped milestones has two `milestoneSlip` rows on the first
detection run. The seed previously carried three insights of three DIFFERENT types, which is why the
shape had never rendered anywhere a test could see it.

★★★ **NO GATE CATCHES THIS.** axe-core 4.12.1 has no rule for two BUTTONS sharing an accessible name;
the nearest, `identical-links-same-purpose`, is links-only and `wcag2aaa`, a tag `e2e/a11y.spec.ts`
does not request. jsdom-side unit tests do not render two same-type rows. The only detector in the
repo is the count assertion added to `e2e/seed-content.spec.ts` on 2026-08-08. Reproduce the axe half:

```bash
node -e 'const a=require("axe-core");console.log(a.getRules().filter(r=>/identical|duplicate|unique/i.test(r.ruleId)).map(r=>r.ruleId+" | "+r.tags.join(",")).join("\n"))'
```

★ The repo already solves this exact shape one file away. `insights/insight-digest-card.tsx:60-72`
computes the set of colliding labels and appends an entity reference ONLY to those, deliberately
leaving the non-colliding common case with no `aria-label` at all — so the fix here has a precedent
to copy rather than a design to invent. `entityRef.id` is the natural qualifier and is present on
exactly the types that can repeat (`milestoneSlip`, `raidAging`); the portfolio-level types
(`stalledWork`, `overdueTrend`, `budgetVariance`) carry none, and detection emits at most one of each,
so they cannot collide.

★★★ **THE FIX MUST ALSO FLIP THE DETECTOR, AND THE DETECTOR WILL GO RED FIRST.**
`e2e/seed-content.spec.ts` asserts `toHaveCount(2)` on the accessible name
`"Dismiss – Milestone at risk"`. That assertion CHARACTERIZES this defect — it pins the bug, not the
wanted behaviour — so a correct fix turns it red, and the red run is the fix working. It is labelled
in the spec (a named constant plus a comment pointing back at this §), but a reader who meets the
failure before the comment will be tempted to "repair" the spec by loosening the count, which would
silently restore the blind spot. The flip is mechanical: expected count `2` → `0`, plus positive
assertions for the two now-distinct qualified names. Do NOT delete the assertion and do NOT relax it
to a range — it is the only detector in the repo, so a loosened form is equivalent to no detector.

★ Same defect class as §111 (document row controls named by a non-unique title). Fixing them together
would be reasonable; neither is in a slice yet.

★ NOT fixed here on purpose: this was found by a prose/seed fact-check with no source-file lane, and
`insights-panel.tsx` belongs to the insights subsystem. Filing beats a drive-by edit to another
slice's freshly-shipped surface.

## 127. Two of the six AI trigger hooks never abort on unmount — CLOSED 2026-08-08

Split out of §121 on 2026-08-08, when the third of the three closed. §121's table is the audit that
found all three; this entry carries the remainder so the closed one stops implying the set is clean.

★★★ **CLOSED the same day, in the review round that followed.** Both hooks gained the cleanup-only
`useEffect(() => () => abortRef.current?.abort(), [])`, each pinned by a test that captures the
signal, asserts `aborted === false` before unmount as an anti-vacuity control and `true` after, and
each mutation-proved by deleting the effect and watching that test go red. So all six trigger hooks
now abort on unmount, and the grep in the STATUS block below returns six files.

★★ **The reason it closed rather than shipping is worth keeping.** It was filed as a follow-up
because the fix sat outside the lane of the round that found it — and a cold review of that round
then flagged it as the round's own recurring failure shape: *the batch sets a standard and does not
apply it to a case the SAME commit had open.* Two one-line fixes were cheaper than a register entry.
A follow-up is the right home for a decision or a design question; it is the wrong home for a
one-liner with three existing precedents in the same file family.

★★ **`use-action-analysis.ts`'s guard was NOT reachable and was applied anyway.** Traced: `analyze`
reaches the UI only through `use-ai-orchestration.ts` → `actions-panel.tsx`'s `AiTriggerButton`,
which swaps `onClick` from run to cancel the instant `busy` is true, and no second trigger, hotkey or
retry exists (the scheduled-job runner calls `runJobAnalysis` directly, not this hook). The comment
in the code says defence-in-depth in those words rather than claiming a live bug — do not quote this
entry as evidence of a shipped defect there.

★ **One instance of the ADJACENT class is still open: `use-timelog-sync.ts`. It is filed as §128.**
It was first written here as a bullet, which was wrong — a live defect recorded inside a CLOSED
entry, with no number and no index row, is a defect nobody will read again. Closed entries are the
ones that stop being re-read.

★★★ EVERYTHING IN THE TABLE IS **AS OF FILING** (2026-08-08), stated in the past tense on purpose:
this entry describes a defect that is expected to be fixed, so a present-tense "the file contains no
`useEffect`" would become false the instant someone does the work — and a register entry that
asserts the absence of the fix is a trap for whoever applies it. Check the STATUS block below before
quoting any row.

| trigger mount | backing hook | why it did not abort (AT FILING) |
|---|---|---|
| `actions-panel.tsx` | `use-action-analysis.ts` | owned a controller and a `cancel`, and the file contained **no `useEffect` at all** |
| `inline-ai-edit-popover.tsx` | `use-inline-entity-edit.ts` | HAD an effect, but it fired on `paneActive === false` and returned **no cleanup** — it aborted on DEACTIVATION, never on unmount |

★★ The second one is the trap that made this worth filing separately: a `grep` for `useEffect` finds
a hit in `use-inline-entity-edit.ts` and a reader stops there. An effect is not a cleanup. Ask
whether the effect RETURNS a function, not whether one exists — and note this survives the fix, since
the file then holds TWO effects and only one of them is the cleanup.

**STATUS — SETTLED. Both fixes are committed and tested.** The check was whether both files carry the
cleanup-only shape:

```bash
grep -rlF "() => () => abortRef.current?.abort()" src/app; echo "EXIT=$?"
```

Six files listed (the six hooks in §121's table) ⇒ nothing left here. Four ⇒ untouched. Five ⇒ one of
the two landed. Measured **6** on 2026-08-08, and again after commit with a clean tree.

★★★ **THIS BLOCK CONTRADICTED ITS OWN HEADING FOR ONE COMMIT AND THAT IS THE LESSON.** It was written
while the fixes were still uncommitted, so it correctly refused to close on a working-tree reading
and said the entry was "deliberately left OPEN". The heading, the opening paragraph and the index row
were then all flipped to CLOSED — and this block, forty lines down, was not. For one commit a reader
who scrolled reached "deliberately left OPEN" and would have re-done finished work. **A cautious
STATUS block is right; leaving it behind when the caution is discharged is the exact trap this entry
was rewritten to remove.** When you close an entry, grep its own body for the words that said it was
open.

★★ Closure needed more than the grep, and got it: the shape must actually be REACHED. Each hook is
pinned by a test that captures the signal, asserts `aborted === false` before unmount and `true`
after, mutation-proved red with the effect deleted. A grep hit with no test is the same evidence
quality as the prose this entry exists to correct.

★ The fix was the same one line both times — the cleanup-only shape
`useEffect(() => () => abortRef.current?.abort(), [])`, which sets no state and so stays clear of the
`react-hooks/set-state-in-effect` ban. **All six hooks now carry it**; copy from any of them.

★★ The cost was a billed Anthropic call running to completion with its result discarded, not a crash
— nothing failed, nothing logged, and only a bill would have shown it. That is why it was worth
finding, and why it is worth pinning with a test rather than a grep.

★ Reproduce the whole picture before quoting a count — the sweep is in §121, and the figure that
matters is per-mount, not per-file.

## 128. `use-timelog-sync.ts` clears `busy` from a superseded run — open, UI

Split out of §127 on 2026-08-09. It was first written as a bullet INSIDE §127, which was the wrong
home twice over: §127 is CLOSED, and a live defect in a closed entry has no index row and stops being
read. Filed properly here.

`use-timelog-sync.ts`'s `finally` guards only half of what it should:

```ts
} finally {
  if (abortRef.current === controller) abortRef.current = null;
  setBusy(false);            // ← outside the guard
}
```

So a superseded run turns `busy` off while its successor is still in flight — the surface reports
idle during a call that is still running. This is the SAME shape `use-abortable-ai.ts` and
`use-action-analysis.ts` were both fixed for in slice 3's review rounds, and it is the last of the
three.

★★ **It is a DIFFERENT defect from §127, and conflating them is why it nearly shipped as a footnote.**
§127 was an unmount LEAK (a billed call outliving its surface); this is a superseded run disarming
its successor's FLAG. Same file family, same `finally`, different failure. An entry that fixes one
does not cover the other.

★ Not an AI path, so it is outside the "six trigger hooks" framing entirely — do not expect the
sweeps in §121 or §127 to surface it. Reproduce the census with:

```bash
grep -rn "=== controller" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Measured 2026-08-09: three non-test SITES (`use-abortable-ai.ts`, `use-action-analysis.ts`,
`use-timelog-sync.ts`), of which this is the only one whose `setBusy` sits outside. ★ The grep also
returns three COMMENT lines in `use-action-analysis.ts` that document this very outlier — count
sites, not lines.

★ Fix is to move `setBusy(false)` inside the existing `if`. Cheap, but it needs a test that
supersedes a run and asserts the flag survives — the same shape that proved the other two, and
without it the guard is unpinned exactly as `use-abortable-ai.ts`'s `setError` guard was.

★★ Severity is lower than §127's: nothing is billed twice and nothing leaks, the UI just reads idle
early. Filed rather than fixed because slice 3's review rounds were already three deep and this is a
non-AI surface none of them touched — a fourth widening was the wrong call.

---

## 129. Six of the eight `RichTextEditor` call sites import it statically, so Tiptap SSRs and ships in the initial bundle — open, a decision, measured

**Where:** `src/app/rich-text-editor.tsx`'s consumers.

| Import style | Sites |
|---|---|
| STATIC (SSRs) | `change-edit-modal.tsx` · `dashboard-sections/dashboard-narrative.tsx` · `milestone-edit-modal.tsx` · `note-log-panel.tsx` · `raid-edit-modal.tsx` · `task-form-fields.tsx` |
| `dynamic(..., { ssr: false })` | `meeting-report-panel.tsx` · `settings-sections/comm-templates-section.tsx` |

Reproduce: `grep -rl 'rich-text-editor"' src/app --include="*.tsx" | grep -v '\.test\.tsx'` returns the 8
consumers; intersect with `grep -rln "ssr: *false" src/app --include="*.tsx"` for the 2. ★ Do NOT use
`grep -rl "<RichTextEditor" src/app` — it returns **11**, adding `rich-text-editor.tsx` itself,
`rich-text-editor.test.tsx`, and `label-binding.guard.test.ts`.

★★ That 11 was written here as "10" in the commit that filed this entry, and a reviewer caught it. The
number came from a subagent's report and was copied without re-running the command — inside the very
commit that corrects §54 for the same class of mistake. It is 11 at this HEAD and was 11 at the base
commit, so it was never 10. Recorded rather than quietly fixed: this file's standing rule is that a
correction is a NEW claim inheriting none of the verification of the thing it corrects, and the cheapest
proof that the rule is worth keeping is an instance of breaking it.

Raised while fixing §54, and deliberately NOT folded into it.

★★★ **CONVERTING THE SIX WOULD NOT HAVE FIXED §54, AND READING IT AS AN ALTERNATIVE FIX IS THE TRAP.**
`useEditor` is called with `immediatelyRender: false`, which defers Editor construction — and therefore
`injectCSS()` — to mount. So the un-nonced `<style>` is injected client-side under BOTH import styles and
the CSP violation is byte-identical. `ssr: false` changes where the component renders, not where Tiptap
injects.

★★ Nor does it let the `typeof document` guard in `csp-nonce.ts` go away. Even with every site converted
the guard stays: it costs one line, it makes the function total, and a future static import would
silently reintroduce the SSR call. So there is no simplification on offer either — the two questions are
independent.

★ Static + `immediatelyRender: false` is a SUPPORTED Tiptap configuration, not an oversight. That flag
exists precisely so the editor can be SSR'd safely. The two dynamic sites are a settings panel and a
report panel, where lazy-loading a rarely-opened surface is its own justification — they are not evidence
the other six are wrong.

**The real question is bundle weight, and it is UNMEASURED.** `@tiptap/react` + `@tiptap/starter-kit` +
the prosemirror tree is large, and six static imports put it in the initial bundle. Nobody has measured
the delta. **Measure before deciding** — a conversion argued from "Tiptap is big" rather than from a
number is the same class of reasoning that put the wrong mechanism in §54.

**Costs if it is done.** Mount timing changes in six surfaces that all carry test suites; each needs a
`loading:` fallback or a modal shows a blank flash while the chunk loads; and each affected test goes
from a synchronous `render` to `await waitFor`. That is a real behavioural surface, which is why it is
its own slice rather than a rider.

---

## 130. The `prod-smoke` port guard probes `localhost` only, so a non-loopback listener on its port is invisible and can still be killed — open, accepted, measured

**Where:** `scripts/e2e-smoke-prod.mjs` `isPortAlreadyInUse()`; the kill side is `scripts/stop-dev.mjs`.

**The guard exists** to stop the destructive sequence: something else holds port 3200 → `next start`
fails to bind → `waitForReady()` succeeds against the FOREIGN server → the smoke measures the wrong app
→ `stopServer()` port-kills a process we did not start. It refuses to run rather than adopt-then-kill.

**What it does not cover.** It is a raw TCP connect to `localhost`, so a listener bound to a specific
non-loopback address (a LAN IP, a container bridge) never answers it. Measured 2026-08-09:

```
LAN addr: 10.2.0.2
guard(localhost) sees it? -> false
guard(LAN addr)  sees it? -> true
second bind on 0.0.0.0: bound 0.0.0.0 OK
```

On Windows the subsequent bind on `0.0.0.0` then SUCCEEDS, so the smoke runs happily against its own
server — and the kill still hits both, because `stop-dev.mjs` adds every PID whose `netstat` local
address matches `[:.]<port>$`, which `10.2.0.2:3200` does, and kills each. So the exact outcome the
guard was written to prevent survives on a path the guard cannot see.

**Why it is accepted rather than fixed.** Closing it means enumerating local interfaces and probing
each, which is real machinery for a case that needs someone to have bound a non-loopback address on
the smoke's own port on the same machine. The decision recorded here is to **narrow the claim instead
of overstating the guard** — the doc comment used to say it covered "ANYTHING listening on the port",
which is what turned a known limit into a false statement.

★★ **The timeout branch is a separate question and it was WRONG until 2026-08-09.** It resolved
`false` — "port is free" — for a probe that sent a SYN and got nothing back. On loopback a genuinely
free port RSTs the SYN, taking the error branch in 16.6-30.6 ms over five COLD processes — the only
condition the script runs in, and ~20x the "0-1 ms" this entry first recorded from a warm second
connect — so a two-second hang is never the
free case; it is a full accept backlog or a firewall DROP. Mapping the ambiguous outcome to "free"
re-opened the destructive path above, in the same function whose comment says "Refusing is the safe
behaviour". It now resolves `true`. ★ A guard whose comment states a safety rule its code does not
follow is worse than no guard: the comment is what the next reader checks.

---

## 131. The doc-claims ratchet cannot verify a citation is CORRECT; the grandfathered debt is worked down to 3 — open, accepted, measured

**Where:** `scripts/check-doc-claims.mjs`, `docs/baselines/doc-line-cites.json`, CI job `doc-claims-check`.

**Why it exists.** AGENTS.md has carried "CITE THE SYMBOL, NOT A LINE RANGE" at three stars for a long
time with NOTHING enforcing it. On 2026-08-09 a 10-line comment insertion in `src/proxy.ts` silently
repointed six `proxy.ts:NN` citations across TWO tracked files — four of them inside
`docs/security/threat-model.md`, including the one cited twice as the evidence that `connect-src` is
restricted to `*.turso.io`, which came to rest on `return [`. Every one had been exact when written.

**★★★ WHAT IT CANNOT DO, and no future version can.** It cannot tell you a citation still points at
the right code, because the doc never records what was supposed to be at that line. It proves two
things only: the cited file exists, and the cited line number is within it. **A citation silently
shifted by an insertion still passes.** That is not a gap to be closed later — it is why the rule is
"prefer a symbol" rather than "keep the numbers fresh".

★★ MEASURED ON THE ROW THAT MOTIVATED THE GATE, not reasoned. `threat-model.md`'s server-logging row
cited three files. TWO were wrong: `timelog/_helpers.ts` cited at line 185, past its 183 (this said
"one past its 184" until a cold review found the gate's own line arithmetic counted the empty string
after the trailing newline — the file has 183 citable lines, so the cite is TWO past, and a cite to
:184 was silently passing); and
`jira/_helpers.ts` cited at line 181, while the only `console.error` in it sits at line 117 — 64 off. The gate
caught the first and was **silent** on the second, because being 64 lines wrong is indistinguishable
from being right when the only question asked is "does line 181 exist". One of two. Both were also
attached to a quoted comment — "status-only — never the token" — that **exists nowhere in the file**.
The mitigation itself held (no proxy logs a credential); every artifact describing it had rotted.
That row now cites a grep instead, and the gate cannot check the grep either.

**★★ CONTINUATION CITES — the first cut saw a quarter of the breakage.** Docs write one path and then
several bare line numbers. §62 read, before this pass (fenced because it is an EXAMPLE — the gate
fired on this very paragraph when it was written as prose, which is the ratchet working):

```
(`use-resource-planner.ts:710` and `:723`, returned at `:1023`/`:1025`)
```

That is FOUR citations; the original pattern matched the first only — and all four were broken. Bare
`` `:NNN` `` spans are now attributed to the nearest file mentioned EARLIER ON THE SAME LINE. Effect:
496 → 551 citations seen, out-of-range 5 → 8. (56 of 156 bare spans resolve; an earlier
wording said 37 of 150, which were the counts under the REJECTED full-cite anchor.)

★★★ Two false-positive classes surfaced while building that, both caught by RUNNING it rather than
reasoning about it, and both would have reported a green branch as red — the expensive direction:
(a) the anchor must be the nearest preceding file MENTION, not the nearest preceding `path:LINE` — a
colon-less `task-manager.tsx` was skipped, hanging four of its numbers on a file with 152 CITABLE
lines (153 by `split`, and the range check is the one that matters here); (b) the
path pattern truncated `notes-badge-button.tsx` to `.ts`, because the extension alternation tried
`ts` first with nothing forcing the token to end, inventing phantom citations to files that do not
exist across **25 distinct truncated paths**. ★ Quote the 25, not a total: the totals (47 against
the tree that first measured it, 45 against `73935dab`) move with the corpus, so a bare count is
unreproducible a week later while the distinct-path figure has held across both measurements.

★★★ THAT NUMBER WAS FIRST WRITTEN AS "20", AND THE MISTAKE IS THE ONE THIS REGISTER KEEPS RECORDING:
it was read off a display truncated at 20 lines. A `head`/`sed 1,20p` output is a FLOOR, never a
count, and it looks exactly as rigorous as a real measurement in the sentence that quotes it. Caught
by re-running the buggy pattern on purpose and DIFFING the totals — which is the only thing that can
catch it, since nothing about "20" reads as wrong. Count with a counter, not with your eyes.
The full-cite pattern was immune to (b) only because the `:` after the extension forces a backtrack.

★ The 100 bare cites whose path sits on a PREVIOUS line stay OUT of scope. The form is genuinely
ambiguous — AGENTS.md's own `` `:3000` `` is a PORT NUMBER — and a cross-line rule would have hunted
for a source file to hang it on. A gate that invents a citation is worse than one with a documented
blind spot.

**Grandfathered debt: 3, down from 19.** Failing on pre-existing breakage would have made the gate
unlandable, and a gate that cannot land protects nothing — but the debt was then worked off rather
than left. All three survivors are in `findings-2026-07.md`, a DATED snapshot of a July 2026 audit
(TWO cites past EOF, one to a file since deleted). They are deliberately NOT renumbered and the file now
carries a banner saying so: rewriting a signed audit record to match today's tree destroys the only
thing it is good for, which is saying what was true when it was signed.

**A third bucket, `thirdParty` (10), is classified rather than counted.** Ten of the eleven original
"unresolvable" cites pointed into dompurify / prosemirror / vitest / eslint-plugin internals —
legitimate references to code this repo does not own and cannot fix. Counting them made the debt look
11× worse than the ONE real broken pointer, which is the fastest way to get a number ignored. ★ Not
harmless: they rot on any upgrade, and `vitest/dist/chunks/coverage.DM_a_rWm.js` carries a CONTENT
HASH in its filename, so that one is guaranteed to break and nothing will announce it.

**★★★ WHAT THE CLEAN-UP MEASURED — the real argument for the rule.** Every out-of-range cite in a
LIVING doc was re-verified against the code rather than renumbered, and in every case the CLAIM was
sound while the coordinates were not:

- ONE row of `handrolled-ui-inventory.md` carried SEVEN line numbers and **FIVE were wrong**:
  `actions-panel` off by 3, `notifications` by 6, `sidebar` and `timelog-panel` by 8 each, and the
  caret it attributed to `chat-panel.tsx` had moved into `chat-tool-block.tsx` entirely. The gate
  caught ONE — the only one past EOF.
- §33's `export-pptx.ts` cite was EXACT until an extraction commit moved the element into
  `ooxml-pptx-primitives.ts` (`git log -S 'a:bodyPr' -- src/app/export-pptx.ts`). ★★ A first
  write of this bullet called it a wrong FILE that "never contained" the element, and used it as
  the CONTRAST to §62's accurate-for-an-older-revision case — when it is the SAME category. The
  gate saw only the past-EOF symptom; the drift is invisible to it either way.
- §88's two bullets were both wrong: the surviving defect was 227 lines off, and the other pointed
  into a file the code had left — that half turned out to be **fixed**, closed here on re-check.
- §62's four numbers were ACCURATE, for the file at commit `0d770283` (1042 citable lines) rather
  than at HEAD (553). A cite pinned to a named revision is a real category the gate cannot know about; the
  durable form is the SHA plus a symbol, never the SHA plus a number.
  ★★★ THIS NUMBER WAS "CORRECTED" IN THE WRONG DIRECTION, TWICE, AND THAT IS THE REAL LESSON.
  It first read 1042 (from `wc -l`), was "audited" to 1043 on the reasoning that every gate counts
  `split("\n").length`, and is 1042 again — because the same branch then FIXED this gate to count
  CITABLE lines (`countLines`, which drops the empty string after the trailing newline and so equals
  `wc -l` for a newline-terminated file). The audit's replacement claim was true when written and
  falsified by a later commit in its own branch; the closing instruction it added — "use the gate's"
  — then pointed at the number it had just called an error. ★★ There are genuinely TWO conventions
  and neither is wrong: `check-file-sizes.mjs` counts `split("\n").length` because it asks HOW BIG a
  file is; this gate counts `countLines` because it asks WHICH LINE NUMBERS EXIST. So the file was
  1042 citable lines at that commit and 1043 by the size gate's measure. ★ Which is the argument for
  the bullet above rather than against it: a SHA plus a symbol needs no convention at all.

The through-line: a wrong line number is a SYMPTOM. Renumbering it preserves a claim nobody re-read —
and §88 proves that can mean documenting an open defect that was closed months ago.

**★★ EVERY NUMBER ABOVE WAS THEN RE-DERIVED BY A SCRIPT, and the audit is worth as much as the
findings.** 28 claims, 25 clean. Of the THREE mismatches, only ONE was a real error (the 1043 above);
the other two were bugs in the AUDITOR — it matched `ChevronDownIcon` on the IMPORT line instead of
the JSX usage and duly reported drifts of −60 and −584 against claims that were correct. A
verification probe is code, and carries the same defect rate as the thing it verifies. Read a
mismatch as "one of these two is wrong", never as "the claim is wrong" — the reflex to trust the
newer measurement is exactly how a correction round introduces errors, which this register already
records at three stars elsewhere.

**★★ The parsing is now a tested module.** `scripts/doc-claims-lib.mjs` holds the regexes and
`citesOnLine`/`resolveCandidates`/`stripFencedBlocks`; `check-doc-claims.mjs` is a ~200-line driver.
`vitest.config.ts` `include` gained `scripts/**/*.{test,spec}.mjs`, so the CI gates are reachable from
the unit suite for the first time — coverage `include` stays `src/**`, so a script test raises no
floor and gates no percentage. NINE other scripts are now testable the same way and none is tested
yet — including two more GATE scripts (`check-agents-symbols`, `check-file-sizes`),
`sync-script-docs` (which backs the `docs:scripts:check` prebuild gate), and ★★ `check-doc-claims`
ITSELF: extracting the parsing left the DRIVER — the walk, the baseline diff, the reporting —
entirely untested, so "the parsing is now a tested module" is true and is HALF the gate. An earlier
three-item list here read as exhaustive and named three of nine; the first correction of it said
EIGHT, dropping the driver, which is the one omission that changes what a reader concludes.
Reproduce with `ls scripts/ scripts/*.test.*` and subtract.

★★★ MUTATION-PROVED — and the first reading of the result was HALF WRONG, in the dangerous
direction. Six injected defects, four killed at once, two survived; I classified BOTH survivors as
equivalent mutants, concluding that `SOURCE_EXT` ordering and PATH_RE's `(?!...)` lookahead were
redundant guards so removing either alone changed nothing. A cold review's differential fuzz settled
it: dropping the ORDER changes NO outputs, dropping the LOOKAHEAD invents phantom paths —
`` `foo.tsxx` `` anchors to `foo.tsx`, `tsconfig.jsonc` to `tsconfig.json`.
★★ THAT EXPERIMENT NOW LIVES IN THE SUITE (`PATH_RE mutants — the two guards are NOT
interchangeable`), and this entry used to quote its corpus size instead — "784 inputs, 336 differ".
Nothing in the repo reproduced those figures, and a second reviewer building their own corpus got
different ones for the same true property; that is this section's own "quote the 25, not a total"
rule applied to the text that states the rule. Both mutants are now built from the exported
`SOURCE_EXT`, so the property is ENFORCED rather than asserted and there is no count to go stale.
★ Writing that pin is itself worked evidence: the first version enumerated "every
extension-SUFFIXED input" as the expected differing set and FAILED, because the corpus builds
`ts` + `x` as `foo.tsx` — a valid name that must not differ. Enumerating re-derived the regex's
rules and got them wrong; asserting the PROPERTY (every difference is an invented path, and no
accepted input is affected) is what holds.
The lookahead mutant survived only because no test fed it an extension-SUFFIXED name — a TEST GAP,
which I recorded as proof the code was redundant, in a comment a future contributor would read as
licence to delete a live guard. There is now a test (".tsxx is not .tsx") and that mutant dies.

★★★ THE RULE, stated correctly this time: a surviving mutant is a QUESTION, and its two answers —
"equivalent mutant" and "missing test" — are INDISTINGUISHABLE from the harness, because both look
like a green run. Telling them apart requires an input the suite does not contain, so you have to go
LOOKING for one; assuming equivalence is how a guard gets deleted two releases later. ★ Reading them
as "vacuous tests" would also have been wrong, and that was the original mistake's mirror image: the
tests were fine, the *conclusion drawn from their silence* was not. Note also that the `.yaml` case
sitting beside the two real truncation regressions is NOT one (`yml` is not a prefix of `yaml`, so no
ordering can truncate it); it is relabelled as a plain positive case, because a vacuous test filed
under "regression" is worse than no test — it is counted as cover.

**★★★ A COLD REVIEW OF THE GATE FOUND FIVE REAL DEFECTS, and two of them could FAIL A GOOD BRANCH.**
Dispatched after the tests existed, scoped to the parsing, and required to report an executed input
and its observed output for every finding. All five were verified independently before being fixed;
every one reproduced. ★★ This said SIX for one release while the LIST below held five, and what the
sixth was meant to be is NOT recoverable — the review report is gone and no commit names it. Corrected
DOWN to what is enumerated, because a count nobody can reproduce is worse than a smaller true one.
Count the bullets; they are the authority.

- **Scoped packages were counted as repo debt.** `@` was absent from the citation character classes,
  so a line-numbered cite to `node_modules/@tiptap/core/dist/index.js` parsed as
  `tiptap/core/dist/index.js` — the `@` split the token and took the `node_modules/` prefix with it.
  ★ Writing that example WITH its line number tripped this very ratchet, which is the fix
  demonstrating itself: before it, the gate could not see that citation at all.
  `THIRD_PARTY_RE`'s `@[\w.-]+/` branch
  was therefore UNREACHABLE from anything the parser produced, and the first person to cite a scoped
  package in prose would have reddened the gate. ★★ Its unit tests passed throughout because they
  feed the classifier hand-written literals and never `citesOnLine` output — a dead branch reads as
  live when the pipeline between the two is untested. There is now a test on the composed pipeline.
- **`stripFencedBlocks` was a six-line parity toggle with four failure modes**, three of them one
  authoring habit away: a BLOCKQUOTED fence (`> ```bash`) was not recognised, so its contents were
  scanned as prose — and README.md carries one TODAY, harmless only by luck of content; TILDE fences
  were unhandled; a line containing an INLINE ``` span inverted the parity and silently swallowed
  every line to the next fence (a mass false negative); and a NESTED fence closed the outer block,
  leaking fenced content back out. Replaced with CommonMark's actual rule — open on a run of ≥3 of
  one char plus an info string containing no fence char, close only on a longer-or-equal run of the
  SAME char with nothing after it.
- **Bare RANGES were invisible.** `` `:113-116` `` did not match, so the gate was blind to precisely
  the form the "cite the SYMBOL, not a line RANGE" rule exists to discourage. Live in
  `docs/security/threat-model.md`. Only the START line is range-checked.
- **A URL with a line anchor parsed as a citation.** `https://github.com/x/y/blob/main/app.js:12`
  became a cite to `github.com/x/y/blob/main/app.js`, which resolves to nothing — so merely LINKING
  to code on the web would have failed the gate.
- **The range check was off by one.** It counted `split("\n").length`, which includes the empty
  string after a trailing newline, so a citation to exactly one past EOF passed and every failure
  message overstated the file by one. Now `countLines`, unit-tested, and the reason the numbers in
  this very section moved. ★ `check-file-sizes.mjs` counts the other way on purpose — that gate asks
  how big a file is, this one asks which line numbers exist. Do not "align" them.

★★ FIXING THEM MADE THE GATE STRICTER AND IT IMMEDIATELY FOUND MORE: 537 → 541 citations (four had
been hidden by the `@` and range blind spots) and a SECOND out-of-range cite in the dated snapshot
that the off-by-one had been passing. All four REGEX fixes are mutation-proved (4/4 killed); the fifth
defect — the `stripFencedBlocks` rewrite — is covered by its own cases, not by a mutant, which is why
that number is four against a five-item list. Debt is now
1 unresolvable + 2 out-of-range, **all three in `findings-2026-07.md`** — every living doc is clean.

★ WHAT THE REVIEW DID NOT FIND, which is worth as much: zero live false positives across the whole
corpus (220 distinct cited paths), zero mis-attributions across all 56 bare-cite attributions — each
read against its source line, including the awkward colon-less-mention cases — and no catastrophic
backtracking (quadratic, cleanly 4× per doubling; a 50k-char line parses in ~1.8s). The
nearest-preceding-MENTION anchor does exactly what its comment claims. ★ One accepted looseness:
`resolveCandidates`' dotfile fallback also matches `config.ts` → the three `*.config.ts` files, and
`route.ts` already resolves to 12 candidates, so those citations are effectively unchecked (a cite is
only flagged when EVERY candidate is out of range). Permissive, so it cannot redden a good branch.

**Deliberately NOT built: staleness detection.** The strongest available check is "was the cited file
modified after the doc line was written", via `git blame` on the doc plus `git log` on each cited
file — a dozen blames and one log lookup per distinct cited path (220 today), so cost is not the
objection. **The slim CI image has no
git** (the same constraint `check-file-sizes.mjs` records at its `readdirSync` comment). It would work
locally and silently no-op in CI, which is the worst possible shape for a gate: green because it did
not run. Either move it to a job on a git-bearing image, or do not build it.

★ Citations inside ``` fences are ignored by design — a stack trace or a sample command is an example,
not a claim about this repo. A citation hidden in a fence therefore escapes the ratchet. Accepted: the
alternative is the gate firing on its own documentation.

★★ **THE GATE FIRED ON THIS ENTRY, ON THE FIRST RUN, AND THAT WAS CORRECT.** A register entry about
broken citations necessarily contains citation-shaped text, so §131's own prose examples read as three
new `path:LINE` citations and the ratchet refused them. The temptation is to re-baseline — which would
have admitted three new citations into the baseline and quietly defeated the only thing the gate
checks, on the very commit that introduced it. The fix was to obey the rule instead: the examples now
read "`timelog/_helpers.ts` cited at line 185" rather than the `path:LINE` form. Baseline unchanged at
310 cites / 11 unresolvable / 5 out-of-range across 11 docs — the state recorded in
`doc-line-cites.json` at that commit, and today's 541/1/2 across 12 is the live figure.
★★ This said "496/11/5". The 11 and the 5 were right and the 496 was not: summing the baseline's own
per-doc counts at that commit gives 310. Two right numbers beside a wrong one is the hardest shape to
catch by reading, because the pair vouches for the third — re-derive EACH, and cite the artifact that
holds it (`git show <sha>:docs/baselines/doc-line-cites.json`) rather than a remembered triple. ★ If you are ever about to run `--update` to make your own commit pass, that is the signal
you are the thing being gated.

★ **The parsing now has a unit test** (see above); `check-file-sizes.mjs` and
`check-agents-symbols.mjs` still have none. ★★ This bullet read "No automated test covers this
script" until a cold review caught it contradicting the paragraph above it in the same entry — a
leftover from before the test landed, and read alone it told the next maintainer the opposite of
the truth. The DRIVER (walk, baseline diff, reporting) is still untested; verification there was
a manual mutation pass
proving it exits 1 on each violation class (new cite to an existing path · new cite to a new path ·
unresolvable file · line past EOF) and 0 on each allowed case (a citation inside a fence · a
symbol-only citation · correcting an existing citation's line number in place). A future edit to the
regex or the resolver has nothing catching a regression — re-run that mutation pass by hand.


## 132. A multi-target successor fan-out labels as "Edited N item(s)" with no entity word — open, cosmetic, measured

`recordSuccessorEdits` (`use-task-submit.ts`) passes `name` only when it wrote exactly ONE target, so a
fan-out onto several tasks reaches `buildUndoLabel` with no name, resolves entity `task`, and falls to the
generic `undoToastEdit` — "Edited 3 item(s)". The single-target case still reads `Edit task "…"`.

★★ The fix is NOT to change the `kind`. `kind: "bulk.edit"` produces the IDENTICAL string for the
multi-target case ("bulk" is not in `ENTITY_KEY_SET`, so `entityKeyFromKind` returns null and
`buildUndoLabel` returns at its `if (!key)` guard BEFORE the `isBulk` branch) and a strictly WORSE one for
the single-target case, since `kind` is shared by both branches and switching it would drop the name.
Reaching `isBulk` needs an explicit `entityKey`, which `CaptureCompositeOpts` does not carry.

The real fix is an edit-side twin of `undoLabelDeleteCount`. Deliberately not built: it would relabel EVERY
unnamed multi-row edit capture in the app, which is a far wider blast radius than this one call site.

★ Scope: the LABEL in undo history only. The TOAST was always count-shaped (`pushEntry` composes it from
`undoToastEdit`/`undoToastDelete` regardless of kind or name), so nothing regressed there.

## 133. A redo-created dangling dependency is repaired on two of six backends — open, measured

Undo of a successor fan-out restores the target arrays from images resolved at capture time. Create task 5
with successor 2 → undo → delete 5 → redo merges `{taskId:5}` back onto task 2, pointing at a task that no
longer exists.

★★ It self-heals ONLY on CSV and Markdown loads. `dropDanglingDependencies` has exactly two production call
sites, in `csv-codecs-decode` and `markdown-codecs-decode`. Reproduce with
`grep -rn "dropDanglingDependencies(" src/app | grep -v ".test."` — 4 lines: those two, the definition in
`sanitize-core.ts`, and the comment in `use-task-submit.ts` that names the symbol. JSON maps tasks through
`migrateTask` + `sanitizeNoteFields`, neither of which touches `dependencies`; IndexedDB — the DEFAULT
backend, since `defaultStorageConfig` is `{ kind: "browser" }` — and both Turso backends have no dangling
pass at all. Turso shares the CSV ROW builder (`buildTaskFromObj` via `turso-schema`) but never enters the
enclosing workspace decoder where the dangling pass runs.

★ Severity is low because the consumers tolerate it: dependency rendering resolves through the live task map
and a missing id renders nothing. It is recorded because a code comment stated flatly that it self-heals on
the next load, which is false exactly where most users are.

## 134. Two `captureComposite` callers flag no primary and ride the positional fallback — open, latent, measured

`compositeUndoRunner` picks the remap source with `Math.max(0, findIndex(isPrimary))`, so an unflagged
composite silently nominates fragment 0. Of the SEVEN call sites, five flag one; `use-budget-buckets.ts` and
`use-task-submit.ts` flag nothing.

★★★ ENUMERATE WITH ALL THREE CALL SHAPES. A grep matching only `captureComposite({` and
`captureCompositeRef.current?.({` misses the OPTIONAL-call form `captureComposite?.({` and reports SIX. That
error shipped in a code comment and was caught only by a cold audit; it omitted the newest caller.

Neither is a live defect — no fragment in either declares `fkRemapField`, so the empty remap is never read.
The hazard is what happens NEXT: `captureFieldPart` hardcodes `isPrimary: false`, so adding a `capturePart`
cascade beside an existing field fragment points that cascade at stale ids with no error. `use-budget-buckets`
is the likelier site, because its first fragment is the whole-row `tasksPart` from `use-bulk-operations` — a
§50 candidate whose obvious fix reproduces exactly this shape. Flag the cascade `isPrimary: true` in the same
edit.

## 135. Two different-type links to one task can be staged but not removed individually — open, UI

`DependencyLinkGroup` appends `{ taskId, type: pendingType }` on add with no check, so the same task can be
staged twice under different types (FS and SS). Its remove handler filters on `taskId` ALONE, so removing
either chip removes BOTH.

★★ An exact `(taskId, type)` duplicate is NOT the problem, and a working note claiming so was wrong:
`pushUniqueDependency` (`sanitize-core.ts`) keys its `seen` set on the id and type together, so an exact
duplicate is collapsed at save on every backend. Only the DIFFERENT-type pair survives, and it is the one the
remove control cannot address.

★ Whether a task should be allowed two relation types to the same task at all is the open design question;
the storage layer permits it today. Matching the remove handler on both fields is the smaller change and does
not settle that.

## 136. The `dependencies` branch of `sanitizeInlinePatch` has no caller — open, dead code

Removing the Open Points inline relations pencil (0.228.0) left the `dependencies` branch of
`sanitizeInlinePatch`, and its `sanitizeDependencies` call, unreachable: no `onInlinePatch` call site passes
that key. Reproduce with
`grep -rn "onInlinePatch(" src/app --include=*.tsx | grep -v ".test." | grep -c dependencies` → 0. The
remaining inline cells commit `priority`, `assignee`/`assigneeEmail`/`resourceId`, and the generic
single-field path from `useInlineCellEdit`.

★ Left in place rather than deleted because it is a SANITIZER: the branch is the guard that would apply if a
future inline affordance did patch the field, and deleting it makes reintroducing that affordance silently
unsanitised. Recorded so a dead-code sweep does not mistake it for an oversight in either direction.
---

## 137. The seven rich entity fields' editor cannot represent three tags their storage permits — CLOSED 2026-08-11

Opened 2026-08-10 out of §107's closure. **Not a regression against §107 — it is what closing §107
UNCOVERED**, and §107's own closure note points here.

**Three layers disagree, and only two of them were ever compared.**

| layer | what it is | tags |
|---|---|---|
| classifier | `SINK_TAGS.template` (`html-start.ts`), derived per sink since §107 | 11 |
| storage | `sanitizeTemplateHtml`'s `TEMPLATE_ALLOWED_TAGS` | 11 — `p br strong em` **`u h1 h2`** `ul ol li a` |
| editor | the lean `RichTextEditor` variant's schema (`LEAN_EXTENSIONS`) and its `sanitizeNoteHtml` commit | the 8-tag lean set — no `u`, no headings |

§107 compared the first two and made them agree. The THIRD was never in that comparison. So `u`,
`h1` and `h2` are effectively **write-only** for the six RAID / change / milestone rich fields: the
allow-list permits them, the AI path can produce them, and the editor a human uses can neither make
one nor commit one.

### The `Task.description` asymmetry — measured

`Task.description` is the sharp case, because its two write sinks are DIFFERENT WIDTHS:

* the **AI** path is `sanitizeAiRichText` → `sanitizeRichText(raw, max, "template")` →
  `sanitizeTemplateHtml` — 11 tags, and an unlisted tag is UNWRAPPED, keeping its text;
* the **human form save** is `sanitizeNoteHtml` in `use-task-submit.ts` — 8 tags, `KEEP_CONTENT:
  false`, which DELETES an unlisted element **together with its text**.

There are TWO human paths, because the modal seeds the form with the RAW stored HTML
(`use-task-submit.ts`, `setForm({… description: task.description})`) and the lean editor's
`onUpdate` fires only on a real edit.

**Path 1 — open the task, do NOT touch the description, Save.** `sanitizeNoteHtml` runs on the raw
stored value. Measured 2026-08-10 through the real exported sanitizer:

```
"<h1>Title</h1><p>body</p>"       -> "<p>body</p>"          "Title" DELETED
"<u>underlined</u> rest"          -> " rest"                "underlined" DELETED
"<blockquote>quoted</blockquote>" -> ""                     whole value EMPTIED
"<h3>Sub</h3><p>body</p>"         -> "<p>body</p>"          "Sub" DELETED
"<p>plain <u>under</u> tail</p>"  -> "<p>plain  tail</p>"   "under" DELETED mid-sentence
```

For contrast, `sanitizeTemplateHtml` on the same five inputs keeps every word — it returns the first,
second and fifth byte-identical, and unwraps the other two to `"quoted"` and `"Sub<p>body</p>"`.

**Path 2 — type in the description.** ProseMirror re-parses the value against the lean schema before
anything is committed, so a heading or blockquote normalises to a PARAGRAPH and its words SURVIVE.
`<u>` did not, because `underline` was registered in the lean schema while `NOTE_ALLOWED_TAGS` has no
`u` — the editor re-emitted a `<u>` on every edit and its own commit sanitizer then deleted the
underlined WORD with it. Fixed in `dfeceabf` by `underline: false` in `LEAN_EXTENSIONS`, so Path 2 is
clean. Reproduce that half:

```bash
npx vitest run src/app/rich-text-editor.test.tsx -t "underline" --reporter=dot
```

★★★ **THE CONSEQUENCE, AND IT IS THIS ENTRY'S MOST IMPORTANT SENTENCE.** BEFORE this slice, an
AI-written `<h1>` in a task description failed the shared 8-tag classifier and was stored ESCAPED —
ugly literal tags in the field, but the WORDS SURVIVED every save. AFTER it, the same value is stored
as real markup, so Path 1 and the editor's own commit now DELETE the text. **Closing §107 converted a
visible-but-lossless defect into a silent lossy one, on a path §107 never mentions.** That is why
this entry exists and why it is open. It is not an argument for reverting §107: escaping was never
correct, and the fix is to make the editor and the allow-list agree.

★★ **NOT MEASURED, and do not upgrade it to a conclusion:** whether a human can create a `<u>` by
keystroke at all without the AI path. The mark WAS live and `Mod-u` is bound by
`@tiptap/extension-underline`, but a jsdom `userEvent.keyboard` probe produced no `<u>` — most likely
a driver artifact (a synthetic modifier keydown may never reach ProseMirror's keymap) rather than a
finding. Settling it needs a real browser. The sanitizer half above needs no probe and is measured
regardless of how the value got there, since the AI path alone can produce all three tags.

★★★ **SCOPE — and the earlier sentence here was WRONG.** It said the `sanitizeNoteHtml` exposure was
"TASK-ONLY", that the six RAID / change / milestone fields "route their save through their DOM-free
entity sanitizers, so their Path 1 does not delete", and that "their exposure is the other half".
It is not. `sanitizeRichFields` (`note-log.ts`) applies **`sanitizeNoteHtml(descriptionHtml(value,
"note"))`** to every rich field it is given, and all four per-entity normalizers —
`sanitizeNoteFields`, `sanitizeRaidRichFields`, `sanitizeChangeRichFields`,
`sanitizeMilestoneRichFields` — are that one function with a different field list. Both whole-object
load boundaries call all four: `jsonToWorkspace` (`workspace.ts`, every JSON load) and the IndexedDB
load (`browser-backend.ts`, the DEFAULT backend). So **all seven rich fields are exposed on every
load, with no human and no save involved.** Measured 2026-08-10 through the real exported
normalizers:

```
sanitizeRaidRichFields({description:"<p>Intro</p><h1>Risk</h1><p>detail</p>"})
  -> {description:"<p>Intro</p><p>detail</p>"}     "Risk" GONE
sanitizeRaidRichFields({mitigation:"<p>a</p><u>b</u>"})
  -> {mitigation:"<p>a</p>"}                       "b" GONE
sanitizeChangeRichFields({impactDescription:"<p>a</p><u>b</u>"})
  -> {impactDescription:"<p>a</p>"}                "b" GONE
```

★★ **THE NUANCE THAT MAKES IT SUBTLE, and it is how the false sentence came to be written.** The loss
needs a value that **LEADS with an allow-listed tag and carries the disallowed one MID-VALUE**. A
value LEADING with the disallowed tag is classified as plain text by the `"note"` sink FIRST and
escaped whole, so its text SURVIVES:

```
sanitizeRaidRichFields({description:"<h1>Risk</h1><p>detail</p>"})
  -> {description:"<p>&lt;h1&gt;Risk&lt;/h1&gt;&lt;p&gt;detail&lt;/p&gt;</p>"}   "Risk" intact
```

Probe this path with leading-tag examples and it looks safe in every case. Move the same tag one
element to the right and the words are gone.

### The leading-tag branch is not "safe" either — it re-escapes, and that undoes §107's payoff

★★★ **THE BLOCK ABOVE DRAWS ONLY HALF THE CONCLUSION FROM ITS OWN OUTPUT, and the missing half is
the one a reader will act on.** "Risk intact" is true about the WORDS and false about everything
else: the value came out of the AI boundary as REAL MARKUP and comes back from one load as LITERAL
TEXT. That is precisely the §107 symptom, re-created on the load path after §107 closed the write
path. Measured 2026-08-10 through the real exported functions, same run as the block above:

```
AI write boundary stores : "<h1>Title</h1><p>body</p>"
after ONE load (raid)    : "<p>&lt;h1&gt;Title&lt;/h1&gt;&lt;p&gt;body&lt;/p&gt;</p>"
after ONE load (task)    : identical
after TWO loads (raid)   : identical to one load — it escapes ONCE, it does not compound
descriptionText BEFORE   : "Title body"
descriptionText AFTER    : "<h1>Title</h1><p>body</p>"
```

The last two lines are the user-visible ones. `descriptionText` is what feeds search, the AI digests
and the inline-AI preview (exports take `descriptionTextWithBreaks` through the same projection), so
after one load a register description reads as its own raw markup rather than as its prose.

★★ **PRE-EXISTING, not introduced by the §107 slice — establish this before filing anything against
it.** `git diff 528dd5fe...HEAD -- src/app/note-log.ts` is a ONE-LINE change, the explicit `"note"`
argument, and `NOTE_ALLOWED_TAGS` minus its `#text` member is the SAME eight tags the retired shared
constant carried. So this path classified identically before and after. What the slice changed is
the value ARRIVING here: the AI boundary is 11 tags wide, so it now hands the load path markup the
load path will not keep. The pre-slice version of the same defect simply started one step earlier —
the AI boundary escaped it too, which is §107's own opening paragraph and is not re-measured here.

★ **Documents are exempt — verified, not assumed.** `sanitizeDocumentRichFields`
(`document-rich-fields.ts`) calls `sanitizeDocumentHtml` and nothing else — no `descriptionHtml`, no
`note` classification, no `sanitizeNoteHtml`. The same `<h1>Title</h1><p>body</p>` in a document
paragraph comes back byte-identical. Only the seven ENTITY rich fields are affected.

★★ **SCOPE, as the slice set it: stop-the-bleed only.** No repair of already-escaped stored values
and no re-architecting of the load path — `note-log.ts` is deliberately untouched. This is recorded,
not fixed, and it closes with the same one decision as the rest of this entry: bring classifier,
storage and editor to ONE list. Widening the `note` sink alone would let the load path KEEP an `<h1>`
and hand it straight to `sanitizeNoteHtml`'s `KEEP_CONTENT: false`, converting this escape back into
the DELETION the block above measures. That is the trap, and it is why this is not a one-line fix.

★ **PRE-EXISTING, not a regression.** Do not read this as caused by §107's slice: the old shared
8-tag `HTML_START` also matched a leading `<p>`, so a mid-value `<h1>` was already passed through and
deleted here. What §107 changed on THIS path is nothing — `sanitizeRichFields` classified against the
8-tag list before and against the (identical) `"note"` list after. The §107-caused half of this entry
is the `Task.description` Path 1 above, where the AI write boundary is 11 tags wide.

★ **A grep, not a claim — FIVE paths, recounted.** Four apply `sanitizeNoteHtml` to a task
description: the form save (`use-task-submit.ts`, measured above), `task-inline-patch.ts`,
`bulk-operations-helpers.ts` and `task-dedup/dedup.ts`. The fifth is `sanitizeRichFields`
(`note-log.ts`), which covers all seven fields across all four entities on both load boundaries.
Sweep with
`grep -rn "sanitizeNoteHtml" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."`
(it also returns the note-log ENTRY html and the display/editor sites, which are a different
question). Of the four task paths only the form save was measured; the dedup merge is the likeliest
second instance of Path 1, because it is the one that reads STORED descriptions rather than a
freshly-typed value, while the other two sanitize an incoming patch.

★★ **A correction to a claim made while this was being written, kept because it is the kind that
propagates:** `RichTextView` (which re-sanitizes with `sanitizeNoteHtml` at display) is **NOT** in
this path. It has exactly two call sites — the dashboard narrative and the note log — and neither is
a task or register description. The display-side narrowing here is the lean EDITOR's own
`sanitizeNoteHtml` commit (`rich-text-editor.tsx`) plus ProseMirror's re-parse, not `RichTextView`.
Reproduce: `grep -rn "<RichTextView" src/app --include="*.tsx" | grep -v "\.test\."`.

**Closure is ONE future slice — the "unify rich text" program — not per-field patches.** The three
layers have to be brought into agreement in one decision: either the lean editor gains `u`/`h1`/`h2`
(and `sanitizeNoteHtml` widens with it, which is the change §107's retraction block warns is not
local — the NOTE LOG shares that sanitizer and `KEEP_CONTENT: false` is deliberate there), or the
template allow-list narrows to 8 and the AI is no longer told it may emit headings. Patching one
field at a time produces a fourth list to drift, which is the exact failure §107 and §114 record.

### CLOSED 2026-08-11 — the unify-rich-text slice took the WIDEN branch

**CLOSED** — one list (`RICH_ALLOWED_TAGS`, 21 tags), one sanitizer (`sanitizeRichHtml`, at
DOMPurify's DEFAULT `KEEP_CONTENT` — unwrap semantics), one classifier sink (`rich`), one editor.
`sanitizeTemplateHtml` and `sanitizeNoteHtml` are DELETED with no alias — an alias is a fourth list
waiting to drift. `DOCUMENT_ALLOWED_TAGS` now SPREADS the rich array, so the surviving second
sanitizer differs by exactly one tag (`img`). The five measured deletions at the top of this entry
and the leading-tag escape are both gone, pinned by fixtures in `sanitize-html.test.ts` and
`note-log.test.ts`.

★ The editor half: `RichTextEditor` lost `variant`/`labels`/`isLean`/`ToolbarButton`, gained
`StarterKit.configure({heading:{levels:[1,2,3,4]}})` + Highlight + Subscript + Superscript, and
delegates to the shared `rich-text-toolbar.tsx`. Markdown input rules are back ON. `BLOCK_TAG`
(`rich-text-plain.ts`) gained `pre`.

**NOT closed by this slice, each now its own entry.** Already-escaped STORED values are not repaired
— a value written as `&lt;h1&gt;` before this slice stays that way (**§141**). Task list and text
alignment are unbuilt, because both need new HTML ATTRIBUTES (**§140**). §115's `data-*` default is
unchanged and its blast radius GREW — §140 owns it.

★★★ **THE ORDERING LESSON, AND IT IS THE MOST VALUABLE THING THIS SLICE LEARNED: MOVING A CLASSIFIER
WIDER BEFORE MOVING ITS SINK CONVERTS AN ESCAPE INTO A DELETION.** Mid-branch — between the sink
merge and the sanitizer retirement — the tree carried LIVE DATA LOSS. `note-log.ts` ran
`sanitizeNoteHtml(descriptionHtml(value, "rich"))`: a 21-tag classifier feeding an 8-tag
`KEEP_CONTENT:false` sanitizer, on the whole-object JSON **and** IndexedDB load path, for all seven
rich fields. Measured at that commit:

```
RAID description "<h1>Escalation</h1><p>ok</p>"    -> "<p>ok</p>"    "Escalation" DELETED
RAID mitigation  "<blockquote>plan B</blockquote>" -> ""             field EMPTIED
```

Twelve of the 21 tags lost their words. The OLD sink escaped these — ugly, but the words survived.
**No test went red on any of it; a cold reviewer found it.**

★★★ **AGENTS.md had already written the warning and the warning was not enough.** This entry's own
bullet in that file said "Do not 'finish' it by widening the `note` sink", and the widening happened
anyway — because it happened **one file away from the sentence**, in a commit whose subject was the
sink merge, not the sanitizer. A prose warning is scoped to the file a reader is looking at.

★★★ **The durable protection is TWO tests in `html-start.test.ts`, and the interesting one is NOT
the property.** The subset property pins `kept(sanitizer) ⊆ recognised(sink)` for every sink, derived
empirically on both sides — it feeds tags through the real sanitizer and the real classifier rather
than comparing two constants. Before it, widening a sanitizer's `ALLOWED_TAGS` **config** without
touching the exported array left every test green: the §107/§114 class exactly, and why this shipped
mid-branch.

★★★ **BUT A PROBE-BASED PROPERTY CAN ONLY SEE TAGS IN THE UNIVERSE IT PROBES**, so the property
alone did not close the class — a tag added to the config but absent from the probe list never enters
the kept-set, and the subset holds vacuously. The closing assertion is a different shape: it reads
back the **RESOLVED `ALLOWED_TAGS` a sanitizer actually handed DOMPurify**, through an
`uponSanitizeElement` hook, and compares it to that sink's exported array. That is
**tag-INDEPENDENT** — it inspects the config rather than probing a universe — which is why it cannot
be escaped by choosing an unusual tag. ★ It compares SORTED NAME SETS, not object identity; a
reference check would pin the wrong thing (`SINK_TAGS.rich` is separately pinned by reference).

★★★ **Measured, and it refutes the obvious cheaper fix — widening the probe universe.** With a
`quux` mutant deliberately outside the universe: **1 red, the config test alone**; both behavioural
tests stayed green. The `details`/`kbd`/`abbr`/`dfn` mutant went 0 red → 3 red. So universe-widening
helps only for tags someone already thought of, which is the same blind spot the original defect had.
★★ The fix originally proposed for this was itself wrong and was refuted by measurement — the claim
that asserting `kept == RICH_ALLOWED_TAGS` catches any tag, when a tag outside the probed universe
never enters `kept` and equality therefore still holds. **Same error class as §113's alignment
claim**: a mechanism asserted from how it ought to behave rather than run.
★ A fixture pins the tags someone thought to list; a probe-based property pins the ones in its
universe; only a config read-back pins the ones nobody imagined.

★★ **A THIRD INSTANCE OF THE SAME CLASS, from this branch's a11y follow-on.** The brief for the
toolbar group naming asserted that "the editable regions are uniquely named" and scoped the fix to
the toolbars alone. True per PANEL — and false across two MOUNTED panels, which is precisely the
mount the fix exists for: `NoteLogPanel`'s two `RichTextEditor` `label` props ignored `labelSuffix`,
so with the floating notes window and the task editor's inline panel both open, the composers and the
entry editors collided, and the new toolbar groups — which take that same string — collided with
them. A fix whose entire purpose is disambiguation would have inherited a collision its own brief
said did not exist. Found by the implementer ENUMERATING the actual `label` at every call site
instead of accepting the premise. Fixed in `a6e7c0c5`; the residue is **§142**.

★★ **A SOURCE-TEXT ASSERTION TAXES THE DOCUMENTATION OF THE VERY CHANGE IT PINS.**
`rich-text-editor.test.tsx` asserts its own source does not contain `sanitizeNoteHtml` /
`sanitizeTemplateHtml` / `RichTextEditorVariant` / `isLean`. That is the right guard — but it cannot
tell a live reference from a HISTORICAL NOTE, so writing "this used to run `sanitizeNoteHtml`" into
that file turns the test RED. The note belongs here instead, and the guard should not be weakened to
admit it. ★ `rich-text-plain.test.ts` enforces a DIFFERENT rule on its own module — comments MAY name
DOMPurify, only a CALL is banned — so do not generalise either file's rule to the other.
★ Consequence for this entry: prose about a retired symbol goes in the register, and a `src/` comment
about one is only safe in a file no source-text assertion scans. Check before writing it.

★ **`html-start.ts` stated THE RULE INVERTED in its own headline** — "never recognise MORE than your
sink KEEPS" — while its two back-references in the same file, and AGENTS.md, both said LESS.
Corrected on this branch. This is the **second recorded instance** of a rule being inverted inside
its own implementation while every reference to it stayed right; the first is §107's own history.
A rule stated once and referenced twice can disagree with itself, and the implementation is the copy
a reader trusts.

## 138. The open-followups consolidation stopped after its harness — P2–P4 deferred, scope measured

The 2026-08-10 slice that produced `scripts/check-followup-claims.mjs` (npm `followups:check`) was
phase P0+P1 of a five-phase consolidation. **P2–P4 are not started.** The spec and plan that defined
them are under `docs/superpowers/`, which is gitignored — so they exist on one machine and this entry
is the only durable record. It is written to be resumable without them.

★★★ **THE ORIGINATING PREMISE WAS FALSE AND MEASURING IT FIRST IS WHAT SAVED THE SLICE.** The request
was "extract the open TODOs out of the app files into one place". This repo has **zero**
`TODO`/`FIXME`/`HACK` markers. Open work was already centralised — here. What the code holds is not
to-dos but CITATIONS: at the time, 289 `§NN` references across `src`/`scripts`/`e2e`, of which
**197 pointed at CLOSED entries**. Those are provenance — the recorded reason a guard, a test or an
odd-looking branch exists. A sweep that deleted them would have removed the justification for
roughly two hundred guards while looking like tidying. ★★ A keyword sweep cannot separate the two
classes and is ~97% noise here: `owed` matches `allowed`/`followed`, and `Deferred` is a
`ChangeStatus` enum member. The separator is a criterion, not a regex — **if the work were done,
would this sentence be deleted?** Keep the citation, strip the open-state.

### What P0+P1 delivered

`agents-symbols-lib.mjs` (+ its first-ever test) extracted from the blocking symbol gate, and
`followup-claims-lib.mjs` / `check-followup-claims.mjs` / `docs/baselines/followup-claims.json` added
beside it. ★★ **The harness rules claims OUT, never IN.** A `CLEAN` verdict means only that nothing
static disproved the entry; every result carries `needsProbe: true` and the tool closes nothing.
★★ `CLEAN` is additionally a WEAK signal and nearly tripped the suspect-the-harness rule: an entry
"has a claim" whenever it names any backticked symbol, and nearly all do, so `CLEAN` collapses to
"names at least one symbol and every name resolves". The design expected `NO_MACHINE_CLAIM` to be
large — a11y and CSS entries no static check can judge — and it came back at 1.

### The three phases that remain

**P2 — probe all open entries behaviourally.** The only phase whose size is already known, and about
60% of what is left. Read-only agents, batched; each brief must carry the entry text **verbatim**,
because an agent told to "read §84" reads the wrong lines the moment the register shifts.
★★★ **Distrust the verdicts.** This slice already measured what a plausible absence heuristic does
to this file: reusing the symbol gate's proximity matcher (`markedNear` / `PROXIMITY`) to decide
"the entry says this is absent" put **48 of 54** hits on things that EXIST — each one a false "this
follow-up is done", which is the costliest error available here. The failure was structural, not a
badly-sized window: §7 puts a real absence assertion 15 characters from a present symbol, and the
motivating idiom ("no `X` exists") matches no marker at all. The fix was **anchoring** — the marker
must capture the name it negates. Apply the same suspicion to an agent's "done".

**P3 — apply the verdicts.** Cannot be sized until P2 reports. Mechanically simple, but serial: one
file, no parallel edits.

**P4 — the extraction and strip.** The unbounded one, and the reason the whole thing is deferred
rather than half-done. Four parts: orphaned open items into this register; fold or link
`tech-debt-register.md`; strip open-state prose out of `AGENTS.md` and `docs/AGENTS/*.md`; strip
open-item comments from source while KEEPING the provenance citations.

★★★ **P4 CARRIES AN UNRESOLVED CONFLICT AND MUST NOT PICK A SIDE SILENTLY.** The agreed scope says
fold `tech-debt-register.md` in and delete it. The header of THIS file says the opposite in as many
words — a different artifact class, owner-assigned and quarterly-reviewed, and merging it "would
create two masters and guarantee drift". Both arguments are good. Whoever resumes decides it
explicitly and rewrites the losing paragraph; leaving both standing is the drift either one warns
about.

★★ **Inserting entries here breaks every `docs/open-followups.md:LINE` citation below the insertion,
and the doc-claims ratchet cannot see the ones in `scripts/`.** Twelve such cites were found in
`scripts/` during P0 and converted to `§N, verbatim`; `src/` was never swept for the same shape.
Do that sweep BEFORE P3/P4 insert anything, not after.

★★ **Scope a `§`-renumber BY FILE, never by number.** Recorded independently on an earlier branch and
it applies with full force to a phase whose whole job is renumbering.

### Measured 2026-08-10, with the commands that re-derive them

Numbers in a register rot; these are dated and each is falsifiable. Do not trust them, re-run them.

| | measured | reproduce |
|---|---|---|
| entries / open | 129 / 92 | `grep -cE '^## [0-9]+\. ' docs/open-followups.md` |
| lines inside open entries | 4721 (median 34, p90 107, max 422; 10 over 100) | the sweep's own snapshot |
| verdict spread | `CLEAN` 80 · `SYMBOL_MISSING` 8 · `NO_MACHINE_CLAIM` 1 · `PATH_MISSING` 1 · `PATH_THIRD_PARTY` 1 · `CITE_THIRD_PARTY` 1 | `npm run followups:check` |
| `§` citations to triage | 277 in `src` (98 files) · 49 in `scripts` · 7 in `e2e` | `grep -rno "§[0-9]" src scripts e2e \| wc -l` |
| open-state prose in the always-loaded doc | 25 marker hits in `AGENTS.md`, 9 across the nine subsystem files | `grep -c -iE "STILL OPEN\|left open\|not fixed\|unverified" AGENTS.md docs/AGENTS/*.md` |
| fold-in candidate | `tech-debt-register.md`, 49 lines | `wc -l docs/tech-debt-register.md` |

★ The `SYMBOL_MISSING` eight were hand-checked at the time: all genuinely absent, zero false
positives. That is a statement about those eight names, not a licence to trust the classifier.

### Two harness gaps left open on purpose

★★ `REPRO_NONZERO` and `REPRO_TIMEOUT` fire on nothing in today's register. They were proved
non-decorative by temporary probes that were then reverted, so **nothing committed exercises the
runner loop** — it lives in a CLI that `process.exit`s at import and is therefore untestable in
place. Extracting it is the same move that made `toArgv` testable, and is the obvious next
maintenance slice. ★ `grep` is the only binary with an exit-code exemption (exit 1 means "no match",
which several entries expect); `git merge-base --is-ancestor` and `diff` would false-positive the
same way and have no exemption.

★★ A gate that names the symbols it hunts must exclude its own files, and BOTH gates here needed it —
`GATE_SELF_FILES` in the symbol gate, `SWEEP_SELF_FILES` in the new one, both passed through
`collectIdentifiers`. The second was found only by a cold review, after the first had already been
fixed per-name on the same branch: **per-name discipline does not lift itself to the mechanism.**
A new consumer of `collectIdentifiers` inherits this hazard and nothing will tell it so.

★★★ **THE DIRECT CONSEQUENCE, AND THIS ENTRY DEMONSTRATES IT: THE SWEEP CANNOT VERIFY A CLAIM ABOUT
ITSELF.** The two self-sets are applied together — `collectIdentifiers` always drops its own three,
and the caller's third argument drops three more — so **six** files are invisible to the identifier
scan, and every mixed-case name defined only in them reads as absent. This entry therefore reports
three `SYMBOL_MISSING` of its own, all false: `markedNear`, `collectIdentifiers` and `toArgv` all
exist. Reproduce the mechanism directly, which is the only way to see it — the tool's own output
cannot distinguish this case from a real deletion:

```bash
node -e "Promise.all([import('./scripts/agents-symbols-lib.mjs'),import('./scripts/followup-claims-lib.mjs')]).then(([a,f])=>{const s=new Set();for(const d of ['src','scripts','e2e'])a.collectIdentifiers(d,s,f.SWEEP_SELF_FILES);console.log(['markedNear','collectIdentifiers','toArgv'].map(n=>n+'='+s.has(n)).join(' '))})"
```

★★ **This is correct behaviour and must NOT be "fixed" by narrowing either set** — that restores the
hole where the harness's own fixtures vouch for the symbols it judges, which is what made the second
set necessary. It is also not fixable by an allowlist: one exception invites a hundred, the same
reasoning that leaves §131's illustrative filename unsuppressed. The correct handling is what is done here —
state the false positives in the entry that causes them. ★ Consequence for P2: an entry about the
tooling gets no static help at all, so it needs the same behavioural probe as an a11y entry does.

---

## 139. The entity-side attach door was designed and deliberately NOT built — documents S4 shipped one door of two

Documents S4 (`linkedEntities`) shipped the DOCUMENT-side door: the Documents pane has a picker
(`DocumentLinksField`) that attaches tasks, milestones, RAID items and changes to the open document.
The ENTITY-side door — attaching a document from inside a task/RAID/change/milestone editor — was
designed in the same session and deliberately deferred.

★★ **This was a choice, not an oversight, and the reason is the failure mode it avoids.** Shipping
half of a two-door feature is a shape this repo has been bitten by repeatedly — the phrase "one door
of two" recurs in this register, including inside §113 itself: the second door looks trivial, gets
bolted on later against a
model that was never shaped for it, and the two doors then disagree about validation, about caps and
about what a stale reference means. Rather than ship both surfaces thinly, S4 shipped ONE surface
completely and wrote the model so the second is additive.

★ **The model is already shaped for it.** `document-ref.ts` is a LEAF module — it imports nothing
from the app, specifically so the four entity editors can import `DocEntityRef`/`refKey` without
pulling in `document-model.ts`, which sits in the `settings-types` ⇄ `workspace` ⇄ `document-model`
value-import cycle (§92). `indexDocumentsByEntity` already answers the reverse question the entity
side needs. The mutations (`link`/`unlink`) are keyed on the document id, so an entity-side call is
the same mutation with the arguments known in the other order.

★★ **What the second door still has to decide, and must not guess:** the cap is per-DOCUMENT
(`MAX_LINKS_PER_DOC`), so attaching from the entity side can be refused by a limit the user cannot
see from where they are standing. That needs a real answer (surface the documents remaining
budget? a per-entity cap as well? silently pick another document?) — it is the one part of the
design that does not fall out of the existing model.

★ **One behaviour was accepted rather than overlooked**, recorded in `docs/AGENTS/documents.md`: a
read-only popout renders NO link chips at all (the field is withheld rather than drawn inert — the
no-false-affordance rule), so a popout mirror cannot see what a document links to. Closing it needs
a read-only mode on `DocumentLinksField`, not a model change.

★★ **A second one was NOT accepted — it was a defect, found by the branch's own cold review and
fixed.** With a filter armed, selection fell back to `documents[0]`, and because the link field is
bound to `selected`, an attach made from a filtered view could land on a document the list was not
showing. Both existing tests happened to order the fixture so `documents[0]` was the right answer,
which is why they were green. Recorded here because "accepted behaviour" and "undiagnosed defect"
look identical from a green suite, and this one was written into two docs as the former before it
was understood as the latter.

---

## 140. The attribute boundary — task list and text alignment are unbuilt because both need new HTML attributes — CLOSED 2026-08-13

Opened 2026-08-11 out of §137's closure. The unify-rich-text slice deliberately stopped at TAGS.
Task list and text alignment were the two controls it did not build, and they share one blocker:
each needs an HTML **attribute** the storage boundary does not currently admit, and the attribute
surface is shared by every rich field AND by documents. That is a security boundary, so it gets a
designed slice and its own review rather than a toolbar button.

**Scope, as one decision:**

1. **Task list** — `data-type="taskList"` / `data-type="taskItem"` + `data-checked`.
2. **Text alignment** — `text-align`, via `style` (or a `class`, see below).
3. **A VALUE allow-list**, enforced by a DOMPurify `uponSanitizeAttribute` hook. This is the part
   that does not exist today in any form.
4. **`ALLOW_DATA_ATTR: false` on every sanitizer**, which is what closes **§115**.
5. A security review of the result.

### The design inputs — measured, so the slice does not re-derive them

★★★ **`style`, `class`, `title` and `id` are members of DOMPurify's `DEFAULT_URI_SAFE_ATTRIBUTES`
and therefore BYPASS the `ALLOWED_URI_REGEXP` value test entirely.** `target`, `rel` and `lang` are
not, which is why those three never survive (§38). Measured 2026-08-11 on dompurify 3.4.13 WITH
CONTROLS — listing `target`/`rel` still strips them and listing `lang` still strips it, proving the
regexp was armed, while `style="text-align:center"` and `class="text-center"` both survive.
**§113 carried the opposite claim ("Alignment CANNOT be markup") and it is corrected there.**

★★★ **So the blocker is the VALUE, not the attribute NAME — and nothing constrains it today.**
A surviving `style` is passed through verbatim: `position:fixed;inset:0;z-index:99999` survives, and
so does `background:url(javascript:alert(1))` — DOMPurify does not parse CSS values at all. These
fields are AI-writable. **Admitting `style` without a value allow-list would be a real
vulnerability**, which is the whole reason this is a slice with a review and not a list entry.
★ A `class` allow-list is the cheaper alternative and worth pricing FIRST: the app already has a
fixed palette of alignment utilities, so an allow-list of four class names is a far smaller attack
surface than any CSS-value grammar. Decide between them explicitly.

★★ **Task-list markup would survive TODAY, and only by accident.** `ALLOW_DATA_ATTR` defaults to
TRUE and `sanitizeRichHtml` leaves it at the default — that is §115, still open. So a `data-checked`
would pass the boundary regardless of `ALLOWED_ATTR`. ★★★ **That accident got WIDER, not narrower,
in the §137 slice**: `sanitizeRichHtml` inherited the default from an 11-tag config and now applies
it across **21 tags**, i.e. ten more than the config it came from. Do not build task list on top of
the accident — fix §115 in the same slice, then re-admit `data-type`/`data-checked` by name.
★ Re-admitting them is not just a name-list edit: setting `ALLOW_DATA_ATTR: false` removes the
`data-*` SHORT-CIRCUIT, which drops those attributes into the value chain where `ALLOWED_URI_REGEXP`
rejects any non-URI value. Each one kept needs `ADD_URI_SAFE_ATTR` too — §115 records that mechanism
and `sanitizeDocumentHtml`'s `data-asset-id` is the worked precedent.

★★ **Task list needs NO new package.** `@tiptap/extension-list` is already a `starter-kit`
dependency — reproduce with
`node -p "Object.keys(require('./node_modules/@tiptap/starter-kit/package.json').dependencies)"` —
it is simply not registered — StarterKit does not register TaskList/TaskItem, and
`grep -cE "TaskList|TaskItem" node_modules/@tiptap/starter-kit/dist/index.js` returns **0**. Only
**`@tiptap/extension-text-align`** is a genuinely new dependency.

★★★ **INSTALL THAT ONE AT AN EXACT VERSION — a caret range breaks the install.** The tree is
uniformly on Tiptap **3.27.1** (core, react, starter-kit and the three extensions this slice added;
verified 2026-08-11). `@tiptap/extension-text-align@^3.27.1` resolves to **3.29.2**, whose peer
dependency is an EXACT pin — `{"@tiptap/core": "3.29.2"}`, not a range — against the installed
3.27.1. Reproduce without installing anything:

```bash
npm view @tiptap/extension-text-align version           # 3.29.2
npm view @tiptap/extension-text-align peerDependencies  # { '@tiptap/core': '3.29.2' }
```

This bit Task 1 of the §137 slice. Install `@tiptap/extension-text-align@3.27.1` explicitly, or
upgrade the whole Tiptap tree as a deliberate separate step.

★ **Sequencing note.** §113's S3b (the documents block editor) is now smaller than designed because
the unified `RichTextEditor` already exists — but S3b wants alignment, so this entry sequences
BEFORE it, the same way the classifier work sequenced before S3a.

### CLOSED 2026-08-13 — the decisions taken

This entry's spec (`docs/superpowers/specs/2026-08-13-attribute-boundary-140-design.md`) is
gitignored and local-only. Reproducing the decisions here, because the durable record is this file,
not the spec.

★ **`data-align`, not `style` or `class`.** §113's correction already established `style`/`class`
both survive DOMPurify unparsed (DEFAULT_URI_SAFE_ATTRIBUTES). A `class` allow-list (the four
alignment utilities) was priced as the cheaper alternative and rejected anyway: a `data-*` attribute
under a VALUE allow-list is a guard that cannot be widened one declaration at a time the way a CSS
grammar or a growing class list can — `ATTR_VALUES["data-align"]` is a closed 4-member string set,
full stop. `data-align` also composes with the SAME mechanism task list already needed
(`data-type`/`data-checked`), so one hook covers both controls instead of two different guard shapes.

★ **The chain, and why each link is load-bearing.** `ALLOW_DATA_ATTR: false` on `sanitizeRichHtml` is
simultaneously the §115 fix AND the precondition that makes `ATTR_VALUES` reachable — the default
`true` SHORT-CIRCUITS every `data-*` past both the name test and the value test, so the hook would
never be asked about a kept name if the flag stayed on. Turning it off drops the three kept names
(`data-align`/`data-type`/`data-checked`) into the value chain, where `ALLOWED_URI_REGEXP` is tested
against EVERY attribute value and rejects any non-URI — so each kept name ALSO needs
`ADD_URI_SAFE_ATTR`, or it is stripped outright regardless of `ATTR_VALUES`. That exemption in turn
skips the value test, which is exactly why the `ATTR_VALUES` table has to exist: it is the only
remaining guard on these values. Three links, none optional: turn off the short-circuit, re-exempt
the URI test, then guard the value with the table.

★ **The hook is registered LAZILY, never at module eval.** `DOMPurify.addHook` is `undefined` with no
DOM and throws a `TypeError`; `sanitize-html.ts` is module-eval-reachable under Next SSR
(`templates-builtin.ts` imports `plainToHtml` from here and calls it at module scope building the
built-in templates), so a top-level registration would 500 every page. `ensureAttrHook()` guards this
with a one-time flag. A source scan enforces it — comments may name the API, code may not call it at
top level.

★★★ **THE TASKITEM FINDING THIS ENTRY NEVER HAD, and it is the reason the tag list did not grow.**
Stock `TaskItem.renderHTML` emits `<li><label><input type="checkbox"><span></span></label><div>…</div></li>`
— four tags beyond `RICH_ALLOWED_TAGS`, spreading into `DOCUMENT_ALLOWED_TAGS`, plus an
`<input type=checkbox>` whose only sibling is an empty `<span>` — axe-critical in an `A11Y_VIEWS`
member. TaskItem separately declares `addNodeView`, and a nodeView is EDITOR-ONLY — `getHTML()`
serializes through `renderHTML`, never the nodeView. So overriding `renderHTML` alone (to emit only
`data-type="taskItem" data-checked="…"`) costs nothing in editor UX: the editor keeps Tiptap's own
interactive labelled checkbox, and storage gets markup needing zero new tags. This entry priced the
attribute boundary as the whole cost of task list; the real cost turned out to be one `renderHTML`
override, found only by reading the extension's source rather than assuming the stock markup had to
ship.

★ Alignment: `TextAlign.extend({ addGlobalAttributes() {...} })` rewires `parseHTML`/`renderHTML` to
read/write `data-align` instead of the stock `style="text-align:…"`; the alignments filter, commands
and keyboard shortcuts are the stock extension's, unchanged.

★ Fidelity reach, as shipped: in-app CSS, standalone HTML/PDF, and a plain-text `[x]`/`[ ]` prefix for
flat exports. DOCX and PPTX are the STATED gap — see §141(b), extended below, not silently deferred.

---

## 141. Rich-text repair and export fidelity — the debt §137 deliberately did not pay — (b) and (d) CLOSED 2026-08-16; (a) and (c) still open

Opened 2026-08-11 out of §137's closure, which was scoped stop-the-bleed: it fixed what happens to
values written from now on and repaired nothing already stored.

### (a) Already-escaped stored values are not repaired

A value that passed through the old narrow classifier before §137 closed was stored **escaped** —
`"<p>&lt;h1&gt;Title&lt;/h1&gt;…</p>"` — and stays that way. It renders as its own raw markup, and
`descriptionText` (search, AI digests, the inline-AI preview) reads it as markup rather than prose.
§137 measures both. The new sanitizer will not undo it, because escaping is not lossy and nothing
distinguishes "was escaped by the old boundary" from "the user typed a literal heading tag".

★★ That ambiguity IS the design problem, and it is why this is not a migration script anybody should
write casually. A repair pass must decide what evidence licenses un-escaping a stored value, on data
where both readings are legitimate. Price the option of doing nothing: the population may be small
(only values that crossed an AI or import boundary between §107's closure and §137's), and it
shrinks every time a human re-saves one.

### (b) Export fidelity for the entity rich fields — CLOSED 2026-08-16

`htmlToRichLines` (`rich-text-runs.ts`) is the shared HTML → styled-runs parse behind
`doc-render-docx.ts` and `doc-render-pptx.ts`, but the seven rich ENTITY fields do not route through
it — exports take the flat `descriptionTextWithBreaks` projection. Now that those fields can carry
headings, lists, blockquote and code blocks, the gap is visible: **heading LEVEL and list NUMBERING
are lost** in DOCX and PPTX. Wiring the entity fields onto `htmlToRichLines` is the fix.

**Extended 2026-08-13 by §140.** The entity rich fields can now also carry TASK LISTS and TEXT
ALIGNMENT, and this gap grew to cover both, for two different structural reasons. Alignment is a
PARAGRAPH-level property and `htmlToRichLines` returns styled RUNS — a run has no paragraph to hang an
alignment off — so this needs a new LINE-level field on that type, plus a mapping in
`doc-render-docx.ts` and `doc-render-pptx.ts` (DOCX: `<w:pPr><w:jc w:val="…"/></w:pPr>`; PPTX: the
paragraph's `algn` attribute). Task items need the equivalent of the `[x]`/`[ ]` marker
`markTaskItems` (`rich-text-plain.ts`) already gives the flat projections — plain characters, since
neither renderer has a checkbox glyph today.

§140 shipped in-app CSS, standalone HTML/PDF and the flat-text `[x]`/`[ ]` prefix for both features.
**DOCX and PPTX are the stated gap, not a silent omission** — recorded here so the next reader does
not assume export parity because the in-app and web fidelity landed.

#### CLOSED 2026-08-16 by `feat/rich-text-export-fidelity-s2` (`c9f17120`…`31f9928d`)

`buildExportSections` no longer flattens. A rich column now emits `RichCell = { html; text }`
(`ExportCell = string | number | RichCell`, guard `isRichCell`, flattener `cellText`), so each
renderer chooses: DOCX and the HTML/PDF path render `html` with full structure; XLSX and both PPTX
paths read `.text` and are byte-identical to before. `RichLine` (`rich-text-runs.ts`) gained
`kind: "heading"` with `level`, `kind: "li"` with `ordered`/`depth`/`index`/`task?`, and `align?` on
every kind but `hr`. ★ The DOM-free boundary held — `export-sections.ts` CARRIES the html and never
parses it; every parse stayed inside the DOM-bound renderers.

★★★ **TWO CORRECTIONS TO THIS ENTRY'S OWN TEXT, both found by doing the work.**

**(1) The loss was NEVER DOCX/PPTX-only.** This entry says the level and numbering "are lost **in
DOCX and PPTX**" and that HTML/PDF fidelity "landed" with §140 — false for the ENTITY fields, which
is the only thing this entry is about. §140's HTML/PDF fidelity is the DOCUMENT renderer's; the
entity rich columns reached `doc-render-html.ts` through the same flat `descriptionTextWithBreaks`
projection every other renderer got, so a task description's `<h2>` and `<ol>` arrived as plain
lines in the HTML export and the PDF too. The scoping error is what made "wire the entity fields
onto `htmlToRichLines`" read as a two-renderer job. Reproduce the shape of the old path on the
pre-slice tree: `git show 2e2c8c00:src/app/export-sections.ts | grep -n descriptionTextWithBreaks`
returns the import plus the single flattening site inside `richCell` that EVERY format consumed.

**(2) The stated fix was insufficient AS WRITTEN.** "Wiring the entity fields onto
`htmlToRichLines` is the fix" could not have worked, because `RichLine` had nowhere to put what was
being lost: it carried no heading LEVEL, no list ordinal and no alignment. The parser had to gain
those fields FIRST (`aca61bdc`), and only then could the wiring carry anything. A fix phrased as
"route A through B" hides a missing field on B.

★★★ **THE CRITICAL THIS SLICE FOUND, after the model work had already shipped — a fixture that made
a whole feature untestable.** Tiptap's `listItem` content spec is `paragraph block*`, so the editor
stores `<ul><li><p>a</p></li></ul>`. The parser's LI arm started an empty line, the child `<p>`
flushed it, and `flush`'s whitespace rule DROPPED it — so the `li` kind was **inert for every value
a real user typed**, discarding `ordered`, `depth`, `index`, `task` and `align`. The whole suite said
nothing, because every fixture used the hand-authored `<li>text</li>` form, which appears nowhere
but `golden-workspace.*`. **Measured on the commit that introduced the kind — 15 `<li>` fixtures,
ZERO carrying an inner `<p>`:**
`git show aca61bdc:src/app/rich-text-runs.test.ts | grep -oE '<li[^>]*>(<p[^>]*>)?' | sort | uniq -c`
(★ a test COUNT is the wrong metric here and does not reproduce — an earlier draft of this paragraph
said "nine green tests", where the same command shows 7 references to the `"li"` kind and 4
list-named `it(` blocks depending on how you count. The FIXTURE SHAPE is the thing that was wrong,
and it is exactly countable.) Corroborated independently by `markTaskItems`
(`rich-text-plain.ts`), whose optional `<p>` group exists precisely because stored task items carry
one. Fixed in `5fe0c2de` by making a `LINE_TAGS` child of an `<li>` transparent. **The
generalisable lesson: a fixture can be unrealistic in a way that makes a whole feature untestable,
and hand-authored golden data is exactly where that hides.** Reproduce the storage shape:
`grep -n 'markTaskItems' -A6 src/app/rich-text-plain.ts` shows the optional-`<p>` group.

★★ **Alignment could never have been read off the `<li>`.** `rich-text-editor.tsx` configures
`TextAlign` with `types: ["heading", "paragraph"]`, so the editor writes `data-align` on the inner
`<p>`, never on the list item. Reproduce:
`grep -n 'types: \[' src/app/rich-text-editor.tsx` → `types: ["heading", "paragraph"]`.

★★ **`buildDocx` passed NO styles before this slice.** `word/styles.xml` in the workspace export
declared only `Title` and `TableHeader`, so every style a rich cell names — `Heading1`-`Heading4`,
`ListParagraph`, `Quote`, `CodeBlock` — would have been undeclared **in the very export this slice
exists for**, and Word SILENTLY IGNORES a `w:pStyle` naming a style the part does not carry. Fixed
by hoisting `DOC_STYLES` beside the emitter and passing it from both `buildDocxPackage` callers.
Reproduce the declarations: `grep -c 'w:styleId=' src/app/ooxml-docx-primitives.ts`.

★★ Two more OOXML facts no string assertion can see, each pinned by a test in `73c17aa8`:
**`ST_Jc` spells justified `both`, not `justify`** (emitting `justify` hands Word a value it drops
and the paragraph renders left-aligned, every assertion green); and **`<w:pPr>`'s children are an
`xsd:sequence`** (`CT_PPr`: `pStyle → pBdr → spacing → ind → jc → outlineLvl`) — wrong order makes
Word reject the part or drop the properties.

★★ h5/h6 are CLAMPED to `level: 4` for the same silent-ignore reason: nothing declares a `Heading5`.

★ **DOMPurify re-escapes a bare `&` on serialize**, which is why the entity assertions in
`11c8b82b` cannot be collapsed into one. Measured with two mutants: a decode placed BEFORE the
sanitizer is self-healing for ampersands but not for tags; a decode placed AFTER it is the reverse.
Neither mutant alone proves both halves.

★★ **CSV and Markdown are outside all of this, and not for the reason a reader assumes.**
`exportWorkspace` routes csv/md to `workspaceToCsv`/`workspaceToMarkdown` — the STORAGE serializers
— and calls `buildExportSections` only for docx/xlsx/pptx/pdf. So CSV export never consumed the
flat projection at all; it emits the STORED HTML, which is exactly what `golden-workspace.test.ts`
pins. Reproduce: `grep -n 'workspaceToCsv\|buildExportSections' src/app/export.ts`.

### (c) §31's unbounded markup bytes

Caps measure VISIBLE TEXT (`htmlTextLength`), never `html.length`, so markup bytes are unbounded.
The 21-tag list makes a given amount of visible text able to carry more markup than the 8- or 11-tag
lists did. Not a new defect — §31 — but its ceiling moved, so re-price it here.

### (d) `CONTAINS_TAG`'s `/i` flag is unpinned — CLOSED 2026-08-16 by `31f9928d`

The `render` sink's classifier is `CONTAINS_TAG` (`html-start.ts`), a case-INSENSITIVE tag match.
Dropping its `/i` leaves `html-start.test.ts` **29/29 green** (this entry said 22/22 — a wrong count
against a correct substance; re-measure with
`npx vitest run src/app/html-start.test.ts --reporter=dot`), and the mutant is NOT equivalent:
without it, UPPERCASE legacy markup (`<P>`, `<STRONG>`) fails the render classifier and is ESCAPED
into Word, PowerPoint, the HTML preview and the PDF.

**ANSWERED 2026-08-11 — it is unpinned REPO-WIDE, not just in one file.** This entry asked for the
scope to be established before anyone wrote a test; it now is. The `render` sink has exactly THREE
production consumers — `doc-render-docx.ts`, `doc-render-html.ts`, `doc-render-pptx.ts` (enumerate
with `grep -rn '"render"' src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'`) — and the
`/i`-dropped mutant survives **215 tests across the six files that own the sink and its consumers,
0 red**: `html-start` 29 · `doc-render-html` 26 · `doc-render-docx` 41 · `doc-render-pptx` 70 ·
`rich-text-runs` 29 · `rich-text-projection` 20. Non-equivalence re-confirmed on the same run:
`"Intro <STRONG>bold</STRONG> tail"` → `true` with `/i`, `false` without.

★★ The harness was proved live in the same session, so the green is a real survival and not a
mis-run: the neighbouring swap of `doc-render-html.ts`'s own sink argument (`"render"` → `"document"`)
turns **3** tests red in that same file.

★ Still recorded rather than fixed, and now for a stated reason rather than an open question: the
input the suite lacks is a stored UPPERCASE-markup value, which no fixture in any of the six files
carries. The one-line test is a `doc-render-html` case rendering `"Intro <STRONG>bold</STRONG> tail"`
and asserting the markup is NOT escaped — cheap, but it belongs with §141(b)'s export-fidelity work,
where the same three renderers are already being touched.

**CLOSED 2026-08-16 — the test landed with (b), exactly where this entry said it belonged.**
`31f9928d` adds the `doc-render-html` case, and it asserts the POSITIVE (the `<strong>` element
SURVIVES as markup), not merely that an escaped form is absent — an absence assertion here would
pass against a renderer that emitted nothing at all.

★★ **It has exactly ONE detector in the repo, and that was re-measured on the CURRENT tree rather
than carried over from this entry's 2026-08-11 figures.** Under a mutant dropping `/i` from
`CONTAINS_TAG`, the new test is the single red; **237 tests across the five other candidate files
stay green** — `html-start` 32 · `doc-render-docx` 61 · `doc-render-pptx` 75 · `export` 20 ·
`rich-text-plain` 49, all exit 0. Note the file list and every count differ from this entry's
earlier measurement (215 across six files), because the suites grew and the candidate set was
re-derived; **do not read the old numbers as still current, and re-derive rather than trust these
if you re-check.** Non-equivalence unchanged: `"Intro <STRONG>bold</STRONG> tail"` classifies
`true` with `/i` and `false` without.

---

## 142. `NoteLogPanel`'s `labelSuffix` is honour-system and unguarded — a third mount site collides silently — open

Opened 2026-08-11 out of the a11y follow-on to §137's branch. The DEFECT is fixed (`a6e7c0c5`); the
MECHANISM that let it happen is not, and cannot be seen by anything in the repo.

### What `labelSuffix` is for, and what ignored it

`NoteLogPanel` takes an optional `labelSuffix`, whose own docstring states the reason: *"Appended to
the composer/row control names so two mounted surfaces never announce identical labels. axe cannot
see a duplicate accessible name."* Two panels genuinely mount at once:

- `notes-window.tsx` — the floating notes window. Passes **NO** suffix on purpose: its `role="dialog"`
  `aria-label` already scopes everything inside it.
- `task-form-fields.tsx` — the task editor's inline panel, fed by `use-notes-window.ts`, where the
  suffix is documented as REQUIRED.

The Add / Edit / Delete buttons and both dictation mics applied the suffix. The two `RichTextEditor`
`label` props did **not** — so in that mount both composers announced "Write a note…" and both entry
editors announced "Edit" (WCAG 2.4.6, on the editable regions themselves). It also defeated the
toolbar group naming shipped one commit earlier, since those groups take this same string: the one
mount where disambiguation matters most produced two identically-named groups.

Fixed by naming each mic and the editor beside it from ONE shared const (`editLabel` /
`composerLabel`). Two spellings of the same string sat within ten lines of each other and only one
was ever updated — which is how it happened, and why the fix is a shared const rather than a second
correct spelling.

### The open part — nothing can detect a THIRD caller

★★ The mechanism is honour-system. `labelSuffix` is OPTIONAL, so a future third mount site that
simply omits it compiles, renders, and collides **silently**. Nothing in the repo can tell: axe is
structurally blind to a duplicate accessible name at any seed size (see §55's neighbouring
measurement and AGENTS.md's a11y bullet), and the type system is no help either — optional means
optional.

★ The asymmetry is worth naming, because it looks like coverage and is not: the site that is
SUPPOSED to omit the prop is the one held structurally (`notes-window.tsx` types itself
`Omit<NoteLogPanelProps, "labelSuffix">`, so it *cannot* pass one), while the site that MUST pass it
is held only by a comment in `use-notes-window.ts`. The guard is on the harmless direction.

★★ **The two-panel test does not close this and must not be read as if it does.** It lives inside
`note-log-panel.test.tsx` and pins today's spellings *within* `note-log-panel.tsx` — it mounts the
production pairing (one with a suffix, one without) and asserts the SET of the four editable
surfaces' names has size 4, rather than merely that four exist. It cannot see a new CALLER that omits
the prop, because it constructs the mount itself.

### Why the test was necessary — the mutation result

Mutation-measured in `a6e7c0c5`: dropping the suffix from the entry editor's label turns **2** tests
red; dropping it from the composer's turns **1** red — the new two-panel test in both cases, and for
the composer half it is the ONLY detector. Every pre-existing case in that file mounts ONE panel,
where "Write a note…" resolves whether or not the suffix is applied, so each passes either way. That
is the whole argument for the two-panel shape: a single-mount fixture cannot observe a collision that
only exists when both surfaces are in the DOM.

### Closing it

Options, none taken: make `labelSuffix` REQUIRED on `NoteLogPanelProps` and have the window pass an
explicit sentinel (turns the honour system into a typecheck, at the cost of a meaningless argument at
the one site that legitimately has nothing to say); or derive the suffix inside the panel from
something it already knows. ★ Recorded rather than fixed because the branch was already wide, and
because the right answer depends on whether a third mount site is ever actually wanted — if it is
not, the cheapest correct move is to keep it at two and say so in the type.

---

## 143. The sink ARGUMENT is unpinned at every call site — the §107/§114 class surviving one level up — CONVERSION COMPLETE 2026-08-16; the TYPE-level guard is still open

Opened 2026-08-11 out of a cold review of `unify-rich-text-s1`. `isHtmlStart(value, sink)` is that
slice's design centre: one classifier per sink, each DERIVED from the allow-list its sink sanitizes
against, so a classifier can no longer be narrower than its sink (§107) or wider than a deleting one
(§114). `html-start.test.ts` pins the MAP thoroughly and empirically, per sanitizer.

**Nothing pins that any consumer passes the RIGHT sink.** The argument is a hand-written string
literal at every call site, and `RichTextSink` is a union of four members, so every value typechecks
everywhere. Measured swaps that leave the owning suites FULLY GREEN:

| swapped call site | swap | suites run | result |
|---|---|---|---|
| `narrative-html.ts` `narrativeToHtml` | `"rich"` → `"document"` | `narrative-html` 14 + `dashboard-narrative` 20 | **34/34 green** |
| `sanitize-records.ts`, all SIX entity sites | `"rich"` → `"document"` | `sanitize-records` · `sanitize-raid` · `sanitize-change` · `rich-text-plain` · `note-log` | **151/151 green** |
| `doc-render-html.ts` `renderBlock` | `"render"` → `"document"` | `doc-render-html` 26 | **3 red** |

★★ The third row is the POSITIVE CONTROL and it is why the first two greens are a real survival
rather than a mis-run — same session, same harness, same command shape. Run it whenever you re-check
this entry; a suite that starts reporting green for the `doc-render-html` swap means the measurement
is broken, not that the defect closed.

★★ **The mutants are NOT equivalent.** `rich` and `document` differ by `img`, which is enough to
change `isHtmlStart`'s answer for a value opening `<img …>`. So this is a missing test, not an
equivalent-mutant question — the distinction §131 records as the one a harness cannot make for you.

★ **Blast radius is bounded TODAY and unbounded in SHAPE.** The two lists differ by one tag, and no
entity field or dashboard narrative has any business carrying an `<img>`, so nothing observable is
wrong right now. What is not bounded is the arrangement: a fourth sink, or any future divergence
between `RICH_ALLOWED_TAGS` and `DOCUMENT_ALLOWED_TAGS`, lands here undetected. The six entity sites
are the ones that matter — those are the STORAGE classifiers, where a wrong answer escapes a whole
value permanently or passes one through raw.

### Closing it

★ Not a per-call-site test each (fifteen assertions nobody maintains). The cheap shapes, in order of
appeal: (1) make the sink a BRANDED value each sanitizer hands out, so a call site cannot spell one
it does not import; (2) one table-driven test per storage boundary that feeds a value distinguishing
the two lists (an `<img>`-leading string today) and asserts the answer — small, but it goes stale the
moment the lists converge again; (3) accept it and say so here. ★ Deliberately NOT fixed in the
branch that found it: it is the branch's own design being reviewed, and the right guard is a type
change touching every call site.

### What actually closed (2026-08-12) — a weaker version of option (1)

`html-start.ts` now exports four `as const` string constants — `RICH_SINK`, `DOCUMENT_SINK`,
`PROJECTION_SINK`, `RENDER_SINK` — and the STORAGE-critical call sites the entry's own blast-radius
paragraph singled out ("the six entity sites are the ones that matter") now import and pass them
instead of hand-writing the literal: `narrative-html.ts` (1 site), all six entity fields in
`sanitize-records.ts`, and `doc-render-html.ts`'s `renderBlock` (1 site) — **8 call sites across 4
files** (the fourth being `html-start.ts` itself, where the constants are defined). Each conversion is
pinned by a regression test asserting the ORIGINAL string-literal swap that used to leave the suite
green now goes red (`html-start.test.ts` `describe("branded sink constants (open-followups §143)")`,
`narrative-html.test.ts` and `sanitize-records.test.ts`, both `describe(...(open-followups §143))`).

★★ **This is option (1) in NAME only — read `html-start.ts`'s own docstring on the constants, which
is explicit that it is not the type change the entry asked for:** *"This does not make a WRONG sink
impossible — a caller can still import the wrong constant — but it removes the 'typo a string
literal' failure mode and makes the intended sink searchable."* `RichTextSink` is still the plain
union `"rich" | "document" | "projection" | "render"`, not an opaque/branded type, so nothing stops a
call site from writing `"render"` by hand instead of importing `RENDER_SINK` — and MOST still do:
`doc-render-docx.ts` and `doc-render-pptx.ts` (the two OOXML renderers — `doc-render-html.ts` was the
one HTML renderer converted, they were not), `ai-rich-text.ts` (all four model-write boundaries),
`note-log.ts`, `templates.ts`, and `use-resource-planner.ts`'s RAID mirror all still pass a raw
literal — unconverted BY DESIGN, matching the CHANGELOG's "highest-risk call sites" framing, not an
oversight. The real type-level guard (option (1) as originally scoped, or option (2)'s per-boundary
table test for the remaining sites) is still open.

### 2026-08-12 — ONE PAIR IS AN EQUIVALENT MUTANT AFTER ALL, and it is the pair nothing converted

★★★ **The ★★ "the mutants are NOT equivalent" claim above is true for the pairs it measured and
FALSE for one it never tried.** `document` ↔ `projection` is indistinguishable **by construction**,
so for that pair "equivalent mutant" is the ANSWER, not the open question §131 says a harness cannot
decide for you. The proof is three lines of the source, not a sample:

* `SINK_TAGS.projection` and `SINK_TAGS.document` are the **same array reference**
  (`DOCUMENT_ALLOWED_TAGS` — and that array is itself `[...RICH_ALLOWED_TAGS, "img"]`).
* `SINK_RE` derives each member as `htmlStartRe(SINK_TAGS[sink])`.
* `htmlStartRe` is a pure function of the array's contents, so the two regexes have identical
  `source` and identical flags.

Therefore **no input distinguishes them, for all inputs, permanently** — as long as the two keep
deriving from one list. Confirmed empirically alongside the construction argument: a probe over every
tag in the widest list plus the mid-string, unlisted-tag and non-markup shapes reports `0`
distinguishing inputs for that pair, against `<img>`-leading for `rich` ↔ `document` and mid-string
tags for anything ↔ `render`.

★★★ **Branded constants cannot help here, so this is not a "convert the rest" item.** Importing
`DOCUMENT_SINK` where `PROJECTION_SINK` belongs is exactly as swappable as the literal was, and
exactly as green. It is the one pair where option (1) and option (2) BOTH fail — (2)'s per-boundary
table test needs a distinguishing value, and none exists.

★★ **And that pair is 100% unconverted.** `rich-text-projection.ts` holds both `"projection"` sites
and `ai-rich-text.ts` holds both `"document"` sites; none of the four was touched. So the conversion
went to the pairs a fixture CAN catch and left untouched the only pair a fixture never can.

★★ **The enumeration above is INCOMPLETE — it names 9 of the 25 unconverted sites**, which is why
"several" is now "MOST". Missing entirely: the three edit modals (`change-edit-modal.tsx` 7 sites,
`raid-edit-modal.tsx` 5, `milestone-edit-modal.tsx` 2) and `rich-text-projection.ts` (2) — 16 sites,
the largest block of them. Those are display/upgrade boundaries rather than storage classifiers,
which is a fair reason to deprioritise them and not a reason to omit them from a list that reads as
exhaustive. Counts, and the command that produces them (run it — 8 + 25 = 33 must hold):

```bash
# still raw literals: 25
git grep -nE 'descriptionHtml\(|sanitizeRichText\(|isHtmlStart\(' -- 'src/app/*.ts' 'src/app/*.tsx' \
  | grep -v '\.test\.' | grep -E '"(rich|document|projection|render)"' | grep -vE ':[0-9]+: *\*' | grep -c .
# converted to constants: 8
git grep -nE 'RICH_SINK|DOCUMENT_SINK|PROJECTION_SINK|RENDER_SINK' -- 'src/app/*.ts' 'src/app/*.tsx' \
  | grep -v '\.test\.' | grep -vE 'export const|import ' | grep -c .
```

★ **What would actually close the undetectable pair**, in ascending cost: (a) a CONSTRUCTION test —
assert `SINK_TAGS.projection` is `SINK_TAGS.document` and that `htmlStartRe` yields the same `source`
for both, which pins the PREMISE rather than a behaviour and goes red the moment they diverge, at
which point a fixture becomes possible and should be written; or (b) containment — collapse the sink
literal to one line per boundary behind named functions, so confusing the two requires editing one
module rather than passing a different string at any of 33 sites. (a) is a handful of lines and is
the honest minimum: it converts an untestable pair into a tested premise. Neither is done.

### 2026-08-16 — the CONVERSION half is complete and (a) landed; the entry stays OPEN for the TYPE

`31f9928d` converted the remaining raw literals and added the construction test. **Re-derived on the
current tree with this entry's OWN two commands, not carried over from the commit message** — raw
literals **24 → 0**, constant uses **11 → 35**, so the `8 + 25 = 33` identity above is now `35 + 0`:

```bash
# still raw literals: 0
git grep -nE 'descriptionHtml\(|sanitizeRichText\(|isHtmlStart\(' -- 'src/app/*.ts' 'src/app/*.tsx' \
  | grep -v '\.test\.' | grep -E '"(rich|document|projection|render)"' | grep -vE ':[0-9]+: *\*' | grep -c .
# converted to constants: 35
git grep -nE 'RICH_SINK|DOCUMENT_SINK|PROJECTION_SINK|RENDER_SINK' -- 'src/app/*.ts' 'src/app/*.tsx' \
  | grep -v '\.test\.' | grep -vE 'export const|import ' | grep -c .
```

So the two things this entry named as outstanding are done: every call site the "★★ MOST still pass
a raw literal" paragraph enumerated now imports a constant — `doc-render-pptx.ts`,
`ai-rich-text.ts`, `note-log.ts`, `templates.ts`, `use-resource-planner.ts`, the three edit modals
and `rich-text-projection.ts`; and option (a)'s construction test for the `document`/`projection`
pair landed (`html-start.test.ts`, `describe("the document/projection sink pair is equivalent BY
CONSTRUCTION (§143)")`).

★★ **`doc-render-docx.ts` is the one name in that enumeration you will not find converted — it no
longer holds a sink call at all.** The DOCX render-sink call MOVED into `ooxml-docx-primitives.ts`
during §141(b), and a second one appeared in `download.ts` (the HTML/PDF rich-cell path). Verify by
NAME, never by the old file list: `grep -rn RENDER_SINK src/app --include=*.ts --include=*.tsx |
grep -v '\.test\.'`. This is the `docs:claims:check` drift class one directory up — an enumeration
of FILES rots on an extraction commit exactly the way a line number does, and the first draft of
this very paragraph asserted `doc-render-docx.ts` had been converted.

★★★ **NOT CLOSED, and the reason is the one this entry has stated since 2026-08-12: the conversion
is option (1) in NAME only.** `RichTextSink` is still the plain union — verify with
`grep -n 'export type RichTextSink' src/app/html-start.ts` → `DerivedSink | "render"` — so a bare
string literal still typechecks at every one of the 35 sites, and a NEW call site can hand-write one
or import the WRONG constant with nothing going red. Reaching 0 raw literals removed the typo
failure mode and made the intended sink searchable; it did not make a wrong sink impossible, which
is what the entry asked for. **Do not read `24 → 0` as closure** — it is the metric that is easy to
move, not the guard.

★ **Precisely what remains**, so the next reader does not re-derive the whole entry: make
`RichTextSink` opaque/branded so only the four exported constants inhabit it (option (1) as
originally scoped). Option (2)'s per-boundary table test is NOT an alternative for the whole entry —
it cannot address the `document`/`projection` pair at all, and (a) has already covered that pair's
premise.

---

## 144. The new rich-text toolbar is invisible to every gate in the repo — CLOSED 2026-08-12, a11y, measured

Opened 2026-08-11 with the toolbar that `unify-rich-text-s1` shipped. Fifteen controls per editor —
twelve `ToggleButton`s (`BLOCKS` + `MARKS`), Insert link, Remove link, and the heading menu trigger
(a `<select>` when this entry was opened; replaced by an icon-triggered `PopoverPanel` menu in a
same-day follow-up branch) — and **not one of them is reachable by any automated check in this repo.**

### Why the axe gate cannot see it

The gate runs 90 scans (17 views × 5 scheme combos, plus 5 Kanban variants). Every `<RichTextEditor`
mount is behind something a scan cannot open — but for FOUR different reasons, not one. ★★ A first
revision of this entry said "eleven of the twelve are inside a MODAL", which is wrong for three of
them and would send the next reader looking for a modal that does not exist:

- **Nine behind a modal or a floating window**, and nothing in `e2e/a11y.spec.ts` opens either:
  `change-edit-modal` ×3, `raid-edit-modal` ×2, `milestone-edit-modal`, `task-form-fields` (the
  floating `TaskFormModal`), and `note-log-panel` ×2. ★ That ×2 is the two EDITORS INSIDE
  `note-log-panel.tsx` — the composer and the entry editor — **not** two parents. The panel does also
  have two PARENTS (`notes-window.tsx`, and `task-form-fields` inside the task modal), but that is a
  different multiplicity and must not be multiplied into the nine: 3+2+1+1+2 = 9 mount SITES in
  source, which is the unit the `<RichTextEditor` grep below counts.
- **One behind a non-default Settings section.** `settings-view.tsx` renders
  `CommTemplatesSection` under `active === "commTemplates"`, and the scan lands on Settings' default
  section — so this one IS in a scanned VIEW and still never renders.
- **One in a view that is not scanned at all.** `meeting-report-panel.tsx` mounts inside
  `steering-committee-panel.tsx`, and `steering-committee` is a real nav view that `A11Y_VIEWS` does
  not list.
- **One inside collapsed content.** `dashboard-sections/dashboard-narrative.tsx` renders inside a
  `<details>` with **no `open` attribute**.

★★ Enumerate with the right shape or the count is wrong:
`grep -rn "<RichTextEditor" src/app --include=*.tsx | grep -v "\.test\."` returns **fifteen** lines,
three of which are `useRef<RichTextEditorHandle>` / `Ref<RichTextEditorHandle>` type arguments, not
JSX. Twelve are real mounts. The `<`-prefixed grep matching a TYPE argument is the same
count-inflation trap this file records elsewhere.

And no e2e spec touches a toolbar at all:
`grep -rn 'commTplBold\|rich-text\|Text style\|Highlight' e2e/` returns **nothing**.

★★★ Even a scan that DID reach one would be silent on the defect the toolbar's `role="group"` exists
to fix. Measured against the installed axe-core 4.12.1 and recorded in §126 and AGENTS.md's a11y
bullet: of its 105 rules, 69 carry one of the four tags the spec requests, and NOT ONE flags two
controls sharing an accessible name. So unit tests are not "the cheapest detector" here, they are the
ONLY one — in both layers, at every seed size.

★ What IS pinned, so this entry is not read as "untested": `rich-text-toolbar.test.tsx` holds the
multi-editor group-naming test and pins `queryByRole("toolbar")` as NULL, and
`rich-text-editor.test.tsx` now pins the `label` → toolbar wire that makes the group render at all
(mutation-proved: cutting `label={label}` turns exactly 1 test red, and left the file 33/33 green
before that test existed, with `change-edit-modal.test.tsx` 28/28 and `raid-edit-modal.test.tsx`
20/20 green too). What is unpinned is everything a rendered browser would show.

★★ **NOT A FLAKE — a shared-worktree artefact, recorded so nobody chases one.** The cold review of
this branch re-ran `rich-text-editor.test.tsx` and saw **1 red in 3**, which reads exactly like an
order- or timing-dependent test. It was not: a CONCURRENT agent was editing `rich-text-toolbar.tsx`
in the SAME working tree while the run was in flight, so the suite was reading a half-written module.
Re-run on a quiet tree by the controller afterwards: **five consecutive runs, 34/34 each**. ★ That
read "5/5 green" at first, which collides with the passed-of-total notation this same entry uses
three paragraphs up (`33/33`, `28/28`, `20/20`) and so announced a five-test file; it has 34. A run
COUNT and a test count are not interchangeable in a register that quotes both. ★ The lesson is review HYGIENE,
not test health — a vitest run is a read of the live filesystem, so a red from a shared tree is
evidence about the TREE, not about the code under review. Quiesce the tree (or take a worktree of
your own) before treating an intermittent red as a finding, and never file one as a flake without a
quiet-tree re-run.

### The tab-stop cost, recorded beside it

★★ Every one of the fifteen controls is its own tab stop, so a keyboard user crosses **15 tab stops
per editor** to reach the text. `change-edit-modal.tsx` mounts up to THREE editors, so that form
carries **up to 45** toolbar tab stops, with no bypass mechanism.

★★ **THAT COUNT IS MODE-DEPENDENT, and a flat "45" over-states it in simple mode.** Two of the three
editors sit behind modal field-visibility gates — `isVisible("description")` and `isVisible("impact")`
— and `modal-fields.ts` tiers `change`'s `impact` field as `advanced`, so the impact editor does NOT
render in SIMPLE mode and the form carries **30**. Only the resolution/rationale editor is ungated.
45 is the count at the DEFAULT tier and at `full` (`DEFAULT_TIER` in `field-visibility.ts` is
`advanced`, so 45 is what most users see). Measured rather than read off the tier table:
`visibleFields("change", applyTier("change", "simple"))` returns
`["title","type","status","description"]` — no `impact` — while the same call at `advanced` and
`full` includes it.

★★★ The refusal of `role="toolbar"` is CORRECT and must not be "fixed" by adding the role: the APG
toolbar pattern is a keyboard CONTRACT (one tab stop for the row, roving `tabindex`, Left/Right
moving focus between controls) and this row implements none of it. Declaring a role whose interaction
the widget does not honour tells an AT user to press arrow keys that do nothing — worse than
declaring none. `rich-text-toolbar.test.tsx` pins the absence so the role cannot arrive without the
behaviour. **The tab-stop count is the price of that correctness, not evidence against it.**

### Closing it

Two independent halves, neither taken: (a) give the row roving `tabindex` and THEN the role — which
changes what Tab does in every editor in the app, so it is its own slice with its own eye-verify; or
(b) seed a rich-text surface into the e2e a11y run so at least one toolbar is scanned, remembering
that a green scan still says nothing about duplicate names. ★ (b) is cheap and buys less than it
looks like it does; (a) is the real answer.

### (b) CLOSED 2026-08-12 — the cheap half only

`e2e/a11y.spec.ts` adds `"a11y: harbor-light — Open Points (Notes window rich-text toolbar)"`, which
seeds a task, DOM-clicks its notes badge on Open Points to open the floating notes window
(`notes-window.tsx`), and runs the same `wcag2a wcag2aa wcag21a wcag21aa` axe scan the 90-scan matrix
runs elsewhere — asserting zero critical/serious violations. The comment directly above the test cites
this entry by number and repeats, in place, the warning this entry itself carries: a green result
proves this ONE toolbar clears the structural rules, not that no duplicate accessible name exists —
axe cannot see that at any seed size (§55, §126, AGENTS.md's a11y bullet).

★ This closes exactly what (b) promised and nothing more: one of the toolbar's twelve real mounts
(§144's own count, from the corrected `<RichTextEditor` enumeration above) is now reachable by a gate;
the other eleven — the nine behind a modal/floating window, the one behind a non-default Settings
section, the one on the unscanned `steering-committee` view, and the one inside a closed `<details>` —
are exactly as unreachable as before. **(a), the roving-`tabindex` keyboard contract, is UNCHANGED and
is still the real answer** — this entry stays open for it.

### (a) CLOSED 2026-08-12 — the roving-tabindex keyboard contract

**What shipped, in commit order:** the pure engine `toolbar-roving.ts` `moveToolbarFocus(count, index,
key, modifiers)` (tsc-exhaustive over a `HandledKey` union, no `default:` arm); the roving
`activeIndex` state + `handleRowKeyDown` + `tabIndex` wiring on all fifteen controls in
`rich-text-toolbar.tsx`; THEN `role={named ? "toolbar" : undefined}` (was `"group"`). That order is the
whole point — the role change is a consequence of the behaviour existing, not the other way round.
**Tab stops: 15 → 1 per row.**

★★★ **A COLD REVIEW OF THE FINISHED, ALL-GATES-GREEN BRANCH REFUTED TWO OF ITS OWN CLAIMS.** Both had
been written into code comments AND into this entry as settled fact, and every gate passed over both.

(1) **"tsc-exhaustive" was FALSE, and it failed in the worst direction.** `HANDLED` was
`new Set<string>(...)`, declared independently of the `HandledKey` union, so adding `"PageDown"` to it
without a `case` compiled clean (measured: `TSC_EXIT=0`). `isHandledKey` then returns true for a key the
switch cannot match, the switch falls off its end returning **`undefined`** — not `null` — and the
caller's `if (next === null) return` does NOT catch it. Result: `preventDefault` fires, `activeIndex`
becomes `undefined`, every `activeIndex === N ? 0 : -1` yields `-1`, and **the entire row silently
leaves the tab order** with a green typecheck and a green suite. The union half of the claim was always
true (widening `HandledKey` without a `case` is TS2366); the half the comment actually named was not.
Fixed by typing the set `Set<HandledKey>` and casting only at the `.has` lookup — a `ReadonlySet<HandledKey>`
annotation alone does NOT compile, because `.has` then rejects a `string`. ★ No test can catch this
class: the suite's unhandled-key list is hardcoded and the property test draws only from the four
handled keys. The TYPE is the only detector, which is why it has to be a real one.

(2) **`TOOLBAR_CONTROL_COUNT` could drift from the DOM after all.** The runtime walks
`:scope > button` (direct children); the count test walked `container.querySelectorAll("button")`
(descendants). Wrapping one control in a bare `<span>` left the file **31/31 GREEN** while the widget
broke — 14 controls in the arrow order, "Insert link" unreachable by arrow, and `End` focusing "Remove
link" while "Insert link" held the tab stop. Focus and the tab stop on two different controls is the
exact thing that test claims to prevent. The test now reads the row through the runtime's own selector
and additionally asserts descendant-count === child-count. Re-measured after the fix: the same mutant
goes **0 red → 1 red**. ★ The durable rule: **a test that pins a runtime invariant must query the DOM
the way the runtime does.** A different selector is a different claim.

★★ **A THIRD defect was functional, not documentary: the tab stop moved on KEYDOWN ONLY.** The state
model was justified in-comment by "every control passes `preventFocusSteal`, so a click never focuses a
toolbar button". The heading trigger deliberately omits it — `rich-text-toolbar-button.tsx` says so, and
the slice's own tests filter that control out for that reason — so the premise was contradicted three
files over. Measured: Tab in, ArrowRight ×2 (tab stop → Italic), click the trigger twice to open and
close its menu; focus lands on the trigger while the tab stop stays on Italic, so the next Tab moves
**within** the row. Two tab stops, on a mixed mouse/keyboard path, i.e. this very item's defect
reopened. Fixed with the APG shape — a row-level `onFocus` that syncs `activeIndex` from the focused
control — which covers click, programmatic focus, and any future control that opts out, rather than
only the route the keydown handler knows. Pinned by "keeps one tab stop after a click focuses the
heading trigger", which carries a vacuity guard (it asserts the click actually focused the trigger
first) and turns **1 red** when the `onFocus` wiring is deleted.

★ **NOT fixed here, deliberately:** Escape inside the heading menu drops focus to `document.body`
rather than returning it to the trigger, leaving the row arrow-dead. It is PRE-EXISTING (`PopoverPanel`
has never restored focus) and the tempting one-liner — focus the trigger from `closeHeadingMenu` — is
WRONG: that callback carries no reason and fires for Escape, outside-click AND resize alike, so it
would steal focus on an outside click. A correct fix needs a reason on `PopoverPanel.onClose`, which is
a shared primitive with many consumers and does not belong in an a11y slice for one row. Recorded as
its own item rather than half-fixed.

**Mutation counts, exactly as measured (not "mutation-proved" — the numbers):**
- Portal guard (`if (current === -1) return;` inside `handleRowKeyDown`) — **1 red**, scoped to the
  single heading-menu-open test (`"does not rove while the heading menu is open"`) to isolate it from
  unrelated noise from the pending role flip at the time it was run. A vacuity check ran first:
  `document.activeElement` was asserted to equal the focused menu item BEFORE the `ArrowRight` press,
  confirming focus had genuinely reached the portaled menu — so the 1-red result could not have been a
  false negative from a test that never exercised the guard.
- `tabIndex` ternary on the `CONTROLS.map` control (mutated to a bare `tabIndex={0}`) — **3 red**
  (`"puts every control but the active one out of the tab order"`,
  `"is a single tab stop: a second Tab leaves the row entirely"`,
  `"keeps two mounted rows roving independently"`). Both mutations were restored before committing;
  `git diff --stat` confirmed no stray leftovers.

**Blast radius of the `group` → `toolbar` role flip, the real shape (not predicted, discovered by
RUNNING the suite): 6 `getByRole`/`queryByRole("group", …)` assertions across 4 tests in 3 files.**
The four are: `rich-text-toolbar.test.tsx` `"names the row after the editor it acts on"` (1) and
`"keeps two mounted rows apart — each control resolves inside its own group"` (2);
`rich-text-editor.test.tsx` `"names the toolbar group from the editor's own label prop"` (1); and
`note-log-panel.test.tsx` `"keeps two mounted panels apart — the editors carry the suffix, not just
the mics"` (2 in one test). NONE was named in the original dispatch plan; all four were found by
running the file.
★★★ **8 `("group")` ASSERTIONS EXISTED AT BASE AND ONLY 6 BROKE — the gap is the lesson, not a
rounding error.** The other two (`"renders no group at all when there is no name for it"`,
`"treats a blank label as no name, not as an empty one"`) assert `queryByRole("group")` is NULL, and
an UNNAMED row renders no role under either regime, so they passed unchanged through the flip and
still sit at HEAD. So the two obvious methods disagree in opposite directions: enumerating test
TITLES from memory undercounts (it produced 4, and 2 of those carried none of the 6), while grepping
the retiring role string overcounts (it produces 8). Grep is still the right tool — it is the only
one that cannot silently miss a call site — but its hits need triage: an assertion that the role is
ABSENT is role-agnostic and survives a rename.
★★ An earlier revision of this paragraph credited two of the four to the ORIGINAL dispatch plan
("the pinned-null test, the two-row roving test"). Both were false: the pinned-null test asserted
`queryByRole("toolbar")`, never `("group")`, and the two-row roving test DID NOT EXIST at base — this
slice added it. A cold reviewer then "verified the figure exactly right" while quoting a command
(`grep 'byRole("group"'`) that CANNOT match `getByRole("group"` — lowercase `b` against a capital
`B` — so the confirmation was luck, not measurement, and it confirmed a headline that was right for
reasons neither of us had checked. Reproduce with the correct case:
`git show <base>:src/app/<f>.test.tsx | grep -c 'ByRole("group"'`

**Browser-level proof:** `e2e/rich-text-toolbar-keyboard.spec.ts` reuses (b)'s reachable mount (the
floating notes window off Open Points' notes badge) to drive a REAL browser: focuses the heading
trigger, asserts `ArrowRight` moves focus to Bold without changing `.ProseMirror`'s content, and
asserts one `Tab` leaves the tagged toolbar row entirely. Passed on the first run.

## 145. Two icon packages now coexist, and the migration decision behind it lives nowhere durable — open, a decision, measured

Opened 2026-08-11 with the icon-only rich-text toolbar (`0.233.0 "Reed"`). `rich-text-toolbar.tsx`
imports `lucide-react` for its icon set (Tiptap's own reference toolbar
[uses it](https://template.tiptap.dev/preview/templates/simple), and it ships filled/outline pairs
heroicons does not); every other icon in the app still comes from `@heroicons/react`. Measured, not
assumed: `grep -rln "lucide-react" src/app --include="*.tsx" --include="*.ts"` returns exactly
**one** file, `rich-text-toolbar.tsx`; `grep -rln "@heroicons/react" src/app` returns **75**. Both
packages sit in `package.json` `dependencies` side by side.

★ The decision to scope it to one file rather than replace heroicons app-wide was made deliberately
during brainstorming for this slice, and the reasoning — a full app-wide icon migration is its own
project, out of scope here — is recorded ONLY in
`docs/superpowers/specs/2026-08-11-rich-text-toolbar-icons-design.md`. That tree is gitignored
(`spec-location-superpowers-default`), so the decision and its rationale are invisible to anyone who
doesn't have this local checkout — not in `AGENTS.md`, not in `docs/CODEMAPS/dependencies.md`, not
here until this entry. `docs:symbols:check`/`docs:claims:check` cannot flag the gap either: there is
no broken citation to catch, just a decision that was never written into a tracked file.

★★ Nothing is BROKEN by the coexistence — the two packages don't conflict, and this toolbar's icons
render correctly. The risk is a slow one: the next person adding an icon anywhere in the app now has
two equally-real precedents to copy, and nothing in a tracked doc says which one is the default for
new code (heroicons, by volume and by not being the one carrying a "verify against 1.31.0's real
barrel exports" caveat in its own spec).

### Closing it

Either (a) write the scope decision into `docs/CODEMAPS/dependencies.md` (or a `tech-debt-register.md`
row) so it survives outside this one contributor's local `docs/superpowers/` tree, stating plainly
that heroicons remains the default for new code and lucide-react is scoped to
`rich-text-toolbar.tsx` until a dedicated migration slice says otherwise; or (b) actually run the
app-wide migration as its own brainstormed project, which retires the question rather than
documenting it. Neither has been done — this entry is (a) done partially, by existing at all.

## 146. `PopoverPanel` never restores focus on dismiss, so Escape from a menu drops the user at `document.body` — open, a11y, measured

Found by a cold review of the §144(a) branch, deliberately NOT fixed there. PRE-EXISTING and app-wide:
`PopoverPanel` has never returned focus to its trigger, and the §144(a) diff does not change that.

Measured on the rich-text toolbar's heading menu, primary keyboard path:

```
Tab -> "Text style"   Enter -> focus on "Normal text" (menu item)   Escape ->
  document.activeElement = BODY, inside row? false
  ArrowRight -> still BODY (the row's portal guard correctly refuses to act)
```

So a keyboard user who opens a style menu and changes their mind is dumped to the top of the
document, and the toolbar they were in goes arrow-dead. WCAG 2.4.3 (focus order) at minimum.

★★★ **THE OBVIOUS ONE-LINE FIX IS WRONG, which is why this is an entry and not a commit.** Focusing
the trigger from the caller's `closeHeadingMenu` looks right and is not: `PopoverPanel.onClose` takes
NO reason and is invoked identically for Escape, for an outside click, and for a window resize
(`popover-panel.tsx` — the dismiss hook, the outside-click listener, and the resize listener all call
the same bare callback). Restoring focus unconditionally would therefore YANK FOCUS BACK TO THE
TRIGGER when the user clicks somewhere else entirely — a worse bug than the one being fixed, and one
that would land on every consumer of the primitive at once.

### Closing it

Give `onClose` a reason (`"escape" | "outside" | "resize"`) and restore focus on `"escape"` only —
the APG rule, and the only variant that distinguishes intent. That is a change to a SHARED primitive
with many call sites, so it wants its own slice with a sweep of every consumer, not a rider on a
single row's a11y work. ★ Until then, do not add a focus-restore to any individual consumer: one
consumer restoring focus while its siblings do not is a worse inconsistency than the uniform gap.

---

## 147. Read-only task-item checked state is a character name to AT, not "checked" — open, a11y, known limit

Opened 2026-08-13 out of §140's closure. `TaskItem.renderHTML` (`rich-text-editor.tsx`) stores task
items as `<li data-type="taskItem" data-checked="…">` with no `<input>` — the editor's Tiptap nodeView
supplies the real, labelled checkbox, and every READ-ONLY surface (`RichTextView`, standalone
HTML/PDF) renders the state as a `::before` glyph (`globals.css` / `doc-render-html.ts`
`DOCUMENT_PAGE_STYLES`): ☐ / ☑ (`\2610` / `\2611`), driven by `[data-checked="true"]`.

★★ **This was the RIGHT trade for the alternative it avoided.** Storing the stock markup
(`<input type=checkbox>` with an empty sibling `<span>`) would have shipped an axe-CRITICAL unlabeled
form control in Documents, an `A11Y_VIEWS` member. A generated `::before` glyph has no accessible-name
problem because it is not a form control at all — `content` on a pseudo-element is exposed to the
accessibility tree as a CHARACTER, not as a semantic state.

★ **The limit, stated precisely.** A screen-reader user hears the glyph's Unicode NAME (something
like "ballot box" / "ballot box with check", browser-dependent) rather than "checked" / "not checked".
That is strictly better than an unlabeled `<input>` (which announces nothing at all, or announces
"checkbox" with no name), but it is not equivalent to a real checkbox's `aria-checked` announcement.

★ **Candidate fix, not adopted:** CSS Generated Content's `content: "☑" / "checked"` alt-text syntax
(a string literal after the glyph, announced instead of the glyph's own name) is the closest match —
but browser support is uneven (`content` alt-text is a relatively recent addition to the spec and
support varies across the engines this app targets), so adopting it needs a compatibility check this
entry does not do.

★★★ **NO GATE CAN SEE THIS.** axe-core has no rule that inspects generated pseudo-element content for
semantic meaning, and the app's own axe scan of Documents renders whatever the e2e seed contains — no
task list is seeded, so a green Documents scan says nothing about this either way (same class as the
`A11Y_VIEWS` seeding gap AGENTS.md already records). The only way to know this is stated behaviour is
to read this entry or the code comment beside the CSS rule.

## 148. `retryLoad`'s reload branch clobbers a concurrently-minted chat thread — open, correctness, measured

Opened 2026-08-14 out of the chat-thread-persistence branch's fourth review round. It is the SAME
defect that round fixed in the mount-fetch effect, one function down, left unfixed deliberately to
keep a review-round diff reviewable.

`use-chat-threads.ts` `retryLoad` has two branches. When `pendingRetryRef` is non-empty it replays the
failed WRITES and returns — that half is fine. When the map is empty (i.e. the initial FETCH is what
failed, so there is no payload to replay) it re-runs `loadThreads` and then assigns the result
unconditionally:

```
.then((loaded) => { setThreads(loaded); const next = loaded[0] ?? null;
                    setActiveThreadId(next?.id ?? null); setHistory(…); setDisplay(…); })
.catch(() => { setThreads([]); setActiveThreadId(null); setHistory([]); setDisplay([]); })
```

The mount-fetch effect now captures `const startedOn = threadIdRef.current;` before its own
`loadThreads` and MERGES (`.then`) or skips the reset (`.catch`) when the ref moved while the request
was in flight. `retryLoad` does neither. So a send started between the Retry click and the response
mints a thread via `ensureThreadForSend`, that row IS written to Turso, and then the resolving reload
drops it from `threads`, clobbers `activeThreadId`, wipes history/display, and — because the
`threadIdRef` sync effect sees the id change — aborts the in-flight send. The user's message vanishes
from the UI while existing server-side. The `.catch` path is the more destructive of the two, exactly
as in the fixed effect.

★★ **Narrower reachability than the fixed one, which is why it was deferred rather than shipped.** It
needs the INITIAL fetch to have failed (otherwise `pendingRetryRef` is non-empty and the first branch
returns before reaching here), AND a send to start between the click and the resolve. The mount-fetch
case had no such precondition — `chat-panel.tsx`'s `chatSeed` effect auto-sends from a MOUNT effect,
so "Analyze with AI" raced it every time.

### Closing it

Hoist the guard rather than copying it: both call sites want "if the active thread changed while my
request was in flight, do not overwrite it". A shared helper taking `startedOn` and returning
merge-or-replace would make the two impossible to drift apart. ★ Do NOT close this by making
`retryLoad` reuse the effect's body wholesale — the effect also clears `pendingRetryRef`/`latestSeqRef`
on project switch, which `retryLoad` must not do.

★ A test for this needs the failed-initial-fetch precondition set up explicitly; a fixture whose
`pendingRetryRef` is non-empty never reaches the branch and passes whichever way it is written.

## 149. Date-dependent unit tests detonate on a calendar rollover, with no code change behind them

**Status:** two instances FIXED (`rebaseline-popover.test.tsx`, 0.240.0). The CLASS is open — nothing
sweeps for the rest, and the only detector is a red pipeline on the morning it happens.

`rebaseline-popover.test.tsx` asserted the literal `"2026-08-15"` against a fixture task whose
`dueDate` was that same date. `milestoneRebaselineDate` FLOORS its result at today
(`forecast > today ? forecast : today`), so the assertion held only while the fixture date was still
in the future. At midnight on 2026-08-16 both tests went red on `main` and on every open branch at
once. The engine is pure and takes `today` as a parameter — it was never wrong. **The test was.**

★★ **It had ALSO stopped testing what it claimed before it went red.** Its own comment reads
`// forecast from linked task`, but once the fixture date reached today the function took the
today-floor branch instead — the assertion still passed, against the wrong branch, for as long as
the two dates coincided. So the failure was the SECOND symptom; the first was silent.

★★★ **A red pipeline here names a file the branch never touched, which reads as a merge defect.**
It cost a release cycle on 0.240.0: the branch was byte-identical to main at that file
(`git diff --quiet origin/main HEAD -- <file>` → 0) and every other gate was green, including e2e
and prod-smoke. Check that diff FIRST before investigating your own changes.

### The fix that was applied

`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime` in `beforeEach`, `vi.useRealTimers()`
in `afterEach`, frozen well before the fixture date so the FORECAST branch stays live.
★ `toFake: ["Date"]` deliberately, not full fake timers: faking every timer puts RTL and the React
scheduler on a stopped clock, which these tests have no need for. (`api/jira/_rate-limit.test.ts`
uses full fake timers because it genuinely drives a sliding window — different requirement.)
★ Mutation-proved: moving the frozen date PAST the fixture turns the same 2 tests red
(`expected '2026-09-01' to be '2026-08-15'`), so the freeze is load-bearing rather than decorative.

### Closing it

A sweep for the rest of the class. There is no cheap grep for it — a hardcoded date is only a bomb
when some code path compares it against the real clock, which no pattern can see. The tractable
shape is the inverse: find tests that reach the real clock at all (a component calling `new Date()`
internally, like `rebaseline-popover.tsx`'s `TODAY_ISO`), and freeze the clock in each. ★ Running
the suite under a faked future date would enumerate them in one pass, but vitest fakes the clock
per-test-file, so this needs a harness-level option rather than a one-off command.

## 150. A balanced pair of stray quotes mislabels rows across a CSV section boundary — open, UNDECIDABLE, measured

Opened 2026-08-16 out of the cold review of the branch that closes §105.

★★★ **THIS IS A SEVERITY REGRESSION OF §105's FIX, NOT A NEW FAILURE.** The same file lost the same
rows before the branch. What changed is that silent LOSS became silent MISLABELLING — rows enter the
workspace as the wrong entity type. Do not read it as damage the branch introduced from nothing.

**Where:** `splitCsvSections` (`csv-codecs-decode.ts`) now segments the document with the quote-aware
`splitCsvLines` (`csv-line-scan.ts`). Quote state therefore carries across the WHOLE file, where the
physical `csv.split(/\r?\n/)` it replaced reset it at every line. The branch already handles the
UNBALANCED case by falling back to that physical split for routing — an unbalanced quote is proof the
file is malformed, and one stray `"` in an early section would otherwise swallow every later marker.
**A BALANCED pair of stray quotes is not covered and cannot be.**

★ **Reachability: a hand-edited, truncated or foreign file only.** `csvEscape` wraps any cell
containing a `"` and doubles every quote inside it, so a file our own encoder wrote can never carry a
stray one. This is the same reachability envelope the `unterminatedQuote` doc comment already states
for its own signal.

### Measured

Fixture built by encoding a one-task / three-milestone workspace with `workspaceToCsv`, then
TEXTUALLY replacing two plain cell values — `blockers` on the task and `description` on milestone 5 —
to model a hand edit. Tasks header elided here (28 columns); the milestones section is verbatim:

```
# TASKS
id,taskName,…,blockers,…,noteLog
1,T1,,,,2026-01-01,,,Medium,To Do,a"b,,,,,,,,,,,,,,,,,

# MILESTONES
id,name,date,description,achievedDate,linkedTaskIds,localModifiedAt,knowledgeLinks,outlookEventId
5,M5,2026-02-01,c"d,,,,,
6,M6,2026-03-01,,,,,,
7,M7,2026-04-01,,,,,,
```

The `"` in `a"b` opens a quote; the `"` in `c"d` closes it. Everything between — including the
`# MILESTONES` marker line and the milestones header — is swallowed into one cell.

```
AFTER  (this branch)      task ids [1, 6, 7]   taskName ["T1","M6","M7"]   milestones []
                          diag {"droppedRows":0,"unterminatedQuote":false}
BEFORE (physical split)   task ids [1]         taskName ["T1"]             milestones [5]
                          diag {"droppedRows":0,"unterminatedQuote":true}
```

★★ **The BEFORE half was measured through the branch's OWN fallback, not from an old checkout.** The
pre-branch routing IS `csv.split(/\r?\n/)`, so appending a third stray quote (`JUNK,"UNCLOSED`) after
the last section flips `unterminatedQuote` and takes that branch, leaving the physical routing of the
tasks and milestones text byte-identical.

★★★ **SO THE BEFORE ROW'S `unterminatedQuote: true` IS AN ARTEFACT OF THE MEASUREMENT, NOT A
PRE-BRANCH SIGNAL — and it could not have been anything else.** That flag is what SELECTS the
physical-split branch, so any run reaching the BEFORE routing has it set by construction. An earlier
revision of this entry printed one `diag, BOTH {"droppedRows":0,"unterminatedQuote":false}` line, which
contradicted this very paragraph and sent anyone re-running the recipe looking for the error in the
wrong half. The conclusion is unchanged: `unterminatedQuote` **did not exist before the branch**, so
the genuine pre-fix diagnostic was `droppedRows` alone — 0 on both sides. Both states are fully
silent; the fix neither added nor removed a signal here.

★ Put the junk somewhere that neither counts nor is measured. Measured, all three shapes: a bare
`JUNK,"UNCLOSED` line → `droppedRows` 0; a `# STAKEHOLDERS` marker followed by that one junk line →
also **0**, because the lone line is consumed as the section HEADER; the marker + a real header row +
the junk row → **1**, the junk row having gone through `decodeCsvSection`. Only the third shape moves
the counter, and it would have been read as a pre-branch diagnostic that does not exist. The bare line
is what the numbers above were taken with.

### Why no fix is proposed

**It is undecidable at the byte level.** A legitimately quoted cell containing marker-shaped text and
a stray quote that swallowed a real marker are BYTE-IDENTICAL. There is nothing for a parser to
condition on.

★★★ **DO NOT close this with a "the two splits disagree" warning.** A well-formed file legitimately
carrying a marker-shaped line inside a quoted cell — precisely the §105 shape this branch exists to
fix — produces exactly that divergence. The warning would therefore fire on the file we just fixed,
on every correct import, which is worse than the silence it replaces.

★★ **And do not reach for a heuristic** ("a marker line inside a quote is suspicious", "a section
that came back empty while a neighbour grew"). §105 already recorded two detectors designed and
discarded for this family — reject-counting and rows-found-vs-entities-produced — both structurally
blind because the rows are ABSORBED rather than rejected. A heuristic here does not merely fail to
detect; it mis-detects the legitimate case, and there is no input that separates the two.

★ The honest options are all outside the parser: refuse to import a CSV whose quotes are stray by
some external check, or accept the class. Neither is scoped here.

### The autosave interaction

Nothing stops the mislabelled workspace being written back over its source. `mayCommitAfterTruncation`
gates on `loadWasTruncated` only, so import diagnostics never block a save — and here there is no
diagnostic to block on: `reportImportDiagnostics` fires on `droppedRows` or `unterminatedQuote`, and
both are falsy. The milestone rows are gone from `milestones` and present as tasks by the time the
first ordinary save runs.

★ Read with §105 (the mid-row section switch this branch closes) — this is the residue of that fix,
not an independent defect.

## 151. "The sample generator runs under bare node" is FALSE, retracted in four source headers, and still asserted as a live rationale in eight places — open, needs a probe

Opened 2026-08-16, out of the same cold review as §150. **No fix is applied here and none should be
applied casually** — this entry exists to stop a FIFTH retraction being derived from scratch.

**The claim.** A DOM-free rule on a module is justified by "a DOMPurify call here would throw, because
`scripts/generate-sample-workspace.ts` runs this under bare node, and `jsonToWorkspace`'s catch-all
would swallow the throw into a near-empty sample file."

**The claim is false about the generator.** `generate-sample-workspace.ts` constructs a `JSDOM` and
`Object.assign`s `window`/`document` onto `globalThis` BEFORE its dynamic
`await import("../src/app/storage")` — its own comment says the install exists so the DOM-bound
sanitizers downstream work. It is also the only script that imports `src/app` at all; the other
`scripts/*.mjs` files merely NAME the path inside comments and doc-gate fixtures.

### Measured

```
$ grep -rln "src/app" scripts/
scripts/check-followup-claims.mjs      <- comment text only
scripts/doc-claims-lib.mjs             <- comment text only
scripts/doc-claims-lib.test.mjs        <- comment text only
scripts/followup-claims-lib.mjs        <- comment text only
scripts/followup-claims-lib.test.mjs   <- comment text only
scripts/generate-sample-workspace.ts   <- the only real importer; installs JSDOM first
```

Posture of every site, classified BY READING it — the sweep below only produces candidates:

| Where | Posture |
|---|---|
| `csv-line-scan.ts` | RETRACTS (added 2026-08-16, this branch) |
| `document-model.ts` | RETRACTS |
| `document-versions.ts` | RETRACTS, and cites the other two |
| `document-rich-fields.ts` | RETRACTS ("obsolete") — ★★ and does NOT contain the phrase, see below |
| §97 (this file) | RETRACTS, scoped to the DOCUMENT load paths only |
| AGENTS.md, four separate bullets | ASSERTS |
| §28 (this file) | ASSERTS — "out of scope by construction" |
| §36(a) (this file) | ASSERTS — the stated REASON the boundary cannot be added |
| §49 (this file) | ASSERTS — "the obvious fix is forbidden" |

Candidate sweep, flattening whitespace first — the phrase WRAPS ACROSS LINES in several headers, so a
plain `grep "bare node"` under-reports, and it is hyphenated in one place:

`node -e 'const fs=require("node:fs");for(const f of process.argv.slice(1))if(/bare[- ]?node/i.test(fs.readFileSync(f,"utf8").replace(/\s+/g," ")))console.log(f)' AGENTS.md docs/open-followups.md src/app/*.ts`

★★★ **RUN IT, THEN READ EVERY HIT — AND DO NOT TREAT ITS OUTPUT AS THE POPULATION IN EITHER
DIRECTION.** Verified 2026-08-16: it returns 22 paths, of which most mention bare node for unrelated
reasons, and it **MISSES `document-rich-fields.ts` ENTIRELY** — that header retracts the identical
rationale phrased as "a DOMPurify call would throw for want of a DOM", never using the words. So the
phrase is not the concept, a phrase sweep cannot enumerate this cluster, and the table above was built
by reading rather than by grepping. This is the same trap recorded against the register elsewhere: a
`grep -c` returning fewer hits than expected is not evidence of absence.

### Why this is NOT "go delete the rule"

★★★ **A RULE WITH A FALSE RATIONALE CAN STILL BE A CORRECT RULE, AND DELETING A LIVE GUARD BECAUSE
ITS STATED REASON IS WRONG IS HOW GUARDS DIE.** Each asserting site needs its OWN probe before
anything moves, because the sites do not share a mechanism:

- `csv-line-scan.ts` already re-grounded itself on a different argument entirely (it is the shared
  zero-import LEAF beneath both CSV scanners, so any dependency is inherited by every decode path).
  Its DOM-free rule survives the retraction untouched.
- `document-rich-fields.ts` states the opposite conclusion for its own case — that composing the
  DOM-bound pass at the caller is "a normal change, not a contract violation".
- §36(a) and §49 are the ones with real stakes: in both, the false claim is the reason an allow-list
  pass is NOT applied to a model-writable field. If the rationale is dead there too, those are live
  security gaps rather than accepted ones. **Neither has been probed.** The fixture flow is a second
  consumer named alongside the generator in §28 and has not been checked at all.

★★ Note the asymmetry that makes this expensive: the four retractions sit in SOURCE headers a reader
opens only once they already know to look, while the eight assertions sit in AGENTS.md — the
always-loaded file — and in the register, which is what someone reads while PLANNING. The false
version is on the path of least resistance in both directions.

★ Deliberately NOT done here: this branch owns a CSV fix, and rewriting a sanitizer rationale in
AGENTS.md on the back of it would be an unrelated change to the one always-loaded file. §97 already
demonstrates the shape a scoped, measured retraction takes — copy that, per site, with a probe.

## 152. `onOpenStorageFile` applies tasks + RAID from a malformed CSV and reports no import loss — open, the two signals need splitting

Found by the cold review of the branch closing §105, 2026-08-16. **Not introduced by that branch** —
it is the residue of the fix that took `lastImportDroppedRows` from one reporting call site to five.

`TruncationOps.reportFor` (`use-load-truncation.ts`) carries **two independent signals on one call**:
the §103 documents-truncation flag, and the CSV/Markdown import diagnostics (`lastImportDroppedRows`,
`lastImportUnterminatedQuote`). Bundling them is what stopped the import signal drifting away from the
load paths. But it also means a path that must NOT touch the truncation flag cannot report an import
loss either.

★★★ **DO NOT RELY ON THE `reportFor`-PER-`load()` CENSUS TO CATCH A NEW PATH — IT CANNOT SEE THE FILE
THIS ENTRY IS ABOUT.** The census (`use-load-truncation.test.ts`) source-scans a hardcoded `OPS_FILES`
list holding `use-storage-file-ops.ts` and `use-storage-turso-ops.ts` ONLY, so `use-storage-backend.ts`
— which holds THREE of the six load sites, including `onOpenStorageFile` — is never read, and it sits
at 3 loads / 2 reports green today. Reproduce both halves:

```
grep -n "OPS_FILES *=" src/app/use-load-truncation.test.ts
for f in src/app/use-storage-backend.ts src/app/use-storage-file-ops.ts src/app/use-storage-turso-ops.ts; do
  echo "$f loads=$(grep -o '\.load()' $f | wc -l) reports=$(grep -o 'reportFor(' $f | wc -l)"; done
```

★★ It is also a TOKEN count, not a reachability proof, so it says nothing about whether a `reportFor`
present in the source is reached at runtime. What actually pins the five reporting paths is
behavioural: `24687cd7` "test(storage): pin import-diagnostic reachability on all five reportFor
paths", whose mutation result `use-storage-backend.test.tsx` records beside the same warning about
this census. An earlier revision of THIS entry credited the census with the protection — a claim the
branch's own test comment already refuted, one file away.

`onOpenStorageFile` (`use-storage-backend.ts`) is that path, and the only one of the six load sites
that APPLY a workspace to render scope with no `reportFor`. Enumerate the SITES — a `reportFor` grep
structurally cannot, since the path in question is the one that does not appear in it:

```
grep -rnE "await (backend|target|targetBackend)\.load\(\)" src/app --include=*.ts | grep -v "\.test\."
grep -rn "reportFor(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

★★ **A BARE `grep "\.load()"` IS THE WRONG COMMAND AND AN EARLIER REVISION HERE SHIPPED IT** — it
returns **15**, because `store.load()`, the action-learning store and several comments all match, and
it was quoted under a sentence claiming seven. Anchoring on `await` and on the three receiver names
returns exactly the 7 real call sites with no comment noise. Re-run it rather than trusting the number.

★ The second returns **6** lines and they are NOT the six paths — one is a comment in
`local-file-backend.ts` quoting that very command, so it is 5 reporting call sites plus a self-match.
A grep matching its own documentation is a recurring trap in this repo; read the hits, do not count
them.

★★ THE FIRST RETURNS **7**, and the extra one is correctly out of scope: `use-portfolio-health.ts`
loads other projects' workspaces to compute portfolio health and never applies one to render scope,
which is exactly the qualifier `TruncationOps.reportFor`'s own docstring uses ("every `backend.load()`
whose workspace is APPLIED to render scope"). Six is the count of APPLYING sites, not of `.load()`
calls.

★★★ **§103 SAYS "TWO LOADS DELIBERATELY DO NOT REPORT" AND IS NOT IN CONFLICT WITH THE "ONE OF SIX"
HERE — the two entries count different things, and a reader who spots the mismatch without this note
concludes one of them is wrong.** §152 counts load SITES; §103 counts non-reporting EXITS. The mount
effect's empty-load REFUSAL branch returns before the `reportFor` further down the same site, so that
one site has both a reporting and a non-reporting exit.

★★ That refusal is therefore a SECOND place import diagnostics are suppressed, and this entry did not
mention it. It matters on its own terms: a file malformed enough that every row is dropped decodes to
an EMPTY workspace, the refusal fires to protect the live project, the user is told "kept current
data", and nothing anywhere says rows were dropped. Whoever splits the signals should decide that case
deliberately rather than inherit it.

**Its stated reason is correct, and correct only for truncation.** The handler applies `loaded.tasks`
and `loaded.raid` and nothing else — absences and shifts are deliberately not restored, and documents
never are — so raising the flag would warn about documents the user still holds, and lowering it would
clear a warning that is still true of the live ones. Neither describes the workspace that is live.
★★★ That argument does **not** carry over to import diagnostics, and reading the suppression as
justified for both is the trap: the rows this path drops MAY INCLUDE the tasks and RAID it is about to
apply. ★ "May include", not "are precisely" — the counter is bumped for every section, so a drop
confined to milestones raises it too, and this path discards milestones. That is weaker than the
overclaim an earlier revision made here and is still more than enough to defeat a truncation-only
justification.

**Measured — FIVE increment sites, not three, and the two that are easiest to miss are the Markdown
ones.** `droppedRows` is bumped into **one workspace-wide counter with no section attribution**:

```
grep -rn "droppedRows[+][+]" src/app --include=*.ts | grep -v "\.test\."
```

→ `csv-codecs-decode.ts` ×3, `markdown-codecs-core.ts` ×1, `markdown-codecs-decode.ts` ×1. All five sit
in row loops, though only `csvToTasks` is per-ENTITY — the other two CSV sites are generic collectors
shared across entities, and both Markdown sites iterate rows of whatever table they were handed.

★★★ **A CSV-ONLY GREP IS THE TRAP, AND THIS ENTRY FELL INTO IT.** The first revision cited
`grep -c "diag.droppedRows++" src/app/csv-codecs-decode.ts` → 3 under a sentence saying "the decoders",
and the command was honest about its own scope while the sentence was not. `onOpenStorageFile` reaches
Markdown as readily as CSV (`local-file-backend.ts` branches
`this.format === "csv" ? csvToWorkspace(text, diag) : markdownToWorkspace(text, diag)`), and the repo
already warns about this scope split in two places — `local-file-backend.ts` and `workspace.ts` both
carry a "CSV ONLY, despite `lastImportDroppedRows` above covering CSV *and* MD" note about the sibling
`lastImportUnterminatedQuote` field. Undercounting here understates the per-section-attribution work
below and would ship Markdown unattributed.

So a malformed CSV **or Markdown** file opened through this handler can silently lose task or RAID rows
with nothing shown at all — `reportImportDiagnostics` is the sole reader of both import fields and its
only output is a toast, so a suppressed call leaves no banner and no `logDiag` trail either.

### The fix, and the part of it that is not a fix

Split the two signals: report the import loss without touching the §103 documents flag. That is small
and mechanical.

★★ **It does not close the whole finding.** Because the counter is workspace-wide, even a split report
says "N rows were dropped" without saying whether those rows were the tasks/RAID this path APPLIES or
a section it DISCARDS — and the two are different losses with different remedies. Per-section
attribution is a separate, larger change to `ImportDiag` and **all five** decoder sites that write it,
across BOTH codec families. Do not record §152 as closed on the strength of the split alone.

★★★ **Whoever does it must fire `storageOpenedToast` BEFORE the report, never after.** The toast
surface is single-slot (`useToast` holds a `useState<Toast | null>`; `showToast` REPLACES it, with no
queue and no stacking — it clears the pause ref and calls `setToast(...)`), so of two calls in one
stretch only the LAST is seen. Putting a diagnostic in front
of a confirmation is exactly the defect the §105 branch's own fix round shipped and had to undo — the
warning was raised, overwritten, and lost, with the suite green because the test asserted `showToast`
had been CALLED rather than reading the surviving toast. Assert on the LAST call.

★ `use-storage-backend.ts` stands at **799** lines against the hard 800 cap (it is not in
`docs/baselines/file-sizes.json`, so the cap applies rather than a baseline, and `size:check` counts
`wc -l` plus one). That is one line of headroom — which is why the gap is recorded there as a single
long comment line and why any real fix has to extract rather than inline. Re-read the number, do not
trust this line:

```
node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
```

★ Deliberately NOT done on the branch that found it: that branch owns a CSV quoting fix, and the
review round that surfaced this was a toast-ORDERING fix. Splitting a signal channel on the back of an
ordering change is how an ordering change acquires a behavioural regression.

---

## 153. PPTX export is one slide per row and drops most rich fields before they can be rendered — open, measured

Opened 2026-08-16 out of §141(b), which gave DOCX and the HTML/PDF path full structural fidelity for
the seven rich entity fields and deliberately left both PPTX paths on the flat `.text` projection.
That was the right call for that slice — but the reason PPTX is hard is NOT the missing bullet XML,
and recording only "PPTX still flat" would send the next reader to the wrong file.

**The layout is the binding constraint.** `buildPptxRowSlide` (`export-pptx.ts`) renders ONE SLIDE
PER ROW, not a table: column 0 becomes the slide title, column 1 the subtitle, and the remaining
columns become `"Label: value"` meta lines — capped at six by `columns.slice(2, 8)` with the comment
"cap at 6 extra fields so text fits the slide". So a rich column at index ≥ 8 is not merely
flattened, **it is not on the slide at all.**

★★ Measured against the live column orders rather than assumed — **three of the seven rich fields
never reach a slide**, including the single most-used one:

| field | column index | on the slide? |
|---|---|---|
| `Task.description` | 11 (of 28) | **no** |
| RAID `description` | 3 (of 23) | yes |
| RAID `mitigation` | 11 | **no** |
| Milestone `description` | 3 (of 9) | yes |
| Change `description` | 2 (of 20) | yes |
| Change `impactDescription` | 6 | yes |
| Change `resolutionNotes` | 13 | **no** |

Re-derive rather than trust the table — the indices move whenever a `*_CSV_COLUMNS` list gains an
entry, and this table is exactly the kind of enumeration §143's own file list shows rotting:

```bash
grep -n 'slice(2, 8)' src/app/export-pptx.ts
grep -n '_RICH_COLUMNS' src/app/export-sections.ts
```

### Scope, if this is picked up

Two independent pieces, and the second is the larger one:

1. **Native bullets and numbering.** PPTX needs NO new package part for this — the DrawingML
   paragraph properties carry bullets as child elements (`a:buChar` for a literal bullet glyph,
   `a:buAutoNum` for auto-numbering), so `RichLine`'s `ordered`/`depth`/`index` (added by §141(b))
   already carry everything required. This is the cheap half. ★ Those two are ECMA-376 element
   names, not repo symbols: there is no such `buChar` and no such `buAutoNum` identifier anywhere in
   `src`, and a symbol probe that flags either one is reporting correctly.
2. **A real table layout.** Until a section can render as a table, the per-row slide keeps
   truncating at six meta fields and the three fields above stay invisible however well they are
   marked up. Doing (1) alone would ship bullets for the four fields that happen to sit early in
   their column list and change nothing for `Task.description`.

★ Ordering matters: (1) before (2) is mostly wasted, because the field a user most wants formatted
is the one (2) unblocks.

---

## 154. Native DOCX list numbering needs a package part, and nothing in the repo can detect a malformed one — open

Opened 2026-08-16 out of §141(b). DOCX list items render their marker as **literal text in its own
`<w:r>`** rather than as Word numbering — `ooxml-docx-primitives.ts` says so at `bulletMarker`, which
is deliberately the ONE place that decides the marker so DOCX and PPTX cannot spell it differently.
Consequences: the list is not a real Word list (no continuation, no renumbering on edit, no
list-style change), and a pasted-out list arrives as text with a bullet character in it.

The real fix is a `numbering.xml` part plus an abstract-numbering definition, `[Content_Types].xml`
and rels wiring, and `<w:numPr>` on each item's `<w:pPr>` in place of the marker run.

★★★ **The blocker is NOT the XML — it is that nothing in this repo can tell you the package is
valid.** Every DOCX assertion the suite owns is a STRING assertion over emitted markup, and §141(b)
recorded three separate ways Word fails SILENTLY on input that passes every such assertion: an
undeclared `w:pStyle` is ignored, a `w:jc` value of `justify` instead of `both` is dropped, and
`<w:pPr>` children out of their `xsd:sequence` order make Word reject the properties or the part.
A new package part multiplies that surface — a malformed `numbering.xml`, a missing content-type
override or an unwired rel produces a file that either opens with the numbering silently absent or
does not open at all, and **the suite is green in both cases**.

### The entry must choose, and this is the actual decision

* **(a) Package-level validation.** Bring in a real OOXML validator (or a minimal in-repo one that
  checks content-types, rels resolution and the `CT_*` child sequences) so a malformed part goes red
  in CI. Highest cost, and the only option that makes further OOXML work safe by default.
* **(b) An accepted manual-open step.** Declare that a change touching DOCX package structure
  requires opening the artifact in Word before merge, and say so where the emitter lives. Cheap and
  honest, but it is a process guard with no gate behind it — this repo's own record is that an
  ungated rule decays.

★ Do NOT start the XML before picking one. Writing `numbering.xml` under (b)'s regime without
actually performing the manual open is how a broken part ships behind a green pipeline, and the
string assertions will read as coverage.

---

## 155. `buildDocxTable` names a `Grid` table style that nothing declares — open, harmless TODAY by accident

Opened 2026-08-16 out of §141(b)'s styles work, which fixed the PARAGRAPH styles
(`Heading1`-`Heading4`, `ListParagraph`, `Quote`, `CodeBlock` are now declared) and left this one.

`buildDocxTable` emits `<w:tblStyle w:val="Grid"/>` inside `<w:tblPr>`, and **no `w:styleId="Grid"`
exists anywhere in the emitted `word/styles.xml`** — so Word silently ignores it, the same
failure mode §141(b) fixed for paragraph styles. Reproduce:

```bash
grep -n 'tblStyle' src/app/ooxml-docx-primitives.ts        # the reference
grep -n 'w:styleId="Grid"' src/app/ooxml-docx-primitives.ts # no match
```

★★★ **It is harmless today ONLY BY ACCIDENT, and the accident is the danger.** The same `<w:tblPr>`
sets an explicit `<w:tblBorders>` block (all six edges, `single`, `sz="4"`), so the table renders
with rules regardless of whether the style resolves. **The table looks right because of the borders,
not because the style is found.** Anyone who later deletes those explicit borders trusting the named
style — a reasonable-looking cleanup, since naming a style and then hand-setting what it should
provide reads as redundancy — gets a borderless table with **nothing going red**, because every
assertion in the suite is a string assertion over the emitted XML and the `<w:tblStyle>` string is
still there.

★ Two ways to close, both cheap: declare a real `Grid` table style beside `DOC_STYLES` and let the
explicit borders go; or DELETE the `<w:tblStyle>` reference and keep the borders as the single
source of the table's appearance. The second is smaller and removes the trap outright — a reference
to a style that does not exist has no upside. Either way, leave a comment at the borders saying they
are load-bearing, because that is the fact no test can express.

★ Related but distinct from §154: this one needs no new package part, only a declaration (or a
deletion) in a part that already exists.

## 156. A `<blockquote>`, `<pre>` or `<hN>` inside a list item loses the item’s indent — open, deliberate

Opened 2026-08-17 alongside the continuation fix (`continuation: true` on `RichLine`), which gave a
wrapped list item’s later lines the item’s geometry. That fix covers exactly the content that
INHERITS its kind — the text after a `<br>`, a second `<p>`, a `<div>`. It deliberately does NOT
cover the three elements inside an `<li>` that impose a kind of their OWN.

```bash
# the three shapes, and the assertions that pin each one keeping its own kind
grep -n "imposes its own kind" -A 24 src/app/rich-text-runs.test.ts
grep -n "keeps a <pre> inside an item" -A 10 src/app/rich-text-runs.test.ts
```

★★ **The trade is deliberate and it is the right way round.** Turning a `<pre>` into an `li`
continuation would win the indent and lose the kind — and the kind is the whole point of a `<pre>`:
verbatim whitespace and a monospace face. Same for a `<blockquote>`’s rule-and-italics and for an
`<hN>`’s LEVEL, which a continuation has nowhere to carry. Losing an indent beats losing the kind.

★ **Reachability is narrow but real.** Tiptap’s `listItem` spec is `paragraph block*`, so the editor
always puts a `<p>` first and a user cannot type an `<h2>` as an item’s only child. AI-authored
(`sanitizeAiRichText`) and imported HTML can, and nothing normalises either to the editor’s schema.

★ **The fix, if it is ever wanted, is a second axis, not a fourth kind.** The line would need to
carry the enclosing item’s `depth` WITHOUT becoming an `li` — i.e. an optional `listDepth` on
`LineBase` that both renderers add to their indent. That is a wider change than the continuation
slice needed, and it buys indentation only.

★ A smaller cousin, also open: a DOCX continuation sits at the item’s `w:ind w:left`, so its text
starts under the MARKER rather than under the item’s text. Fixing that properly needs a real
`numbering.xml` (§154), which would retire the literal marker text altogether.

## 157. An item with no `li` line AT ITS OWN DEPTH still spends an ordinal and renders no marker — open

Opened 2026-08-17 by the fix that closes the larger half of this. `promoteItemHead`
(`rich-text-runs.ts`) makes the FIRST `li` line an item put into the output its HEAD, so an item
whose own line was dropped — it started empty and a `<br>`, an `<hr>` or a heading closed it before
any text arrived — no longer renders every line unmarked while spending its number. What is left is
the case where the item puts **no `li` line AT ITS OWN DEPTH** into the output:

```bash
# both shapes, with the assertions that pin the ordinal being spent
grep -n "SPENDS a number on an item whose only" -A 22 src/app/rich-text-runs.test.ts
```

`<ol><li><h2>h</h2></li><li>a</li></ol>` and `<ol><li><ul><li>n</li></ul></li><li>b</li></ol>`. In
both the item RENDERED — a heading, a sub-list — so it correctly occupies a numbered slot and `a`/`b`
are item 2. Neither line can carry the outer item's marker, so nothing in the export shows a "1." —
but **the two shapes miss it for DIFFERENT reasons, and only the first is a kind story**:

- `<li><h2>h</h2></li>` emits a `heading` line, which keeps its own kind by §156. There is no `li`
  line anywhere, at any depth.
- `<li><ul>…</ul></li>` **does** emit `li` lines — the sub-list's items, heads of their own, one
  depth DEEPER. What skips them is `promoteItemHead`'s `line.depth !== depth` filter, not any kind
  test. `grep -n "only content is a nested list" -A 9 src/app/rich-text-runs.test.ts` shows `[1, 0]`
  then `[0, 1]` as `[depth, index]`, and that mapper emits an array only for a line of kind `"li"`.

An earlier wording of this entry (and of `promoteItemHead`'s docblock, and of AGENTS.md) said "emits
only lines of another kind", which is FALSE about the second shape and sends a reader hunting for a
kind bug. The accurate predicate is the one in the title.

★★ **This is §156 seen from the numbering side — but only the FIRST shape shares its cause.** An
earlier wording here said both did ("a line that keeps its own kind cannot hold an `li`'s marker"),
which contradicts the two bullets directly above it: the sub-list shape emits `li` lines and is
skipped on DEPTH, not on kind. For the `<h2>` shape the §156 trade holds as written — promoting its
line would destroy the level. The `listDepth`-on-`LineBase` second axis §156 proposes would want a
`listMarker` beside it.

★ **Deliberately NOT closed by widening `promoteItemHead`.** It filters to `line.depth === depth` so
it cannot reach into a sub-list; dropping that filter would move an outer item's marker onto its
first nested item, which reads as a numbering bug rather than a missing marker.

★ Reachability is the narrow one §156 records: Tiptap's `listItem` spec is `paragraph block*`, so
the editor always puts a `<p>` first. AI-authored and imported HTML can produce either shape.

## 158. A `<blockquote>`'s OWN `data-align` is DROPPED — imported/AI HTML only — open

Opened 2026-08-17 by the round that softened an overclaiming test comment. `htmlToRichLines`
(`rich-text-runs.ts`) carries a block's alignment down to a line a `<br>` re-opens, and
`rich-text-runs.test.ts` covers that for four kinds. Two of the four fixtures are markup no editor
can produce, and the blockquote one is the pair that matters:

```bash
# the hand-authored shape the suite covers, then the two blockquote shapes
grep -n "keeps the alignment on BOTH halves" -A 25 src/app/rich-text-runs.test.ts
grep -n "DROPS a blockquote's OWN align" -A 26 src/app/rich-text-runs.test.ts
```

`<blockquote data-align="right">q<br>r</blockquote>` keeps `"right"` on both halves.
`<blockquote data-align="right"><p>q</p></blockquote>` projects to a single line with **no align at
all**: the walk's NESTED arm opens a `blockquote` line carrying the align, the inner `<p>` takes the
LINE_TAGS arm with `item === null` and opens a line of its own with its own (absent) align, and the
still-empty outer line is dropped by `flush` for holding no text.

★★★ **REACHABLE ONLY BY IMPORTED OR AI-AUTHORED HTML — the editor cannot produce either fixture.**
An earlier title and body of this entry said the second one was "the shape the editor actually
stores", which is false and inverted the severity. `TextAlign` is configured
`types: ["heading", "paragraph"]` (`rich-text-editor.tsx`), so `data-align` never lands on a
`<blockquote>` at all; a user aligning text inside a quote puts it on the inner `<p>`, and that shape
**keeps** its alignment — pinned by "keeps the align the EDITOR stores on a quote". So no user of the
editor can hit this, and the entry is a robustness gap in the import path, not a live data loss.
Getting this wrong is the same hand-authored-fixture-as-real-input class the branch spent three
rounds correcting, reproduced in the correction text itself.

★★ **The fix is not "make LINE_TAGS inherit whatever align is in force".** That arm is the one this
round just taught to fall back to the ITEM's align inside an `<li>`; giving it a blanket fallback to
the enclosing block's would also change every `<p>` inside a `<div>` and inside a `<pre>`, which is a
wider output change than this entry is worth. The narrow shape is for the NESTED arm to hand its
align down as the alignment IN FORCE and for LINE_TAGS to consult THAT — the same `own ?? inherited`
resolution, sourced from `walk`'s existing `align` parameter rather than from `item`.

★ **Characterized, not merely recorded.** `rich-text-runs.test.ts` asserts the alignment is
`undefined` today ("DROPS a blockquote's alignment in the shape the editor actually stores"), so that
test goes RED when this is fixed and the fixer is told to update it. It is the §126 pattern: an
assertion that the defect is still present, not a guarantee that it should be.

★ Severity is cosmetic-but-silent, and it is the same class as the `<ul data-align>` residue the
walk's docblock now names: an author's alignment choice is discarded with nothing to notice it by.
`data-align` is value-guarded and not tag-guarded in `sanitize-html.ts`, so both shapes reach the
renderer intact.

## 159. `today` and `tz` are two adjacent `string` parameters on the recap path, so a transposition typechecks — CLOSED 2026-08-17 by `ProjectClock`

Opened 2026-08-16 out of the AI Recall B2b test-validity review. Partially closed in the same slice
by branding `TimeZone`; **fully closed 2026-08-17** by `ProjectClock`.

★★★ **CLOSED — and the shape below is exactly what "Closing it" specified, so read that section as
the spec it turned out to be.** `timezone.ts` now exports an opaque `ProjectClock` (`{ today, tz }`
plus an unforgeable brand) and a single producer `createProjectClock(tz, now = new Date())` that
derives `today` from `tz` INTERNALLY. `ChatDispatcherArgs`' two fields (`today: string` +
`timezone: TimeZone`) collapsed into one `clock: ProjectClock`; `use-chat-dispatcher` holds ONE
`clockRef` instead of two; `summarizeForRecap(ai, entries, clock)` is the only place the pair is
unpacked; and `task-manager.tsx`'s local `effectiveToday` was DELETED so there is no second producer
of `today`.

★★ **`now` is a parameter and that is not a hole.** The caller picks the INSTANT, never the rendered
day — the zone→day conversion stays inside the factory, which is the entire invariant. It is also
what lets tests pin a day without an `asProjectClockForTests({today, tz})` escape hatch, i.e. without
handing back the exact ability the bag removes. `timezone.test.ts` pins the invariant directly: one
instant, two zones, two different days.

★ The engine `summarizeRecentActivity` deliberately KEEPS its two-string signature. It is pure and
clock-free, and rewriting it would churn ~20 test call sites to move a guarantee already established
one hop earlier. The residual is therefore one line, where both values come off one object.

`use-chat-dispatcher.ts` builds the model-facing recap with
`summarizeForRecap(settingsRef.current.ai, activityLogRef.current, todayRef.current, timezoneRef.current)`.
Parameters 3 and 4 were both `string`, so swapping them compiled. Under the swap
`summarizeRecentActivity` computes `new Date("UTCT00:00:00Z")`, hits its own
`if (Number.isNaN(start.getTime())) return null` guard, and the recap is `undefined` on every turn
of every conversation, permanently and silently.

★★★ **Measured, not reasoned:** with the swap in the tree, `npx tsc --noEmit` exited **0** and
**337 tests across 5 suites passed** (`use-chat-dispatcher` · `chat-tools` · `chat-api` ·
`activity-recap` · `chat-panel`). Neither the type system nor the suite could see a defect that
removes the whole feature. `use-chat-dispatcher.test.tsx` had **zero** `activitySummary`
assertions at the time.

### What the brand bought, and what it did not

Branding `TimeZone` (produced solely by `resolveTimezone`, cast kept non-exported inside
`timezone.ts`) makes the transposition unrepresentable. It does **not** close the larger class.

★★ **`today` is a pure function of `tz`** — `task-manager.tsx` derives `const today =
effectiveToday(effectiveTz)` one line after resolving the zone, and passes both. So the two can
still be handed over as an **inconsistent pair** (`today` computed in Berlin, `tz` naming
`America/New_York`), which is well-typed under **every** branding scheme. Measured: no error.
They are not two independent inputs; they are one derived pair travelling as two values, and only
collapsing them removes the class.

### Closing it

Replace the two parameters with one opaque `ProjectClock` built by a single factory.

★★★ **The factory must derive `today` INSIDE from `tz`.** A factory taking both rebuilds the swap
one level up and buys nothing.

★★ **Therefore the factory belongs at `task-manager.tsx`'s `resolveTimezone`/`effectiveToday`
pair, NOT in the engine module.** `summarizeRecentActivity` is deliberately clock-free (its own
`★ NO CLOCK` note ties it to the calendar-rollover class in §149), so the `new Date()` must stay
where it already is.

★★★ **A plain `{ today, tz }` options object DOES NOT WORK, and this is the trap** — it is the
first fix anyone reaches for. Measured: `f({ today: tz, tz: today })` typechecks silently, because
both fields are `string`. It buys call-site legibility, never a guarantee. The bag must carry a
brand the caller cannot forge.

★ Sizing, if it is picked up: the brand thread is `resolveTimezone → ChatDispatcherArgs.timezone →
Snapshot["timezone"] → buildActivityRecapBlock`; a bag replaces the tail of that thread rather than
extending it. `days` is a `number` and collides with neither string — leave it alone.

★ Note the error POSITION when working on this, or the brand reads as broken: a swap fails on the
**tz parameter's own position** — argument 4 for `summarizeForRecap`, argument 3 for
`summarizeRecentActivity` — never on the `today` argument, because `TimeZone` is assignable to
`string` and slides into `today:` silently. Only the raw string arriving at `tz:` errors.

## 160. An AI `update_settings` writes TWO activity rows, and the second one cannot be taught who caused it — CLOSED 2026-08-17

Opened 2026-08-16 out of the AI Recall B2b actor-stamping slice, deferred as "the cheap fixes are all
worse than the defect", and **CLOSED 2026-08-17**. Not a regression: the second row predates the
branch. What the branch changed is that the two rows became visibly *different*, because one carries
an actor and the other does not.

★★★ **CLOSED WITH A CREDIT COUNTER, WHICH IS NOT THE SUPPRESSION FLAG THIS ENTRY REJECTED.** The
rejected design set a "this burst came from the AI" flag before `setSettings` and cleared it after the
debounce — a TIME WINDOW, which swallows any human change landing inside those
`SETTINGS_LOG_DEBOUNCE_MS`, turning a duplicate row into a MISSING one. The shipped design has no
window at all: the dispatcher calls `onSettingsLoggedByAi()` once per `"ai"` `settings.updated` row it
writes, task-manager's settings effect consumes exactly ONE credit per run, and a human change
immediately afterwards gets its own run, finds the counter at 0, and is logged normally.

★★ **The correctness condition is "credit only alongside a real settings-identity change."** The
effect only runs when the settings object changes, so a credit issued without one is never consumed
and would sit there swallowing the NEXT genuine user row. Both call sites satisfy it unconditionally —
`setLanguage` always spreads a fresh object, and `updateSettings` credits inside its `applied` guard.
`use-chat-dispatcher.test.tsx` pins that a no-op patch credits nothing and that credits and rows are
issued one-for-one across a burst.

★★★ **THAT CONDITION IS NECESSARY AND WAS NOT SUFFICIENT, and the first cut of this fix shipped the
gap.** Credits are issued PER TOOL CALL and consumed PER EFFECT RUN, and React batches every
`setSettings` of one assistant turn into ONE render — `chat-panel.tsx` runs each `tool_use` block of a
message in a `for … await runTool(…)` loop, and the awaits between them are microtasks, which React
batches. So "switch to German and turn off view hints" issued TWO credits against ONE run. While the
effect DECREMENTED, the surplus outlived the turn and silently ate the user's next settings row,
whenever that came. **The effect now CLEARS the counter**, which bounds any leak to the render that
created it. Found by a cold review of this very fix round; the entry as first closed asserted the
wrong invariant in three places (here, `task-manager.tsx`, and `chat-dispatcher-types.ts`).

★★ **Residual of the clear, deliberately accepted and the strictly better trade:** if two AI writes in
one turn are separated by a real macrotask (an intervening tool doing I/O), React renders twice, the
second run finds 0 and writes one actor-less row. An EXTRA honest row beats a MISSING user row — do
not trade this back for a decrement.

★★★ **THE SECOND DEFECT WAS THE EFFECT CLEANUP, and it failed in the opposite direction.** The
cleanup was `return () => logger.cancel()` on the settings effect, so it ran BEFORE the next effect
body: an AI write landing inside a user's 1500 ms debounce cancelled the user's pending row and then
early-returned on the credit without re-arming — the user's change vanished outright, which is exactly
the swallow this entry rejected the suppression-flag design for. The cleanup is now UNMOUNT-scoped, a
behaviour-neutral change on the normal path because `notifyChange` already restarts the timer itself.

★★★ **BOTH WERE INVISIBLE TO THE SUITE FOR ONE REASON: every §160 test asserted CREDITS, never ROWS.**
`grep -rn "aiSettingsCredits" src/app --include=*.test.tsx --include=*.test.ts` returned **0** — the
consumer had no coverage at all, and one issuer test pinned `credits === 2` after a three-call burst,
i.e. the leak state asserted as an invariant. The guard now lives in
`task-manager.activity-actor.test.tsx`, which mounts the real TaskManager and asserts ROWS: a user
change after a two-write AI batch, a user row surviving an AI write inside the window, an
anti-vacuity control that a plain user change logs one row, and the original suppression. Both fixes
are mutation-proved, each caught by exactly its own test.

★★ **`vi.useFakeTimers()` CANNOT test this debounce and a test using it passes vacuously** (measured:
zero rows either way). `createSettingsLogger`'s `setTimeoutFn` parameter DEFAULTS at call time and the
logger is built in a `useRef` initializer during first render, so it closes over the `setTimeout` that
was global at MOUNT; installing fake timers afterwards swaps a global it no longer consults. The tests
use real ~1.6 s waits.

★ The debounced row stays ACTOR-LESS, and the credit counter does not change that. It does not teach
the effect a cause; it only tells the effect that a particular change was already reported by someone
who knew. Every row it still writes is one nothing can attribute — do NOT "finish the sweep" by
stamping it `"user"`.

An AI settings write produces:

1. the dispatcher's own row — `use-chat-dispatcher.ts` calls `logActivityAs?.("ai",
   "settings.updated")` from both `updateSettings` (inside its `applied` guard) and `setLanguage`;
2. `task-manager`'s debounced row, written `SETTINGS_LOG_DEBOUNCE_MS` later by
   `createSettingsLogger(() => logActivity("settings.updated"), …)` — **actor-less on purpose**.

Both kinds carry NO args, so they render as two textually identical "Settings updated" lines.

★★ **The actor-less row is correct and its comment says so** — do NOT "finish the sweep" by
stamping it `"user"`. It is an effect over settings STATE, not a handler behind a gesture, so it
cannot see its cause: the AI's write mutates the same state and fires it too. A `"user"` stamp
would sit directly contradicting the `"ai"` row beside it, which is worse than saying nothing.
Absence is the honest answer to a question that code genuinely cannot answer.

★★★ **Same shape as the `ai.inlineEdit` double-log this slice DID fix, one layer further out — and
the layer is exactly why it is not fixable the same way.** There, the redundant row was written by
code that knew it was the AI, so deleting it was a local edit. Here the redundant row is written by
an effect that structurally cannot know, so there is nothing local to delete. ★ Note the criterion
that carried the inlineEdit fix was REDUNDANCY, not row count (`ai.insightRecommendation` was kept
at up to five rows because it says something no other row says). By that criterion this pair is
redundant: the two rows report one event and the second adds nothing the first does not already say.

★ A user-initiated settings change writes only ONE row, so the doubling is AI-specific.

### Why it is worth closing

Not cosmetics. `summarizeRecentActivity` counts rows into `byActor`, so one AI settings change
reports as **1 `ai` + 1 `unknown`** in the recap the model reads every turn — it inflates the
`unknown` bucket, and it makes the "never attribute an entry whose actor is absent" caution
(`VIEW_AI_SCOPE.activity`) fire on a row whose cause is in fact known and sitting next to it. It
also double-counts against `ACTIVITY_MAX_ENTRIES` in a ring buffer.

### Closing it, and the three fixes that do not work

★★★ **Do not drop the dispatcher's `"ai"` row and let the debounced one stand.** It is the
tempting one-line fix and it destroys the only true fact in the pair: that the AI did it. Strictly
worse than the status quo.

★★ **Do not route the dispatcher's write through the debounced logger with an actor.** The logger
would then report whoever wrote last, which is the same cause-tracking problem moved one file over
and made harder to see.

★★ **A suppression flag is the plausible one and it has a real trap.** Setting a "this burst came
from the AI" ref before `setSettings` and clearing it after the debounce works only if no HUMAN
change lands inside the same `SETTINGS_LOG_DEBOUNCE_MS` window — and if one does, it is swallowed
entirely, turning a duplicate row into a MISSING row. That is a worse failure: a log that
over-reports is annoying, one that under-reports is untrustworthy. Any attempt needs the window
collision handled explicitly, not assumed away.

★ The tractable shape is probably to give the debounced logger a cause channel that records the
LAST writer per burst and emits nothing when that writer already logged — but that is a design
slice, not a patch, which is why this is an entry rather than a commit.

---

★★★ **§159–§166 WERE RENUMBERED ON THE WAY IN, AND THE COLLISION IS RESOLVED.** This
branch and `feat/rich-text-export-fidelity-s2` both opened entries off a merge base whose register
ended at §152. That branch merged first and took §153–§158, so this branch's entries shifted by
six: §153–§160 —> §159–§166. ★★ Run the shift **descending**, because the source and target ranges
OVERLAP — a low-to-high pass re-shifts values it has just written, producing DUPLICATES:
`node -e 'let s=[153,154,155,156,157,158,159,160];for(const v of s.slice())s=s.map(x=>x===v?x+6:x);console.log(s.join(","))'`
—> `165,166,161,162,163,164,165,166`. ★ Note what that is and is NOT: the duplicates land inside
this branch's OWN range and never reach main's §153–§158, so the damage is a colliding register,
not a reference silently retargeted at a stranger's entry.

★★★ **THE BANNER THAT USED TO STAND HERE WAS RENUMBERED BY THE VERY SWEEP IT DESCRIBED.** It sized
the collision in § numbers, so a mechanical `§NNN` sweep rewrote its own figures and it emerged
claiming this branch held "§161–§166" and the other one "§159–§164" — a collision that no longer
existed, in the one paragraph whose job was to size the work. **Text that quantifies a renumber
cannot survive that renumber.** Write the outcome, not the plan, and re-read any surviving banner
AFTER the sweep. ★★ Its predecessor was ALSO wrong, and in the other direction: it headlined six
entries (`§155–§160`) while the branch held eight. Verify:
`git show 3b6adfc0:docs/open-followups.md | grep -oE "§1[0-9]+–§1[0-9]+ CARRY PROVISIONAL"`
★★★ So do NOT read this as "each was true when written". Two successive versions of this banner
carried wrong numbers — one staled by the sweep, one wrong on arrival — and a cold review of the
REPLACEMENT text is what found both.

★★ **NOTHING GATES ANY OF THIS.** The register has no uniqueness check, and `docs:claims:check`
range-checks `path:LINE` citations only — it cannot see a § reference at all, so a missed one stays
green while pointing at a stranger's entry. The references that matter most live in SOURCE COMMENTS,
which no doc gate reads; a title grep finds none of them, because a comment cites `§159`, never the
heading text.

★★★ **DO NOT USE A NUMBER PREFIX FOR THAT SWEEP.** `git grep -n "§15"` is wrong in BOTH directions
at once: it OVER-matches (`file-picker-button.tsx` cites the unrelated §15, a decoy the range form
excludes) and it goes BLIND at `§160`, because a prefix cannot match a longer number — so after a
renumber past it the sweep returns the pre-renumber hits and nothing else, reading as "done". Use a
bounded RANGE for today's numbers and the three-digit class for the durable form:

```bash
git grep -nE "§1[5-6][0-9]" -- src scripts e2e   # the moving numbers, no decoy
git grep -nE "§1[0-9][0-9]" -- src scripts e2e   # survives any renumber inside §100–§199
```

★★ **COUNT OCCURRENCES, NOT LINES** when sizing the work — `git grep -n` collapses a line carrying
two citations into one hit. Use
`git grep -ohE "§1[0-9][0-9]" -- src scripts e2e | sort | uniq -c | sort -rn` for the per-section
breakdown. ★★★ **RUN IT — no count is quoted here, deliberately.** Every figure the two previous
banners carried was measured, and every one of them was wrong by the time it was read.

## 161. `latestAt` picks the "latest" activity entry by raw lexicographic string compare

Opened 2026-08-16 out of the AI Recall B2b slice. **Pre-existing class, not introduced here** — B2b
made it MODEL-VISIBLE by putting `latestAt` into the ambient recap sentence the assistant reads every
turn.

`summarizeRecentActivity` (`history-search.ts`) ends its scan with a bare
`if (entry.timestamp > latestAt) latestAt = entry.timestamp;` — a string compare over a field that
`sanitizeActivityEntry` only checks is a **string** (`typeof e.timestamp === "string"`; it never
parses it, never checks the `Z` suffix, never normalises). `ActivityEntry.timestamp`'s docstring
asserts "ISO 8601 UTC … always `toISOString()` shape", but that is an assumption held by the
WRITERS, not a validated invariant.

So an offset-bearing stamp can win the compare while being an EARLIER instant. Reproduce:

```bash
node -e '
const a="2026-08-16T23:59:00+14:00", b="2026-08-16T10:00:00.000Z";
console.log("lex a>b:", a>b, "| instant a<b:", new Date(a) < new Date(b));'
```
→ `lex a>b: true | instant a<b: true`. `latestAt` therefore holds `a` (instant `09:59Z`) while the
real latest is `b` (`10:00Z`), so the recap dates the project's last change **EARLIER** than it
happened. ★ The model never sees the minute — `activity-recap.ts` renders
`dayInZone(summary.latestAt, tz)` and the emitted clause is `latest YYYY-MM-DD` — so the realised
harm is a wrong DAY, and only in a zone where the two instants straddle midnight. In a `+14` project
that pair reports `2026-08-16` when the true latest day is `2026-08-17`:

```bash
node -e '
const f=(iso,tz)=>new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));
console.log(f("2026-08-16T23:59:00+14:00","Pacific/Kiritimati"), f("2026-08-16T10:00:00.000Z","Pacific/Kiritimati"));'
```
→ `2026-08-16 2026-08-17`. ★★★ **THE ZONE IS NOT THE PROPERTY — THE STRADDLE IS.** Both instants of
THIS pair fall on the same UTC day, so this exact fixture is invisible in a UTC project. The BUG is
not: pick a pair whose two instants straddle the fixture zone's own midnight, whatever that zone is.
`a="2026-08-17T13:59:00+14:00"` / `b="2026-08-17T00:00:00.000Z"` is lexicographically greater,
instantaneously earlier (`23:59:00Z` vs `00:00:00Z`), and renders `2026-08-16` against `2026-08-17`
**in UTC**. ★★ An earlier revision of this line said a UTC fixture "CANNOT observe this" — false, and
false in the expensive direction, since "Fixing it" below asks for exactly that test and the line
would have sent its author hunting for an exotic zone the reproduction does not need.

★★ **Watch the arithmetic on any example you write.** The first draft of this entry paired that
stamp with `…T09:00:00.000Z`, which is a **counter-example**: `+14:00` at 23:59 is `09:59Z`, i.e.
LATER than `09:00Z`, so the pair demonstrates the compare working. The offset has to be large enough
to cross the compared field but not so large that it overshoots the instant. Run the node line; do
not eyeball it.

### Why it matters, and where it is worse

`mergeActivityLogs` (`activity-log-merge.ts`) makes the IDENTICAL assumption and fails harder: it
sorts with the same lexicographic comparator and then caps with `all.slice(-ACTIVITY_MAX_ENTRIES)`,
which drops the HEAD. A stamp that sorts wrongly LOW is therefore **permanently deleted** on the
next over-cap merge rather than merely misplaced. `ActivityEntry.timestamp`'s own docstring already
records that consequence — what it does not record is that nothing enforces the precondition.

### Entry vector

Not reachable from normal use: every runtime append is `new Date().toISOString()`
(`appendActivityEntry`). It arrives via an **imported or hand-edited workspace** — the activity log
rides all six write paths as a JSON meta-blob, so a JSON/CSV/Markdown file or a Turso row can carry
any string at all.

### Fixing it

Normalise at the load boundary: have `sanitizeActivityEntry` re-stamp a parseable-but-non-canonical
timestamp through `new Date(v).toISOString()` and DROP an unparseable one (it already drops a
non-string). That fixes both consumers at once and needs no change to either comparator. ★ It is a
behaviour change on load, so it wants a fixture carrying a `+HH:MM` stamp and an assertion that both
the merge order and `latestAt` follow the INSTANT — a fixture of canonical stamps cannot tell a
fixed implementation from the current one.

## 162. The `historySearch` kill switch is advertisement-scoped, not enforced at the executor — CLOSED 2026-08-17 (enforcement added)

Opened 2026-08-16 out of the AI Recall B2b slice. Low severity; recorded because the setting is
framed to the user as a switch that turns the capability off. **CLOSED 2026-08-17.**

★★★ **CLOSED AS ENFORCEMENT, which is one of the two outcomes the ★ at the end of this entry asked
for.** The entry's real complaint was that the code said nothing either way; it now says
enforcement, in code rather than in a comment. `ToolDispatcher` gained
`isHistorySearchEnabled()`, `runTool`'s `case "search_history"` refuses before touching the log, and
`use-chat-dispatcher` reads the flag LIVE from `settingsRef` so a mid-conversation toggle takes
effect immediately — the exact case that made the advertisement-only gate insufficient.

★★★ **BOTH LAYERS READ ONE PREDICATE, `historySearchEnabled` (`settings-types.ts`), and that matters
more than either layer.** Defence in depth is only worth having while the layers agree; two
hand-spelled `=== false` checks are one config slip from a switch that advertises OFF and serves ON —
which is this entry's own failure mode, arriving from the other direction. `toolsFor`/`toolNamesFor`
were rewritten to call it too. `chat-api.test.ts` pins that the advertisement follows the predicate
for every input shape the sanitizer can produce, garbage included.

★★ Note what did NOT change: this is not a confidentiality boundary. The log is the user's own data
in the user's own browser and there is no adversary, so the refusal is a plain error rather than a
redaction. The fix is about a labelled switch telling the truth.

★ **EVERYTHING BELOW DESCRIBES THE PRE-FIX TREE and is kept as the diagnosis, not as a current
reading** — same convention as §165. Its probes now return the opposite of what they print
(`grep -c historySearch src/app/chat-tools.ts` → **2**, not 0), and its closing ★ asks the reader to
decide a question the closure block above already answered. Read it for the reasoning, never for the
state.

`settings.ai.historySearch === false` removes `search_history` from `toolsFor`'s array, from
`toolNamesFor`'s set, and therefore from both prompt surfaces that advertise it — a clean, single-
decision design (see [`docs/AGENTS/ai-assistant.md`](AGENTS/ai-assistant.md)). But `runTool`'s
`case "search_history":` in `chat-tools.ts` executed unconditionally: the dispatcher would serve the
log to anyone who named the tool. Reproduce (PRE-FIX):
`grep -c historySearch src/app/chat-tools.ts` → **0**.

### Why it is narrow, and why it is still worth an entry

The model cannot invent a tool name from nothing — but it does not have to. Toggling the setting off
**mid-conversation** leaves prior `tool_use`/`tool_result` pairs in the re-sent message history, and
a model that has seen its own successful `search_history` call three turns ago has a strong template
to mimic. There is no adversary here (the log is the user's own data, in the user's own browser), so
the impact is "a switched-off feature can still answer once" rather than a leak.

For anything framed as a kill switch the normal shape is defence in depth: the executor refuses too,
so the guarantee does not rest on the request being well-formed. A two-line guard —
`case "search_history":` returning a refusal when the flag is `=== false` — would need the flag
threaded onto `ToolDispatcher` (it is not there today), which is why this is an entry rather than a
patch.

★ **Decide and record which it is.** If advertisement-scoping is the intended contract ("the setting
controls what we offer, not what we can do"), say so at the setting and at the `case`, and this entry
closes as by-design. If it is meant to be enforcement, it is a gap. Today the code says nothing
either way, which is the actual defect.

## 163. Completion-trend reconstruction under-counts the historical denominator after a mass delete — CLOSED 2026-08-17 (both actors); the `dDone` half stays OPEN

★★★ **THE FIRST CLOSE INVERTED THE ASYMMETRY INSTEAD OF REMOVING IT, and the title said "AI".**
`BULK_TOTAL_KINDS` corrected the denominator for `bulk.delete`, but that kind had exactly ONE writer —
the AI's `delete_all_tasks` — so AI mass deletes counted and the far commoner USER path still did not:
`use-bulk-operations.ts`'s `handleClearAll` and `handleBulkDelete` took an undo capture and wrote NO
activity entry at all. Both now log `bulk.delete`, with the count taken from the rows actually removed
(`removed.length`, never `ids.size` — a stale selection can name ids no longer present, and the walk
subtracts whatever the entry carries). Found by a cold review of the fix round. **Check both actors
whenever a metric is corrected for one of them** — "the AI half" is a scope, not a fix.

Opened 2026-08-16 out of the AI Recall B2b slice. Only reachable when a project has **fewer than two
snapshots** — `computeCompletionTrend` prefers snapshots and falls back to
`reconstructFromActivity` otherwise — so this is the no-Turso / new-project path.

`COUNT_KINDS` (`completion-trend.ts`) has four members; `bulk.delete` is deliberately **not** one of
them, and that exclusion is right: every member moves the metric by ±1 per entry, while one
`bulk.delete` entry carries a count of N, so including it would under-count by N−1. But this branch
made the AI's `task.created` and `task.deleted` writes count. The result is an asymmetry that did not
exist before, because the AI logged nothing at all:

- an AI `create_task` **adds** to `dTotal`, so the backward walk subtracts it correctly;
- an AI `delete_all_tasks` writes ONE `bulk.delete` carrying N, which the walk ignores entirely.

`reconstructFromActivity` walks backward from the current counts subtracting each day's delta, so
after a chat mass-delete the reconstructed historical `total` is understated by N — and since
`percent` is `done/total`, every historical point's percentage **inflates**. Reproduce the set and
the walk with `grep -n -A25 COUNT_KINDS src/app/completion-trend.ts`.

★★ **A second, older asymmetry compounds it and is worth fixing in the same pass:** `dDone` is fed
ONLY by `task.completed` and `task.reopened`, and **nothing in the app writes either kind**. Verify:
`git grep -nE '"task\.(completed|reopened)"' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.'`
→ only `activity-log.ts` (the union member and its `activityMessageKey` row) and `completion-trend.ts`
itself. A status change to Done logs `task.updated`, from every writer including the AI's
`update_task`. So the numerator is CONSTANT across every reconstructed day and only the denominator
moves — which means the reconstructed sparkline is already a curve about task count, not about
completion. Pre-existing and independent of this branch.

### Fixed 2026-08-17 — the denominator half

Exactly as specified below: the count is read OUT OF THE ENTRY rather than by adding a member to
`COUNT_KINDS`. A second set, `BULK_TOTAL_KINDS`, holds kinds whose delta comes from `args[0]`, and
`bulkTaskCount` coerces it. ★★ Keep the two sets separate — they encode two different arithmetics
(±1 per entry vs. N per entry), and merging them silently reinstates the N−1 undercount this entry
opens with.

★★ `bulkTaskCount`'s `Number.isFinite` guard is load-bearing and its failure mode is SILENT, not
loud: the walk does `total -= delta`, so one NaN propagates into every EARLIER day, and
`clampPctFromCounts` maps each non-finite result to 0 — the chart then reads a plausible 0% across
that whole earlier span rather than looking broken. Nothing prompts anyone to look at a wrong number
that looks like a number. ★ "Everywhere" is what an earlier wording said here and it overshoots:
`endState[i]` is assigned BEFORE the subtraction, so the corrupt day and every day AFTER it keep
their correct values. The same overshoot was corrected in `AGENTS.md` first and left standing here
for a while — one claim, two files, fixed on different days.

### The `dDone` half stays OPEN, and the obvious fix was measured and rejected

Reading `changes` for a `status` diff is the natural closure — `diffFields` really does record
`{field: "status", from: "To Do", to: "Done"}` with unlocalized raw values. **It does not work.** The
AI's `update_task` logs with NO `changes` array (`use-chat-dispatcher.ts` calls
`logActivityAs?.("ai", "task.updated", id, name)`), while a form save passes `diffFields(...)`. So a
changes-based numerator would move for user edits and not for AI ones — reintroducing precisely the
user/AI asymmetry this entry exists to remove, one metric over.

★ A second reason it is not a patch: `diffFields` caps at `MAX_FIELD_CHANGES` keeping the FIRST
fields ALPHABETICALLY, and "status" sorts late — a wide edit can drop it from the diff entirely.

Closing it needs a real `task.completed` / `task.reopened` writer, which is a design slice. Until
then the reconstruction is a curve about TASK COUNT, not completion, and `completion-trend.ts` says
so at the top of `reconstructFromActivity`.

## 164. `renderActivityEntry` lacks the `args`-element guard the Activity panel has, and it runs inside the AI tool loop — CLOSED 2026-08-17

Opened 2026-08-16 out of the AI Recall B2b slice. **Pre-existing from 0.241.0** (B2a), not introduced
here; B2b did not widen it.

★ **EVERYTHING BELOW DESCRIBES THE PRE-FIX TREE and is kept as the diagnosis, not as a current
reading** — same convention as §162 and §165. This banner was MISSING until a cold review caught it,
so the section's present-tense diagnosis sat under a CLOSED heading and read as live state. Its
central claim is now false by its own closure: the sanitizer DOES inspect the elements (`argsBad`,
`src/app/activity-log.ts`). Read it for the reasoning, never for the current tree.

`activity-prompt.ts`'s `renderActivityEntry` calls `t("en-US", key, ...entry.args)` with no guard on
the elements. At the time, `sanitizeActivityEntry` checked only `Array.isArray(e.args)` and never
inspected the elements, while the Activity panel had already added a per-element guard — the panel's
comment described `args` as the one shape the load boundary did not cover. Reproduce the asymmetry
against the PRE-FIX tree (`git show beed4f8f:src/app/activity-log.ts`), not the current one:
`grep -n "Array.isArray(e.args)" src/app/activity-log.ts` against
`grep -n "Array.isArray(e.args) ? e.args.map(changeText)" src/app/activity-log-panel.tsx` (the guard
the panel added for exactly this).

★★ THAT COMMENT IS **DESCRIBED, NOT QUOTED**, and the change is the point. An earlier revision quoted
it as verbatim — "THE ONE SHAPE THE LOAD BOUNDARY **DOES** NOT COVER" — while the source says **DID**
not cover, and opens with "used to be", which inverts the claim outright. So a section whose own
closing ★ says the comment was rewritten precisely so nobody reads it as evidence of a live gap went
on citing the rewritten comment as that evidence, thirty lines apart. This branch wrote the
DESCRIBED-NOT-QUOTED rule one file over in `docs/AGENTS/ai-assistant.md` and then broke it here.
Verify the source text rather than trusting either version:
`git grep -n "THE ONE SHAPE THE LOAD BOUNDARY" -- src`

`t()` interpolates with `String(a)`, and a non-callable own `toString` makes `ToPrimitive` fall
through to `Object.prototype.valueOf`, which hands the object back:
`node -e 'try{String({toString:1})}catch(e){console.log(e.message)}'` → `Cannot convert object to
primitive value`.

### Why the location matters

The panel's guard fixed the UI. `searchHistory` calls `renderActivityEntry` itself — deliberately, so
the substring filter can run over the rendered text — so the same stored shape throws **inside
`runTool`**, on a fully sanitized log, from any of the six backends. That is a chat turn that dies
rather than a table that fails to paint, and it is reachable from an imported workspace with no
hostile intent required (a hand-edited JSON blob).

### Fixed 2026-08-17 at the load boundary

`sanitizeActivityEntry` now coerces each non-string/number `args` element to `""` — the field was
already typed `(string | number)[]`, so the sanitizer was simply not enforcing its own type.

★★★ **COERCE IN PLACE, never FILTER, and never drop the entry** — this entry's own "(or the
element)" aside is the trap. `args` is POSITIONAL: renderers spread it into `t(lang, key, ...args)`
against `{0}`/`{1}` placeholders, so removing a bad element SHIFTS every later argument into the
wrong slot and turns a crash into silently wrong audit text. Dropping the whole entry is wrong for
the reason an unknown-but-string `kind` is KEPT: the log is shared workspace data that autosave
writes straight back, so one client meeting a corrupt row would delete it for everyone.
`activity-log.test.ts` pins the arity case explicitly (`["before", "", "after"]`), and a `filter`
mutant fails 4 tests.

★★★ **The repair had to join the EARLY-RETURN condition, not just the repair block.** The fast path
returns the ORIGINAL object by reference when `changes === undefined` — the overwhelmingly common
case — so a repair added only to the block below it would do nothing in practice while every fixture
carrying `changes` still passed. That is the identical trap the `actorBad` comment beside it already
records; `argsBad` now guards the same early return.

★ The panel's local guard is KEPT rather than shrunk to a comment: it also renders entries that never
passed the load boundary, and `changeText` stringifies the row regardless. Its comment was rewritten
so nobody reads its presence as evidence the boundary is still missing.

## 165. `sanitizeAiConfig` drops `actionSuggestions`, so switching the Action Center's AI off reverts to ON on the next reload — CLOSED 2026-08-17

Opened 2026-08-17 out of the AI Recall B2b review, found SIDEWAYS — the round was checking whether
B2b's two new toggles matched the shape of their neighbours, and the neighbour turned out to be
broken. **PRE-EXISTING, not introduced by this branch.**

★★★ **CLOSED the same day, and the reversal is worth recording because the FIRST decision was to
defer.** This section originally read "deliberately NOT fixed here … the one-line change cannot be
verified without running the suite, which this round is not doing" — a gate-availability argument
standing in for a blast-radius one. The blast radius is checkable WITHOUT the suite, and checking it
took three greps: the field is OPTIONAL on `AiConfig` (so adding a key cannot fail tsc), there is
exactly ONE caller (`use-settings.ts`), and NO test anywhere asserts this function's shape
exhaustively — every `sanitizeAiConfig` assertion in `settings-snapshots.test.ts` and
`settings-types.test.ts` reads a single named property, so a new key is invisible to all of them.
★★ "I cannot run the gates" is not the same claim as "I cannot bound the change", and collapsing the
two defers fixes that are provably safe. Ask which one you actually have.

The fix is one line in the return literal, mirroring the two beside it, plus the comment above them
(which said "Both features shipped enabled" and is now "All three").

★★ **The regression pin lives in `settings-types.test.ts`'s "AiConfig recall toggles" block**, which
is the wrong-sounding home for it — `actionSuggestions` is not a recall toggle — and the right one:
the bug is a property of the object literal that block already covers, not of the feature the field
belongs to. ★★★ **Its round-trip assertion is the only load-bearing one.** A dropped key reads
`undefined` exactly as the ON default does, so a test asserting only "absent ⇒ ON" is green against
the broken code — which is precisely why the two neighbouring toggles' own default test could never
have caught this, and why the field went unpinned for its whole life.

★ **The probes below describe the PRE-FIX tree and are kept as the diagnosis, not as current
readings** — the first now returns a non-zero count and the reader sweep returns more than six.

`sanitizeAiConfig` (`settings-types.ts`) builds an **explicit object literal** and had no
`actionSuggestions` key at all, so the field was dropped on every load:

```bash
sed -n '/^export function sanitizeAiConfig/,/^}/p' src/app/settings-types.ts | grep -c actionSuggestions
```
→ `0`. ★ `grep -c` exits **1** on a zero count — read the printed number, not the exit code.

That sanitizer runs over stored settings on the live load path — `use-settings.ts` builds `merged`
with `ai: sanitizeAiConfig(...)` assigned AFTER the `...defaultSettings`/`...parsed` spreads, so its
output wins outright (`grep -n "sanitizeAiConfig(" src/app/use-settings.ts` → one call site).
`writeSettings` does NOT strip the field on the way out (it spreads
`settings.ai` and blanks only `apiKey`), so `false` really is persisted — the loss is on READ.

### The round trip that reverts

`settings-sections/ai-section.tsx` writes `actionSuggestions: settings.ai.actionSuggestions === false`
and renders `checked={settings.ai.actionSuggestions !== false}`; the consumer
`use-ai-orchestration.ts` also reads `!== false` (its `aiEnabled`). Sweep every reader with
`grep -rn "actionSuggestions" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."` → six
hits: the type declaration, two in the settings toggle, the consumer, and TWO doc-comment lines in
`activity-recap.ts`. ★★ That count read **five** when this section was first written, and it was
correct then — a SIBLING edit in the same review round gave `activity-recap.ts` its second mention.
Neither author could have caught it alone, and no gate can see a count at all. **After any parallel
fix round, re-derive every count that greps a file another agent touched.** So:

switch OFF → `false` stored → reload → sanitizer drops the key → `undefined !== false` → **ON**.

The user's only feedback is the checkbox, which re-ticks itself, so this reads as the setting never
having been saved rather than as a defect with a name.

### Contrast — the two B2b toggles are correct

`historySearch` and `activityRecap` survive because the sanitizer carries an explicit line for each
(`obj.X === false ? false : undefined`):

```bash
sed -n '/^export function sanitizeAiConfig/,/^}/p' src/app/settings-types.ts | grep -cE "historySearch|activityRecap"
```
→ `2`, and that reading is unchanged by the fix (neither name appears in the comment it added).
`actionSuggestions` had no line at all and now has the third one. ★ `groundInGuides` is a THIRD shape and is also fine —
a required `boolean` the sanitizer always fills (`obj.groundInGuides !== false`), never `undefined`
post-sanitize, so its truthy reads are correct. Do not read it as a shape-mate of the optional two.

### Why no gate caught it

The tests stop one hop short — `ai-section.test.tsx` asserts what reaches `onChange`
(`expect(last.ai.actionSuggestions).toBe(false)`) and nothing round-trips that value back through
`sanitizeAiConfig`. Same class as the "test at the WRITE, not the tool call" landmine in AGENTS.md:
an assertion at the producer cannot see a consumer that discards the value.

### Fixing it

One line, beside the other two:

```ts
actionSuggestions: obj.actionSuggestions === false ? false : undefined,
```
★ It wants a round-trip test (`sanitizeAiConfig({ actionSuggestions: false }).actionSuggestions`
stays `false`), not another producer-side assertion — a fixture that never re-loads cannot tell the
fixed sanitizer from the current one.

### Pre-existing, verified

```bash
git show 2e2c8c00:src/app/settings-types.ts | sed -n '/^export function sanitizeAiConfig/,/^}/p' | grep -c actionSuggestions
```
→ `0` at the merge base, i.e. the field was already being dropped before this branch existed.

---

## 166. An UNDONE `bulk.delete` corrupted the completion trend permanently — CLOSED

Opened 2026-08-17 by a cold review of the §163 fix round; **closed the same day**, in the round that
found it. **Introduced by §163's user half**: the user path previously logged nothing at all, so
there was no forward row for an undo to contradict. The AI path has emitted the same `bulk.delete`
LOGGING shape since the kind was minted, but never the defect — the AI dispatcher takes no undo
capture, so an AI mass delete can never be followed by an `undo` row (last bullet).

`completion-trend.ts` reconstructs history by walking the activity log BACKWARD from the current
total (`total -= dTotal`, with `dTotal -= bulkTaskCount(e.args)` for a `bulk.delete`). `undo` was a
member of neither `COUNT_KINDS` nor `BULK_TOTAL_KINDS`, so the walk ignored it.

Scenario, with 40 tasks:

1. User bulk-deletes 10 → `bulk.delete 10` is logged, current total 30.
2. User presses Undo → the 10 rows come back, current total is 40 again.
3. The `undo` row was ignored by the walk, but the `bulk.delete 10` row was not.

Every reconstructed day before that point read a total of **50** against a truth of 40 — silently,
until the entry aged out of the 500-entry ring.

★★★ **THE DIRECTION IN THE FIRST DRAFT OF THIS SECTION WAS BACKWARDS**, and it is recorded rather
than quietly overwritten because it is the same slip in the same file twice. It said "the whole
historical curve sits **above** the truth". `percent` is `done/total`, so a denominator reconstructed
too HIGH pushes every point DOWN — the curve sat BELOW. §163's own defect is the mirror (an IGNORED
`bulk.delete` leaves the total too LOW, which inflates), and the source comment for it states that
correctly; this section reached for the same word without redoing the division.

Measured, not reasoned — but NOT on the 40-task scenario above, which has only ONE event day and
therefore returns `[]` (`days.length < 2`). The numbers come from the test's own fixture in
`completion-trend.test.ts`: two `task.created` days, then `bulk.delete 8` and its `undo` on a third,
against a live 2 done / 10 total. That reconstructs to `[12, 11, 20]` pre-fix and `[22, 20, 20]`
after. ★ So the fix RAISES the two HISTORICAL points; the third is 20 either way, because the last
event day's end state is `currentDone/currentTotal` by construction and no walk can move it. An
earlier revision here said "every historical point" and attached the 40-task scenario as its source —
both caught by a cold review, and the second is the worse error: a reader reproducing from the stated
scenario gets an empty series and concludes the section is fiction.

### How it was fixed

The walk could not reverse the undo from what was stored: both writers logged a bare count and no
kind. `useUndoStack` now appends `(kind, count)` PAIRS after the row's total-rows arg — one pair per
distinct kind in the batch, built by `reversedKindCounts` from data the stack already held as
`UndoMeta.kind`/`.count` — at all four sites (`commitUndo`, `undoThrough`, `redo`, `redoThrough`).
`completion-trend.ts` decodes them in `reversedForwardDelta` and applies the sum with the direction's
sign: an `undo` subtracts the reversed ops' forward delta, a `redo` re-applies it.

Nothing else can see the new args. `activityUndo`/`activityRedo` interpolate `{0}` only, and `t()`'s
`{1}` replacement is a no-op, so every rendered message is byte-identical — which covers the activity
panel (`activity-log-panel.tsx`), the AI-facing `renderActivityEntry` (`activity-prompt.ts`), and
`historySearch`, which searches that rendered text. The panel's own search matches `row.message` and
`row.kind`, never the raw args. `sanitizeActivityEntry` preserves arity with per-element coercion and
caps nothing. ★ Named individually because an earlier revision presented a shorter list as if it were
exhaustive and omitted the two consumers THIS branch adds — the conclusion held, the audit did not.

★★★ **THE FIRST CUT OF THIS FIX INTRODUCED A SECOND DEFECT, and it is recorded because the shape is
the reason to enumerate call sites rather than reason from a kind.** Reading undo rows is only sound
where the FORWARD side of the same op is also read. Four sites capture `kind: "task.deleted"` — two
in `use-bulk-operations.ts`, one in `use-task-row-handlers.ts`, and `use-tasks-dedup.tsx`. The first
three pair it with `bulk.delete N` or `task.deleted`; the dedup logs only **`ai.taskDedup N`**, which
belonged to neither set. So the forward walk contributed 0 while the new reversal contributed +N, and
an undone dedup inflated every earlier day — a NEW corruption on a path that had merely been
incomplete, since before the reversal both halves were silent and cancelled. `ai.taskDedup` joined
`BULK_TOTAL_KINDS`, which also closes the pre-existing blind spot: its `args[0]` is `removedCount`,
and `applyMerges` returns `removedCount: removed.length`, so both directions are exact by
construction. To re-derive the four, grep `src/app` for a `capture` call whose kind is the
task-delete one, excluding tests AND `completion-trend.ts` — whose comment describes that search
rather than quoting it, because a comment spelling its own search string is matched by it and reports
two phantom sites. (That is the third recorded instance of a self-matching grep in this repo, and a
cold review caught this one after the same trap had already been written into `AGENTS.md`.)

★★ **EVERY GATE WAS GREEN OVER THAT DEFECT** — full suite, coverage, shuffled, dup — and four
mutants had been killed. No test paired a dedup with an undo, and a mutation score says only that
some assertion fired, never that a caller was fixtured at all. It was found by enumerating the
capture sites while answering "should we run another review?", i.e. by the question rather than by
the round.

★ `jira.sync` and `history.restore` also move the total and stay out of both sets on purpose:
`jira.sync`'s `args[0]` fuses creates and updates (`added + pulled`) and `history.restore` replaces a
whole workspace, so neither carries a usable delta — and neither takes an undo capture, so the
reversal cannot reach them.

★★★ **THE FIRST CUT SHIPPED A THIRD DEFECT — a documented "acceptable residual" whose justification
was false — and this is the one worth carrying.** That cut wrote a SINGLE kind per row, and `""` when
the batch spanned several kinds, which the trend then ignored. The docstring called that acceptable
because "every single-entry undo is homogeneous, i.e. the common case is exact". Both halves true;
the inference worthless. **A single-entry undo never reached the batch helper at all** — `commitUndo`
and `redo` pass `meta.kind` straight through — so the reassurance described a function in which the
`""` case could not arise. The `""` case arises ONLY under the caret's undo-through/redo-through,
where a multi-entry batch is the entire purpose of the control. Delete 50 tasks, edit one field, undo
through both: one mixed row, the 50-row correction discarded, §166 reproduced two clicks from the fix
meant to close it. Per-kind pairs are exact for every batch, so there is no mixed case and no `""`
left. ★★ The lesson is not "pairs are better" — it is that a residual's justification must name the
code path the residual actually occurs on. This one named the path it could not occur on, and the
sentence read as reassurance precisely where it was least true.

★★ **`redoThrough` was one of four log sites with NO assertion at all**, and a cold review's mutant
proved it: regressing its args to `""` left the entire suite green. It reaches the app through a
single prop (`task-manager.tsx` `onRedoThrough`), so `use-undo-stack.test.tsx` is its only possible
detector. A regression there reopens §163's inflation on the redo side. Both branches — mixed and
homogeneous — are now pinned on each of undo-through and redo-through. ★ Pair ORDER differs between
them (undo runs newest-first, redo oldest-first) and carries no meaning; `completion-trend.test.ts`
pins that both orders give the same answer.

★ `task.created` and `bulk.delete` are both handled in the reversal table although **neither can
appear in a pair today**: no `capture()` call passes either as its kind, since a delete captures
`task.deleted` whatever kind its activity row uses. Leaving a total-moving kind out of that table is
precisely the asymmetry §163 and §166 each cost a release to find. `task.created` is pinned by a
synthetic-fixture test; `bulk.delete` is not, and a cold review flagged the earlier text for
implying it was live when only `task.created` had been marked as speculative.

★★ **DO NOT "FIX" THIS BY REVERTING §163's USER HALF** — the advice stands even though the defect is
closed, because the temptation returns whenever a trend number looks wrong. Before §163 the user path
logged nothing, so every user bulk delete made the curve wrong in the OTHER direction (−N on every
prior day) and did so on EVERY delete, not only undone ones. Reverting trades a narrow error for a
universal one.

★ The AI's `delete_all_tasks` takes no undo capture at all, so it never reached this state — the user
path inherited an undo route its mirror does not have, which is why mirroring the AI writer's logging
was necessary but not sufficient.

## 167. Bulk edit on the changes register bypassed `applyChangeStatus` — CLOSED 2026-08-18

Found by review during the 0.245.0 slice, and CLOSED in the same slice after a second review round.
Recorded because the shape recurs: a register grew a new entry point that held an invariant while an
OLDER entry point on the SAME table did not, so the two disagreed and a user could not tell which
path they were on.

The defect: `applyBulk` spread the raw status onto the row, so a bulk sweep to a DECIDED status
(Approved/Rejected) left `decisionDate` unset, and a sweep back to a pending status left a stale one.
`pushableChanges` filters on `!!c.decisionDate`, so bulk-decided changes were silently dropped from
the Outlook decision-date write-back — not a cosmetic gap.

★★★ **THE FIX WAS NOT THE ONE-LINE FIX THIS ENTRY ORIGINALLY PRESCRIBED, and the difference is the
lesson.** The entry said: "in `applyBulk`, replace the status spread with `applyChangeStatus(...)`;
the panel already imports the helper and already holds `today`, so nothing else has to move." That
was true of `applyBulk` and MISSED the second bypass entirely — the AI dispatcher wrote `status`
raw on both `create_change` and `update_change`, with the full enum exposed to the model. Taking the
one-line fix would have left the register half-correct while this entry read as closed.

★★ And the dispatcher could not take that same line. `sanitizeChangeItem` falls back to `"Proposed"`
for anything off the enum, so a mistyped status silently DEMOTED a decided change; routing the MERGED
status would then have cleared its `decisionDate` as well. It needed a gate on the model's RAW value
— `applyModelChangeStatus` — mirroring the task dispatcher's `isTaskStatus` shape. `applyChangeStatus`
also had to MOVE to `change-log.ts`, because the dispatcher cannot import a React module.

★★★ **"SOLE WRITER" WAS NEVER TRUE AND IS STILL NOT — what is exclusive is the TRANSITION, not the
field.** This entry asserted `applyChangeStatus` was "the sole writer of the status/`decisionDate`
pair", and two prose sites in the code said the same. Four writers of `decisionDate` remain by design
and are enumerated in `change-log.ts`'s docblock: the Outlook two-way pull writes the date ALONE
(`use-calendar-integrations.ts`, `withDate`), `chat-tool-defs.ts` exposes `decisionDate` as its own
model-writable field, and `ai-project-proposal.ts` + `templates.ts` build rows through the sanitizer
alone — both passing it BY REFERENCE, so a call-shaped grep misses them. Those two rebuild a register
from an untrusted blob rather than transitioning a live row, which is why they are exempt.

```bash
# every routing site, bare name so by-reference passes are visible too
grep -rn "applyChangeStatus\|applyModelChangeStatus" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

★ The status/`decisionDate` invariant is now held at all four transition points (row select, modal,
bulk, dispatcher), matching what the task register does through `applyStatusChange`.

## 168. Template import drops every register's note log — open, pre-existing

Capturing a template from a workspace assigns the live entity arrays verbatim
(`templateFromWorkspace` does `seed.changes = ws.changes`, and the same for `tasks` and `raid`),
so a captured template really does carry the note logs. Import then throws them away, because the
entity sanitizers it runs are DOM-free and therefore cannot carry rich HTML:

```bash
grep -n "seed.changes = \|seed.raid = \|seed.tasks = " src/app/templates.ts
grep -n "sanitizeArr<" src/app/templates.ts
# ★★ THE THREE SANITIZERS DO NOT LIVE IN ONE FILE, and an earlier revision of this entry cited only
# sanitize-records.ts — evidence for one third of the sentence below. Changes route to
# `sanitizeChangeItem` (sanitize-records.ts); tasks and RAID route to `sanitizeSeedTask` /
# `sanitizeSeedRaidItem`, which are LOCAL to templates.ts. Both files must be checked:
grep -n "function sanitizeSeedTask\|function sanitizeSeedRaidItem" src/app/templates.ts
# the sanitizers themselves never mention the field, so it is dropped by construction — 0 for BOTH
grep -c "noteLog" src/app/sanitize-records.ts src/app/templates.ts
```

Changes, tasks and RAID all behave the same way. Same class as the `sanitizeRaidItem` behaviour
AGENTS.md already records, reached through a different door.

★★★ **It CANNOT be fixed by re-attaching the log after sanitizing** — the shortcut that fixed the
AI-write path. That path runs no rich pass at all, so a re-attached log would be stored
UN-SANITISED, and `rich-text-plain.test.ts`'s import-graph guard bans `templates.ts` from importing
the DOMPurify-bearing modules precisely so this cannot be done by reflex. A real fix needs a
sanitised carry that stays DOM-free — the same shape as the open item on `sanitizeSeedTask`
(§36(a)), and it should probably be solved once for both.

## 169. TimeLog period keys are derived at FETCH time from the granularity, then cached — open

`aggregateActuals` takes `granularity` as a required argument and buckets each booking with
`periodKeyForDate(it.date, granularity)`; `use-timelog-sync.ts` calls it during the fetch and
persists the resulting aggregate. Changing the plan granularity between the fetch and the apply
therefore lands applied hours under period keys the budget report never reads.

```bash
grep -n "granularity" src/app/timelog-actuals.ts
grep -n "aggregateActuals(" src/app/use-timelog-sync.ts
```

★★ **This is NOT the symptom 0.245.0 fixed and must not be recorded as covered by it.** The
attribution trap that slice addressed made hours land under `unattributed`; this one attributes them
correctly and files them under an unreadable key. It also does not suppress plan rows, which is why
it was invisible during that investigation. It is a live corruption path in the same cache, and the
Refresh & re-apply action added in 0.245.0 happens to clear it — which makes it easy to mistake for
fixed when a user stumbles onto the workaround.

★ The argument is required rather than defaulted (a missing one is a tsc error, and the declaration
carries a comment saying so), so the hazard is a STALE cache, never a wrong call.

## 170. The `ChangePanelMemo` docblock claims a `useCallback` the parent does not do — open, pre-existing

The comment above `memo(ChangePanelBody)` says the memo "relies on handler props being stable refs
(the parent wraps them in `useCallback`)". It does not: `task-manager.tsx` builds `guardEdit(handler)`
unmemoized during render, so a fresh identity arrives on every parent render and the memo cannot
bail.

```bash
grep -n "memo(ChangePanelBody)" -B 4 src/app/change-panel.tsx
grep -n "guardEdit" src/app/task-manager.tsx | head
```

Same class as the `ResourcesPanel` memo AGENTS.md already documents as aspirational — but that one
is honestly labelled and this one is not, so a reader takes the comment as a live guarantee and may
"preserve" an optimisation that has never run. Either correct the comment or delete the memo; do
NOT cite it as a reason anything is fast. ★ Memoizing `guardEdit` is not the fix on its own — it is
one unstable family among several, the same finding recorded for `ResourcesPanel`.

## 171. The axe gate now scans the Time bookings EMPTY STATE, not the table — open, knowingly accepted

`e2e/seed.ts` seeds file mode and never enables the Timelog integration, and 0.245.0 gated the page
on `cfg.enabled`, returning `TimelogNotConfigured` when it is off. "Time bookings" is in
`A11Y_VIEWS`, so the view is still scanned — it just renders the not-configured screen from now on.

```bash
grep -n "enabled" e2e/seed.ts            # no timelog settings are seeded
grep -n "TimelogNotConfigured" src/app/timelog-panel.tsx
```

★★ The table's own controls — the per-row link pickers, the fetch/apply toolbar, the clear-all
action — are therefore no longer covered by ANY gate. That is the seeded-empty-state blind spot
AGENTS.md warns about, newly created rather than merely inherited: this view USED to render a real
table under the scan.

★ Two ways out, and the choice has not been made: seed Timelog settings in `e2e/seed.ts` so the
table renders again, or accept the loss and pin those controls with unit tests instead. Recorded so
the acceptance is deliberate rather than silent.

★★★ IT ALSO KILLED AN e2e ASSERTION, AND NOTHING LOCAL SAW IT. `e2e/seed-content.spec.ts` carried
"seeded timelog project links reach the app, not just IndexedDB", which asserted `Clear link – 701`
and `– 702` — rows that the gate makes unrenderable. The entry above reasoned about the axe scan and
stopped there, so the second consumer of the same render went unexamined until pipeline #6179 went
red on it. The test is now the INVERSE: it pins the not-configured screen, and says in its own body
that restoring the old lines requires seeding the settings FIRST.

★★ So the blind spot is one step worse than this entry first said: the projects and people tables
have no e2e coverage of ANY kind now, not merely no axe coverage. What survives is
`timelog-panel.test.tsx`, which pins the row-qualified `${timelogMatchClear} – 99` label in two
places — the row-UNIQUENESS rule, not the rendering path.

★ General shape, worth more than this instance: a render gate has as many consumers as there are
suites that render the view. Enumerate them (`grep -rn "Time bookings" e2e/`) rather than reasoning
about the one that came to mind.

## 172. A partial TimeLog fetch overwrote the cached aggregate, and the manual Apply path would write it — CLOSED 2026-08-18

Opened while fixing the reapply half of this hazard in 0.245.0 and deliberately not closed there,
because the fix changes the persisted cache shape. Closed in the same unreleased version.

### The hazard

`fetchBookingsForProjects` is fail-soft per project: a project whose fetch throws increments
`failedProjects` and the loop continues. It then called `finish()` — which writes both
`sync.aggregates` and the persisted `aipm-cockpit:timelog-actuals` entry — with **only the projects
that succeeded**. `failedProjects` was reported to the caller and surfaced as a toast, but nothing
marked the stored aggregate as short.

Apply OWNS every allocation line of a routed period: `buildApplyPlan` emits a row for every line whose
`next` differs from `current`, and a line TimeLog did not route to this time gets `next = 0`. So a
bucket fed by two TimeLog projects, refreshed while the second project's fetch throws, re-applied at
the first project's hours alone and **erased the second's** — a silent write of real booked hours to a
lower number.

★★ "Present and non-empty" was never the test. A partial aggregate is well-formed, yields plan rows,
and reads exactly like a good one; only the loop that swallowed the error knows.

### What shipped

The register offered two shapes. **Shape (b) — mark the entry partial and gate every apply path on the
flag — was taken**, because shape (a) (refuse the overwrite outright) throws away the successful
projects' fresh data, which is a second loss to avoid a first.

- `ActualsCacheEntry.partial?: boolean` (`timelog-actuals-store.ts`). ★★ **ABSENT MEANS COMPLETE**,
  which is what makes it back-compatible: an entry written before the field existed keeps its old
  meaning, and an older client on the same device ignores an unknown key. Read `=== true`, never
  truthiness — `isEntry` deliberately does NOT reject a malformed value, because rejecting would drop
  the whole entry over a flag and treating a hand-edited `"false"` as partial would disable Apply with
  no way back but Clear all. Failing OPEN on garbage only restores the pre-existing behaviour.
- `finish(items, usersOverride, isPartial)` sets the state and persists the flag. ★★ It is a
  PARAMETER because nothing about `items` can reveal that a project threw.
- ★★★ **All FOUR savers carry it, not just `finish`'s.** The entry is rewritten WHOLE, so a saver that
  omits the field CLEARS it — `loadDirectory`, `loadManagedProjects` and `removeUsers` would each have
  re-opened this through a path with nothing to do with fetching. Pinned by a test that flags the
  cache partial, calls `removeUsers`, remounts, and asserts the flag survived.
- `canApplyToBudget` (`timelog-guards.ts`), evaluated by BOTH the Apply button's `disabled` and
  `openConfirm`.
- `timelogApplyPartial` EN/DE, rendered by `TimelogApplyNotices` — extracted from `timelog-panel.tsx`,
  which was close enough to the 800-line ratchet that a third inline notice was not worth spending on.
  It LEADS the two existing notices, because it is the only one that DISABLES Apply rather than
  explaining a partial write.
- The per-user `fetchBookings` path got the same treatment off `failedEmployees > 0`. It is not wired
  into the panel today; leaving it unflagged would have been a trap for whoever wires it back.

★★ **It was also the FIFTH instance of §74, and a LATENT one.** `openConfirm` returned early on
`!overlay` alone while its button carried `applyDiff.length === 0 || isPopout` — but `openConfirm` has
exactly ONE caller, that button, so nothing could reach the gap. An earlier revision of this entry
called it "the one that had teeth" and named a non-button caller that does not exist; a cold review
refuted it. Both sites now evaluate the one predicate, which is worth doing for a latent drift — just
do not sell it as a live one.

★ Recovery is a CLEAN re-fetch (which sets the flag false) or Clear all. There is deliberately no
"apply anyway" — the whole point is that the aggregate is unfit to write.

★★ Both commands below are SCOPED to the sentence they settle, and the first cut of this entry got
that wrong in the way this repo keeps recording: it ran a bare `grep -n "partial"` over the hook
(**9** hits — a `useState`, three comments and the return object alongside the four savers) under a
comment telling the reader to expect four, and a bare `grep -n "canApplyToBudget"` over two files
(**5** hits) under "two call sites". Neither was false; both handed the reader the filtering the
command was supposed to have done.

```bash
# every saver carries the flag — four sites, each passing `partial`
grep -n "saveActualsCache(projectId" src/app/use-timelog-sync.ts
# one predicate, exactly two call sites
grep -n "canApplyToBudget(applyState)" src/app/timelog-panel.tsx
```

### The second surface — missed on the first cut, and the reason to enumerate by DATA, not by CONTROL

★★★ **`BudgetUnappliedNotice` reads the same cache entry and the first cut did not gate it.** It was
left open deliberately, on the reasoning that its invitation stayed true and the Timelog panel would
explain the block on arrival. **That reasoning was wrong, and two independent cold reviews said so from
opposite directions.** The string it renders is not a statement that hours exist — it is an
instruction: "those buckets' actual hours will not change until you apply them in Time bookings"
(`budgetUnappliedActuals`) — and applying in Time bookings is precisely what `canApplyToBudget` now
refuses. Worse, all FOUR of its signals are DERIVED from the short overlay (`affected`/`withheld` by
running `buildApplyPlan` over it, `missing` by `bucketsMissingAllocations`, `unattributed` by having
been summed during the same short fetch), so it reported the erasure this entry exists to prevent as
though it were work waiting to be done. It also broke an invariant stated in that file's own source:
"the two surfaces cannot describe one cache differently."

A partial entry now SUPPRESSES all four and renders one line, keeping the "Go to Time bookings →"
button because that is where the Refresh that repairs it lives.

★★★ **THE LESSON IS THE ENUMERATION.** This entry told the fixer to gate "every apply path" and handed
them `grep -n "setPendingApply" src/app/timelog-panel.tsx` to find them. That command finds every
control that WRITES — and this surface writes nothing, so it was structurally invisible to the
instruction while being the first thing a user actually reads. **Enumerate every consumer of the
POISONED DATA, not every caller of the dangerous FUNCTION**, and reach for a command over the STORE
rather than the writer:

```bash
# consumers OUTSIDE the sync hook that owns the cache — the surfaces that can
# render or act on a short aggregate. Excluding the hook is what makes the
# output readable: it seeds five slices from the same loader.
grep -rn "loadActualsCache" src/app --include=*.ts --include=*.tsx \
  | grep -v "\.test\." | grep -v use-timelog-sync
```

★★★ **IT RETURNS SIX LINES ACROSS THREE FILES BESIDES THE STORE ITSELF — TWO OF THEM REAL READS, AND
THE FIRST CUT OF THIS SECTION GATED ONE.** (Six because two are the `import` lines and one is the
`export function` declaration; read the file names, not the line count.) The command was written
into this entry as the lesson and then not run against it — the same "attach a command and run it"
failure the entry above it is about, one section later, by the same hand:

1. `budget-unapplied-notice.tsx` — the CTA described above. Gated: all four signals suppressed.
2. `workspace-section.tsx` → `budget-panel`'s per-person breakdown rows (`actualsByBucket`).
   Display-only, no CTA and no write, and deliberately **NOT** suppressed: `docs/open-followups.md`
   §122 already records that these rows disagree with the role row above them for four other
   reasons, and its case 3 is precisely what suppression would look like — a missing figure is not
   better than a short one. A partial fetch is now case 5 there.
3. `budget-panel.tsx` — a comment, not a read.

### Two narrower gaps closed at the same time

★★ **The flag was wired to "a call threw" while it documents itself as "the aggregate is short".** Both
fail-soft loops `break` on a cancel and fall through to `finish`, so a run cancelled BETWEEN iterations
reached it with `failedProjects`/`failedEmployees` still 0 and persisted a truncated aggregate as
complete. The predicate is now `... > 0 || signal.aborted` on both paths.

★ `finish`'s `isPartial` parameter is REQUIRED, with no default. A default would let a future third
caller silently persist `partial: false` and CLEAR the flag — the same wholesale-rewrite hazard the
four savers carry a note about. Required makes it a typecheck error instead.

★ STILL OPEN, and not this entry's to fix: `callPaged`'s `MAX_PAGES` cap (100 × 500 rows per project)
short-returns with no error and no `failedProjects`, so it is the same "short aggregate reads as
complete" class by a third route. Pre-existing, and almost certainly unreachable at real data volumes;
recorded because nothing anywhere else says it.

## 173. The load `catch`'s mid-flight-adoption branch publishes a POPULATED thread list with `available: false` — open, narrow

Found by a cold review of the fix round on 2026-08-18 (`feat/ai-recall-b2c`), not by any gate.

`useChatThreads`' load effect has a `catch` branch that adopts a project switch which landed while
the fetch was in flight. It sets the load-failure flag, but deliberately KEEPS the rows it already
had (filtering `prev` down to the adopted `projectId`) and sets `loadedProjectId`, so
`threadsMatchProject` is true. The registry publish therefore emits a POPULATED `threads` array
alongside `available: false`.

★★ That is the advertise-then-deny contradiction the load-scoped `available` narrowing was
written to remove, INVERTED and surviving it.
`useChatSearchBindings` builds the ambient chat pointer from `published.threads` and never consults
`available` — so the system prompt still says "There are N earlier conversations in this project
— Use search_chats to read them", the model obeys, and `runChatSearch` answers
`coverage: "unavailable"`. Reproduce the blindness, which is the load-bearing half:

```bash
grep -n available src/app/use-chat-search-bindings.ts   # exit 1 — never reads it
sed -n '/const adopt/,/^      }/p' src/app/use-chat-threads.ts
```

★ REACHABILITY IS NARROW AND THE PRODUCTION IMPACT IS **UNVERIFIED**: it needs a project switch
landing mid-flight AND at least two same-project rows in `prev`, since `summarizeChatThreads`
excludes the active thread and a one-row pointer renders nothing. The code path is verified by
READING, not by reproducing it — do not record it as observed.

★★ TWO REPAIRS, and the obvious one is wrong. Clearing `threads` in that branch would make the
pair consistent by DISCARDING rows the user can still read in the sidebar, which is a worse outcome
than an inconsistent hint. The honest fixes are either (a) leave the load-failure flag unset on the
adoption branch — nothing stopped us looking, we merely looked at a different project — or
(b) gate the ambient pointer on `available` so both surfaces speak with one voice. (b) also closes
§174.

## 174. The FIRST publish in Turso mode claims `available: true` over an empty list while the load is still in flight — open, pre-existing

Same review, same day. NOT a regression — it predates the `available` work and is recorded here
only because that work reasoned carefully about the opposite error and never mentioned this one.

The load-failure flag starts `false`, so the first registry publish in Turso mode is
`{threads: [], available: true}` — which downstream becomes `coverage: "turso"`, and
`chat-tool-defs.ts` defines that to the model as "past conversations WERE searched". The fetch has
not returned. So a `search_chats` racing the first load can tell the user a topic was never
discussed, which is the exact failure mode the load-failure branch was added to prevent, arrived at
from the other side.

★★ "Not yet looked" is a THIRD state and the boolean cannot hold it. `available` today conflates
"looked, nothing there" with "have not looked yet". A fix means either seeding the flag so the slot
reads unavailable until the first load SETTLES (either way), or widening `ChatCoverage` past its two
members — the second changes a tool-visible contract and needs its description updated in the same
commit, or the model is handed a value the prose does not define.

★ Window is small but not theoretical: the pointer and the tool are both reachable on the first
turn after a project opens.

## 175. `buildChatPointerBlock` is no longer bounded by any test — open, safe by single-producer accident

Same review. Introduced BY the fix that moved the thread-title cap to its producer: that commit
deleted the four size tests from `chat-recap.test.ts` because their subject (`inlineTitle`'s clip)
no longer existed.

`buildChatPointerBlock` accepts an arbitrary `ChatPointer` and does no clipping of its own. Every
value it can receive is bounded TODAY because `summarizeChatThreads` is its only producer and caps
each title at `THREAD_NAME_MAX` via `threadTitle`. Nothing enforces that. A second producer — a
test helper, a replay path, a future digest — reaches the system prompt unguarded, on the UNCACHED
half of the prompt, with the whole suite green.

```bash
grep -rn "ChatPointer\b" src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

★ The cap belongs where it is; this is not an argument to put a second one in the renderer. It is
an argument for ONE test that feeds `buildChatPointerBlock` an over-long title directly and asserts
the block stays bounded — the guard that makes the single-producer property checkable instead of
merely true.

## 176. The chat-pointer title path flipped from flatten-then-cap to cap-then-flatten, and no test pins either order — open, cosmetic

Same review. Behaviour delta, deliberately shipped, recorded so it is not mistaken for a bug later.

Before the cap moved, `inlineTitle` collapsed interior whitespace (`\s+` —> " ") and THEN clipped.
Now `threadTitle` clips first and `inlineTitle` flattens what survives. A title carrying a long run
of interior whitespace therefore yields FEWER visible characters in the prompt block than it used to,
because the run is counted against the cap before it is collapsed.

★ Bounded either way (the cap plus one ellipsis), model-facing only, and no storage or export path
is involved ★★ but NO test pins either ordering, so a future edit can reverse it silently in
either direction. If it is ever worth pinning, pin it at `threadTitle`, where the clip now lives.

---

## 177. Field-patch undo residue — whole-row paths still revert unlisted concurrent writes, deliberately out of scope

§50's field-patch conversion (closed 2026-08-18) made the five converted PANEL bulk-edit sites immune
to the write-through clobber BY CONSTRUCTION — a field patch merges only the fields the op itself
touched, so a concurrent edit to a DIFFERENT FIELD of the row survives, not just
`noteLog`/`outlookEventId`. ★ It does NOT preserve a concurrent write to a different KEY of the same
object-valued field (§178), and the five are not the only `bulk.edit` emitters (§50's Resolution
carries both corrections and the greps). That property does not extend to every writer in the app,
and this entry records what was deliberately left out.

★★ **The whole-row paths that remain still revert every concurrent change OUTSIDE
`WRITE_THROUGH_FIELDS`.** Reference-data cascades, the resource directory, task dedup
(`use-tasks-dedup.tsx`), the alloc plan (`use-alloc-plan.tsx`), the BUCKETS half of the tasks
bulk-edit composite (`use-budget-buckets.ts`), and dependency stripping on delete
(pinned against, not fixed, by the two `use-task-row-handlers.test.ts` tests §50 added) all still
capture whole rows. Undoing any of them reverts every field the row carried at
capture time, including one a background writer changed in the meantime — the exact §50 shape.

★★ **TWO CORRECTIONS TO THIS PARAGRAPH'S OWN EARLIER TEXT, both measured.** (1) It said these paths
capture "via `capturePart`" — that is THREE of them, not all: the reference-data cascades
(`use-reference-data.ts`), the resource-directory DELETES (`use-resource-directory.ts`) and the
BUCKETS half of the tasks bulk-edit composite (`use-budget-buckets.ts`, whose part carries whole
`removed`/`edited` rows). Task dedup, the alloc plan, the resource directory's BULK EDIT and
dependency stripping on delete all use the single-array `capture()` instead. (2) It said the shape is
"just not on a `bulk.edit` site", which contradicts §50 and is false twice over — the alloc plan and
the resource directory's bulk edit BOTH emit `kind: "bulk.edit"`.

★★★ **BOTH COMMANDS BELOW ARE NARROWED FROM THE BARE GREPS THIS ENTRY USED TO CARRY, and each bare
form was wrong in a DIFFERENT direction.** `grep -rn "capturePart"` OVER-reports — it returns the
import lines and the source comments that merely name the helper. But the obvious narrowing,
`capturePart({`, UNDER-reports and hides the very site the sentence above was missing: the
budget-buckets call is `capturePart<BudgetBucket>({`, so a call-shaped grep with no generic in it
drops it silently. The form below admits an optional type argument — the repo's standing
"enumerate call sites with ALL call shapes" rule. Read the `kind:` hits rather than counting them:
comment lines quoting the literal are hits too.

```bash
grep -rnE "\bcapturePart(<[A-Za-z0-9_, ]*>)?\(" src/app --include=*.ts --include=*.tsx \
  | grep -v '\.test\.' | grep -vE ':[0-9]+: *//'
grep -rn 'kind: "bulk\.edit"' src/app --include=*.ts --include=*.tsx | grep -v '\.test\.' \
  | grep -vE ':[0-9]+: *//'
```

A NEW write-through field added to an entity escapes
`WRITE_THROUGH_FIELDS`/`WRITE_THROUGH_KEYS` on these paths silently: nothing fails, the field is simply
reverted on undo like any other.

Two ways out, neither taken here:
- Convert the remaining sites to field patches where the op is genuinely field-shaped (most of the
  list above edits, rather than restructures, the row).
- Derive `WRITE_THROUGH_FIELDS`/`WRITE_THROUGH_KEYS` from something structural (a per-entity
  "concurrently-writable" field list on the type, or similar) rather than hand-maintaining two copies
  — see the duplication note below, which is the sharper version of this same risk.

This slice deliberately scoped these sites out — converting every whole-row capture in the app was not
in §50's blast radius, and doing it inside the fix round that closed §50 is how a regression ships (the
same reasoning §50 itself gave in 0.211.1 for not touching shared undo machinery mid-batch).

★★ **The write-through field list is duplicated, and that duplication is itself residue.**
`WRITE_THROUGH_FIELDS` (`src/app/undo/use-undo-stack.ts`) governs what a whole-row undo PRESERVES;
`WRITE_THROUGH_KEYS` (`src/app/undo/field-groups.ts`) governs what a bulk-edit field patch CAPTURES.
Both are hardcoded to the same two names, `["noteLog", "outlookEventId"]`. They are deliberately
SEPARATE constants — different layers, and `field-groups.ts` must not import the hook — and each
carries a doc comment cross-referencing the other, but a third write-through field means editing BOTH
by hand. Nothing enforces they stay in sync; a future field added to one and not the other would fail
silently in exactly the shape this whole entry is about.

```bash
grep -n "WRITE_THROUGH_FIELDS" src/app/undo/use-undo-stack.ts
grep -n "WRITE_THROUGH_KEYS" src/app/undo/field-groups.ts
```

---

## 178. A field-patch undo still reverts a concurrent write to another KEY of the same object-valued field — open, pre-existing

§50's Part B captures field PATCHES rather than whole rows, and its Resolution originally claimed that
this "preserves EVERY concurrent edit on that row". It does not. `buildBulkFieldEdits` diffs
key-by-key and stores the WHOLE VALUE of each changed field (`pick(before, changed)`); the BULK field
runner `captureFieldPart` then merges those values wholesale over the live row
(`const merged = { ...row, ...pick(edit) }`). So the unit of preservation is the FIELD, not the key
inside it — a concurrent writer that produced a new object or
array for a field the op also touched loses its change, exactly as a whole-row capture would.

```bash
grep -n "pick(before, changed)" src/app/undo/field-groups.ts   # whole VALUE captured
# ★★ The BULK runner, not the single-row one. `{ ...r, ...patch }` in the same file is
# `captureFieldEdit`'s modal-save path — it proves the same property about a DIFFERENT runner,
# and it exits 0 and prints a line, so citing it reads as verified when it is not.
grep -n "merged = { \.\.\.row, \.\.\.pick(edit) }" src/app/undo/use-undo-stack.ts   # merged wholesale
```

**Reachable today on `Stakeholder.raci`**, which is a `Record<string, RaciRole>` keyed by milestone id,
and whose only writer returns a whole new map:

```bash
grep -n "raci: Record" src/app/types.ts
grep -n "export function setRaciRole" -A 12 src/app/stakeholders.ts   # returns { ...s, raci }
```

Sequence: RACI panel → **Suggest RACI** → apply across stakeholders (one `bulk.edit` field patch whose
changed field is `raci`) → the user assigns a cell for a DIFFERENT milestone on one of those
stakeholders → Ctrl+Z. The bulk suggestion is undone AND the user's hand-assigned cell silently
vanishes, because the patch's `before.raci` is the whole pre-suggestion map.

Same shape wherever an op's changed field holds a collection another writer can rewrite —
`Task.labels` (`string[]`), `RaidItem.linkedTaskIds` (`number[]`). ★ NOT `Task.blockers`: that is a
plain `string`, so whole-value capture is exactly right there and there is no sub-field to lose.

**Why it was left.** Pre-existing, not a regression — the whole-row capture this replaced lost the
same cell and more, so Part B strictly narrowed the defect rather than introducing it. Closing it
needs per-key diffing and per-key merging of object-valued fields, which is a different data model
for a patch (`{path, before, after}` rather than `{field, before, after}`) and a different restore
runner. That is a design slice, not a fix-round edit to shared undo machinery — the same reasoning
§50 gave in 0.211.1.

---

## 179. The undo/redo DELETE branch is not covered by the preserve mechanism, and a write-through write between undo and redo duplicates the row — open, pre-existing

§50's Part A backstop is wired into the EDIT branch only. Both `applyPreserved(item, …)` call sites
sit inside an `op === "edit"` loop — one in `applyUndoRestoreWithRemap`, one in `applyUndoForward`:

```bash
grep -n "applyPreserved(item" -B 3 src/app/undo/undo-stack.ts
```

The delete branch instead confirms a row's IDENTITY before removing it, by deep-equality against the
capture-time image:

```bash
grep -n "rowsEqual(r, recovered)" src/app/undo/undo-stack.ts
```

A write-through field that changed on a RESTORED row breaks that equality, and the failure is not a
no-op — it desynchronises the two stacks and then mints a duplicate:

1. Delete a RAID item. → undo entry pushed with a delete-image.
2. Ctrl+Z. The row is restored under its original id; the entry moves to the redo stack.
3. Add a note to that row through the notes window. The notes window is write-through and pushes NO
   undo entry, so the redo stack SURVIVES this write (a normal edit would have cleared it — that is
   why this needs a write-through writer specifically).
4. Ctrl+Y. `rowsEqual(live, recovered)` is now false (the live row carries a `noteLog` the recovered
   image does not), so the filter keeps the row — the redo does NOT remove it. The entry still moves
   back to the undo stack.
5. Ctrl+Z. The restore branch now finds `present.has(id) === true`, takes the id-reuse path, and
   splices a SECOND copy of the row in under a freshly minted id.

Result: a duplicate RAID item plus a stale one, from three keystrokes and one note.

**Why it was left.** Pre-existing and unchanged by this branch — `rowsEqual` predates it and the
preserve list did not alter the delete path in either direction. The fix is not "pass `preserve` to
`rowsEqual`" either: the guard exists to stop redo destroying an unrelated live row that reused a
freed id (real data loss), so relaxing it needs an identity notion that is neither whole-row equality
nor id alone. Scoping that inside the fix round that closed §50 is how a regression ships.

---

## 180. `buildBulkFieldEdits` ignores the `FieldGroup` invariants, so a field-patch undo can leave a coupled pair inconsistent — open

`changedFieldGroups` exists because some fields must be captured and reverted TOGETHER —
`TASK_UNDO_GROUPS` couples `status` with `completedDate` (and the three assignee-identity fields),
`CHANGE_UNDO_GROUPS` couples `status` with `decisionDate`. `buildBulkFieldEdits` takes no
`FieldGroup[]` argument and consults none of those constants: it diffs key-by-key and captures
exactly the keys that differ.

```bash
grep -n "export function buildBulkFieldEdits" -A 4 src/app/undo/field-groups.ts   # no FieldGroup param
grep -n "UNDO_GROUPS" src/app/undo/field-groups.ts   # declaration lines ONLY — no read site
grep -n "KNOWN GAP" -A 7 src/app/undo/field-groups.ts                             # the same gap, at the source
```

So if a bulk edit sees only ONE member of such a pair differ, only that member is captured, and the
undo restores it alone — leaving `status: "Done"` with no `completedDate`, or a change whose
`decisionDate` no longer matches its status. Both are invariants the rest of the app reads as
guaranteed (`isTaskDelivered` is `!!completedDate`, so a task can read as closed-but-never-delivered
or the reverse).

**Reachability.** A lone-member difference requires the STORED row to already be inconsistent, and
§183 records a code path that produces one from well-formed data — the Jira CONFLICT merge, which
writes `completedDate` from the user's per-field pick and never `status`. Nothing repairs that on
load: `migrateTask` short-circuits on
`if (statusOk && createdOk) return task;`, so a valid-but-inconsistent pair from an import or a
hand-edited blob survives every load path.

★★ **THE GROUND FOR THAT IS NOT "`applyStatusChange` IS THE SOLE WRITER", WHICH THIS ENTRY CLAIMED
AND IS FALSE.** The Jira path bypasses it: `issueToTaskFields` (`jira-api.ts`) sets `completedDate`
off its own `isDone` flag and `status` off `jiraCategoryToStatus`, and `use-jira-sync.ts` applies
`patch.completedDate` directly. That bypass is deliberate — routing through `applyStatusChange` would
stamp today instead of Jira's resolution date — and AGENTS.md describes it in the Kanban and
task-status bullets. Enumerate the writers before relying on either — and note that the OBVIOUS
sweep cannot do it, because two of the four write the field through an ASSIGNMENT rather than a
property literal, and one of those two is the §183 defect:

```bash
# A bare `completedDate:` misses `templates.ts` outright and returns only the three patch-literal
# sites in `use-jira-sync.ts`, never the conflict merge. Admit both shapes, and the trailing `=`
# that sits at end-of-line:
grep -rnE "completedDate[[:space:]]*[:=]([^=]|$)" src/app --include=*.ts --include=*.tsx \
  | grep -v '\.test\.'
```

**Why it was left.** It is a pre-existing property of the new helper's contract, and the source
already carries the gap as a comment pointing here. ★★ It was left on the ground that no sequence
reached it from well-formed data; §183 removes that ground by supplying the inconsistent row this
entry needs as its precondition, so re-argue the deferral rather than inheriting it. Fixing it means threading the per-entity `FieldGroup[]` through
`captureFieldRows` to every one of the converted call sites — a change to the shared capture contract,
which is exactly the class §50 declined to make inside a fix round.

---

## 181. Four converted registers omit `stampField` on their bulk capture while the tasks bulk edit passes it — open, UNRESOLVED

§50's field-patch conversion wired five PANEL bulk-edit sites to `captureFieldRows`. Exactly ONE of
them — tasks (`use-bulk-operations.ts`) — passes `stampField: "localModifiedAt"`. RAID
(`use-resource-planner.ts`), changes (`use-change-log.ts`), stakeholders (`use-stakeholders.ts`) and
milestones (`milestones-panel.tsx`) pass nothing.

```bash
# the four that omit it, and the one that passes it — five lines, one per register.
# ★ The optional-call and ref-call shapes BOTH have to be admitted: a plain `captureFieldRows(`
#   grep sees neither `args.captureFieldRows?.({` nor `captureFieldRowsRef.current({`.
grep -rnE "captureFieldRows(Ref\.current)?\??\.?\(\{" src/app --include=*.ts --include=*.tsx \
  | grep -v '\.test\.'
# the four source comments that point at this entry
grep -rn "No .stampField. here" src/app --include=*.ts --include=*.tsx | grep -v '\.test\.'
```

What `stampField` does is not in dispute: `captureFieldPart` writes a FRESH `new Date().toISOString()`
into the named field on undo AND on redo. It does not restore the row's prior stamp, and it is not
meant to — the reversal is itself a local modification.

**What is unresolved is which behaviour is right, and two texts written in the same round do not
agree about it.** All four register sites record the omission as an OPEN QUESTION and say so with
that word (three share one wording; `milestones-panel.tsx` phrases it as "which of the two registers
is right"). The tasks-side test docblock in `use-bulk-operations.test.tsx`
states the omission as a defect: `buildBulkFieldEdits` never captures the stamp (it is in
`NEVER_CAPTURE`), so without `stampField` an undo merges the before-patch and leaves the APPLY's
stamp sitting on the row — "the content moves backwards while the sync layer is told the row last
changed at the apply, so the revert never propagates".

★★ **NEITHER VERDICT HAS BEEN VERIFIED, and this entry deliberately does not pick one.** Deciding it
means establishing how each of the six backends actually uses `localModifiedAt` — whether any of them
resolves a conflict or skips a push on it, and whether the four registers even reach a path where
that matters. Nobody has done that work. Until it is done, "harmonising" the five sites in either
direction is a BEHAVIOUR change on four registers, not a consistency cleanup, and the test docblock
above is an argument, not a measurement.

★ Nothing STRUCTURAL gates the asymmetry: `stampField` is optional on `CaptureFieldRowsOpts`
(`stampField?: keyof T & string`), so all five spellings typecheck and a future site inherits
whichever spelling its author copied. Whether any TEST would catch a flip on the four is not asserted
here — no suite was run for this entry. The four omitting sites each carry a comment pointing here;
read it before editing one of them.

---

## 182. Template import can store an inconsistent `status`/`completedDate` pair, and nothing repairs it — open

The invariant `status === "Done"` ⟺ `completedDate` set is held by WRITERS, not at load — and NOT by
all of them. FOUR paths write the pair. Two hold it, by two DIFFERENT mechanisms:

- `applyStatusChange` (`task-status.ts`) holds it BY CONSTRUCTION — `Done` stamps a `completedDate`,
  every other status clears it. Every LOCAL status mutation routes through it.
- Jira sync's PATCH-application sites (pull, create, read-only) hold it WITHOUT calling that
  function — but its CONFLICT merge does not, so scope this to the path and not to the file (§183):
  `issueToTaskFields` (`jira-api.ts`) derives both
  fields from one `statusKey` read (`isDone` picks the date branch, `jiraCategoryToStatus` the
  status), so the two cannot disagree. ★ This is why `applyStatusChange` is not "the sole writer of
  status + completedDate" — a phrase four source comments carried until the round that filed this
  entry. AGENTS.md now carries the scoping in one place; do not restate it at a call site.

The other TWO hold it by neither, so do not read the pair above as an enumeration. One is this entry;
the other is the Jira CONFLICT merge, filed separately as §183 because it is reachable from
well-formed data through the conflicts modal and this one is not.

**Template import holds it by neither mechanism.** `sanitizeSeedTask` (`templates.ts`) reads the two
fields INDEPENDENTLY off the raw seed — `status` is a bare cast, `completedDate` a separate
`sanitizeIsoDate` read assigned only when truthy — and then returns `migrateTask(task)`.

```bash
# leg 1: the two independent reads, and the normalizer call that ends the function.
# ★ A FOURTH hit (`const status = raw.status`) belongs to the NEXT sanitizer in the file, not to
#   sanitizeSeedTask. Read the function; do not count the hits.
grep -n "raw\.status\|raw\.completedDate\|migrateTask(task)" src/app/templates.ts
# leg 2: the short-circuit, and the GUARDED status write that is the real reason nothing is repaired.
grep -n "statusOk && createdOk\|if (!statusOk)" src/app/task-status.ts
```

★★ **`migrateTask` does not repair the pair, and on THIS path the reason is NOT the short-circuit.**
The obvious reading is that `if (statusOk && createdOk) return task;` returns early on a valid
status. It does not fire here: `sanitizeSeedTask` never assigns `createdDate` (the field is optional
on `Task`), so `createdOk` is false and the body always runs. The body preserves the pair anyway,
because its only status write is guarded `if (!statusOk)` and a template's valid status makes
`statusOk` true — `migrateTask` backfills `createdDate` and leaves the inconsistency untouched. The
OUTCOME is identical either way, which is exactly what makes the wrong mechanism easy to write down.

**Consequence.** `isTaskClosed` and `isTaskDelivered` (`task-closed.ts`) are the two questions a
caller can ask, and they read DIFFERENT fields — `status` and `completedDate` respectively. An
inconsistent row answers them incoherently, in both directions:

(a) A non-Done status beside a set `completedDate` is OPEN and DELIVERED at once.
`computeDashboardProgress` counts it in `completed` (the numerator is `isTaskDelivered`) AND keeps it
in the denominator (`scopeCounts` subtracts only `isTaskOutOfScope`, which requires CLOSED), while
`computeScheduleStatus` and `partitionUpcoming` skip on `isTaskClosed` — so with a past `dueDate` the
SAME row is counted complete and counted overdue on one dashboard render. Hide-finished does not hide
it either (`visible-task-rows.ts` filters on `isTaskClosed`), so the table still shows it as To Do.
Reports takes the delivered branch first, so it lands in `stats.completed` and the on-time/late split
and never in `stats.open` — Reports and the dashboard schedule tile then disagree about that row.

(b) `Done` with no `completedDate` is CLOSED and never DELIVERED, i.e. `isTaskOutOfScope` — dropped
from the completion denominator and counted as cancelled scope in Reports. ★ That SHAPE is not
specific to template import (`health.ts` already splits the "Done-with-no-date" row out three ways,
§65); what is new is that template import is a way to CREATE one.

**Why it is left open.** Not reachable from shipped data: no built-in template carries a
`completedDate` (`grep -n completedDate src/app/templates-builtin.ts` returns nothing). The reachable
sources are a hand-edited or third-party template JSON read back by `sanitizeTemplates`, and a
capture of an already-inconsistent workspace row — `templateFromWorkspace` copies live `Task` objects
verbatim, so it launders whatever the workspace already holds.

★ The fix is one line in `sanitizeSeedTask` (route the seed through `applyStatusChange` before
returning), but WHICH field should win is a real question and this entry does not answer it: trusting
`status` discards a real delivery date, trusting `completedDate` flips a status the template author
wrote. ★★ Do NOT reach for `migrateTask` instead — it runs on all six load paths, so teaching it to
reconcile a VALID-but-inconsistent pair changes every backend's load behaviour, and AGENTS.md records
that the invariant is held by the writers and that `migrateTask` only backfills an ABSENT/INVALID
status.

---

## 183. The Jira conflict merge writes `completedDate` without `status`, so accepting the modal's default splits the pair from well-formed data — open

`handleResolveConflicts` (`use-jira-sync.ts`) seeds its output row from the LOCAL one —
`const merged: Task = { ...original }` — then overwrites, per conflict field, whichever side the user
picked. `completedDate` has its own branch. `status` has NO branch, and cannot have one: it is not a
member of `ConflictFieldKey`, and `diffTaskAgainstIssue` (`jira-api.ts`) never offers it. So the merge
writes one member of the coupled pair and leaves the other at its LOCAL value.

```bash
# the union the modal can offer, and the eight checks that build a diff — no `status` in either
grep -n "export type ConflictFieldKey" -A 10 src/app/jira-api.ts
grep -n "^  check(\"" src/app/jira-api.ts
# every write the merge makes: labels, completedDate, lastSyncedAt, localModifiedAt. No status.
grep -nE "merged: Task|merged\.[a-zA-Z]+|field\.key ===" src/app/use-jira-sync.ts
```

**This is the FOURTH writer of the pair, and the SECOND that holds the invariant by neither
mechanism.** Corrected set: `applyStatusChange` (`task-status.ts`) holds it by construction; the three
patch-application sites in `use-jira-sync.ts` hold it because `issueToTaskFields` derives both fields
from one `statusKey` read; `sanitizeSeedTask` (`templates.ts`) holds it by neither (§182); and this
merge holds it by neither. §180's reachability paragraph and the AGENTS.md task-status bullet were
both written against a set of two or three and have been corrected in the same round as this entry.
★ Note the split is WITHIN one file — `use-jira-sync.ts` holds the invariant on its pull/create/
read-only paths and breaks it on its conflict path — so scope any claim about that file to the path.

**Reachable from well-formed data, and the DEFAULT pick is the one that breaks it.** A conflict is
queued when a synced row's `localModifiedAt` and the issue's `updated` have BOTH moved past
`lastSyncedAt`, on a project `isReadOnlyIssue` does not exclude. `jira-conflicts-modal.tsx` seeds
every field's pick to `"remote"`, and the merge falls back to `"remote"` again for any key the
resolution omits — so both directions below are reached by opening the modal and pressing confirm,
without touching the `completedDate` row at all.

```bash
grep -nE "remoteChanged = |localChanged = |remoteChanged && localChanged" src/app/use-jira-sync.ts
grep -n 'picks\[f.key\] = "remote"' src/app/jira-conflicts-modal.tsx
grep -n '?? "remote"' src/app/jira-conflicts-modal.tsx src/app/use-jira-sync.ts
```

(a) **Local Done, remote reopened.** The row is `status: "Done"` with a `completedDate`; the user edits
any field locally (which stamps `localModifiedAt`); someone reopens the issue in Jira. The patch's
`completedDate` is undefined, so it differs and is offered. Accepting remote clears
`merged.completedDate` and leaves `merged.status === "Done"`. → **`Done` with no date.**

(b) **Local open, remote completed.** The row is a non-`Done` status with no `completedDate`; same
local edit; the issue is transitioned to done in Jira. The patch carries a real date, it is offered,
and accepting remote writes it while `status` stays non-`Done`. → **a completion date on an open row.**

★ Picking LOCAL for `completedDate` is consistent in both directions, because `status` is already the
local one. It is the REMOTE pick — the default — that splits the pair.

**Consequence, derived from `task-closed.ts` rather than asserted.** `isTaskClosed` reads `status`,
`isTaskDelivered` reads `completedDate`, and `isTaskOutOfScope` is the conjunction
`isTaskClosed && !isTaskDelivered`. The two directions land on opposite sides of it:

- **(a) is CLOSED and never DELIVERED, i.e. `isTaskOutOfScope`.** `computeDashboardProgress`
  (`dashboard.ts`) leaves it out of the numerator (`tasks.filter(isTaskDelivered)`) AND removes it
  from the denominator, because `scopeCounts` subtracts exactly the out-of-scope rows. So a task the
  user just watched go Done stops contributing to completion % in either term, and RAISES the
  percentage reported for every other row. `computeStats` (`reports-stats.ts`) files it under
  `cancelled` — the bucket whose own comment reads "closed without being delivered" — so a
  resolved task is reported as cancelled scope, and is never counted open or overdue.
- **(b) is OPEN and DELIVERED at once.** The dashboard counts it in the numerator AND keeps it in the
  denominator (out-of-scope needs CLOSED, which it is not). `computeStats` takes the delivered branch
  first, so it lands in `completed` and in the on-time/late split and never in `open`. Meanwhile
  `visible-task-rows.ts` filters hide-finished on `isTaskClosed`, so the table goes on listing it as
  an open row while Reports calls it complete.

★ It can SELF-HEAL, which is the likeliest reason this has not been reported. The merge clears
`localModifiedAt` and stamps `lastSyncedAt`, so the next sync in which the issue changes takes the
plain pull branch — which writes `status` and `completedDate` together off one patch. A row whose
issue never changes again stays inconsistent indefinitely.

**Not determined.** Nothing here was executed: no suite was run for this entry, and the sequences
above are read off the source, not reproduced. No test exercises the branch either — every conflict
fixture in `use-jira-sync.test.tsx` seeds `diffTaskAgainstIssue` with a `taskName`-only diff, so the
`completedDate` arm of the merge loop has never run under the suite:

```bash
grep -n "diffTaskAgainstIssue as ReturnType" -A 3 src/app/use-jira-sync.test.tsx
```

Also undetermined: whether the `transitionIssueTo` call on the `anyLocalPicked` path shortens the
window for either direction in practice, and whether anything downstream of the six backends reads
the pair in a way that would surface the inconsistency sooner than the next sync.

**No fix is proposed, because the choice is a real design question and this round did not settle it.**
Adding `status` to `ConflictFieldKey` exposes a field the user cannot meaningfully arbitrate
independently of the date. Re-deriving `status` inside the merge from the resolved `completedDate`
silently overrides a local status the user was never asked about. Routing the merged row through
`applyStatusChange` would stamp `today` over Jira's resolution date — which is the exact reason the
Jira path bypasses that engine everywhere else, so it is the one option that is already known wrong.

---

## 184. The Documents block editor is in A11Y_VIEWS but is never scanned — open, deferred out of the S3b fix round

"Documents" is in `A11Y_VIEWS` (`e2e/a11y.spec.ts`), but nothing in `e2e/`
enters edit mode — `grep -rn "Edit blocks\|documentsEditBlocks" e2e/` returns
nothing. Every axe scan of that view therefore renders the read-only
`DocumentPreview`. The block editor is entirely unscanned: five per-kind
editors, the table grid, every per-block control, N rich-text toolbars, and
the narrow-pane docked toolbar.

★★ Same blind-spot CLASS as the Turso-gated views and the Resources →
Calendar sub-tab: the view is listed, so a green run reads as coverage, and
the empty/preview state is what the gate actually sees. Compounding it,
`e2e/seed.ts` seeds `documents` from the sample workspace, so even an
edit-mode scan would only cover the block KINDS that sample happens to carry.

★★★ AND THE GATE COULD NOT CATCH THE DOMINANT RISK HERE ANYWAY. This surface
repeats controls across sibling blocks (and across rows and columns inside a
table block), and axe 4.12.1 has NO rule under the four tags the spec requests
that flags two controls sharing an accessible name, at any seed size — see
AGENTS.md's a11y hard-constraint section for the measurement. The multi-block
unit tests in `document-block-editors.test.tsx` and `document-editor.test.tsx`
are the only detector that exists for that class, and closing this item would
not change that.

**To close:** seed a document carrying every `DocBlock` kind, click the
"Edit blocks" toggle before the scan in `e2e/a11y.spec.ts`, and — in the SAME
commit — re-measure the spec's test total with
`npx playwright test e2e/a11y.spec.ts --list` and update AGENTS.md's count.
Deliberately deferred out of the S3b fix round: the surface was being
restructured by that round's docked-toolbar task, and the count could not be
measured under its constraints.

## 185. An over-long document paragraph is flattened to plain text at commit

**Status:** open. **Severity:** low (bounded, visible, and only past 20 000
visible characters). **Introduced:** pre-existing in `capHtmlText`; made VISIBLE
rather than silent by the S3b normalise-at-commit change.

`document-model.ts` caps a paragraph at `MAX_HTML_TEXT_CHARS` (20 000 visible
characters) via `capHtmlText`, whose truncation branch returns
`plainToHtml(text.slice(0, cut))` — so on overflow the paragraph loses **every
mark**, not merely its tail. Bold, links, lists and headings inside it are
REMOVED: what remains is the paragraph's plain-text projection.

★★ **Not "escaped", and an earlier revision of this entry said escaped.** `text`
is already the projection, with the tags stripped; `plainToHtml` then escapes
`& < >` so that any such character the user actually TYPED still renders as
itself. No tag text becomes visible — the markup is simply gone. The distinction
matters because "escaped" describes a corruption a reader would go hunting for
in the sanitizers, and this is not one.

Before the block editor normalised at commit this happened on the next LOAD,
with nothing on screen to connect it to anything the user did. It now happens at
the COMMIT. ★★★ An earlier revision said "the draft's seed nonce remounts the
editor with the flattened result, so the user at least SEES it", and that
stopped being true in the same branch: the reconcile now re-seeds only when
storage holds content the draft does not already say, and after our own commit
the two agree, so there is no re-seed and no remount. That was the deliberate
trade — the remount also destroyed DOM focus and the editor's undo history
mid-session.

★★ So nothing changes on screen AT THE COMMIT. It does NOT follow that the
flattening is invisible until a reload, and the revision that replaced the
sentence above said exactly that — the same overclaim, one step smaller. Any
surface that re-reads storage shows it: leaving edit mode renders
`DocumentPreview` from the stored doc, and so does a remount. Two successive
revisions of this paragraph each asserted a universal about what the user sees,
and neither ran a command against it.

There is no warning before the cap, no notice explaining it, and nothing in the
editor that can restore the markup afterwards. Version history is the only
recovery: the before-image holds the pre-edit paragraph, and only until it is
evicted.

★ It is deliberately NOT fixed by refusing the commit: the user's text would
then be unsaveable, which is worse. Nor by a per-editor `maxLength`: the cap is
measured on VISIBLE text, and a `maxLength` counts markup too, so the two
disagree on any formatted paragraph — that mismatch is exactly what the
normalise-at-commit change removed.

**To close:** either (a) count visible characters live in `RichTextEditor` and
warn as the cap approaches, so overflow is a choice rather than a surprise, or
(b) teach `capHtmlText` a mark-preserving truncation. (b) is the real fix and is
the larger one — it needs a DOM-free HTML truncator, and `rich-text-plain.ts` may
never call DOMPurify.

## 186. The block-editor conflict reason reaches users untranslated

**Status:** open. **Severity:** low. **Found by:** cold review of the S3b fix
round.

`applyOps` rejects a guarded `replace` with the engine string
`op {i}: replace index {n} was changed by another writer`, and
`documents-panel.tsx` surfaces `restoreRejected` by joining those reasons into
one banner. The string is raw English with an op index in it, and it is not an
i18n key.

★★ The panel already concedes untranslated engine reasons, but that concession
was made for RESTORE failures, which are rare and operator-facing. ★★★ An earlier revision of this entry then
claimed this one "fires on an ordinary two-writer editing race — an AI write or
a second tab landing while someone is typing", which is false and overstated who
sees it: `tryCommit` calls `externallyWritten()` and refuses with a TRANSLATED
notice (`documentsBlockConflictNotSaved`) BEFORE it ever reaches `onCommit`, so
the ordinary race never reaches the engine at all. The engine string surfaces
only on the paths where that component guard is blind — the type-change unmount
being the one AGENTS.md already names. Whether that is acceptable is a product call, not a
bug: the banner is better than the silent abandon it replaced either way.

**To close:** give the rejection a code the panel maps to an i18n key, keeping
the engine string as the diagnostic detail. Do NOT translate inside the engine —
`document-mutations.ts` is i18n-free by contract.

## 187. `useDocumentTools` has no test file, and one guard there is unpinned

**Status:** open. **Severity:** low. **Found by:** cold review of the S3b fix
round; the guard was added in the same round.

Nothing under `src/app` imports `useDocumentTools` from a test, and there is no
`use-document-tools.test.ts` — reproduce with
`grep -rln "useDocumentTools\|document_ops" src/app/*.test.*`, which returns
nothing. The whole model-facing document write path is therefore covered only
indirectly, by the engine tests underneath it.

That matters now because the round added a guard there: `keepOp` strips
`expect` from every op before it reaches `applyOps`. The field is the HAND
editor's concurrency guard, carrying a draft's baseline, and an AI op resolves
no draft — but the `document_ops` schema sets no `additionalProperties: false`
(verified: `grep -n additionalProperties src/app/chat-tool-defs-documents.ts`
returns nothing), so a model can emit it and the `{ ...op, block }` spreads
would have carried it through. Worst case was never data loss — the model's own
op self-rejects with a reason the model sees — but model-supplied data should
not decide whether a write applies.

★★ The strip is UNTESTED, and this entry exists so that is on the record rather
than inferred from a confident comment. It is placed in `keepOp` because every
op funnels through there, so no later branch can reintroduce the field; that is
an argument about placement, not evidence that it works.

**To close:** stand up `use-document-tools.test.ts` with a `mutateDocuments`
spy, and assert (a) an op carrying `expect` reaches the engine without it, and
(b) the hand editor's own guarded `replace` still carries its `expect` — the
second half is what stops a future "just drop expect everywhere" simplification.

## 188. A block refusal notice outlives the attempt it describes

**Status:** open. **Severity:** low. **Found by:** cold review of the S3b fix
round. **Deliberately not fixed.**

`useBlockDraft`'s `refusal` state is written only inside `tryCommit`, so the
pink "Not saved" line clears on the next COMMIT attempt and not before.
`commit()` early-returns while the draft is undirty, so blurring the field again
does not clear it.

★★ Recorded rather than fixed because the notice is arguably still TRUE for the
whole of that window, and for `"conflict"` it is actively useful: it is the only
explanation the user gets for their text having been replaced on screen by the
external write the reconcile adopted. Clearing it on adoption would delete the
explanation at the exact moment it becomes relevant.

★ The case for changing it is the stale-context one: a user who walks away and
returns sees a refusal referring to an attempt they no longer remember. If that
is judged to matter, clear it when the draft next goes DIRTY (the user has moved
on) rather than on adoption — and note `document-block-editors.tsx` currently
sits at exactly 800 of the 800-line cap, so it needs headroom first.

## 189. Adopt Prettier at `printWidth: 120` and raise the size cap to 900

**Status:** open, DECIDED but deliberately not implemented. **Severity:** low
(no defect — a tooling decision plus its migration cost). **Decided:**
2026-08-19. **Deferred the same day**, to be done as its own slice rather than
riding on an unrelated branch.

The repo has no formatter. `scripts/check-file-sizes.mjs` caps a `src` file at
`LIMIT = 800` lines. The decision is to adopt Prettier at `printWidth: 120` and
raise that cap to **900** in the same change.

### Why both halves move together

Reformatting the tree at width 120 grows files, so the cap has to absorb that
growth before the ratchet can pass. Raising the cap ALONE would be a pure
weakening — it buys headroom nothing has earned. Adopting the formatter alone
would fail the gate on the files already at the line.

★★ **900 is a CHOSEN number, not a derived one, and nothing here derives it.**
The width-120 growth measured at roughly 2% at the median, which across this
band is ~16 lines — arithmetic alone argues for a cap nearer 820. 900 was picked
to leave room beyond the reformat itself. If that trade is wrong, the number is
the thing to revisit; the pairing of formatter and cap is not. Do not read the
2% figure as the justification for 900 — an earlier revision of this entry put
the two in one sentence and made it look like one.

The pressure is real, measured 2026-08-19 (reproduce with the snippet below):
**27** files sit in the 700–800 band and six are at 795 or above, including
`document-block-editors.tsx` at exactly **800** — zero headroom, which is why
followup §188 records a fix it cannot make room for. Four files are over the cap
and baselined; `i18n.ts` / `i18n.de.ts` are exempt and not counted here.

```bash
node -e "
const fs=require('fs');const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;
if(e.isDirectory()){if(!/node_modules|[.]next|coverage|[.]git/.test(p))walk(p)}
else if(/[.](ts|tsx)$/.test(e.name)&&!/[.]test[.]|[.]property[.]/.test(e.name))files.push(p)}})('src');
const L=files.map(f=>[f,fs.readFileSync(f,'utf8').split('\n').length]).sort((a,b)=>b[1]-a[1]);
console.log('700-800 band:',L.filter(x=>x[1]>700&&x[1]<=800).length);
console.log(L.slice(0,12).map(x=>x[1]+'  '+x[0]).join('\n'));"
```

★ The cap script counts `split("\n").length`, which is `wc -l` **+ 1** — so a
file reading 799 under `wc -l` is already AT an 800 cap. Budget the new cap from
the script's own number, not from `wc -l`.

### The real cost, and why this is not a drive-by

★★★ **A repo-wide reformat silently invalidates every `path:LINE` citation in
the docs, and `docs:claims:check` STAYS GREEN while it happens.** The gate is a
ratchet over citation COUNT plus a range check — it proves a cited line COULD
exist, never that the right thing is on it. Reformatting moves hundreds of lines
without changing any file's length enough to push a citation past EOF, so
essentially none of the drift is detectable. Read today's citation total off the
gate itself (`npm run docs:claims:check`); do not trust a number quoted in prose.

That makes the citation question the *substance* of this slice, not a chore
attached to it. Two defensible answers, and the choice belongs to whoever runs it:

- **Convert first.** Turn `path:LINE` citations into symbol + grep citations
  (already the documented house rule), THEN reformat. Slow, but it retires the
  rot permanently and leaves the gate meaningful.
- **Accept and record.** Reformat, then treat every surviving line citation as
  suspect until re-verified. Cheap, and consistent with the standing rule that a
  wrong line number is a SYMPTOM — go re-verify the claim, never renumber it.

Do NOT re-baseline the citation gate to absorb the churn. Re-baselining to admit
new breakage defeats the only property it checks.

### Implementation notes measured on 2026-08-19

A temporary `prettier@3.9.6` install produced these, and was removed again — the
tree today has no prettier, so re-install before reproducing anything here.

- **`endOfLine: "auto"` is REQUIRED**, not a preference. `core.autocrlf=true`
  checks source out as CRLF on Windows while CI runs on LF. Prettier's default
  `"lf"` would rewrite every worktree file's endings and make a `format:check`
  job pass on CI and fail locally, or the reverse. `"auto"` preserves what each
  file already has, so both platforms agree.
- **Scope to `.ts`/`.tsx`/`.mjs`.** Prettier formats `.json` and `.md` by
  default, and both are hazardous here: `.gitattributes` pins the golden
  serializer fixtures as binary precisely so nothing rewrites them, `*.md` is
  pinned to LF for the script-docs verifier, and the generated
  `operating-guide-builtin.generated.ts` is regenerated LF by `prebuild` — a
  prettified copy would drift on the next build. Today's fixtures are `.csv` and
  `.md` only, so an extension-scoped run cannot reach them, but that is a fact
  about today's fixture set rather than a guarantee.
- **`globals.css` deliberately excluded** from the first cut. It is the file the
  palette and Tailwind-v4 constraints bear on hardest, and formatting it buys
  the least.
- **The size baseline must be regenerated** (`node scripts/check-file-sizes.mjs
  --update`) after the reformat: the four baselined files all grow, and a grown
  baselined file fails the ratchet exactly like a new oversized one.
- **ESLint conflict looks unlikely but was NOT audited.** `eslint.config.mjs`
  adds no stylistic rules of its own — it is `eslint-config-next`'s
  core-web-vitals + typescript presets plus `globalIgnores`. Whether those
  presets carry a formatting rule that Prettier's output would trip was not
  checked, and `eslint.config.mjs` is hook-protected, so a conflict cannot be
  resolved by editing the config. Run `npx eslint --max-warnings=0 src/app`
  against a reformatted tree EARLY.
- **`dup:check` is an open risk.** Reformatting normalises code, which can raise
  jscpd's detected duplication. The gate compares one number — total duplicated
  LINE percentage — against a hardcoded `1.75` in `package.json`. Measure after
  reformatting; if it rises past the threshold, that is a finding about real
  duplication the old formatting was hiding, not a licence to raise the number.

### Not decided

Whether a `format:check` job joins the CI quality stage. Without one the
formatting drifts back within weeks; with one, every in-flight branch goes red
until rebased. Deliberately left to whoever runs the slice.

**To close:** run it as its own branch — answer the citation question first,
then config + reformat + cap + baseline in one reviewable change set.

## 190. The block refusal notice is inserted together with its text, which is the unreliable half of the live-region contract

**Status:** open. **Severity:** low (an announcement that may not fire, on a
surface that already shows the reason visually). **Found by:** cold code review
of the S3b fix round, 2026-08-19.

`BlockRefusalNotice` (`document-block-notices.tsx`) renders
`<p role="status" className="text-xs text-ui-pink">`, and all four call sites in
`document-block-editors.tsx` spell it `{refusal && <BlockRefusalNotice … />}`.
So the live region and its content enter the DOM in the SAME commit.

The reliable shape is the opposite one: a region already sitting in the
accessibility tree whose TEXT then changes. Inserting the region itself is where
AT support diverges — it is the case screen readers historically handle worst,
and the one this repo already avoids everywhere it cares: `dashboard-panel.tsx`,
`modern-shell.tsx` and `resource-calendar.tsx` all keep an always-mounted
`sr-only` region and write into it.

★★ **THIS CANNOT BE GATED, IN EITHER LAYER, AND THAT IS THE REASON TO WRITE IT
DOWN.** axe cannot see it: `p` carries `allowedRoles: true` in axe 4.12.1
(`node -e "const s=require('fs').readFileSync('node_modules/axe-core/axe.js','utf8');const i=s.indexOf('      p: {');console.log(s.slice(i,i+120))"`),
a MISSING live region is an absence rather than a violation, and the notice only
renders after an interaction the scan never performs. jsdom cannot see it
either: no assertion can distinguish "region inserted with content" from "text
changed inside an existing region", so the two tests added for this in
`document-block-editors.test.tsx` pin the ROLE and can never pin the
ANNOUNCEMENT.

★★ Consequently the component's own docstring is over-broad where it says that
unit test "is the only detector there will be" — true of the role, false of the
announcement, which has no detector at all.

### Two changes, and the primitive swap is NOT the one that fixes this

★★★ **`FieldNotice` ALONE DOES NOT FIX THE ANNOUNCEMENT.** The obvious remedy
is to stop hand-rolling and use the shared primitive — `FieldNotice` in
`field-feedback.tsx` is `<p id role="status" aria-live="polite">`, exactly this
shape, and the house rule says do not hand-roll what a primitive covers. But
`FieldNotice` opens with `if (!children) return null`, so it is conditionally
mounted too. Swapping to it buys the explicit `aria-live`, shared styling and
one less hand-rolled control; it leaves the insertion problem exactly where it
is. Do not close this item by swapping the primitive and calling it done.

What actually fixes it is an always-mounted region: widen the prop to
`BlockRefusal | null`, render the `<p>` unconditionally with empty text when
null, and drop the `&&` at the four call sites. ★ That is line-count neutral in
`document-block-editors.tsx`, which matters because that file sits at exactly
800 of the 800-line cap (§189) — `{refusal && <X … />}` and `<X … />` are one
line either way, at all four sites.

### Costs and open questions, so the next person does not rediscover them

- ★ The swap is NOT cosmetically neutral. `FieldNotice` hardcodes
  `mt-1 text-xs text-ui-pink-strong`; the block notice is `text-xs text-ui-pink`.
  Different palette token and an added margin — both need an eye check against
  the block editors' spacing, and the token change needs a contrast read on the
  surfaces it lands on. jsdom cannot judge either.
- ★ `FieldNotice` takes an `id` for `aria-describedby` wiring. The block notice
  has no such wiring today. Adding the primitive without the association gets a
  prop that does nothing.
- ★ An always-mounted empty `<p>` still occupies layout unless it collapses.
  Check that an empty notice does not add permanent vertical space under every
  block editor — four per block, in a list.

★★ **A REVIEWER CLAIM THAT DOES NOT SURVIVE, recorded so it is not repeated:**
the review said this is "the only live region in `src/app` relying on the
implicit `aria-live` of `role="status"` rather than stating it". It is not —
ELEVEN other non-test files do the same. Derive rather than trust either number:

```bash
for f in $(grep -rl 'role="status"' src/app --include=*.tsx | grep -v "\.test\."); do
  grep -q 'aria-live="' "$f" || echo "$f"
done
```

So making this one explicit is a consistency argument at best, not a
correction of a lone outlier — and if implicit-vs-explicit is judged to matter,
it is a sweep, not a one-file fix.

★ One more over-broad premise in the same docstring: "This element mounts AFTER
a blur has already moved focus elsewhere" holds for the BLUR path only. On the
`commitValue` paths — bullets add/remove/move/toggle, table add/remove, the
dataSection `<select>` — it mounts with focus still on the control just
operated. The conclusion (the mount alone announces nothing to a screen-reader
user) is unchanged either way, so this is a wording fix, not a defect.

**To close:** make the region always-mounted, decide the `FieldNotice`-vs-local
question on the styling and `id` questions above rather than on the
announcement, and correct the two over-broad docstring sentences in the same
commit. Nothing will catch a regression here afterwards, so whatever is decided
belongs in the docstring rather than in a test.

## 191. A block draft over a storage cap refuses silently, and the Add controls do not stop you reaching that state

**Status:** open. **Severity:** medium (a false affordance plus a silent
refusal; no data reaches storage wrongly). **Found by:** the pre-release cold
review of the S3b branch, 2026-08-19.

`normalizeBlockForStorage` clamps a block to `MAX_TABLE_COLUMNS` (30),
`MAX_TABLE_ROWS` (500), `MAX_BULLET_ITEMS` (200), `MAX_TEXT_CHARS` (5 000) and
`MAX_HTML_TEXT_CHARS` (20 000). Nothing upstream stops a draft exceeding any of
them: "Add column", "Add row" and "Add item" carry no `disabled` at the cap, and
no text input carries a `maxLength`. Reaching a cap therefore produces a control
the user can see and type into, whose content storage will never accept.

`tryCommit` then refuses it SILENTLY. Its no-change branch runs
`setRefusal(null); return false` — so the cap is a THIRD refusal reason with no
`BlockRefusal` variant and no notice, in the one file whose notice component
exists precisely because "the concurrent-write ABANDON did not have one".

★★ **The reconcile's cap arm treats the symptom, not this.** It clears such a
draft on the next parent render so the phantom control cannot persist
indefinitely (see `exceedsStorageCaps`). That restores the pre-branch behaviour
— the identity-keyed re-seed it replaced dropped the same text on the same
trigger — but it is a cleanup, not a fix, and it has a real cost recorded below.

★★★ **THE OVER-CAP CONTENT IS NOT UNRECOVERABLE, AND AN EARLIER COMMENT SAID IT
WAS.** `removeItem` and `removeColumn` route the WHOLE draft through
`commitValue`, so deleting any row or column brings the draft back under the cap
and the previously-unsaveable text COMMITS. The claim "it can NEVER become
committable" shipped in `document-model.ts` and `document-block-editors.tsx` and
was refuted by the review in one command; both now say "cannot commit while it
stays over the cap". The consequence is that the re-seed discards text the user
could have rescued by deleting a row first — which is exactly why the fix below
is the one that matters.

**To close**, in this order:

1. **Stop the state being reachable.** `disabled` on Add row / Add column / Add
   item at the cap, with the reason surfaced (a real `disabled` attribute, never
   an `aria-disabled` lookalike — that still fires `onClick`). ★ A disabled
   control needs a reason visible somewhere or it is the "disabled control with
   no reason" defect the block editors already avoid elsewhere.
2. **Give the cap a refusal.** Widen `BlockRefusal` from `"empty" | "conflict"`
   to carry a `"cap"` variant with its own i18n string, and have `tryCommit`
   set it rather than clearing the refusal, so a no-change-because-clamped
   commit says so.
3. Once 1 and 2 exist, revisit whether the reconcile's cap arm should still
   discard the draft or leave it for the user to shorten deliberately.

★ Blocked on headroom for the parts that live in `document-block-editors.tsx`,
which sits at exactly 800 of the 800-line cap — see §189. The table controls are
in `document-table-editor.tsx` (225 lines) and are not blocked.

★★ A related gap the same review found, worth closing with 2: `exceedsStorageCaps`
ends in `default: return false` with no exhaustiveness guard, so a SEVENTH
`DocBlock` kind would silently be classified as never-truncating. The predicate's
arms are now pinned individually in `document-model.test.ts`, but nothing forces
a new arm when the union grows.
