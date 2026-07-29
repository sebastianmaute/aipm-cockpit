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
(`2d683d8e`, `diff.raw ?? diff.after`; the `?? after` arm is load-bearing for sanitizer-induced enum
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
