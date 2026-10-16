# Forecast — saved scenarios and the AI forecast tool (§502)

Status: design, approved in chat by the owner 2026-10-16. Builds on
`2026-10-14-monte-carlo-forecast-design.md` (engine, slice 1), `2026-10-15-forecast-simulation-surfaces-design.md`
(parts 1–4) and `2026-10-15-forecast-simulation-part-2-design.md` (part 2, merged in #766). Reference:
`docs/AGENTS/forecast.md`.

## 1. Intent

The customer who asked for Monte Carlo forecasting (GitLab #41, "strongest functional ask", three times) asked for
**scenarios and confidence levels**. Confidence levels exist (P50/P80/P95). Scenarios do not: What-if is a flat,
throw-away adjustment that is gone on reload and cannot express what a project manager actually says in a steering
meeting — "if the contractor starts in January", "December is a freeze", "the reporting module adds twelve tasks for
Go-live on 1 December".

This design adds **saved scenarios with dated changes**, compared side by side against "As is", and an **AI tool** that
reads the forecast and its scenarios and can save a scenario it suggests. Together with parts 3–4 this completes §502.

## 2. What "complete" means here (owner, 2026-10-16)

§502 is complete when parts 3 and 4, saved scenarios and the AI tool are built and merged, and the Forecast view is
removed from `RELEASE_HIDDEN_VIEWS` on `main`. Tagging a release from that `main` is a **separate owner decision** and
is not part of this work.

## 3. Goals, non-goals, anti-goals

**Goals**
- A project keeps up to **4 named scenarios**, each a list of **dated changes** (capacity and scope).
- The Forecast view compares "As is" with every saved scenario: range bars against plan end **and** an exact table
  (owner: both add information), plus a per-milestone chance table.
- A scope change can name the milestone it belongs to, so scenarios move milestone chances honestly.
- The assistant can read the forecast and scenarios, run a one-off what-if, and create or edit a scenario.

**Non-goals**
- Scenarios in exported documents (status report, steering pack, PPTX/DOCX/HTML).
- Repeating changes ("every December"), per-person capacity, changes to the history window or unit per scenario.
- A scenario ever driving the Dashboard, Next actions, the KPI strip or the daily `forecastHistory` entry.
- The assistant deleting a scenario.

**Anti-goals** (failure even if it technically works)
- A scenario that shows numbers computed on the day it was saved. Scenarios store **inputs only** and are recomputed
  from today's tasks and history every time they are shown.
- Differences between columns that are simulation noise. Every column uses the **same random draws** (§5.4).
- A scenario number that does not look simulated. Every figure carries the existing "sim" marking.

## 4. Decisions

### 4.1 The scenario (owner: dated changes, milestone-attributed scope)

A scenario is `{ id, name, changes[] }`. A change is one of:

| Kind | Fields | Meaning |
|---|---|---|
| **Capacity** | `percent` (10–300), `from` (ISO date), `until` (ISO date or empty = to the end) | Every simulated working day in `[from, until]` delivers `percent / 100` of a drawn history day. |
| **Scope** | `tasks` (non-zero integer, ±), `on` (ISO date), `milestoneId` (optional) | On `on`, `tasks` tasks are added (+) or removed (−). Size of one task = the existing What-if rule (one task in the tasks unit; the median estimate in effort mode). |

Rules (designer's calls, apply everywhere — UI, engine, AI writes):
- Changes apply on **working days of the project calendar** (weekends and holidays as the engine counts them today).
- A date before today counts **from today** (it is not an error; an old scenario stays usable). `until` before today
  makes a capacity change inert; the editor shows it greyed with "ended".
- **Overlapping capacity changes multiply** (130 % and 40 % on the same day = 52 %), then clamp to 10–300 %.
- **Added scope must be finished.** A trial whose backlog was done before an addition's date resumes when it arrives;
  the finish is after the addition is done. Work cannot be delivered before it arrives (the trial's done count may not
  exceed the work that has arrived by that day).
- **Removed scope** without a milestone lowers the total backlog on its date, never below zero, and moves **no
  milestone position** — it is modelled as un-needed work at the end of the queue, not as specific tasks (designer's
  call after the builder check: picking real tasks off the end of `orderBacklog` would hit undated milestone-linked
  tasks and break the "unattributed moves only the finish" rule). With a `milestoneId` it comes off that milestone's
  remaining work, never below zero, and moves its position and every later one back by the removed amount.
- **Milestone attribution.** Added scope **with** a milestone joins that milestone's work: its queue position moves out
  by the added amount, and so does every later position. Added scope **without** a milestone queues after all current
  work: it moves the project finish, no milestone. (This is today's What-if rule — "scope does not move milestone
  chances" — stated openly.) Capacity changes move every milestone, as What-if capacity does today.
- **Both milestone figures move.** `milestoneChances` returns `chance` (queue position, "chance in due order") and
  `chancePrioritised` (the milestone's own work only, the basis of Gap). Attributed scope changes both for its
  milestone; the prioritised figure of other milestones is untouched. The Scenarios milestone table shows `chance`;
  `get_forecast` returns both, so "What would get X on time?" can answer with prioritising as one lever.
- A milestone that is achieved, has no valid date, or does not exist when the scenario is shown makes its scope rows
  count as unattributed; the editor marks those rows "milestone gone".
- At most **20 changes** per scenario; names 1–60 characters, unique per project (case-insensitive).

### 4.2 Where it lives in the Forecast view

- The mode `SegmentedControl` gains its third segment: **Quick / What-if / Scenarios** (named in the slice-1 spec).
- **What-if stays flat** and unsaved, for quick play. It gains **"Save as scenario"**: name prompt, then the current
  What-if becomes change rows starting today (a capacity change from today with no end; one unattributed scope change
  today). What-if's **scope percent is converted to whole tasks at save time** (round half-up, the existing What-if
  rule) and the save dialog says so ("+10 % = 6 tasks today"). This is the one value frozen at save, and it is shown
  frozen: from then on it is an editable task count like any other scope row (designer's call; scenarios have no
  percent kind, because a percent of a moving backlog changes meaning as tasks close).
- **Scenarios mode** shows:
  1. **Range bars**: one row per column ("As is" first, then scenarios in saved order), each the existing
     `ForecastRangeBar` shape (P50–P95 band, P80 tick) on one shared date axis, with the plan-end line.
  2. **The table**: columns As is + scenarios; rows Even odds (P50) · Safe to commit (P80) · Worst likely (P95) ·
     On time by plan end · and, once part 3 is merged, Cost at finish (P80) · Chance over budget.
  3. **Milestones**: one row per unfinished milestone with a date, chance on time per column, sorted by the As-is chance,
     worst first; states that are not a chance ("overdue", "no linked tasks") read as today.
  4. Per scenario: **Edit** (opens the editor), **Rename**, **Delete** (the shared confirm pattern; deleting is undoable).
  5. **"New scenario"**, disabled with a reason at 4.
- **The editor** (mockup: `.superpowers/brainstorm/…/scenarios.html`, not committed): name field; a table of change rows
  (kind · amount · dates · milestone picker for scope · remove ✕); "+ Capacity change", "+ Scope change"; Save / Cancel.
  It is a dialog using the shared modal and its Escape/Tab protocol (`docs/AGENTS/ui-shell.md`, dismissal).
- Below the history floor the Scenarios mode shows the floor message once, not one per column; scenarios stay editable.
- The view-local toolbar (window, unit) applies to every column, as it applies to Quick today.

### 4.3 Persistence

- New persisted `Workspace` field **`forecastScenarios`**, a **meta-blob** slice like `forecastHistory`, on **all six
  write paths** (JSON, CSV, Markdown, Turso single, Turso tenant, IndexedDB) and both load funnels. Sanitised on read:
  bad rows dropped, values clamped by the §4.1 rules, unknown keys dropped. It belongs to the project (a Turso team
  shares it). Storage formats stay byte-stable for workspaces without scenarios (absent field = no section).
- Every create, edit, rename and delete is **one activity-log entry** (actor: user or assistant). **Edits, renames and
  deletes are one undo entry each; creates are not undoable** — the undo engine cannot reverse a create and capturing
  one duplicates the row (`docs/AGENTS/undo.md`, "Creates"); this matches every existing `create_*` tool. A created
  scenario is removed with Delete, which is itself undoable. It is not part of `isWorkspaceEmpty`.
- No new `TABLE_NAMES` entry (meta-blob).

### 4.4 The AI tool (owner: the assistant may save)

**`get_forecast`** — read tool, offered under the **same gate as every other simulated surface**: the Forecast view is
enabled AND the project's switch is on (`forecast-simulation.ts` combines both). So while `"forecast"` is in
`RELEASE_HIDDEN_VIEWS` the tool is not offered on a release build; build steps 2–4 are verified by unit tests and a
dev build, and step 5 makes them visible together. When the gate is closed the tool is not offered and the assistant
says forecasting is off. **Every figure it returns uses the app-wide defaults** (60-day window, tasks unit), the
saved scenarios included, and the result states those settings; the panel's view-local toolbar never reaches the chat
layer (designer's call: the Dashboard and history already use the defaults, and the view already says when its own
toolbar differs). Returns, all marked simulated:
- the default run: P50/P80/P95 finish, chance on time by plan end,
  weekly change from `forecastHistory`, history-floor state with the reason when below it;
- every milestone's chance;
- every saved scenario's results, milestones included;
- optional input `whatIf`: a list of changes in the §4.1 shape, computed once and never saved;
- cost at finish and chance over budget once part 3 is merged.

The system prompt tells the model to say the figures are simulated, to call P80 "safe to commit" and never a promise,
and to quote the floor reason instead of guessing when there is no forecast.

**`create_forecast_scenario`** (name, changes) and **`update_forecast_scenario`** (id, expectedToken, name?, changes?) —
entity write tools. They follow the existing chat rules exactly: the staging gate (`shouldStage`: one write applies at
once; two or more writes in a turn stage for review; an applied update is undoable, an applied create is not — §4.3), the write-concurrency token on the update
(`TOKEN_REQUIRED_TOOLS`), a mint kind for the create, row validation against the §4.1 rules with a refusal message the
model can act on (bad date, capacity out of range, unknown or finished milestone, 4-scenario cap, duplicate name). No
delete tool (designer's call: removing a person's scenario is a person's action).

**Ask-Claude chips** in the Forecast view (`ask-claude-menu` pattern): "Explain this forecast", "What would get
[worst-chance milestone] on time?", "Compare my scenarios" (Scenarios mode, at least one scenario), "Suggest a scenario
that makes plan end" (Scenarios mode).

### 4.5 Engine shape (the intent; the builder chooses names)

- Dated capacity becomes a **per-working-day multiplier schedule** built once per scenario from today to the horizon;
  the day drawer scales each drawn day by that day's multiplier. A flat What-if is the one-entry case.
- **One seed for every column.** Today `computeScheduleForecast` puts the three What-if numbers into `seedParts`, so a
  What-if and a scenario with the same effect would draw different numbers. The seed must **leave the changes out**
  (open task ids, history samples, window, unit, stream name only) everywhere: Quick, What-if, every scenario column and
  `get_forecast`. Then "Save as scenario" shows the same numbers it showed in What-if, and a `get_forecast` `whatIf`
  matches a saved scenario with the same changes. This changes Quick and What-if output; the pinned digests are
  **regenerated deliberately** in that PR (the view is still held back, so no released number moves), and the
  determinism tests are kept.
- The early exits (`cannotReach`) must stay exact under a varying multiplier (use the remaining days' maximum).
- Dated scope becomes an **arrivals schedule** (working-day index → amount, with optional milestone), consumed by When,
  How many and milestone chances.

## 5. Constraints

1. Engine rules carry over: seeded, deterministic, 10,000 trials, 1,300-working-day horizon, history floor, nearest-rank
   percentiles, engine i18n-free.
2. Repo hard constraints (AGENTS.md): EN/DE parity with real umlauts; six write paths; palette tokens; accessible names
   and keyboard operation, row-unique names in the change rows and per-scenario actions; no `set-state-in-effect`;
   `task-manager.tsx` gains no lines.
3. Performance: Scenarios mode runs at most 5 forecasts (As is + 4) per input change, only while the mode is shown;
   nothing runs for scenarios on the Dashboard. The builder measures the 5-column cost at the What-if extremes and
   states it in `forecast.md`, as slice 1 did.
4. **Common random numbers.** Every column of one comparison, and `get_forecast`'s scenario results, use the same seed
   and stream split, so two columns differ only by their changes. A scenario identical to As is shows identical numbers.
5. Money (part 3) in the baseline currency (§476).
6. New register numbers are agreed with the peer session first; §743–§746 are reserved by the peer.

## 6. Build order (designer's call, approved)

One PR each, each green on all required checks before the next starts:
1. **Part 3** — budget simulation (surfaces spec §3.6–3.7).
2. **Saved scenarios** — this spec §4.1–4.3, §4.5; cost rows included because part 3 is in.
3. **AI tool** — §4.4.
4. **Part 4** — Gantt, Reports section, Trends line, exports (surfaces spec §3.7).
5. **Un-hide** — remove `"forecast"` from `RELEASE_HIDDEN_VIEWS`, after the owner's eye check of the range bar, the ▲/▼
   glyph and placeholder sizes (open from part 2); close §502 and GitHub #41.

## 7. Left to the builder

- Type and field names, the sanitiser shape, the CSV/Markdown section layout of `forecastScenarios`.
- Exact copy beyond the strings quoted here; German wording.
- How the shared date axis of the range bars is scaled and labelled (one scale for marks, ticks and labels).
- The editor's validation messages and where they show.
- How the chips name the worst milestone when there is none (hide the chip).

## 8. Open after this design

- Scenarios in exports, repeating changes and per-person capacity remain ideas, not register entries, unless the owner
  asks for them.
