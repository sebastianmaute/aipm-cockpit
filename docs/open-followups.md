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

`docs/baselines/` keeps **`file-sizes.json`** and **`jscpd-2026-07.json`** — those are live gate
inputs, not history. Also removed: **296 orphaned per-slice `plans/` + `specs/` docs** referenced
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
| 28 | CSV/MD/Turso never DOMPurify a rich field at load | 0.196.0, widened 0.209.0 | M | open — needs a new boundary |
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
| 55 | Thirteen hand-rolled `aria-pressed` toggles show their on-state by colour alone | 0.212.0 (Nayler) | M | open — a11y (1.4.1), unguarded; ★ 2 of the 13 are NOT colour-only; was 14, tier selector resolved |
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
| 77 | The snapshot capture gate is a one-way latch, so a mid-session storage switch can still capture the wrong project | found post-0.214.0 | M | open — ★★ both obvious fixes are WRONG (suppress-path strands it false; a state reset lands a render late, both effects run in one commit); needs ref+state |
| 78 | A brand-new Turso project auto-captures an empty snapshot, and that row becomes the BASELINE | pre-existing, found post-0.214.0 | S | open — every later variance row then compares against nulls; fix `isFirstEver`, do NOT overload §77's flag |
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
| 92 | The `settings-types` ⇄ `workspace` ⇄ `document-model` value-import cycle is a standing trap for any eval-time snapshot | AI document authoring S1, unreleased | S per instance | open — a TRAP, not a defect. **Sweep 2026-08-06 CLEAN**, no unfixed instances; carries a verified structural triage rule (exporter must transitively import the snapshotter) so the next candidate is decidable, not guesswork |
| 93 | The PPTX truncation notice is a hardcoded English frame wrapped around a LOCALIZED section title | AI document authoring S1, unreleased | S | open — i18n; affects BOTH PPTX paths, and only the newer one carries a code comment saying so |
| 94 | PPTX pagination counts logical lines, so a wrapped long line still overflows the slide | AI document authoring S1, unreleased | S–M | open — eye-verify owed; UNBOUNDED overflow is fixed, bounded overflow remains and no test in this repo can see it |
| 95 | No test exercises a real Turso database on any path — meta-blob coverage is statements → synthetic results | AI document authoring S1, unreleased | M | open — class-wide (`documents` · `insights` · `knowledgeItems`), not a documents-specific gap |
| 96 | The document preview/print path loads the whole `export-sections` registry even for a document with no `dataSection` block | AI document authoring S1, unreleased | S–M | open — measured 60 runtime modules, 59 of them from that one import; priority UNKNOWN, no bundle measurement taken |
| 97 | The DOM constraint **INVERTED** for the document load paths — they now REQUIRE a DOM, and failure is silent | AI document authoring S1, unreleased | S | open — TRAP, safe today. Contradicts the widely-repeated "you cannot call DOMPurify here" lore (§36(a)). ★ The catastrophic half is **FIXED**: the JSON path used to lose the ENTIRE workspace (measured tasks: 0) and is now contained to documents-only like the other three. The DOM dependency itself is unchanged, which is why this stays open |
| 99 | The e2e seed writes NONE of BrowserBackend's nine optional kv slices, so any view backed by one is axe-scanned against its EMPTY STATE | AI document authoring S1, unreleased | S per slice | open — **Insights is in `A11Y_VIEWS` and affected TODAY**; `documents` was the same defect and seeding it immediately exposed a real serious violation, so fixing the rest may legitimately turn scans RED for the first time |
| 100 | Tab ejects focus from a portaled popover opened inside a modal, leaving it open and its contents keyboard-unreachable | field controls → modal header, unreleased | M | open — WCAG 2.1.1, **measured in Chromium** from both a radio and a checkbox. PRE-EXISTING and architectural (`Modal`'s trap guards on `container.contains`, false for every element in a portal); the move only made it prominent. Invisible to jsdom (the control's tests never mount inside `Modal`) and to axe |
| 101 | `SegmentedControl`'s selected segment is distinguished by fill alone in the three DARK schemes | field controls → modal header, unreleased | S | open — computed track-vs-active lightness 2.38 / 2.43 / 2.25:1 dark vs 10.42 / 8.73 / 10.54:1 light, against this repo's own ≥3:1 bar; `--shadow-control` is `none` with no per-scheme override, so there is no fallback cue. Screen readers unaffected (`aria-checked` carries it). Pre-existing, shared by 31 invocations |

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

## 22. `clipText` truncates on UTF-16 code units and can split a surrogate pair — open

**Where:** `sanitize-core.ts:52-55`.

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
`dangerouslySetInnerHTML` sink: they reach `RichTextEditor` (which sanitizes with `sanitizeNoteHtml`)
or are projected to plain text for search, exports and AI digests. So the realized risk is bounded —
but only because nobody has yet added a read-only rich display for one of these fields, which is
exactly the position the defence-in-depth rule exists to prevent. `Task.description` has been in this
state on these three backends since 0.196.0.

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

`sanitizeNoteHtml` allows `<a href>`, so a description can genuinely store a link. The export
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

Pre-existing (`narrative-html.ts:60`), found by a cold review of 0.210.0. Not introduced by it, but
0.210.0 extended the reach to the AI write boundaries, so a model-supplied value now hits it too.

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
`export-pptx.ts:213` sets `<a:bodyPr wrap="square" …>` with **no** `normAutofit`/`spAutoFit` — verified,
so PowerPoint will not shrink text to fit. A task with a four-paragraph description turns one meta line
into four and pushes later fields past the bottom of the box.

★ Not a regression in kind (a long run-on line wrapped and overflowed too) but it is newly easy to hit,
and the adjacent "cap at 6 extra fields so the text fits the slide" comment is now false.
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

`sanitizeAiRichText` is `sanitizeRichText` → `sanitizeTemplateHtml` → `sanitizeRichText`. It is
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
and it CANNOT BE DONE. `sanitizeNoteLog` calls `sanitizeNoteHtml`, which calls DOMPurify, which binds
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

## 50. Undo of a BULK edit reverts write-through fields — open, pre-existing, DATA LOSS

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

**Fix when taken:** either preserve the live row's write-through fields in the edit branch
(`out[idx] = { ...item, noteLog: out[idx].noteLog }`, generalised over a per-entity field list), or
capture bulk edits field-wise. ★ Write the failing test first, and seed the note AFTER the bulk apply —
a fixture that adds it before passes either way (the §48 trap, restated).

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

## 54. Prod-only CSP blocks ProseMirror's base CSS — open, PRE-EXISTING, user-visible

Every rich-text editor in a **production build** renders without ProseMirror's base stylesheet, because
the prod CSP refuses the `<style>` element Tiptap injects at runtime. Dev is unaffected, which is why
this has gone unseen.

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

**It is dependency behaviour, not app code.** `@tiptap/react` + `@tiptap/starter-kit` → `@tiptap/core` →
prosemirror CSS. The editor loads via `next/dynamic`, so Turbopack ships that CSS inside a lazily-loaded
client chunk which injects it at runtime with no nonce. `grep -rn "prosemirror.css" src/` returns
nothing — the app never imports it. Fires once, on initial load.

★★ **Why it is prod-only, structurally** (`src/proxy.ts:51-52`) — verified on the live response header:

| build | `style-src-elem` | injected `<style>` |
|---|---|---|
| dev | `'self' 'unsafe-inline'` | allowed |
| prod | `'self' 'nonce-${nonce}'` | **blocked** |

★ It is `style-src-**elem**`. React `style={{…}}` props ride `style-src-attr 'unsafe-inline'`
(`proxy.ts:60`) and are **not** implicated — do not conflate the two axes when reasoning about a fix.
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
description.

**Not caused by the eslint-10 branch.** That branch touches no CSS, no markup and not `src/proxy.ts`;
its only runtime commit is six type annotations. The same violation, with an identical hash and only the
per-request nonce differing, was seen from the branch first and then measured on `main`.

### What is NOT established

- ★★ **Only `main` was measured.** That is sufficient to establish the branch did not introduce it, but
  it is **not** an independent re-confirmation of the branch-side observation — the two are one
  measurement plus one corroborating sighting, not two measurements.
- **Which fix is right.** Both options below are recorded; neither is decided.
- Whether any other lazily-loaded dependency injects an un-nonced `<style>` on a route the smoke does not
  reach. Only one such element was found on initial load; the sweep was not exhaustive across all views.

### Fix options — recorded, neither chosen

1. **Nonce Next's runtime style injection**, so the injected `<style>` carries the per-request nonce and
   the policy is unchanged.
2. **Allow `'unsafe-inline'` in prod `style-src-elem`.** ★★ This weakens the policy
   `docs/security/threat-model.md:71` leans on — precisely: that row's mitigation reads "strict
   nonce-based CSP, no `unsafe-inline` script" and lists `style-src-attr 'unsafe-inline'` as the single
   documented low-risk residual. Option 2 would extend that residual from style *attributes* to style
   *elements*. It does not touch the script axis, so it is narrower than "abandons the CSP" — but it is a
   real widening of the one exception the threat model already calls out, and it should be argued on that
   row, not around it.

### ★★★ Why this went unseen — the process lesson

**`npm run e2e:smoke` starts no server of its own.** Its header says so: *"Requires the dev/prod server
to be already running at the target URL."* `npm run e2e` is the opposite — Playwright's `webServer`
config auto-starts one. So in practice the smoke is only ever pointed at a dev server somebody already
had running, and **the dev CSP is the permissive branch**. A prod-only defect of this size was therefore
structurally invisible to the one suite most likely to catch it. That is the reason this bug is old and
unnoticed, not a footnote to it. Anything that needs prod-CSP coverage has to point the smoke at a real
`next start`, as the reproduction above does.

---

## 55. Thirteen hand-rolled `aria-pressed` toggles still show their on-state by colour alone — open

0.212.0 gave the shared `ToggleButton` primitive a non-colour pressed cue (a trailing check glyph).
Thirteen controls do NOT use that primitive and were left as they were. For MOST of them the only
visual signal that they are active is a fill or tint change — WCAG 1.4.1.

★ THIS READ **fourteen** UNTIL 2026-08-06. The field-visibility tier selector
(`modal-field-controls.tsx`) was the fourteenth, and it is RESOLVED — the control moved into the
modal header and its hand-rolled `aria-pressed` buttons were replaced by the shared
`SegmentedControl`, i.e. by `role="radio"`, which is exactly the answer this entry's own closing
paragraph proposed for the radio-like cases. Re-measure rather than trust the number:

```bash
grep -rn "aria-pressed={" src/app --include="*.tsx" | grep -v "\.test\." | grep -v "toggle-button.tsx" | wc -l   # 13
```

★★ TWO OF THE THIRTEEN ARE NOT COLOUR-ONLY, and an earlier revision of this entry said flatly that
all of them were. `voice-button.tsx:113` adds `animate-pulse` while listening (a motion cue) plus a
flipping `title`. `dictation-mic.tsx:73` is colour-only IN THE BUTTON, but the hook also returns a
`status` node rendering visible "Listening…/Transcribing…" text (`dictation-mic.tsx:83`) — so the
**13** callers that render it are covered and the two that destructure without it
(`note-log-panel.tsx:68,181`) are not. Check the caller, not the grep hit.
★ That number read **four** until 2026-08-05 and understated the covered set by nine, which errs
against this entry's own argument: `dictation-mic` is the WEAKEST of the twelve colour-only cases,
not a middling one. Re-measured — all 13 destructure the node AND render it in JSX; the 2 that do
not destructure it are the only gap. Reproduce:

```bash
grep -rn "= useDictationMic(" src/app --include="*.tsx" | grep -v "\.test\." | grep -cE "\bstatus\b"   # 13
```

★ A grep keyed on `status:` answers **12** — `chat-panel.tsx:198` destructures `status` unrenamed, so
it has no colon. Key on the bare word, and confirm each hit RENDERS the node rather than merely
destructuring it.

`rich-text-editor.tsx:83-84` is the clearest and the most used: `BTN` and `BTN_ON` differ by
`bg-ui-dark-blue` + `text-white` and nothing else, on the bold/italic/list buttons every task
description and note passes through. The others: `task-form-fields.tsx:545,559` (health-override
chips) · `create-project-wizard.tsx:308,337` (template picker) ·
`raci-chip-picker.tsx:105` · `knowledge-panel.tsx:213` ·
`settings-sections/comm-templates-section.tsx:335,357` (version compare) · `step0-import-panel.tsx:304`
· `influence-interest-matrix.tsx:80` · `dictation-mic.tsx:73` · `voice-button.tsx:101`.

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
leave it to the date above. The editor toolbar and the two mic buttons are genuine binary toggles
and are the natural first migration.

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

★ **Pre-existing, not introduced by §2's split** — they were equally dead at `0d770283`
(`use-resource-planner.ts:710` and `:723`, returned at `:1023`/`:1025`). The move-only rule required
carrying them across verbatim, so the split re-exported two dead handlers through a three-level
spread rather than creating the problem.

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
`dashboard-panel.tsx:378` `VarianceSummary` (the Turso-gated Trends card in the dashboard masonry,
which sits DIRECTLY AFTER the Progress `<Section>`) and the Trends view (`trends-panel.tsx`).
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

## 77. The snapshot capture gate is a one-way latch, so a mid-session storage switch can still capture the wrong project — open

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

★★ **The two obvious fixes are both wrong, which is why this is deferred rather than done.**
(a) `setWorkspaceLoaded(false)` at the top of the load effect strands the flag `false` forever on the
`suppressNextLoadRef` early-return path — the one project switches take — silently disabling capture
for the rest of the session. (b) Resetting it anywhere in state loses the race anyway: both effects
run in the SAME commit, and the capture effect reads the `workspaceReady` of the render it was
scheduled from, so a reset lands one render too late.

★ What would actually work: a **ref** carrying readiness (mutated synchronously when a load starts,
so the capture effect reads the fresh value at the moment it runs) *plus* the existing state (to
re-trigger the effect when it flips true). `useStorageBackend` is registered before `useSnapshots` in
`task-manager.tsx`, so its effect body runs first and the ref is already `false` by the time capture
is considered. Not attempted here — it is a storage-layer change and this was a bug-fix pass.

---

## 78. A brand-new Turso project auto-captures an empty snapshot, and that row becomes the BASELINE — open

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
load landed", not "is this project worth snapshotting". Do NOT overload it — that flag's contract is
what makes §77's reasoning tractable.

★ The fix is on the other side: gate `isFirstEver` (or the auto-capture itself) on the workspace
having content. Deliberately not done here, because "empty" needs defining — a project with one task
and no budget legitimately produces null KPIs, so a naive `tasks.length > 0` test would still baseline
a snapshot with no SPI/CPI. Recorded in the `workspaceReady` doc comment as a known exception.

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

## 87. AI cannot read the activity log — deliberate, no tool exposes it

`activity-log-context.tsx` exposes a WRITER only — `LogActivityFn`, delivered through
`ActivityLogProvider`/`useActivityLogger()` — and the log itself is not part of `Workspace`, so there is
nothing for a read tool to query without new plumbing. Reading it would mean threading it through
`task-manager.tsx`, which is the Phase-3 baselined orchestrator (see "task-manager decomposition map"
above) and is deliberately kept from growing new responsibilities.

Same handling as §86: `VIEW_AI_SCOPE.activity.reading` states the model cannot read the log, and
`ASK_CLAUDE_PROMPTS` has no `activity` entry (same test pins both absences together).

---

## 88. `ai-section.tsx`'s own sub-section titles are not real headings — open, a11y

Found while building the view-scoped AI prompts' Settings disclosure (`AiViewScopeDisclosure`,
`settings-sections/ai-view-scope-disclosure.tsx`, unreleased at time of writing). Its own "AI
Assistant" and "Operating guides" sub-section titles in `ai-section.tsx` are styled elements, not
headings:

- `{t(lang, "aiAssistant")}` renders inside a `<span className="... text-sm font-medium ...">`
  (`ai-section.tsx:412`).
- `{t(lang, "aiGuidesHeading")}` renders inside a `<p className="text-sm font-medium ...">`
  (`ai-section.tsx:603`).

A screen-reader user navigating that Settings tab by heading (NVDA/JAWS "next heading", VoiceOver
rotor) skips both — they read as body text, not section landmarks. `AiViewScopeDisclosure` was written
correctly from the start — a real `<h3>` for its own title — but the two pre-existing titles above it
were left alone as out of scope for that task. Not axe-visible: axe has no rule requiring a styled
sub-heading to be a real heading element, so the gate is silent here (same class of gap as §9's
`aria-sort` and §55's colour-only toggles). Fix is
mechanical — swap both to `<h3>` with matching classes — but touches visual rhythm in a settings tab
with no eye-verification pass scheduled, so it is recorded rather than fixed in this slice.

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

## 99. The e2e seed silently drops nine optional slices, so some axe scans run on an empty state — open

`e2e/seed.ts` writes the sample workspace into IndexedDB from TWO HARDCODED lists: an entity-store
list and a kv-key map. Anything named in neither is dropped without a word. `BrowserBackend`
persists nine optional slices as kv entries — `fieldVisibility`, `features`, `steeringCommittee`,
`timelogLinks`, `knowledgeItems`, `insights`, `settingsOverrides`, `calendarEvents`, `documents` —
and until this slice the seed's kv map carried NONE of them.

★★ The consequence is a gate that reads far stronger than it is. A view whose data never arrives
renders its EMPTY STATE, so axe scans a panel with no rows, no per-row controls and nothing that
could collide. The run is green and proves close to nothing. **`Insights` is in `A11Y_VIEWS` and is
in exactly this position today.**

★★★ This is not theoretical, and the evidence is the reason the entry exists. `documents` had the
identical defect; adding `documents: "documents"` to the kv map and seeding a second row turned up a
REAL `serious` violation on the first run — `scrollable-region-focusable` on the preview pane,
across all five scheme combos. That violation had been invisible because the pane had nothing to
scroll. Reproduce the shape of the check with:

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"
```

★★ HONEST CAVEAT, and the reason this was NOT folded into the documents commit: seeding a slice for
the first time can turn a currently-green scan RED, because it exposes markup the gate has never
actually examined. That is the gate working, but it is a finding that deserves its own change with
its own fix, not a surprise inside an unrelated commit.

★ The fix per slice is one line in the kv map, and the key name is the same on both sides (the
workspace field name equals the kv key). The cost is entirely in whatever the scan then finds.

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

---

## 102. Hand-rolled UI that should be a shared primitive, and glyphs that should be heroicons — open, ratchet

The full audit is [`docs/handrolled-ui-inventory.md`](handrolled-ui-inventory.md), taken 2026-08-07 on
`63e4d768`. It is the work-list for **both** parts; this entry exists so the register points at it.

**What 0.221.0 actually converted** — five panes, 17 call sites across six files, and nothing else:
`insights-panel.tsx` (4) · `insight-recommendation-controls.tsx` (3) ·
`dashboard-sections/insights-card.tsx` (4) all moved `Button` from `variant="ghost"` to
`"secondary"`; `budget-panel.tsx` converted 4 hand-rolled `<button>` to `Button variant="secondary"`;
`milestones-panel.tsx` and `milestone-edit-modal.tsx` each moved the achieved checkbox to
`ToggleButton`. **The remainder is a ratchet, not a scheduled slice** — acting on the inventory and
producing it are separate jobs, and converting 310 elements in one sweep is unreviewable.

The scale, so nobody re-derives it: **341** `<button>` sites in non-test `.tsx` across **152** files;
18 are the primitives' own internals; of the remaining 323, **12 are the word `<button>` in a
comment** and **311 are elements** — 134 correctly hand-rolled, **141 convertible** to `Button`,
**36** to `IconButton`.

★★ **The glyph baseline in the slice plan is not reproducible under the filter that plan's own
command states, and the difference is not drift.** Every quoted figure (`✕` 47 · `×` 75 · `•` 21 · `✓`
17 · `▲`/`▼` 17 · `↑` 12 · `⚠`/`⋮`/`↓` 9 · `▸` 4 · `▾` 3 · `🗒` 2) matches `src/app` scanned with the
`--include=*.tsx --exclude="*.test.tsx"` filters **not in effect** — `.ts` files and test files
included. Under the stated filter the same glyphs measure 24 · 22 · 7 · 10 · 14 · 5 · 8/2/4 · 4 · 3 ·
**0**. Two things follow. The `🗒` count is not UI at all — both hits are in the generated
`operating-guide-builtin.generated.ts`, and there is **no `🗒` glyph anywhere in the app's markup**
(the notes badge renders an icon). And `×` inflates 22 → 75 mostly because test comments are full of
arithmetic, so the multiplication-vs-close-glyph triage the plan calls "the main manual work" is
about a third the size it looks: of 22 real `×` lines, 8 are multiplication or prose and 14 are close
glyphs.

★★★ **Seven source sites have their glyph pinned by a test assertion, not the two the plan names.**
`report-table.tsx:148` (`report-table.test.tsx`, and again via `SortResizeTh` in
`calendar-series-list.test.tsx`) were known. The five that were not: `raid-panel-rows.tsx` 109-158 ·
`task-status-glyph.tsx` 54/56 · `dashboard-panel.tsx:364` · `entity-link-picker.tsx:222` ·
`milestone-horizon-strip.tsx:46`. Distinguish them from the ~10 test files that merely mention a
glyph in an `it(...)` title — the inventory lists both sets so the distinction is not re-derived.

★★★ **`raid-panel-rows.tsx` is the dangerous one and it is a WCAG 2.4.6 case, not a test case.** Its
seven sortable headers concatenate `▲`/`▼` into the header's own text, so the glyph sits inside the
button's **accessible name** — `raid-panel.test.tsx` matches it with a `getByRole` name regex, which
is what makes that visible. These are raw `<th>`s with no `aria-sort` (unlike `SortResizeTh`), so
replacing the glyph with an `aria-hidden` SVG would leave sort direction with **no** channel to
assistive tech at all. The same holds for `activity-log-panel.tsx:160`, `resource-directory.tsx:196`
and `roles-editor.tsx` 197-221. Any glyph sweep must read the `<th>` before touching the indicator.

★★ **`Button` is step one; the variant is step two.** The insights panes in this very release already
had `Button` — what changed was the variant, because ghost renders no border. Converting a
bordered-surface `<button>` to `Button variant="ghost"` deletes its border silently, and jsdom cannot
see it. Match the variant to the current look and eye-verify.

★ Two deliberate non-conversions, recorded so they are not re-litigated: the budget bucket drag
handle (`budget-panel.tsx:455`) carries `draggable`, the drag lifecycle **and** arrow-key reordering,
none of which `Button` forwards; and `milestone-edit-modal.tsx`'s `linkedTasks` checkboxes stay real
checkboxes, because a multi-select list is not a binary toggle and `aria-pressed` would announce each
row as a button rather than a checked item in a set.

★ The largest single conversion family is ~26 close/remove/clear controls spelling the same idea
three ways (`×` U+00D7, `✕` U+2715, `&times;`), all already carrying an `aria-label`. `XMarkIcon` is
imported in eight files already, so converging them adds no dependency — and since each is also an
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
