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
| 2 | ~~`use-resource-planner.ts` 30% over the 800-line ceiling~~ | R5 (0.202.0) | M | **CLOSED post-0.212.0** — two verbatim extractions, 1043 → 553; ★ the entry's own numbers AND its stated precedent were wrong |
| 3 | `optimize_wbs` never built | R4 (0.201.0) | ? | owed; open design question |
| 4 | Two-tab last-writer clobber on file/IDB (#39) | audit (2026-07) | L | parked — own design |
| 5 | No list virtualization anywhere (#14) | audit (2026-07) | L | parked — own batch |
| 6 | Undo residuals: project delete, persistence, retention (#11) | audit (2026-07) | M each | optional, unscheduled |
| 7 | Four surviving dedup seams from the 2026-06 review | refactor review | S–M | re-verified 2026-07-27 |
| 8 | `tour-overlay` claims `aria-modal` with no Tab trap | 0.203.0 (Czerneda) | S | open — a11y, unguarded |
| 9 | `aria-sort` inconsistent across the four raw-`<th>` tables | 0.202.2 | S | open — a11y, unguarded |
| 10 | Keyboard move has no preview (band + day grid) | R5 (0.202.2) | M | open — a11y/UX |
| 11 | ~~`instanceof DOMException` abort check misreports a user cancel~~ | 0.201.0 | S | **CLOSED 0.211.1** — shared `isAbortError`, all four sites. ★ premise DISPROVED in review: hardening, not a user-visible fix |
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
| 39 | Timelog partial-failure toast has failed CI eight times; a bigger timeout did not fix it | first seen 0.205.0 | M | open — needs a real diagnosis, NOT a timeout |
| 40 | `text-ui-dark-blue` with no mode-appropriate companion — **40 sites** | pre-existing, counted 0.211.0 | M–L | open — needs its own slice |
| 41 | Eye verification owed on 0.211.0, on surfaces no gate reaches | 0.211.0 (Samatar) | S | open — a11y/visual |
| 42 | `CalendarSyncControls` push/pull buttons carry unqualified names | pre-existing, found 0.211.0 | S | open — WCAG 2.4.6 |
| 43 | Two "Suggest RACI" reporting gaps | 0.211.0 (Samatar) | S | open — both incomplete rather than wrong |
| 44 | UX-roadmap S6 planned but UNEXECUTED, S7 undesigned | roadmap (gitignored, local-only) | L | open — invisible to every tracked doc |
| 45 | ~~`brace-expansion` advisory in the eslint dev chain~~ | 0.211.0 | S | **CLOSED 0.211.1** — major-scoped `overrides` pair |
| 46 | A `<label>`-wrapped file input can never show a focus ring | 0.211.1 | S | closed for 3 sites — **pattern open** |
| 47 | `chat-panel` clicks a `display:none` file input | pre-existing, found 0.211.1 | S | open — contradicts §15's own warning |
| 48 | ~~RAID editor destroys notes added while it is open~~ | pre-existing, found 0.211.1 | M | **CLOSED 0.211.1** — `noteLog` read from the stored row; ★ the task fix would have been worse |
| 49 | ~~Every AI edit to a RAID item erased its whole note log~~ | pre-existing, found 0.211.1 | S | **CLOSED 0.211.1** — ★ the central fix is FORBIDDEN (DOM-free sanitizer); fixed per-caller |
| 50 | Undo of a BULK edit reverts write-through fields | pre-existing, found 0.211.1 | M | open — **DATA LOSS**, shared undo engine, tasks likely affected too |
| 51 | `use-tasks-dedup` "on confirm" fails under CI load | found 0.211.1 (main #5418) | S–M | open — 2nd flaky test; ★ matcher hardened post-0.212.0, mechanism STILL NOT established |
| 52 | `useColumnResize`'s v1→v2 migration pins defaults for existing users | 0.212.0 (Nayler) | M | open — deliberate; a v1 payload is a defaults SNAPSHOT, and the cheap fix is already foreclosed |
| 53 | ESLint 10 is blocked upstream by `eslint-plugin-react` | 0.211.2 | — | open — **not actionable today**; a dated MEASUREMENT, re-measure before acting |
| 54 | Prod-only CSP blocks ProseMirror's base CSS | pre-existing, found 0.211.2 | S–M | open — **user-visible in production**, no gate sees it |
| 55 | Fourteen hand-rolled `aria-pressed` toggles show their on-state by colour alone | 0.212.0 (Nayler) | M | open — a11y (1.4.1), unguarded; ★ 2 of the 14 are NOT colour-only |
| 56 | `ToggleButton`'s pressed state is near-invisible in all three DARK schemes | 0.212.0 (Nayler) | S–M | open — **WCAG 1.4.11**, 1.03–1.22:1; fix belongs in the scheme maps |
| 57 | Four toolbar Outlook enable-toggles carry an untested `auto` guard | 0.212.0 (Nayler) | S | open — the storage-layer mask IS pinned; these four are not |
| 58 | The axe gate can pass against a STALE dev server | 0.212.0 (Nayler) | S | **HALF CLOSED post-0.212.0** — version stamp + guard test; ★ other half has a designed follow-up (cwd hash / boot nonce), fresh-port convention still required |
| 59 | Eye verification owed on 0.212.0 — and on the two releases before it | 0.212.0 (Nayler) | S | open — ★ the finding is the PATTERN, three releases running |
| 60 | The file-size ratchet ignores every file at or under 800 lines, so a sub-limit baseline entry is inert | pre-existing, found post-0.212.0 | S | open — no fix proposed; ★ §2's re-record buys nothing but dropping the stale 1043 |
| 61 | Three residuals from the `use-resource-planner` split | post-0.212.0 | S | open — cosmetic + a stale comment + a dup seam jscpd cannot yet see |
| 62 | Two reference-data handlers have no production consumer, only tests | pre-existing, found post-0.212.0 | S | open — delete-or-record; ★ needs a non-move-only commit |

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

## 2. ~~`use-resource-planner.ts` is 30% over the 800-line ceiling~~ — CLOSED post-0.212.0

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
| `src/app/use-reference-data.ts` | 308 | 15 handlers — roles · disciplines · grades (create/save/delete/assign/reorder) |
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

Verified move-only rather than asserted:

- the public return shape is **54 keys in identical order**, before and after (23 named keys plus
  three spreads — `resourceDirectoryApi` 9, `calendarEventsApi` 7, `referenceDataApi` 15);
- every `useCallback` dependency array survives verbatim as a multiset. Measured with one regex on
  both sides: **18 dependency arrays before, 25 after** — the seven new ones are the ref-sync
  `useEffect` deps the two new files re-derive locally, and nothing else changed;
- neither new file needed a `vitest.config.ts` `coverage.exclude` entry, exactly as the original
  entry predicted: these are pure `.ts` modules, coverage-gated like their parent.

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
- **resource-directory handlers do reach** the memo'd `ResourceDirectory` (`resource-directory.tsx:442`)
  and `ResourcesPanel` (`resources-panel.tsx:682`) — but they arrive `guardEdit()`-wrapped
  (`task-manager.tsx:2258-2261`), and `guardEdit` is `makeEditGuard(...)` called unmemoized during
  render (`task-manager.tsx:2041`), so their identities are unstable whatever this hook does.

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

**The original write-up follows.**

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

**Was:** `timelog-panel.tsx` computed `projectId = ws.project?.code ?? "default"`, which keyed the
per-device **actuals cache** via `useTimelogSync`. Slice C (0.204.0) added a second per-device store,
the picker scope, keyed on the canonical `portfolioCurrentId ?? "default"` instead — matching
`landing-state` and project-appearance. Because the project *code* is user-editable, a rename orphaned
the actuals cache while the picker scope survived, so the picker restored a selection for bookings that
were no longer loaded.

**Resolution:** the actuals cache is keyed on the canonical id. `timelog-panel.tsx`'s local is now named
`projectCode` and no longer keys anything — **it is only the picker's in-place project-switch signal**
(`use-timelog-picker-scope.ts:49-50`, `:213`), which must keep receiving `ws.project?.code` or the
picker stops re-seeding on a switch. Guarded by a test in `timelog-panel.test.tsx` that fails with
`expected 'proj-a' to be 'canonical-key'` if the wiring is reverted.

★★ **A pre-existing cache is ORPHANED, deliberately.** Existing users open Time bookings once, see an
empty pane, and press Fetch.

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

**The original write-up follows — present tense throughout, and NO LONGER TRUE at HEAD.** Kept for the
reasoning, not the facts: `timelog-panel.tsx` now passes the canonical `projectId: projectKey`, so
neither paragraph below describes today's code. (This marker was missing, so a top-to-bottom reader
could have re-opened a closed bug — §11 and §15 both carry it.)

★ The project *code* is user-editable, so the actuals cache already orphans on a code rename today.
That is the pre-existing bug this note records, not one slice C introduced.

★ Consequence to keep in mind while it stands: the two stores can disagree about which project they
describe. Rename the project code and the picker scope survives (canonical key) while the actuals
cache does not — so the picker restores a selection for bookings that are no longer loaded. The
scope-mismatch note added in the same slice does not cover this case; it compares the picker against
`links.customerId`, which is workspace data and unaffected by the rename.

---

## 15. ~~Two file-picker patterns — extract a `FilePickerButton` primitive~~ — CLOSED in 0.211.1

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
One test query did legitimately move: `branding-image-input.test.tsx` went from
`getByLabelText("Logo")` to `getByRole("button", { name: "Logo" })`, because the accessible name moved
from the wrapping `<label>` to the Button. No label or `aria-label` was re-added to keep the old query.

**The original write-up follows.**

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

## 29. ~~`form.noteLog` is dead state in the task form~~ — CLOSED in 0.211.1

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

**The original write-up follows.**

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

## 39. The timelog partial-failure toast has now failed CI eight times, and raising its timeout did not fix it — open, needs a real diagnosis

`timelog-panel.test.tsx` → "surfaces a partial-failure toast when Refresh drops some projects". Eight CI
failures, always this one assertion, always with the other ~767 files green and the full suite passing
locally: 0.205.0 · 0.208.0 · twice on the 0.209.0 MR · once on main after that merge (which left main
**red**) · the 0.210.0 MR pipeline #5305 · and TWO on 2026-08-02 — the weekly `schedule` pipeline #5403
(00:25) and the post-merge main pipeline #5418 (19:38) for the 0.211.1 MR !338, which again left main red.

★★★ **THE "ONE DATA POINT" CAVEAT AT THE BOTTOM OF THIS ENTRY IS NOW CLOSED — the toast never arrives.**
Three failures have now run under the 15 s budget, and they consumed:

| run | duration |
|---|---|
| !335 (the 6th failure) | **15,093 ms** |
| #5403 (weekly schedule, 2026-08-02) | **15,098 ms** |
| #5418 (main post-merge, 2026-08-02) | **15,117 ms** |

A spread of **24 ms across three runs** at a 15,000 ms ceiling. If the toast were merely arriving slowly
under load, the durations would scatter — some runs passing at 6 s or 11 s, failures landing at varied
points past 15 s. Instead all three consume the entire budget to within 0.16%. That is the timeout
expiring on a toast that is never coming, on those runs. Stop treating this as a performance problem.
★ What is still NOT established: why it is reachable on most runs and not these. The next step remains
the one below — determine whether `showToast("error", …)` is reachable on that path at all under CI
conditions — but it can now be pursued as a logic/race question rather than a timing one.

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
- ~~★ Honest limit of this inference: one data point at 15s. The toast could genuinely arrive at 15.5s.~~
  **SUPERSEDED 2026-08-02 — see the three-run table above.** Two further failures at 15,098 ms and
  15,117 ms put the spread at 24 ms across three runs, which rules out "arrives at 15.5 s": a value that
  close to the ceiling three times running is the ceiling, not the arrival. What *is* established is
  that the mitigation did not work and the reasoning behind it no longer fits the evidence.

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
shipped slice B instead. The tasks: `graph-recurrence.ts` · `calendar-event-attendees.ts` · widen
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

What `npm audit` actually reports today:

```
brace-expansion  <1.1.17 || >=4.0.0 <5.0.8
Severity: high
fix available via `npm audit fix`
1 high severity vulnerability
```

| the entry claimed | live, verified 2026-08-02 |
|---|---|
| "`npm audit` reports **9 high**" | **1 high**, total 1 |
| "range is `<=5.0.7` **across all majors**" | **TWO** sources: `<1.1.17` (1.x) and `>=4.0.0 <5.0.8` (5.x) |
| "no 1.x release escapes it — not 1.1.17, not 1.1.18" | **both are published and both clear it** (`npm view brace-expansion versions`) |
| "`npm audit fix --force` offers exactly one remedy: eslint@10.8.0, a breaking major" | npm offers plain **`npm audit fix`** — no `--force`, no major |

Installed today: `brace-expansion@1.1.16` (via `eslint@9.39.4` → `minimatch@3.1.5`) and `5.0.7` (via
`typescript-eslint` → `minimatch@10.2.5`). **Both are exactly one patch below a clean release**
(1.1.17 / 5.0.8).

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

★ Deliberately NOT fixed in 0.211.1: that batch is scoped to four register entries, and a dependency
change means lockfile churn plus a full re-verification (the `--max-warnings=0` gate makes any eslint
tree movement a real risk). The blocking CI gate is unaffected either way — see below.

**The original write-up follows, with its two EXECUTED negative results intact — those still stand,
they simply do not exhaust the option space.**

`npm audit` reports **9 high** (GHSA-mh99-v99m-4gvg — DoS via unbounded expansion → OOM). `npm audit
fix --force` offers exactly one remedy: **eslint@10.8.0, a breaking major**.

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

**Why it is deferred rather than fixed.**
- ★★ **The blocking gate is unaffected and green.** `.gitlab-ci.yml:99` is `npm audit --omit=dev
  --audit-level=high` — dev deps excluded. `dependency-audit` passed in all three pipelines on
  2026-07-31. Nothing is red.
- It is a **build-time DoS in a linter**. No runtime or shipped-code exposure; eslint and its plugins
  are dev-only.
- ★★ eslint 10 is a major landing against a **`--max-warnings=0`** gate, so any rule added, renamed or
  changed-by-default becomes an instant fatal build. There is also a hook blocking `eslint.config.mjs`
  edits, which a major would likely require. That is a slice with its own verification, not an install.

★★★ ~~Plugin peers would NOT block it — `eslint-config-next@16.2.6` is `>=9.0.0`, and typescript-eslint
and `eslint-plugin-react-hooks` both list `^10.0.0`. The risk is entirely in rule drift, not install
resolution.~~ ← **FALSE in its conclusion, and this is the sentence that made the 2026-08-03 attempt
look safe — see §53.** The peer survey is accurate as far as it goes (install DID resolve cleanly, no
ERESOLVE), but it draws the boundary wrong twice. It surveyed `eslint-plugin-react-hooks` and never
**`eslint-plugin-react`**, whose own peer is `^3 || … || ^8 || ^9.7` — no published version mentions
v10. And it framed the risk space as *peers vs rule drift*, when the actual failure was a third
category it did not model: a transitive plugin calling `context.getFilename()`, which v10 removed.
Measured rule drift was **ZERO** — `eslint:recommended` is not layered into this repo at all.

★★ **The WEEKLY `dependency-audit-full` job DOES include dev deps and all severities, so it will keep
reporting this.** That is expected, not a regression — this entry exists so the finding is not
re-litigated from scratch each week, and so nobody re-attempts the two overrides above. ★ It is
**one** high now, not nine; if the weekly job reports a different count than this entry, the entry is
the stale one — re-measure, don't reconcile.

**To close:** ~~upgrade to eslint 10 as its own slice — migrate `eslint.config.mjs`, run
`npx eslint --max-warnings=0 src/app` against the full rule set, and expect to fix drift rather than
merely bump a version.~~ ← **that route is shut on published packages as of 2026-08-03 — it was
attempted and reverted; see §53** for the upstream blocker and what to re-measure before trying again.
★ Nothing here is blocked on it: this entry's own advisory was closed by the scoped overrides above,
not by an eslint major. Current: eslint `^9` (9.39.4).

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

★ Still open, cosmetic: `raid-edit-modal.tsx:460`'s `draft.noteLog?.length ?? 0` reads the same stale
snapshot, so the Notes button can under-report while the window is open. The log itself is safe.

★ The ratchet baseline for `use-resource-planner.ts` moved 1041 → 1043 for the two-line landmine
comment. Deliberate and minimal; §2 (split that file) is where the real answer lives.

**The original write-up follows.**

## 48-was. RAID editor destroys notes added while it is open — pre-existing, DATA LOSS

**The task-side defect §29 closed still exists in full on RAID.** Found by a reviewer of the 0.211.1
batch, while checking whether the new AGENTS.md sentence ("Re-adding the field is a typecheck error
before it is a data-loss bug — keep it that way") was true app-wide. It is not; it is task-scoped.

The chain, traced independently at three hops:

| hop | file | what it does |
|---|---|---|
| 1 | `raid-panel.tsx:166`, seeded `:325`/`:346` | `useState<RaidItem \| null>` holds a **snapshot** of the whole row at edit-open, `noteLog` included |
| 2 | `task-manager.tsx:2128` `openRaidNotes` | the notes window is owned ABOVE the panel and commits **write-through** to the workspace `raid` array — the snapshot never moves |
| 3 | `use-resource-planner.ts:185` | `const withStamp: RaidItem = { ...item, … }` then `prev.map(r => r.id === id ? withStamp : r)` — a full row **REPLACE** carrying the open-time `noteLog` |

So: open the RAID editor → Notes → add a note → Save ⇒ **the note is gone.** Identical shape to the
task defect fixed in 0.209.0.

★ The same snapshot also feeds the modal's note count (`raid-edit-modal.tsx:460`,
`draft.noteLog?.length ?? 0`), so the button under-reports while the window is open. That is the
falsifiable-count problem 0.211.1 removed from the task form, still live here.

★★ **Not fixed in 0.211.1 on purpose.** That batch was scoped to four named register entries; this is
a fifth, found during its review. Fixing it means deciding *how* — omit `noteLog` from the RAID save
payload (mirrors `use-task-submit.ts`), or stop snapshotting the whole row. The second is the better
shape and the larger change, because `draft` is also what the risk matrix and status handlers mutate.

★ **Traced, NOT repro-tested.** No failing test was written. Write one first — and note the §29 test
trap it inherits: a fixture that never adds a note while the editor is open passes either way.

★ Sweep the same shape at the other snapshot-then-replace editors before assuming RAID is the only
one; the pattern is a full-row `useState` draft plus a write-through side channel, not anything
specific to notes.

---

## 49. ~~Every AI edit to a RAID item erased its whole note log~~ — CLOSED in 0.211.1

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

## 51. A SECOND load-sensitive test — `use-tasks-dedup` "on confirm" — open, mechanism NOT established

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

**What is NOT established — and the two facts do not reconcile from the CI trace alone:**
the line before the failure is `await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy())`.
For the reported error to be the one that surfaced, that `waitFor` must have SUCCEEDED — yet the modal
was absent and the trigger still busy. Either something other than the modal satisfied `/dup/i`, or the
preview opened and closed again between the two lines. **Do not write a fix based on either guess;
reproduce it first.**

★★ **The matcher is fragile independently of the root cause, and that is worth fixing regardless.**
`/dup/i` is a substring of the trigger's own accessible name, "**Dedup**licate & unify tasks". The gate
is therefore not a reliable barrier for the un-waited `getByRole` on the next line: it can be satisfied
by something that does not imply the modal is open. Assert on a modal-specific node (`findByRole` for
"merge selected") so the wait and the assumption are the same condition. ★ The trigger renders no text
child, so it is not proven that it is what matched — this is a fragility argument, not the diagnosis.

★★ **DONE post-0.212.0 — and it changes nothing about the diagnosis.** The test now awaits
`findByRole("button", { name: /merge selected/i })`, so the wait and the assertion are one condition
and `/dup/i` is gone. **The entry stays open**: this removed a way the test could mislead, not the
reason it failed. If it fails again, the failure is now at least trustworthy — do not read the fix as
a root cause, and still do not raise a timeout.

★★★ **DO NOT "FIX" THIS BY RAISING A TIMEOUT.** §39 is the cautionary case directly above: 5 s → 15 s
moved the failure point and bought nothing, and three subsequent failures then consumed the 15 s budget
to within 24 ms. This one is not even timeout-shaped (38 ms).

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
file count understates the blast radius by half):

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
## 55. Fourteen hand-rolled `aria-pressed` toggles still show their on-state by colour alone — open

0.212.0 gave the shared `ToggleButton` primitive a non-colour pressed cue (a trailing check glyph).
Fourteen controls do NOT use that primitive and were left as they were. For MOST of them the only
visual signal that they are active is a fill or tint change — WCAG 1.4.1.

★★ TWO OF THE FOURTEEN ARE NOT COLOUR-ONLY, and an earlier revision of this entry said flatly that
all of them were. `voice-button.tsx:113` adds `animate-pulse` while listening (a motion cue) plus a
flipping `title`. `dictation-mic.tsx:73` is colour-only IN THE BUTTON, but the hook also returns a
`status` node rendering visible "Listening…/Transcribing…" text (`dictation-mic.tsx:83`) — so the
four callers that render it are covered and the two that destructure without it
(`note-log-panel.tsx:68,181`) are not. Check the caller, not the grep hit.

`rich-text-editor.tsx:83-84` is the clearest and the most used: `BTN` and `BTN_ON` differ by
`bg-ui-dark-blue` + `text-white` and nothing else, on the bold/italic/list buttons every task
description and note passes through. The others: `task-form-fields.tsx:545,559` (health-override
chips) · `create-project-wizard.tsx:308,337` (template picker) · `modal-field-controls.tsx:63` (tier
selector) · `raci-chip-picker.tsx:105` · `knowledge-panel.tsx:213` ·
`settings-sections/comm-templates-section.tsx:335,357` (version compare) · `step0-import-panel.tsx:304`
· `influence-interest-matrix.tsx:80` · `dictation-mic.tsx:73` · `voice-button.tsx:101`.

★★ NOTHING AUTOMATED WILL FLAG THESE. axe 4.12.1 ships exactly ONE rule tagged `wcag141` —
`link-in-text-block`, which is about links against surrounding text — and nothing in axe evaluates
whether a CONTROL's state is colour-only (queried in-process: 105 rules, one `wcag141`). Several of
the hosts sit on axe-scanned views and pass today. The count above is the whole population — every
`aria-pressed` JSX attribute outside the primitive, counted, not estimated.

★ The fix is not uniformly "migrate to `ToggleButton`". Some are radio-like single-select groups
(template picker, tier selector, RACI role, import method, quadrant) where the primitive's chip
styling and pinned-label rule may not fit, and where `role="radio"` might be the better answer than
`aria-pressed` at all. The editor toolbar and the two mic buttons are genuine binary toggles and are
the natural first migration.

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

## 58. The axe gate can pass against a STALE dev server — HALF CLOSED post-0.212.0

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

`handleAssignResourceRole` and `handleClearResourceRole` (`use-reference-data.ts:127` and `:140`)
are reachable only from `use-resource-planner.test.tsx` (`:1012`, `:1023`, `:1085`, `:1096`). Nothing
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

## 63. `gantt.tsx` crossed 800 and was baselined rather than split — open, deliberate deferral

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

**What grew it**, so the next reader does not re-derive it: 0.213.0 added the status-bucket filter
wiring, the `visibleMilestones` memo, the holiday/grid overlay mounts, the dependency-layer gate, and
the empty-state branches (`noStatusSelected` / `emptyMessageKey` / `rendersNothing`) with their two
render sites.

**The seam that was identified before the split was called off:** the empty-state block — the
message-selection const plus the branches rendering `ganttNoStatusSelected` / `ganttNoMatches` /
`ganttEmpty` and the add-first-item box. It is prop-driven and self-contained, and it is the piece
that most recently grew. The Gantt already has the right shape to extract into
(`gantt-chrome.tsx` · `gantt-rows.tsx` · `gantt-overlays.tsx` · `gantt-view-menu.tsx` ·
`gantt-engine.ts`), so this is an extraction along an existing grain, not a new architecture.

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
