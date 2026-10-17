# Forecast — saved scenarios and the AI forecast tool (§502)

Status: design, approved in chat by the owner 2026-10-16; **amended 2026-10-17** with two kinds of capacity
(§4.1a, owner); **amended again 2026-10-17** after review of that amendment (rate and external rulings by the owner,
mechanisms corrected to what the code has). Builds on
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
- Repeating changes ("every December"), availability changes per existing person, changes to the history window or unit per scenario.
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
| **Availability** (capacity of the current team) | `percent` (10–300), `from` (ISO date), `until` (ISO date or empty = to the end) | Every simulated working day in `[from, until]` delivers `percent / 100` of a drawn history day, and books `percent / 100` of a drawn spend day (§4.1a). |
| **Add people** (capacity from people joining) | `who`: a resource from the directory (`resourceId`, `hoursPerWeek` 1–60) **or** a placeholder (`label`, `count` 1–20, `rate` + `currency`, `hoursPerWeek` 1–60); `from` (ISO date); `until` (ISO date or empty = to the end); `rampWeeks` (0–26, default 4) | From `from`, the people add delivery at the current team's throughput per booked hour, reaching full speed after `rampWeeks`, and add their own cost from day one (§4.1a). |
| **Scope** | `tasks` (non-zero integer, ±), `on` (ISO date), `milestoneId` (optional) | On `on`, `tasks` tasks are added (+) or removed (−). Size of one task = the existing What-if rule (one task in the tasks unit; the median estimate in effort mode). |

Rules (designer's calls, apply everywhere — UI, engine, AI writes):
- Changes apply on **working days of the project calendar** (weekends and holidays as the engine counts them today).
- A date before today counts **from today** (it is not an error; an old scenario stays usable). `until` before today
  makes an availability or Add-people change inert; the editor shows it greyed with "ended". (Add people keeps its
  ramp counted from the stored `from`, §4.1a.)
- **Overlapping availability changes multiply** (130 % and 40 % on the same day = 52 %), then clamp to 10–300 %.
  Add-people shares are added after the clamp (§4.1a).
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

### 4.1a Two kinds of capacity (owner, 2026-10-17)

A project manager raises capacity in two ways, and both are valid adjustments with different cost effects:

1. **Availability** — the people already on the project work more of their time: higher utilisation, a cancelled
   vacation, a postponed training. The work gets done sooner and the same people book the extra hours, so **cost at
   finish barely moves** (more spend per day, fewer days). Part 3's What-if capacity already models this (`spendScale`)
   and stays as built; the What-if slider is labelled as availability.
2. **Add people** — internals or externals join the project. The work gets done sooner **and their cost comes on top
   at their own rate**, from their first day, including the weeks they are still getting up to speed. This moves cost
   directly: an expensive contractor raises cost at finish, onboarding always does. (A directory person flagged
   external adds no cost; see "Externals" below.)

How "Add people" is computed (owner: directory or placeholder; team-average throughput with ramp-up):
- **Rate (owner, 2026-10-17).** An added directory person costs their role's **internal rate**: `Resource.roleId` →
  `Role.internalRate`, the same cost source as the budget's actual cost and burn. `rateBasis` is honoured the way the
  budget code honours it: the hourly `internalRate` is what the cost math reads, and for a day-basis role it is the
  value derived from `internalRateDay` (`materializeRoleRates`). Role rates are already in the baseline currency
  (§476), so no conversion happens, and they are not dated: one rate applies to every simulated day. A placeholder
  carries its **own typed rate** per hour, with the currency it was typed in, converted at read time with
  `currencyToBase(rate, { currency }, fxRates, plan.currency)`, so a later baseline switch needs no rewrite
  (designer's call). `resolveRate` is an FX cross rate, not a person's rate; it plays no part here beyond what
  `currencyToBase` does inside.
- **Externals (owner, 2026-10-17).** A directory person with `isExternal` **follows the flag**: they add delivery and
  **no cost**, matching every other cost figure in the app (`Resource.isExternal` = "excluded from all cost figures";
  `budget-report.ts` skips them). The editor says so on the row ("no cost — external in the directory"). Paid
  contractors who should cost money are entered as placeholders.
- **Who and hours.** A directory row carries `hoursPerWeek` (1–60), so a person can join part-time ("from January,
  20 h on our project"). It is prefilled from the person's `Shift` (`Shift.hoursPerWeekday`, joined by `resourceId`
  or assignee as `buildResourceWorkload` does), or from `DEFAULT_WEEK_HOURS` when they have none, and is spread over
  the Shift's working weekdays in proportion to the Shift's hours. Weekend Shift hours are ignored, because the engine
  has no weekend working days. A placeholder spreads `count × hoursPerWeek` evenly over Monday to Friday. That gives
  `addedHours(day)`. A directory resource that no longer exists makes the row inert; the editor marks it "person gone"
  (designer's call).
- **Absences.** A directory person's absences (`Absence`, matched by `absencesForResource`) remove that day's hours
  from both delivery and cost. Placeholders have no absences (designer's call).
- **Already on the team** (designer's call). Booked hours are recorded per allocation row, not per person, so a
  person whose hours are already in the team's history cannot be subtracted, and adding them would count their
  throughput (and, with a past `from`, their cost) twice. The person picker and the AI write tools refuse a resource
  that is in any budget allocation's `resourceIds`, or that is the assignee of a task completed inside the history
  window: "already on the team — use an availability change". A saved row that later meets this condition goes inert
  and the editor marks it "already on the team".
- **Team hours** (designer's call). `teamHoursPerDay` is the booked hours (part 3's facts, hours unit) on the run's
  window days (`windowDates`) divided by the number of those days, zero days included: the same day set and the same
  denominator as the throughput samples it is divided against. Added people are sized only when the hours samples
  pass the cost pass's spend floor (`MIN_SPEND_WORKING_DAYS`, not all zero) **and** `teamHoursPerDay` is at least
  1 h. Otherwise the rows are inert in the schedule with the reason "needs booked hours to size added people";
  availability rows still work.
- **Delivery.** On each working day in `[max(from, today), until]` the row adds
  `addedHours(day) × ramp(day) / teamHoursPerDay` to that day's capacity multiplier.
  `ramp = min(1, (working days since from) / (5 × rampWeeks))` in working days of the project calendar (0 weeks = full
  speed at once), counted from the **stored** `from`, so ramp progress already made before today is kept.
- **Clamp** (designer's call). The product of the availability rows is clamped to 10–300 %; that clamped product is
  both the team's delivery factor and the spend scale. The added shares are added **after** the clamp and are not
  clamped, so delivery and cost always describe the same people ("team at 80 % + one added person" is
  `0.8 × 1 + share`). The 1,300-day horizon and `cannotReach` with the remaining days' maximum keep the engine
  bounded. When the added share exceeds 100 % of the current team, the editor and the column say "added people more
  than double the team; the team-average assumption is weak here".
- **Cost.** Each simulated working day in `[max(from, today), until]` up to the trial's finish books `addedHours(day)`
  × the rate, **on top of** the drawn spend day. Ramp-up does not reduce cost. Days on which a trial waits for
  arriving scope still book the drawn spend day and the added cost (people are paid while idle). Added cost is
  computed in the **money unit only**; no scenario surface shows the hours unit (if one ever needs it, it adds
  `addedHours(day)`).
- **No silent zero** (designer's call). A directory person with no role, or a role whose internal rate is 0, still
  delivers, but the cost row says "no rate for <name> — cost counted as 0", and the AI write tool returns the same as a
  warning. A placeholder whose currency has no resolved rate (`resolveRateSource` = "unresolved") is converted at par
  (§474), and the cost row says so.
- **Where reasons show.** When an Add-people row is inert, the reason shows on the row in the editor and once on the
  scenario column, not in the cost rows (with the budget module off there are no facts, so no team hours and no cost
  rows). A sized row shows its conversion: "team books ≈ 31 h per day → +40 h/week ≈ +26 % at full speed".
  `get_forecast` returns the same basis and inert reason so the model can quote them.
- Applies to the Forecast view's Scenarios mode, `get_forecast`'s `whatIf` and the two write tools. Quick and What-if
  stay as they are apart from that label (What-if's single slider is availability).

### 4.2 Where it lives in the Forecast view

- The mode `SegmentedControl` gains its third segment: **Quick / What-if / Scenarios** (named in the slice-1 spec).
- **What-if stays flat** and unsaved, for quick play. It gains **"Save as scenario"**: name prompt, then the current
  What-if becomes change rows starting today (an availability change from today with no end; one unattributed scope change
  today). What-if's **scope percent is converted to whole tasks at save time** (round half-up, the existing What-if
  rule) and the save dialog says so ("+10 % = 6 tasks today"). This is the one value frozen at save, and it is shown
  frozen: from then on it is an editable task count like any other scope row (designer's call; scenarios have no
  percent kind, because a percent of a moving backlog changes meaning as tasks close).
- **Scenarios mode** shows:
  1. **Range bars**: one row per column ("As is" first, then scenarios in saved order), each the existing
     `ForecastRangeBar` shape (P50–P95 band, P80 tick) on one shared date axis, with the plan-end line.
  2. **The table**: columns As is + scenarios; rows Even odds (P50) · Safe to commit (P80) · Worst likely (P95) ·
     On time by plan end · Cost at finish (P80) · Chance over budget.
  3. **Milestones**: one row per unfinished milestone with a date, chance on time per column, sorted by the As-is chance,
     worst first; states that are not a chance ("overdue", "no linked tasks") read as today.
  4. Per scenario: **Edit** (opens the editor), **Rename**, **Delete** (the shared confirm pattern; deleting is undoable).
  5. **"New scenario"**, disabled with a reason at 4.
- **The editor** (mockup: `.superpowers/brainstorm/…/scenarios.html`, not committed): name field; a table of change rows
  (kind · amount · dates · milestone picker for scope · person picker or placeholder fields and ramp-up for added
  people · remove ✕); "+ Availability change", "+ Add people", "+ Scope change"; Save / Cancel.
  It is a dialog using the shared modal and its Escape/Tab protocol (`docs/AGENTS/ui-shell.md`, dismissal).
- Below the history floor the Scenarios mode shows the floor message once, not one per column; scenarios stay editable.
- The view-local toolbar (window, unit) applies to every column, as it applies to Quick today.

### 4.3 Persistence

- New persisted `Workspace` field **`forecastScenarios`**, a **meta-blob** slice like `forecastHistory`, on **all six
  write paths** (JSON, CSV, Markdown, Turso single, Turso tenant, IndexedDB) and both load funnels. Sanitised on read:
  bad rows dropped, values clamped by the §4.1 rules, unknown keys dropped. For an Add-people row (designer's call):
  `who` is exactly one of `{ resourceId: integer, hoursPerWeek: 1–60 }` or `{ label: 1–60 chars, count: integer 1–20,
  rate: finite, 0–100000, currency ∈ SUPPORTED_CURRENCIES, hoursPerWeek: 1–60 }`; `rampWeeks` is an integer 0–26
  (absent = 4). A row that fits neither shape is dropped. An unknown resource id is kept and shown "person gone",
  because a resource can come back on undo. It belongs to the project (a Turso team
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
- cost at finish and chance over budget;
- for every Add-people row, its sizing basis or inert reason (§4.1a).

The system prompt tells the model to say the figures are simulated, to call P80 "safe to commit" and never a promise,
and to quote the floor reason instead of guessing when there is no forecast.

**`create_forecast_scenario`** (name, changes) and **`update_forecast_scenario`** (id, expectedToken, name?, changes?) —
entity write tools. They follow the existing chat rules exactly: the staging gate (`shouldStage`: one write applies at
once; two or more writes in a turn stage for review; an applied update is undoable, an applied create is not — §4.3), the write-concurrency token on the update
(`TOKEN_REQUIRED_TOOLS`), a mint kind for the create, row validation against the §4.1 rules with a refusal message the
model can act on (bad date, availability percent out of range, unknown or finished milestone, unknown or archived
resource, "already on the team" (§4.1a), `count`, `hoursPerWeek`, `rampWeeks` or placeholder rate out of range,
unsupported currency, 4-scenario cap, duplicate name). No
delete tool (designer's call: removing a person's scenario is a person's action).

**Ask-Claude chips** in the Forecast view (`ask-claude-menu` pattern): "Explain this forecast", "What would get
[worst-chance milestone] on time?", "Compare my scenarios" (Scenarios mode, at least one scenario), "Suggest a scenario
that makes plan end" (Scenarios mode).

### 4.5 Engine shape (the intent; the builder chooses names)

- Dated capacity becomes a **per-working-day multiplier schedule** built once per scenario from today to the horizon;
  the day drawer scales each drawn day by that day's multiplier. A flat What-if is the one-entry case. Availability
  rows multiply into it, "Add people" rows add their ramped share (§4.1a).
- The cost pass takes two per-day schedules: the **spend scale** (availability only: the clamped availability
  product, §4.1a) applied to each drawn spend day, and the **added cost** (Add people, in the money unit) added on top.
  A trial books both until its own finish day.
- The cost pass **must** draw each trial's spend from its own **sub-stream** (seed + trial index), in What-if, every
  scenario column and `get_forecast`. Today `simulateCostAtFinish` draws every trial from one stream, so a trial that
  finishes on a different day shifts every later trial's draws and breaks common random numbers between cost columns
  (§3 anti-goal, §5.4). This changes part 3's pinned cost values; they are regenerated deliberately in the scenarios
  PR, which is safe because the view is still hidden.
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

- Type and field names, the sanitiser shape, the CSV/Markdown section layout of `forecastScenarios`. Names this spec
  proposes are working names and do not exist in the code yet: `forecastScenarios`, `hoursPerWeek`, `rampWeeks`,
  `teamHoursPerDay`, `addedHours`, `create_forecast_scenario`, `update_forecast_scenario`.
- Exact copy beyond the strings quoted here; German wording.
- How the shared date axis of the range bars is scaled and labelled (one scale for marks, ticks and labels).
- The editor's validation messages and where they show.
- How the chips name the worst milestone when there is none (hide the chip).

## 8. Open after this design

- Scenarios in exports, repeating changes, and availability changes per existing person remain ideas, not register
  entries, unless the owner asks for them. (Adding named people is in, §4.1a.)
