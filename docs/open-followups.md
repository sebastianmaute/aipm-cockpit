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
| 2 | `use-resource-planner.ts` 30% over the 800-line ceiling | R5 (0.202.0) | M | decided: split, unscheduled |
| 3 | `optimize_wbs` never built | R4 (0.201.0) | ? | owed; open design question |
| 4 | Two-tab last-writer clobber on file/IDB (#39) | audit (2026-07) | L | parked — own design |
| 5 | No list virtualization anywhere (#14) | audit (2026-07) | L | parked — own batch |
| 6 | Undo residuals: project delete, persistence, retention (#11) | audit (2026-07) | M each | optional, unscheduled |
| 7 | Four surviving dedup seams from the 2026-06 review | refactor review | S–M | re-verified 2026-07-27 |
| 8 | `tour-overlay` claims `aria-modal` with no Tab trap | 0.203.0 (Czerneda) | S | open — a11y, unguarded |
| 9 | `aria-sort` inconsistent across the four raw-`<th>` tables | 0.202.2 | S | open — a11y, unguarded |
| 10 | Keyboard move has no preview (band + day grid) | R5 (0.202.2) | M | open — a11y/UX |
| 11 | `instanceof DOMException` abort check misreports a user cancel | 0.201.0 | S | open — scoped out deliberately |
| 12 | `list_allocations` dumps the grid; should be a scoped query | R4 (0.201.0) | M | open — design |
| 13 | Security audit is scope-stale — 39 releases of unaudited surface | audit was v0.164 | M | open — re-scope |
| 14 | Timelog has two per-device stores keyed differently | 0.207.0 | S | open — low priority |
| 15 | Two file-picker patterns — extract a `FilePickerButton` | 0.208.0 (Yolen) | S | open — low priority |
| 16 | Dictation flattens rich formatting | 0.196.0, widened 0.209.0 | M | open — needs a design |
| 21 | Eye verification owed: change + milestone editors, 4 detail cases | 0.209.0 (Lafferty) | S | open — a11y/visual |
| 22 | `clipText` can split a surrogate pair (~54 call sites) | 0.209.0 (Lafferty) | M | open — needs golden regen |
| 24 | Named entities aren't decoded — miscount + mid-entity truncation | 0.209.0 (Lafferty) | S | **open — named tail only** |
| 28 | CSV/MD/Turso never DOMPurify a rich field at load | 0.196.0, widened 0.209.0 | M | open — needs a new boundary |
| 29 | `form.noteLog` is dead state in the task form | 0.209.0, promoted 0.210.0 | S | open — own change |
| 30 | A link in a task description loses its address in document exports | 0.210.0 (Larbalestier) | M | open — needs a decision |
| 31 | `sanitizeRichText` caps visible text, so markup bytes are unbounded | 0.210.0, pre-existing for 3 of 4 | M | open — truncates stored values |
| 32 | `HTML_START` misclassifies `<a note…>`-shaped plain text, deleting it | pre-existing, reach widened 0.210.0 | S | open — read-time classification |
| 33 | A multi-paragraph description can overflow its PPTX box | 0.210.0 (Larbalestier) | S | open — cosmetic, needs eye-check |
| 34 | ~~DOM-free guard filtered by NAME LIST (18 of 76 graph files)~~ | 0.210.0 (Larbalestier) | S | **CLOSED 0.210.0 — guard now resolves the import graph** |
| 35 | `sanitizeAiRichText`'s double pass can double-escape `<a-b>`-shaped markup | 0.210.0 (Larbalestier) | S | open — suspicion, same root as 32 |
| 36 | Template import has no allow-list; `noteLog` exports as a JSON blob — both wrongly cited as recorded in §28 | 0.210.0 (Larbalestier) | S | open — one decision each |
| 37 | `RaidItem.title`/`owner` have NO storage-side cap on any save or load path | pre-existing, found 0.210.0 | M | open — read-time normalisation care needed |
| 38 | `ALLOWED_URI_REGEXP` strips `target`/`rel` from every stored link — all links open same-tab | pre-existing, found 0.210.0 | S–M | open — not a vulnerability; moves goldens |

★ **The numbers are stable identifiers and closed ones are never reused** — hence the gaps at 17–20,
23 and 25–27, all closed by 0.210.0 "Larbalestier" (see Provenance). They are cited from outside this
file: `rich-text-plain.ts:96` points at §24, AGENTS.md at §22 and §28, and `docs/CODEMAPS/*` at §4,
§7 B4, §8–§10 and §13. Renumbering silently redirects every one of those.

---

## 1. Two dead `memo()`s in the Resources subtree — **fork open**

Originally filed as R5 §3, "`ResourcesPanel`'s memo never bails". Re-opened and re-derived
2026-07-27; the original write-up was right about the symptom and wrong about the cause, and it
missed half the finding.

### What is actually true

**`ResourcesPanel` (`resources-panel.tsx:680`) never bails.** `makeEditGuard` is called
UNMEMOIZED during render (`task-manager.tsx:2047`), so every `guardEdit(handler)` prop is a fresh
function each render — that is ~25 of the panel's 47 props (`task-manager.tsx:2180-2274`). The
`absenceCalendar` bag (`:2158`) is rebuilt each render, so its four function members are unstable
too. Call site: `workspace-section.tsx:511-559`.

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

## 2. `use-resource-planner.ts` is 30% over the 800-line ceiling — decided: split, unscheduled

**1037 lines.** The baseline records 1038 (`docs/baselines/file-sizes.json`), so it passes CI on one
line of slack — **the next line added to that file fails the build.** `LIMIT` is 800 in
`scripts/check-file-sizes.mjs`; the ratchet fails only on growth of a baselined file or a NEW file
over the limit.

It is **not** in `vitest.config.ts` `coverage.exclude`, so it is coverage-gated today — extraction
into new `.ts` files is coverage-neutral and needs no exclusion entry.

Cohesive clusters, with line ranges:

| cluster | lines | size |
|---|---|---|
| ref plumbing + `logUpdate` (shared, stays) | 131-167 | ~37 |
| RAID handlers (+ mitigation task at 872-911) | 181-311, 872-911 | ~170 |
| Absences + shifts | 312-446 | ~135 |
| Resource directory CRUD / bulk / import | 447-643 | ~197 |
| Reference data (roles · disciplines · grades) | 644-871 | ~228 |
| Planning grid (utilization, absence override, plan window) | 912-986 | ~75 |

★ **One cluster is not enough**: 1037 − 228 = 809, plus wiring ≈ 819, still over. Clearing 800 takes
**two** — reference data + resource directory lands at ≈620.

Follow the Phase-3 deps-object hook convention (`use-storage-file-ops.ts` is the pattern): a typed
`deps` object of live render-scope values, named `use*`, called unconditionally, returning
NON-memoized handlers.

★ Note the interaction with item 1: those NON-memoized handlers are the same ones that keep the
`ResourcesPanel` memo from bailing. Doing this split does not make item 1 worse, but do not let a
split tempt anyone into memoizing on the way past.

★ This is the surviving half of the 2026-06 review's **B2** ("`use-bulk-operations` + `use-resource-planner`
multi-concern"). `use-bulk-operations.ts` is **419 lines** as of 2026-07-27 — no longer a finding.
`task-manager.tsx` (B3) is tracked as **TD-5**, not here; it has grown 2224 → 2973 lines since that
review.

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

## 11. `instanceof DOMException` abort check misreports a user cancel — open

**Scoped out of 0.201.0 deliberately.** A plain user cancel surfaces a spurious error toast.

`use-tasks-dedup.tsx:111` catches the abort as
`if (e instanceof DOMException && e.name === "AbortError") return;`. When that `instanceof` fails
the branch falls through to the generic arm and fires `showToast("error", t(lang, "taskDedupError"))`
— an error the user caused on purpose, reported as a failure.

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
| `use-tasks-dedup.tsx:111` | bare `instanceof DOMException` | **YES** — falls through to an error toast |
| `use-action-analysis.ts:34` | bare `instanceof DOMException` | **YES** — falls through to `setError(msg)` |
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

## 14. Timelog has two per-device stores keyed differently — open, low priority

`timelog-panel.tsx` computes `projectId = ws.project?.code ?? "default"`, which keys the per-device
**actuals cache** via `useTimelogSync`. Slice C (0.204.0) added a second per-device store, the picker
scope, keyed on the canonical `portfolioCurrentId ?? "default"` instead — matching `landing-state`
and project-appearance.

They were deliberately NOT unified. Re-pointing `projectId` at the canonical key would silently
orphan every existing user's cached actuals: they would open Time bookings and find their fetched
data gone. Fixing it properly needs a read-both-keys migration, which is its own change.

★ The project *code* is user-editable, so the actuals cache already orphans on a code rename today.
That is the pre-existing bug this note records, not one slice C introduced.

★ Consequence to keep in mind while it stands: the two stores can disagree about which project they
describe. Rename the project code and the picker scope survives (canonical key) while the actuals
cache does not — so the picker restores a selection for bookings that are no longer loaded. The
scope-mismatch note added in the same slice does not cover this case; it compares the picker against
`links.customerId`, which is workspace data and unaffected by the rename.

---

## 15. Two file-picker patterns — extract a `FilePickerButton` primitive — open, low priority

The app opens a file dialog in two structurally different ways, and slice E (0.208.0) put both on the
**same settings surface**, Settings → Appearance:

| where | shape |
|---|---|
| `color-scheme-editor.tsx:212-215` | `<label className={btn}>` text + an `sr-only` `<input type="file">` as its child. The label IS the control; no ref, no imperative click. |
| `theme-gallery.tsx:76-95` | DS `<Button>` + a sibling `sr-only` input reached through a `useRef` and `inputRef.current?.click()`. |

Neither is a primitive. **Neither should simply be converted into the other**, which is why this is a
follow-up and not a slice-E fix:

- Converting the gallery to the label shape means copying the editor's `btn` — a **local hand-rolled
  class string** (`color-scheme-editor.tsx:190`), not a design-system export. That hand-rolls button
  styling in a second file and mints a `dup:check` clone, and `dup:check` is BLOCKING.
- Converting the editor to the gallery shape means the editor grows a ref + an imperative click for
  what a `<label>` already does declaratively.

The real fix is one small primitive — a `FilePickerButton` wrapping `Button` with an `accept` prop
and the input it owns — and moving both sites onto it. That also settles the a11y question in ONE
place: the gallery's sibling input was a **second tab stop announcing the same accessible name as its
Button** until `df507f95` gave it `tabIndex={-1}` + `aria-hidden`, and the axe gate cannot see a
duplicate accessible name (it reports missing names only), so nothing would have caught it. The
editor's label shape never had that failure mode, and a shared primitive means neither can regress
into it.

★ Do NOT "fix" this by making the input `display:none` — a hidden input cannot be clicked in every
browser, which is why both sites use `sr-only`.

★ Scope check before starting: `grep -rn 'type="file"' src/app --include=*.tsx` — that grep also hits
`BrandingImageInput`, the create-project import panel and `chat-panel.tsx`'s attachment upload. All
three are image/multi-file flows with their own validation and size caps, so folding them in is a
bigger question than the two theme pickers; the follow-up is scoped to those two.

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

`clipText` is the truncator behind `sanitizeText` and `sanitizeMultiline`, which have **49 call
sites** — `sanitize-core` (6), `sanitize-entities` (7), `sanitize-records` (36) — every capped name,
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

Applied once inside `clipText`, that closes all ~54 sites at once.

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

## 29. `form.noteLog` is dead state in the task form — open, own change

Promoted out of the old §27 when that entry closed in 0.210.0; this half was never a doc claim and
was not fixed. Re-verified 2026-07-29.

`fe779f32` removed `noteLog` from the submit payload — the note log is write-through and owns itself,
so a draft that snapshots it at modal-open and spreads it over the live row on save destroys any note
added while the editor was open. `use-task-submit.ts:167` records that deliberate absence. But the
field is **still seeded** into form state (`:341`, `noteLog: task.noteLog ?? []`), where it now feeds
only the disabled fallback button's count for an unsaved task — permanently `0`, since nothing can
write a note in create mode.

Retiring it means changing that button to a literal, then removing `noteLog` from `TaskFormState` and
the seed together, which touches `emptyForm()` and every fixture constructing a `TaskFormDraft`.
★ Worth doing as its own change; leaving it invites a future writer to put it back into `payload`,
which is the data-loss bug `fe779f32` fixed.

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

## 39. The timelog partial-failure toast has now failed CI six times, and raising its timeout did not fix it — open, needs a real diagnosis

`timelog-panel.test.tsx` → "surfaces a partial-failure toast when Refresh drops some projects". Six CI
failures, always this one assertion, always with the other ~767 files green and the full suite passing
locally: 0.205.0 · 0.208.0 · twice on the 0.209.0 MR · once on main after that merge (which left main
**red**) · and the 0.210.0 MR pipeline #5305.

★★★ **The recorded diagnosis is now in doubt, and the obvious next step is wrong.** The in-test comment
reasons from "always at ~5.1s ... a hair over the limit" to "worker starvation under full parallel load,
not a race", and !335 acted on that by giving this one assertion an explicit `timeout: 15000` above the
global `asyncUtilTimeout: 5000`. The 6th failure happened **with that mitigation in place** and burned
**15,093 ms** — the whole budget, again a hair over. The file took 18,488 ms.

Two budgets, 3× apart, both consumed almost exactly: that is the signature of the toast **never
arriving** in the failing run, not of it arriving slowly. Pure starvation would produce a spread — some
runs passing at 6s or 11s under a 15s budget. So:

- **Do NOT raise the timeout again.** 5s → 15s moved the failure point and bought nothing. 30s would
  move it again and cost another 15s of CI wall-clock per failure.
- The next step is to find out whether `showToast("error", …)` is reachable at all on that path under
  CI conditions — e.g. an unresolved promise in the mocked `useTimelogSync`, a lost `act()` flush, or a
  partial-failure branch that only fires when a timer wins a race it usually loses.
- ★ Honest limit of this inference: one data point at 15s. The toast could genuinely arrive at 15.5s.
  What *is* established is that the mitigation did not work and the reasoning behind it no longer fits
  the evidence.

★ Until diagnosed, the operational answer is to **retry the job**, not to edit the test. It is a known
flake with a known signature, and it has never failed locally.
★ It was untracked here until 2026-07-30 despite six occurrences and one red main — which is why the
frequency data lived only in a code comment and a memory file.

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
(selected arm, assignee picker) · `settings-sections/integrations-section.tsx:441` (link, carries
`underline` as a non-colour affordance) · **`tasks-section.tsx:588`** (Jira-sync button) ·
**`use-tasks-dedup.tsx:69`** (dedup toolbar button class const) · **`chat-prompt-chips.tsx:37`** ·
**`rich-text-view.tsx:13`**.

★★★ **`rich-text-view.tsx:13` is plausibly the most user-visible site in the whole set, and TWO
independent sweeps missed it.** `PROSE_CLASS` is
`"… [&_a]:text-ui-dark-blue [&_a]:underline …"` with no dark variant, and this is the app's shared
read-only rich-text sink — the note log, the dashboard narrative, and every stored HTML body render
through it. So **every link in every rendered rich-text field** is near-black navy on `--surface` in
dark mode. It belongs in this section by the entry's own criteria (it is the same underlined-link
shape as `integrations-section.tsx:441`, which is listed).
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

`combo-input:117` · `gantt-chrome:267` · `gantt-rows:154` · `inline-ai-edit-button:30` ·
`insights/insight-digest-card:86` · `jira-settings:207` · `labels-input:162` · `raci-panel:224,234` ·
`raid-edit-modal:355` · `raid-panel-rows:373` · `resource-directory:424` · `task-kanban-card:133` ·
`task-manager-ui:34` · `task-row:385` · `tasks-section:1007` · `workspace-section-chrome:177,178`

★ **`inline-ai-edit-button:30`, `task-kanban-card:133` and `task-row:385` each carry a base
`dark:text-ui-light-grey` on the same element** — they read as handled and are not.
★ `task-manager-ui:33/34` and `workspace-section-chrome:177/178` are the two-arm ternary shape: in the
first, the active arm is companioned and the inactive arm is not; in the second, both arms are broken.

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

## Provenance — where these items came from, and what already closed

Absorbed from three now-unreachable documents. Kept because it explains why an item is worded the way
it is, and because several entries are **negative results** — work already done that returned nothing,
which is exactly the kind of thing that gets re-run.

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
