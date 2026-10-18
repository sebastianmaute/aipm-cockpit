# Forecast part 4 — from forecast to decision (§502)

Status: design, approved by the owner after an eye check of the mockup on 2026-10-18.
Mockup: [`2026-10-18-forecast-part-4-mockup.html`](2026-10-18-forecast-part-4-mockup.html) (open in a browser; two tabs, Reports and Forecast view; a checkbox labels each element with the app primitive it maps to). Theme in the mockup: Beacon. Sample numbers are invented.

Builds on [`2026-10-15-forecast-simulation-surfaces-design.md`](2026-10-15-forecast-simulation-surfaces-design.md) §3.7 (its part-4 rows: Gantt, Reports view, Trends, Exports) and [`2026-10-16-forecast-scenarios-and-ai-tool-design.md`](2026-10-16-forecast-scenarios-and-ai-tool-design.md) (saved scenarios, the AI tools). Where this document and §3.7 differ, this document wins.

## 1. Intent

The app is for project managers who protect a target — a fixed delivery date, a milestone, a budget — by adjusting time, scope and capacity. The forecast tells them, at a stated confidence, whether the target holds at the current pace and capacity. When it does not, they act: cut or reprioritise scope, add capacity, change availability.

Part 4 turns the forecast into a decision. It has two readers:

- **Primary: the PM preparing to justify action.** On the Gantt they diagnose; in Reports they make the case.
- **Secondary: whoever the PM reports to** (sponsor, PMO lead, delivery lead). They want to know whether the commitment is credible and what decision is proposed. They often see only an export.

The Reports Forecast section must answer three things fast: **which milestone needs attention, how serious it is, and which lever to discuss next.** Its next step is a planning or governance conversation where the PM decides to stay the course, escalate, or change scope, capacity or priority.

## 2. Goals, non-goals, anti-goals

**Goals**
- A target confidence the PM chooses (50 / 80 / 95 %) that every part-4 judgement is measured against.
- For each milestone below target, an app-computed "what it would take" using only levers the app can model.
- A prepared proposal: one saved scenario the PM marks, shown As is vs. Proposal.
- An "Ask Claude to draft a proposal" path for combinations and named tasks, landing as a scenario.
- The Gantt band, the Trends line and the export block from §3.7, the export block extended with the decision part.
- Claude can read and do everything the PM can in this part.
- Help, feature guide, activity log, undo and version compare cover the new state.

**Non-goals**
- Combinations of levers in the app's own proposal (Claude does combinations).
- Effort reduction ("reduce complexity", "reduce quality") as a modelled lever — not modelled, so not offered.
- Choosing which tasks to cut (the app gives an amount; the PM or Claude names tasks).
- Un-hiding the Forecast view (the next build step, after the owner's eye check).
- Changing the Dashboard surfaces built in parts 1–3.

**Anti-goals**
- The report implying a lever the scenarios cannot express. Every app-proposed people or tasks lever must open as an exact scenario; prioritising is the existing "Chance if prioritised" column and opens no draft.
- Claude writing into the report. Claude's output is always a scenario the PM then picks.
- A proposal the PM did not choose appearing as "the proposal".
- Slowing the Reports or Forecast view render with lever searches.

## 3. Decisions

### 3.1 Target confidence

- Three values, the existing labels: **Even odds 50 %**, **Safe to commit 80 %** (default), **Cautious 95 %**. One `SegmentedControl` in the Reports Forecast section and in the Forecast view header; both set the same value.
- Stored per project in `SettingsOverrides.forecast` beside `showSimulation`. Absent means 80. ★ `sanitizeSettingsOverrides` (`settings-overrides.ts`) today keeps `forecast` only when `showSimulation === true` ("Off is absence"), so the sanitizer and `hasAnyOverride` must be extended: the target confidence and the proposal id **survive the switch being off** and come back when it is turned on. Once sanitized, the field rides the six write paths and version restore with the rest of `settingsOverrides`.
- It drives: the Reports verdict, the RAG dot of each milestone row on the part-4 surfaces, the "what it would take" target, the Ask-Claude request text, and the export block heading.
- Logged (§3.10), not undoable (owner decision: like the switch, reverting is one click), settable by Claude (§3.9).

### 3.2 Reports → Forecast section

Order (mockup, Reports tab):

1. **Header row:** section title with `SimBadge`; target-confidence control.
2. **Verdict `Banner`:** "Below target. Plan end 27 Feb has a 41 % chance (target 80 %). 2 of 5 milestones are below target." Severity: `error` under 50 %, `warn` from 50 % to below target, `success` at or above target ("On target …"). Under it the basis line (runs, window, finished tasks) as the Forecast view shows it.
3. **Four `Tile`s with `SimValue`:** Even odds (P50), Safe to commit (P80) with working days vs plan end, On time, Cost at finish (P80) with chance over budget (cost tile only when the budget module and the cost simulation give a figure).
   Under the tiles, the small **P80 finish over time** line (§3.7).
4. **Milestones table, worst first** (`TABLE_HEAD_CLASS`): Milestone (with `RagDot`), Due, Chance, If prioritised, What it would take to reach {target} (§3.3). Each below-target row also carries "Explore in Forecast →" (§3.4) and "Ask Claude to draft a proposal" (§3.6). On-target rows say "On target". Milestones without linked open tasks say so, without a chance.
5. **Proposed intervention:** a `Select` listing the saved scenarios (and "None"); with a choice, a table As is vs. Proposal on Safe to commit, On time, each below-target milestone, and Cost at finish. With none: "No proposal chosen. Save one in Forecast → Scenarios and pick it here." plus the Ask-Claude button.
6. **Forecast by group** fold-out, native `<details>`, closed and computed only when opened — unchanged from §3.7.

### 3.3 What it would take (the app's proposal)

- For each milestone below target, and for the plan end (one line under the verdict), the app finds the **smallest single lever** that brings the chance to the target:
  - **Add people:** one `addPeople` change with a placeholder `who`: `hoursPerWeek` = the team's average booked hours per person, `rate` = the team's average rate in the plan currency (so Cost at finish is meaningful), from today, count N = 1 … min(team size, `ADDED_COUNT_MAX`). Team size is the set the scenario engine treats as on the team. Shown as "+N people (team average)". When the row would be inert (no booked hours: `needs-booked-hours`), the lever shows "needs booked hours" instead of a number.
  - **Fewer tasks:** a scope change of −N tasks on that milestone (for the plan end: on the project), N = 1 … half the milestone's open linked tasks (rounded down). Shown as "N fewer tasks", with the hours equivalent where effort is known.
  - **Prioritise:** the existing "Chance if prioritised" value; shown as "prioritise it → X %" when it reaches the target, else "prioritising alone: not enough".
- Each lever is evaluated as exactly the scenario Explore would open (§3.4), through the scenario engine with the same seed (common random numbers), so the number shown and the number in the opened draft agree. The What-if mode is not used: its scope change does not move milestone chances.
- A lever with no N within bounds is shown as "not within reach"; if no lever reaches the target: "No single lever reaches {target} — consider combining them in Scenarios, or ask Claude."
- **Never on the render path.** Computed on demand when the section or the Forecast view milestones table is shown, cached on the forecast inputs, with a per-row "Working it out…" placeholder. The search may stop early on monotone bounds. Measure the cost and record it in `docs/AGENTS/forecast.md` with a reproduce command, as parts 1–3 did.

### 3.4 Explore → a draft scenario

- Shown only on rows where the people or the tasks lever has a number. "Explore in Forecast →" (Reports) and "Explore →" (Forecast view) open the Forecast view in **Scenarios** mode with the scenario editor open on an **unsaved draft**: name "{milestone} — what it would take (+N people)" (or "(N fewer tasks)"), one change row for the chosen lever (the cheapest of the two by the app's order: people first, then tasks), and a link to switch to the other lever.
- The comparison shows As is vs. Draft and recomputes as the PM edits. Save adds it to the list; Cancel discards it.
- At the four-scenario cap, Explore still opens the draft, with Save disabled and the existing cap message beside it.

### 3.5 The proposal

- One scenario id per project, stored in `SettingsOverrides.forecast` (`proposalScenarioId` or similar). Set from the Reports `Select` or from a **"Use as proposal" `ToggleButton` chip** on each row of the existing scenario list; pressing another moves it; pressing the pressed one clears it.
- The list keeps its existing Edit, Rename and destructive Delete (confirm, undoable). Deleting the proposal scenario leaves the stored id in place; an id that names no scenario reads as "no proposal", so undoing the delete brings the proposal back with the scenario — no cross-slice undo entry is needed.
- The Compared table marks the proposal column with a "proposal" `Badge`.

### 3.6 Ask Claude to draft a proposal

- A `Button` secondary xs with the app's `SparklesIcon` (lucide `sparkles`, 16 px), label "Ask Claude to draft a proposal" (row-unique accessible name naming the milestone; never the same name as the top-bar "Ask Claude" or the Forecast view's "Ask Claude about this forecast").
- Shown only when the AI is available and the simulation is on, on below-target rows and in the empty proposal area.
- Opens the chat and sends a prepared request: bring {milestone} ({date}, {chance}) to the {target} target, combine levers if one is not enough, name the tasks to drop, save it as a scenario. Claude uses `get_forecast` and `create_forecast_scenario` under the usual approve step. A scope change stores a task count, not task ids, so the tasks Claude names go into the scenario name and the chat; the scenario schema does not change. The saved scenario then appears in the Proposal select; Claude does not set it as the proposal unless asked.

### 3.7 Gantt and Trends (as §3.7 of the surfaces design)

- **Gantt:** faint P50–P95 finish band behind the bars, bold dashed P80 line beside the plan end, and a chance chip (`SimValue` look) on each unfinished milestone — **new work on the Gantt**: no Gantt file shows a chance today; reuse the milestone chance the Dashboard chip reads. The band stays faint enough that bars read clearly. Simulation on only.
- **P80 finish over time** (owner decision: Trends + Reports): drawn from `forecastHistory`, which exists on every backend, on its own date axis (its dates are not the snapshot dates), with the plan end as a reference line.
  - In **Trends** (Turso-only view) as its own chart, not a series on the snapshot axis.
  - In the **Reports Forecast section** as a small line under the tiles, so file-mode users and sponsors see whether past actions moved the date.

### 3.8 Exports and documents

- While the simulation is on, a block labelled "simulated" with: target confidence; Safe to commit (P80) vs plan end and chance on time; cost at finish (P80) and chance over budget; each milestone below target with its chance and what it would take; the proposal (name, P80, on time, cost at finish) when one is set. Off: nothing.
- Carried in the export sections (beside the §545 budget forecast section, same derived `ExportExtras` pattern, never in the CSV/Markdown/JSON storage formats) and as a document data block for DOCX/PPTX/HTML.

### 3.9 Claude — complete interaction

- **Read:** `get_forecast` adds the target confidence, the plan-end and per-milestone "what it would take", the proposal (id, name, As is vs. Proposal figures) and the recorded P80 history series.
- **Write:** three new tools, gated on the simulation switch like the existing two and staged/approved the same way: delete a scenario; set or clear the proposal; set the target confidence. Names follow the existing `*_forecast_scenario` pattern (builder's choice). Delete carries the same write-concurrency token as `update_forecast_scenario`.
- The forecast prompt block and the operating guide describe the new reads and tools.

### 3.10 Activity log, undo, version compare

- **Activity log:** new kinds for proposal set, proposal cleared, and target confidence changed (scenario create/update/delete are already logged). Claude's writes carry the AI actor as other AI writes do. ★ No `settingsOverrides` change is logged today, so this is a new write path into the log, not an extension.
- **Undo:** proposal and target-confidence changes are **not** undoable (owner decision, log only). Scenario create/update/delete stay undoable; undoing the delete of the proposal scenario restores the proposal through the stale-id rule (§3.5).
- **Version compare:** add a `forecastScenarios` row to `version-diff.ts` so compare and selective restore show scenario changes (a gap left by the scenarios step; owner chose to fix it here). Proposal and target ride the existing "Project overrides" row.

### 3.11 Help and feature guide

- Written in this step (owner decision): update `helpConceptForecastSimBody` and the Forecast part of the Reports help for target confidence, what it would take, the proposal, Ask Claude to draft, the Gantt band, the Trends line and exports (EN and DE); add the matching lines to `lib/app-feature-guide.md` and regenerate the operating guide.
- Released with the view: any sentence that names the Forecast view or the Reports Forecast section stays out of user-facing text until the un-hide step, exactly as the hiding commit did for parts 1–3 (see `docs/AGENTS/forecast.md` "HELD BACK").

## 4. Constraints

- Everything here is behind the simulation switch and held back with the Forecast view (`RELEASE_HIDDEN_VIEWS`); un-hiding is not part of this step. ★ `isSimulationActive` already answers false while the view is hidden, which hides the Reports section, the Gantt band and the AI tools together — so none of part 4 can be tried in the running app before un-hide; unit tests carry it until then.
- Existing primitives only (mockup "Show primitive names"): `Card`, `Section`, `Tile`, `SimValue`/`SimBadge`, `SegmentedControl`, `Banner`, `TABLE_HEAD_CLASS`, `RagDot`, `Badge`, `Button` (primary/secondary/ghost/destructive), `ToggleButton` chip, `Select`/`Input`, `Modal`/`ModalHeader`, native `<details>`, `SparklesIcon` from `icons.ts`. No primitive was found missing.
- Theme tokens only; the mockup uses Beacon values, the build uses tokens so every scheme works.
- i18n EN + DE; row-unique accessible names for per-row buttons; unit tests for names (axe is silent on duplicates).
- `task-manager.tsx` gains no lines.
- One simulation run shared per view as today; lever searches reuse its inputs.

## 5. Calls made (designer's calls, not owner decisions)

Owner decisions in this design: the readers and their job (§1); both prepared and app-proposed interventions; target confidence 50/80/95 with 80 default; the export carries the decision part; the Ask-Claude button; scenarios stay deletable; Claude can do everything the PM can; help and guide written now, released at un-hide; the version-compare gap fixed here; target and proposal logged, not undoable; the P80 line in Trends and Reports.

Designer's calls:

- Storage of target confidence and proposal in `SettingsOverrides.forecast`, kept while the switch is off.
- Placeholder for "+N people": team-average booked hours and team-average rate; N capped at min(team size, `ADDED_COUNT_MAX`); inert shows "needs booked hours".
- No Explore draft for prioritise-only rows.
- Proposal delete uses the stale-id rule instead of a cross-slice undo entry.
- Tasks Claude names go into the scenario name and chat; no task ids in scenarios.
- Search bounds: people up to the team size; tasks up to half the milestone's open linked tasks.
- Plan end gets its own "what it would take" line under the verdict.
- Verdict severity thresholds (error < 50 %, warn < target, success ≥ target).
- Explore opens the people lever first; the cap leaves Save disabled.
- The Ask-Claude buttons are plain secondary buttons, matching the existing Forecast-view Ask Claude.
- RAG dots on part-4 surfaces follow the chosen target; Dashboard chips from part 2 are unchanged.

## 6. Left to the builder

- Tool, field and activity-kind names; the exact cache key; whether the search runs in idle time or a worker if measurement says so.
- Wording of the Ask-Claude request and of help/guide sentences within §3.11.
- How the document data block renders per format.

## 7. Open after this design

- Un-hide (owner's eye check of range bar, ▲/▼ glyph, placeholder sizes, toolbar fit of the Ask-Claude label), then close §502 and GitHub #41.
