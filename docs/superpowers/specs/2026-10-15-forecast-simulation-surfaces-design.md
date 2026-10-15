# Forecast simulation across the app — design (§502, slices 2 + 5)

**Status:** agreed in brainstorming 2026-10-15 (visual mockups). Awaiting owner review of this document.
**Register:** §502 (work item #41). Builds on slice 1 (`docs/superpowers/specs/2026-10-14-monte-carlo-forecast-design.md`,
shipped in PR #736). This design **replaces** that spec's slices 2 and 5 and takes the export line from its slice 4.
Slice 3 (saved scenarios) and the `get_forecast` AI tool stay separate and are not covered here.

---

## 1. Intent

Slice 1 put a Monte Carlo schedule forecast in its own view. A project manager still has to go there to learn
anything. This design brings the forecast to where decisions are made — the Dashboard, the Budget report, the Gantt,
Reports and exports — and makes the schedule and budget forecasts tell **one story**: if the schedule slips to 12 Feb,
the budget shows what that slip costs.

Two things the owner insisted on:

- **Calculated and simulated values must stay cleanly apart.** A project manager must always know whether a number was
  measured or simulated. Simulation is opt-in.
- **Nothing gets crammed.** Turning simulation on must not overload tiles and cards; with it off, the app is exactly as
  it is today.

## 2. Goals, non-goals, anti-goals

**Goals**
- One switch per project turns simulation on for the whole app.
- Every simulated number looks the same everywhere and can explain itself.
- The budget "at current pace" forecast runs to the **forecast** finish, not the plan end, and becomes a range.
- The Dashboard answers "when do we finish, how has that moved, which milestones are at risk, what will it cost".

**Non-goals (this design)**
- Saved scenarios (old slice 3).
- The `get_forecast` AI tool and a forecast-based Insights detector (revisit after the AI tool).
- Any change to SPI, CPI, earned value, actuals or the "at current efficiency" forecast — they stay calculated.
- A forecast fan on the Completion trend tile.
- Per-label or per-assignee forecasts (an assignee forecast would rank people by speed).

**Anti-goals — a failure even if it works**
- A simulated number that can be mistaken for a measured one.
- With simulation off, any visible difference from today's app.
- A tile or card that needs a legend to be read.
- The budget and schedule views contradicting each other with no explanation.

## 3. Decisions

### 3.1 The switch
- **"Show simulation"**, one switch, stored **per project** (the whole team sees the same view) — a new persisted
  project setting, so all six write paths.
- It lives in the Dashboard toolbar and governs the **whole app**: Dashboard, Budget report, Gantt, Reports,
  Next actions and exports.
- Off (the default): every surface is exactly as today. On: simulated cells, bands, chips, tiles and sections appear.
- The Forecast view itself is simulation by nature and is always available, whatever the switch says.

### 3.2 How a simulated number looks (all surfaces)
- A **dashed teal outline** and a small **"sim" badge** on the value's container. Calculated values never change style.
- Charts: simulated series are **bands** (P50–P95 range, low opacity) plus a **bold dashed P80 line**. The same visual
  language on the budget chart and the Gantt.
- Colours come from sanctioned `globals.css` tokens only (palette constraint); both light and dark themes.

### 3.3 Explaining P50 / P80 / P95 (not a tooltip)
A tooltip is hover-only and excludes keyboard and touch users. Instead, by available space:
- **Everywhere:** an **ⓘ** button beside each simulated value opens a small explainer (click or keyboard; follows the
  app's dismissal protocol): a mini histogram with the P50/P80/P95 cut-offs; one line — "The app replayed your team's
  real past days 10,000 times. P80 = 8 in 10 of those runs finished by this date"; what it rests on ("based on the last
  60 working days"); a link to Help.
- **Tables and lists:** plain words first, P-code small beside: **Even odds** (P50) · **Safe to commit** (P80) ·
  **Cautious** (P95).
- **Wide tiles and cards:** a sentence — "**8 in 10** simulated runs finish by **12 Feb 2027**. Half by 28 Jan · almost
  all (19 in 20) by 3 Mar."
- **Once:** a short intro when simulation is switched on ("Dashed teal numbers are simulated, not measured…",
  *Show me* / *Got it*), re-openable from Help. A new Help entry explains the forecast.

### 3.4 SPI and the simulation can disagree
SPI (calculated from estimates) and chance on time (simulated from observed completions) can point opposite ways.
- Keep **both visible**.
- When they diverge — **SPI ≥ 1.0 and chance on time < 50 %, or SPI < 0.9 and chance on time ≥ 80 %** — show a short line
  beside the two KPI cells (visible, not hidden in the ⓘ): "These metrics use different units. SPI uses estimated effort
  completed versus planned effort due. Chance on time uses the observed completion rate. A project can look ahead on SPI
  and still have low date confidence if many remaining items are small, unestimated, or finishing slowly."
- A **data-quality cue** near the forecast: "Estimates cover N % of remaining work".

### 3.5 Forecast history (recorded)
- A new persisted workspace field: at most **one entry per day** — date, P50, P80, P95 finish and chance on time —
  written when the project is open with simulation on (a later run the same day overwrites that day's entry).
  All six write paths.
- **Both** file mode and Turso read this one field (no separate snapshot source).
- It feeds the forecast tile's weekly change and the Trends line. Until 7 days of history exist the tile says
  "change shown from <date>".

### 3.6 Budget follows the schedule (old slice 5)
- **The calculated "at current pace" figure does not change** (owner decision 2026-10-15). It still carries spend to the
  plan end and keeps driving everything it drives today — the Budget health dot (`paceVacHealth`), the forecast gap and
  the pace leg in exports — whatever the switch says. A simulated number never sets a dot that looks calculated.
- **Beside it, marked "sim", a simulated cost at finish.** Per simulation run, spend is carried to **that run's finish
  day**, each simulated day's spend drawn from real past spend days (bootstrap, as the schedule draws completion days) —
  not one flat average. Result: cost at finish **P50 / P80 / P95** and **chance over budget**. On the charts the
  calculated pace line stays; the simulated cost range is a band beside it.
- The schedule and cost use the **same runs** (same seed stream discipline as slice 1), so a slow run is slow on both.
- **"At current efficiency"** stays one number (no dates in it).
- **Below the history floor** the pace card stays exactly as today, with a note saying why the range is missing.
- The **scope vs performance split** in the change table stays on the calculated pace figure; the simulated range sits
  beside it, marked.
- Money in the baseline currency (`plan.currency`, §476); contract basis as the existing forecast.

### 3.7 Surfaces (simulation on)

| Surface | Change |
|---|---|
| **New Dashboard tile: Forecast** | Finish date at P80 ("8 in 10 … by 12 Feb"), weekly change ("▲ 9 working days later than last week"), P50–P95 range bar vs plan end, open-task count; below it the **top 3 milestones at risk** with chance, worst first; "Open →" to the Forecast view. Hidden while the switch is off. |
| **KPI strip** | Two new simulated cells: **P80 finish** and **chance on time** (by plan end). SPI/CPI unchanged. Divergence line and estimate-coverage cue per §3.4. |
| **Budget burn tile + Budget report chart** | Both orientations (burn-down, cumulative) and both units (money, hours): schedule finish band P50–P95 + P80 line; cost range band after today. |
| **Budget burn tile** | Also shows cost at finish (P80) and chance over budget — the cost figure lives here, not in the Forecast tile. |
| **"At current pace" card** | Calculated EAC unchanged; beside it, marked "sim": cost at finish P50/P80/P95 + chance over budget, to forecast finish (§3.6). |
| **Milestones tile** | A chance-on-time column (full list; the Forecast tile shows only the top 3). |
| **Next actions** | New signal, only while the switch is on: a milestone under **50 %** chance — "Go-live is unlikely on time — 31 % chance · Open Forecast" — marked "sim". |
| **Trends (Turso)** | A "P80 finish over time" line from the recorded history. |
| **Gantt** | Faint P50–P95 finish band behind the bars, bold dashed P80 line beside plan end, a "sim" chance chip on each unfinished milestone. The band must stay faint enough that bars read clearly. |
| **Reports view** | A Forecast section: headline cells (Even odds · Safe to commit vs plan end · On time · Cost at finish P80 with chance over budget), a **milestones table** (date, chance in due order, chance if prioritised, worst first), and a **"Forecast by group" fold-out**, closed by default and computed only when opened: per group open count, safe-to-commit date, chance on time; groups below the history floor say "not enough history (N finished, needs 10)"; under it: "Each group is forecast on its own, from its own past days. The project date comes from all work together, so it is not simply the latest group date." |
| **Forecast view** | A **"Cost at finish"** question beside When / How many: P50/P80/P95 and chance over budget; What-if capacity and scope move cost too. |
| **Exports / documents** | While the switch is on: a "Forecast (P80)" line and cost at finish, always labelled "simulated". Off: nothing. |
| Unchanged | Completion trend, RAID, Changes, Upcoming, budget panel totals and bucket cards, "at current efficiency" card, Insights. |

## 4. Constraints
- Slice 1's engine rules carry over: seeded and deterministic, 10,000 trials, 1,300-working-day horizon, history floor
  (≥ 10 finished tasks, ≥ 10 window days), nearest-rank percentiles, engine i18n-free.
- Repo hard constraints (AGENTS.md): EN/DE i18n parity with real umlauts; a new persisted field on **all six** write paths;
  palette tokens only; every new control has an accessible name and keyboard operation, row-unique names in lists;
  `react-hooks/set-state-in-effect` is banned; `task-manager.tsx` has no size headroom.
- Performance: the Dashboard and Budget report must not run the simulation more than once per input change; per-group
  runs only when the fold-out opens. Budget figures reuse the schedule runs rather than a second simulation.
- The §476 baseline-currency rules (`budget.md`): `resolveRate` requires a base currency; never convert twice.
- New register numbers, if any, are agreed with the peer session first (next free: §740).

## 5. Calls made after the builder check (designer's calls, not owner decisions)

- **App-wide run settings.** Every surface outside the Forecast view, and every recorded history entry, uses fixed
  defaults: history window 60 working days, unit **tasks**, no What-if. The Forecast view's toolbar stays view-local;
  when it differs from the defaults the view says "The Dashboard uses the default settings". This keeps the weekly
  change comparing like with like.
- **Spend window and floor.** Simulated spend days come from the **same 60-working-day window** as the schedule, so the
  same runs drive schedule and cost. The cost range needs the schedule floor **and** enough spend history (the builder
  sets the spend floor); below either, the card shows today's figure and a note saying which is missing.
- **Next-actions signal reach.** The "unlikely on time" action appears only in the Next actions panel and on the
  Dashboard (hero and Top actions). It stays out of the flat list read by notifications, learning and the AI context,
  which cannot carry the "sim" marking.
- **Which exports.** The document outputs that already carry the budget forecast section (status report, steering pack,
  PPTX, DOCX, HTML). Never the storage formats (CSV / Markdown / JSON bytes are pinned). The existing pace leg stays; the
  simulated line is added beside it.
- **The history writer.** A background step writes the day's entry whenever the project is open with the switch on, even
  if no forecast surface is visited. It is gated on `loadPending`, drops a write that lands after a project swap
  (`dropStaleScopeWrite`), is skipped in popouts, creates no undo or activity-log entry, and the last writer of the day
  wins (Turso multi-user included). It must not add lines to `task-manager.tsx`.

## 6. Left to the builder
- Where the switch and the history field live in the types, and their names.
- How the engine exposes per-run finish days and spend to the budget layer (one shared run result is the intent).
- How a per-working-day spend history is derived from the existing dated actuals (period-booked values are spread
  today) and what counts as "enough spend history".
- Exact copy, apart from the strings quoted above, and German wording (real umlauts).
- How the explainer histogram is drawn, within the palette and a11y rules.
- How the work is cut into PRs. A suggested order: (1) switch, sim marking, explainer, intro, history field;
  (2) Dashboard tile, KPI cells, divergence cue, Milestones column, Next-actions signal; (3) budget simulation, pace
  card, chart bands, burn tile, Forecast-view cost; (4) Gantt, Reports section, Trends line, exports.

## 7. Open after this design
- §502 stays open until saved scenarios and the AI tool ship.
