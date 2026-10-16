# Forecast simulation across the app, part 2: the Dashboard picture (§502)

**Status:** approved by the owner 2026-10-16; built on `feat/502-sim-part-2`.
**Register:** §502 (work item #41). This is part 2 of
`docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md` (the "surfaces design"), which stays the
authority. This file **narrows** it to one PR and records the part-2 calls. It does not repeat the surfaces design's
rules (§3.2 marking, §3.3 explaining, §4 constraints). Read them there.
**Builds on:** part 1 (PR #752, merge eba1f9fc8). That PR shipped the switch, `SimValue`, `SimExplainer`, the intro, the
Help entry `concept-forecast-simulation`, `Workspace.forecastHistory` with its recorder, the two simulated KPI cells, the
divergence line and the estimate-coverage cue. All of it is held back while `"forecast"` sits in
`RELEASE_HIDDEN_VIEWS` (`docs/AGENTS/forecast.md`, "HELD BACK").

---

## 1. Intent

Part 1 put two simulated numbers on the KPI strip. Part 2 answers the Dashboard question from surfaces design §2 that
the strip cannot answer: **when do we finish, how has that moved since last week, and which milestones are at risk?**
It does that with one new tile, a chance on each milestone, and a Next-actions nudge when a milestone looks unlikely.

Part 2 also closes the defects that part 1's review deferred, before more surfaces build on that recorder and
explainer.

The owner's two rules still hold: simulated numbers never pass for measured ones, and with the switch off, nothing on
screen changes.

## 2. Scope

**In (part 2):**
1. A new Dashboard tile, **Forecast**.
2. **A chance-on-time chip on each milestone** in the Milestones tile.
3. **A Next-actions signal:** a milestone with less than 50 % chance of being on time.
4. **The fixes deferred from part 1** (§4 below).

**Out:** stays in parts 3–4 of the surfaces design's suggested order:
- part 3: budget simulation, the pace card, chart bands, the burn tile, the Forecast-view cost question
- part 4: Gantt, the Reports section, the Trends line, exports

Saved scenarios and the `get_forecast` AI tool stay outside the surfaces design entirely.

**Already done in part 1** (surfaces design §3.7, KPI row): the P80 and chance cells, the divergence line and the
coverage cue. Part 2 does not touch them.

**Switch placement (owner decisions, 2026-10-15, after the part-1 eye check; built before part 2).** The switch is
"Use Monte Carlo forecasting". It sits in the Budget burn tile directly left of "Open in Budget", and in Edit project as
a "Forecasting" field beside Project manager (applied on Save). It is no longer in the Dashboard toolbar. Edit project's
submit reads "Save". New project offers Import workspace file beside Skip. The demo and sample data were extended so the
demo can simulate.

**Held back like part 1.** Every new surface reads the switch through `isSimulationActive(overrides, features)`. So
while `"forecast"` is in `RELEASE_HIDDEN_VIEWS` none of it renders, and each one gets a held-back test of the same shape
as part 1's.

## 3. Surfaces

### 3.1 Forecast tile

- **Id `forecast`**, appended to `DASHBOARD_TILES` (so it lands **after** existing tiles on a stored layout; `reconcile`
  never reorders) at **w 2 × h 3**, min 1×2, max 4×4.
- **Gate:** a new `TileGateInput.simulationActive`. With the switch off the tile does not exist: no placeholder and no
  entry in the hidden-tiles menu. A gate decides what renders, never what is stored (`dashboard.md`). So a user's
  placement of the tile survives the switch going off and on again.
- **Content, top to bottom.** All of it is simulated, so it uses the surfaces design §3.2 marking. One `SimExplainer`
  serves the headline.
  1. **Headline sentence** (the surfaces design §3.3 wide form): "**8 in 10** simulated runs finish by **12 Feb 2027**.
     Half by 28 Jan · almost all (19 in 20) by 3 Mar." It shows P80, then P50 and P95.
  2. **Weekly change:** "▲ 9 working days later than last week". Other forms are "▼ … earlier" and "No change since
     last week".
     - It compares today's P80 with the `forecastHistory` entry dated **7 calendar days ago**. If that day has no
       entry, it uses the nearest earlier entry within 7–13 days ago.
     - It counts working days with the project holiday set.
     - Until such an entry exists it says "Change shown from <date>", where <date> is the first history date plus 7
       days.
     - A P80 beyond the horizon on either side reads "Change unavailable: beyond the forecast horizon".
  3. **Range bar:** P50–P95 as a band and P80 as a mark. It sits against a **plan end** tick on a shared date axis,
     drawn with the same visual language as the explainer histogram. It has a text alternative that states the four
     dates.
  4. **Open work:** "<n> open tasks", calculated and **not** marked sim.
  5. **Top 3 milestones at risk:**
     - Only milestones with `state: "chance"` count. Sort by chance, lowest first, then by due date. Show at most 3.
     - Each row shows: the name (a button that opens the milestone, like the Milestones tile), the due date, and the
       chance in plain words ("31 % chance on time"), marked sim.
     - Overdue milestones and ones with no linked tasks are left out, because the Milestones tile already shows them.
     - With none at risk below 100 %, show "No milestones at risk".
     - Row names are row-unique.
  6. **"Open Forecast →"** goes to the Forecast view, and only while the view is enabled.
- **Insufficient history:** the tile shows only the muted line part 1 uses on the KPI strip, which says which floor is
  short. It is not marked sim.
- **No plan end:** the bar drops its plan-end tick, and the change and milestone rows still show.

### 3.2 Milestones tile: chance chip

- In `MilestoneHorizonStrip`, every unachieved milestone with `state: "chance"` gets a small chip after its date, such
  as "62 %". It is marked sim with the dashed teal outline and the badge, and its accessible name is "62 % chance on
  time, simulated".
- Overdue milestones and milestones with no linked tasks get no chip.
- **One ⓘ per tile, not per chip** (my call). The surfaces design §3.3 says every simulated value has an ⓘ, but one ⓘ
  per chip on a dense strip breaks the "nothing gets crammed" rule. A single explainer in the tile body, labelled
  "About these chances", explains milestone chance. That covers queue position by due date, and that "if prioritised"
  lives in the Forecast view. The owner can overrule this.
- Switch off: the strip is byte-identical to today's.

### 3.3 Next actions: "unlikely on time"

- **Trigger:** switch active, the forecast is not insufficient, a milestone has `state: "chance"` with `chance < 0.5`,
  and the milestone is not achieved.
- **Copy:** "Go-live is unlikely on time — 31 % chance". The CTA is **Open Forecast**. The row carries the "sim" badge.
- **Surface-only:**
  - The action is built by a pure helper, `buildSimMilestoneActions`, in `next-actions/`. It is i18n-free and returns
    `SuggestedAction`-shaped items with a new `ActionSource` `"forecast-sim"`.
  - `use-next-actions.ts` merges those items into `nextActionGroups` **after** `groupNextActions`. They never enter the
    flat `nextActions` list, so notifications, learning and the AI context never see them (surfaces design §5).
  - A group that already exists for the same milestone takes the action as an extra reason. Otherwise the action forms
    its own group.
- **Tier: `soon`, never `now`** (my call). It sorts after every `now` item, so a simulated nudge can only become the
  Dashboard hero when nothing measured is urgent.
- **Snooze** uses the existing snooze path. The id is `forecast-sim:milestone:<id>`.
- The exhaustive `ACTION_SOURCE_LABEL` map needs the new source.

### 3.4 The shared run

- `computeAppForecast` gains `milestones: MilestoneChance[]` from the **same** engine run. The engine already returns
  it, so this adds no second simulation.
- The tile, the chips, the action helper, the KPI strip and the recorder all read the one memo. A test pins that the
  engine runs once per input change while all of them are mounted.

## 4. Fixes carried over from part 1

Each fix gets a failing test first.

1. **Idle Turso tab at midnight.**
   - **Problem:** at the day change, an idle open tab writes the new day's history entry. Two users on different
     devices each write an entry, and the entries differ when per-device holiday sets differ. Each write raises the
     revision and pauses the other user's next save on a conflict.
   - **Fix:** the recorder must not write when the stored entry for today already exists and agrees on the fields that
     holidays cannot move. Which fields those are is the builder's call (§6).
   - **Test:** two simulated clients with different holiday sets produce one write per day, not a ping-pong.
2. **The explainer's Help link leaves the popover open.** Following it closes the popover (dismissal protocol) and then
   opens Help.
3. **Version restore restores the switch.**
   - **Problem:** restoring an older version rolls `settingsOverrides.forecast` back with the data.
   - **Fix (my call):** the switch is a viewing choice, not project data, so restore keeps the **current** switch value.
     The owner can overrule this.
   - **Test:** restore with the switch on, from a version where it was off, leaves it on.
   - Fix the version-restore comment that review flagged.
4. **Cold-load flicker.**
   - **Problem:** before the holidays are ready, the KPI cells briefly show the "nothing simulated yet" line.
   - **Fix:** until the holidays are ready, simulated slots render a neutral placeholder of the same height. This also
     covers the new tile and the chips. No muted reason line shows.
5. **Histogram label clipping.** The P50/P80/P95 labels in the explainer histogram stay inside the SVG at both ends,
   including when two cut-offs fall in neighbouring bins.
6. **"Show intro again" with the switch off** lands on an empty Dashboard. The Help action turns the intro on only
   while the switch is on. Otherwise it says the intro needs simulation switched on.
7. **Help wording:** the Help body's "says what is missing" also covers the beyond-horizon line.
8. **Test hygiene:**
   - Restore inline spies in `afterEach` (review M3/M4).
   - The DE assertions call `loadI18n("de")`.
   - The builder clears any further part-1 review minors they find, as long as each is test-only.

## 5. Constraints

- All of surfaces design §4.
- New i18n keys in EN and DE, with real umlauts. The German for "chance on time" is "Termin-Wahrscheinlichkeit", as in
  part 1.
- No lines added to `task-manager.tsx`. The tile reaches its data through the existing Dashboard props and context.
- The new tile is in the Dashboard axe scan only when the switch is on, which the seed does not do. So a11y is unit- and
  eye-verified, as for part 1.
- `docs/AGENTS/dashboard.md` (the new tile and its gate) and `docs/AGENTS/forecast.md` (the HELD BACK list, the part-2
  surfaces and the recorder rule) are updated in the same PR.
- The CHANGELOG `[Unreleased]` held-back Notes line is extended rather than duplicated.

## 6. Left to the builder

- Which history-entry fields the midnight fix compares.
- The range bar's exact drawing and its narrow-tile layout at w 1.
- Exact copy beyond the strings quoted here, and the German wording.
- Whether the action helper lives in `next-actions/` or beside `use-next-actions.ts`, as long as it stays pure.
- How the weekly change reads when today's P80 is itself undefined. It must not show a misleading arrow.

## 7. Open after part 2

- Parts 3 and 4 of the surfaces design.
- §502 stays OPEN until saved scenarios and the AI tool ship.
