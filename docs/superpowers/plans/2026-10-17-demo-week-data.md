# Demo week data (§715 project E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `sample-workspace-small.json` so that the demo opened at Monday 2026-09-21 tells the
"MVP slipped" story, and pin the Next-actions list on Monday, on each later day and on Friday in
unit tests.

**Architecture:** Tests come first. A test-only harness runs the same pipeline `use-next-actions.ts`
runs (workload alerts → `buildActionInput` → `computeNextActions` → `groupNextActions`), with default
settings, on `buildDemoWorkspace(master, today)`. A test-only week fixture applies the on-camera steps
of each day to the master, as plain data. The pinned tests are red against today's master; the data
tasks then edit the master until they are green, and the generated artifacts are regenerated.

**Tech Stack:** TypeScript, vitest, `vite-node` for the generator scripts. No app code changes.

**Spec:** `docs/superpowers/specs/2026-10-16-demo-week-story-design.md` (sections "What E puts in the
data", "Signals at T0", "What the week needs to exist", "What must NOT exist"). The recorder changes in
its "What changes in A" section, and the recorder's `T0` in `scripts/demo-video/lib.mjs`, belong to
project A and are NOT part of this plan.

## Global Constraints

- `sample-workspace-small.json` is the only hand-edited sample. `-big`/`-huge` are regenerated with
  `npx vite-node scripts/generate-sample-workspace.ts`; `sample-demo-snapshots.json` with
  `npx vite-node scripts/generate-demo-snapshots.ts`; `src/app/__fixtures__/golden-*` with
  `npx vite-node scripts/regen-golden-fixtures.ts`. Regenerating is correct here: the master's content
  legitimately changes.
- `DEMO_AS_OF` stays `2026-09-18`. At `today = 2026-09-21` the shift is 0, so master dates are the dates
  the tests see.
- No schema change, no new `Workspace` field, no app (non-test) source change. If a need turns out to
  require one, stop and bring it back.
- Fictional names only; e-mail addresses on `@example.com`.
- "What must NOT exist" stays absent from the master: the "Integration Engineer" discipline and its
  role, the new team member, Noah's vacation next week, the DPO stakeholder, the connector change
  request, the "MVP re-demo" milestone, the "CRM connector (CR)" bucket, the two licence tasks, the
  risk "connector licence lead time", and Monday's blocker on the CRM task. The Senior grade stays.
- Every edited task keeps `status === "Done"` ⟺ `completedDate` set.
- Repo rules from AGENTS.md: vitest under the shared lock, targeted files, `--maxWorkers=2`;
  `npx tsc --noEmit` with 0 errors after editing any test; `npx eslint --max-warnings=0` on changed
  files; never read a gate's exit code through a pipe; `src/**` files are CRLF in the working tree
  (`git ls-files --eol`), `docs/**/*.md` LF; commit with `git commit --only <paths>`, no `--amend`,
  no session trailer or URL in a commit, cite §715 only.

## Review Focus

1. **Explore the demo on another day** (shift ≠ 0, e.g. today 2026-10-05 or 2026-11-02): the demo must
   decode, keep status ⟺ completedDate, and show a hero. → Task 5, test "the reworked master still
   builds a coherent demo on other days".
2. **Dangling references** after new ids are added (milestone `linkedTaskIds`, task `dependencies`,
   RAID/change `stakeholderIds`, bucket `taskIds`): every id resolves. → Task 5, test "every
   reference in the master resolves".
3. **The "must NOT exist" list** regressing when someone later "improves" the sample. → Task 5, test
   "the master leaves the week's additions to the video".
4. **Generated artifacts drifting** from the new master (`-big`/`-huge`, demo snapshots, golden
   fixtures). Already pinned by `sample-workspace-variants.test.ts`, `demo-snapshots.test.ts` and
   `golden-workspace.test.ts`; Task 6 regenerates and runs them.
5. **The re-plan spreadsheet becoming auto-mappable** (a header that Detect columns can read makes the
   "Ask Claude" step pointless). → Task 6, test "the re-plan fixture defeats Detect columns".

---

### Task 1: Test harness for the demo's Next-actions rows

**Files:**
- Create: `src/test/demo-next-actions.ts`
- Test: `src/test/demo-next-actions.test.ts`

**Interfaces:**
- Produces:
  - `demoActionGroups(raw: unknown, today: string): ActionGroup[]` — `buildDemoWorkspace(raw, today)`,
    then the `use-next-actions.ts` pipeline with `defaultSettings` (all feature modules, notifications
    and `nextActions` defaults, empty holiday set, `workdayHours` 8, `now = new Date(today + "T08:30:00Z")`,
    no trends, no learned bias, nothing dismissed), the dashboard model from
    `computeDashboard(buildLiveDashboardInput(…, { active: false, snapshots: [] }))` as in
    `use-trend-snapshots.ts`, and comms reminders from `getStakeholderCommsItems` with the
    `leadDaysByQuadrant` default, as in `use-stakeholder-comms.ts`. Simulation stays off (no
    `mergeSimActions`), as the spec requires.
  - `rowSignature(g: ActionGroup): string` → `` `${g.tier} ${g.primary.source} ${g.key}` `` followed by
    ` +` and the sorted extra action ids joined by `,` when `g.extra` is non-empty.
- Reference shape: a working version of this pipeline is the review probe the spec cites; its inputs
  are those listed above. Follow `use-next-actions.ts` where the two differ.

- [ ] **Step 1: Write the failing test** `src/test/demo-next-actions.test.ts`:
  - "puts an overdue milestone first as a now row": a minimal raw workspace (copy the master, keep only
    milestone 5 with `date: "2026-09-18"`, no `achievedDate`, and `tasks: []`, `raid: []`,
    `changes: []`, `stakeholders: []`) at `2026-09-21` → `rowSignature(groups[0])` starts with
    `"now milestone milestones:5"`.
  - "merges two signals on one task into one row": master task 25 set To Do, due `2026-09-18`, no
    `completedDate`, depending FS on an open task → one group with key `open-points:25` whose signature
    contains `task-due:25:overdue` as primary and `task-attention:25:dep-blocked` among extras.
- [ ] **Step 2: Run it, expect FAIL** ("demoActionGroups is not a function" / module not found).
  `npx vitest run src/test/demo-next-actions.test.ts --maxWorkers=2` under the lock.
- [ ] **Step 3: Implement both functions.**
- [ ] **Step 4: Run it, expect PASS.** Then `npx tsc --noEmit` → 0 errors; eslint on both files.
- [ ] **Step 5: Commit** `test: harness for the demo's next-actions rows (§715)`.

### Task 2: Week fixture — the on-camera steps as data

**Files:**
- Create: `src/test/demo-week.ts`
- Test: `src/test/demo-week.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `type DemoDay = "mon" | "tue" | "wed" | "thu" | "fri"`,
  `DEMO_WEEK_DATES: Record<DemoDay, string>` = `2026-09-21` … `2026-09-25`, and
  `applyDemoWeek(raw: unknown, through: DemoDay): unknown` — a deep copy of `raw` with every step of
  the days up to and including `through` applied (never mutates `raw`). Also
  `DEMO_DUPLICATE_PAIRS: ReadonlyArray<readonly [string, string]>` — the follow-up names Task 5 plants
  and Tuesday deletes:
  ["Fix CRM sync for new registrations", "CRM provisioning fails for sign-ups"],
  ["Erasure requests not reaching the CRM", "GDPR delete does not propagate to the CRM"],
  ["Re-run the MVP demo checklist", "Prepare the MVP demo re-run"]. New rows take
  `max(existing id) + 1` in their collection, so the fixture keeps working whatever ids the master ends
  with; the fixture looks up master rows by NAME/TITLE, not id, except where the spec pins an id.

Steps per day — only those that change a signal; AI steps apply their FIXED outcome:

| Day | Steps |
|---|---|
| mon | task "Integrate CRM provisioning": `blockers` = "CRM API rejects erasure calls", `dueDate` 2026-09-24, `lastUpdateDate` 2026-09-21 |
| tue | that task → In Progress; delete one task of the first duplicate pair; add change "Add a CRM provisioning connector" (Under Review, impact Medium, no stakeholders); add milestone "MVP re-demo" 2026-10-02 linked to task 25; task 25 `dueDate` 2026-10-02 and moved off milestone 5's `linkedTaskIds`; delete the remaining duplicate of each pair (Deduplicate's fixed outcome) |
| wed | add discipline "Integration Engineer", role Integration Engineer × Senior (internal and external rate), resource for the new member in that role with `utilization` for 2026-09 and 2026-10; absence for Noah Bennett 2026-09-28 → 2026-10-02 (vacation); Maya Patel's `utilization["2026-09"]` → 100; one CRM follow-up task reassigned to the new member |
| thu | RAID "GDPR erasure requests do not reach the CRM": owner Noah Bennett, status In Progress; add risk "connector licence lead time" (Medium, Open, owner Noah Bennett, raised 2026-09-24); add stakeholder DPO (High influence, High interest, `raci` C on "MVP re-demo"); changes "Add MFA to SSO scope" and the connector change → Approved; add bucket "CRM connector (CR)"; add tasks "Order the connector licence" and "Confirm licence delivery" (To Do, owner Noah Bennett, due 2026-10-09, `lastUpdateDate` 2026-09-24); milestone "MVP target" date → 2026-10-01 |
| fri | CRM task → Done, `completedDate` 2026-09-25; the GDPR RAID issue → Resolved |

- [ ] **Step 1: Write the failing tests:** "does not mutate its input" (deep-equal before/after);
  "applies the days in order" (`through: "mon"` has the blocker and no "MVP re-demo"; `through: "fri"`
  has "MVP re-demo", the DPO, the CRM task Done with `completedDate` 2026-09-25); "keeps status and
  completedDate paired on every task it touches". Use a small hand-built raw object holding exactly
  the rows the fixture looks up, so this task does not depend on the master edits.
- [ ] **Step 2: Run, expect FAIL** (module not found).
- [ ] **Step 3: Implement `applyDemoWeek`.** If a looked-up row is missing, throw with its name, so a
  master edit that renames a row fails loudly here and not as a silent no-op.
- [ ] **Step 4: Run, expect PASS;** tsc 0 errors; eslint.
- [ ] **Step 5: Commit** `test: the demo week's on-camera steps as a data fixture (§715)`.

### Task 3: Pinned Monday, mid-week and Friday rows (red)

**Files:**
- Create: `src/app/demo-week-signals.test.ts`

**Interfaces:**
- Consumes: `demoActionGroups`, `rowSignature` (Task 1); `applyDemoWeek`, `DEMO_WEEK_DATES` (Task 2).

Ids below are the ones the data tasks create: CRM task **36**, GDPR issue **RAID 15**, Thursday
steering meeting **2**. If Task 4 has to use other ids, it updates this file in the same commit.

- [ ] **Step 1: Write the tests.**

  "Monday 2026-09-21: every row is intended and every intended row fires" — groups of the unedited
  master at `2026-09-21`. `rowSignature(groups[0])` is the hero and equals the first line; the rest
  compares as a SET per tier (`expect(new Set(sigs)).toEqual(new Set(expected))`) because rows of equal
  score have no meaningful order:

  ```ts
  const MONDAY = {
    hero: "now milestone milestones:5",
    now: ["now milestone milestones:5", "now committee steering-committee:2"],
    soon: [
      "soon task-due open-points:36",
      "soon task-due open-points:25 +task-attention:25:dep-blocked",
      "soon workload workload:4",
      "soon raid raid:15",
      "soon change-pending changes:1",
      "soon milestone milestones:2",
      "soon stakeholder-comms stakeholders:1",
      "soon stakeholder-comms stakeholders:5",
      "soon task-attention open-points:5",
      "soon task-attention open-points:7",
      "soon task-attention open-points:8",
      "soon task-attention open-points:10",
    ],
    monitor: [
      "monitor schedule gantt:0",
      "monitor raid raid:2",
      "monitor raid raid:4",
      "monitor raid raid:11",
    ],
  };
  ```

  Extras other than task 25's are not expected; an extra reason appearing on another row is a
  failure (e.g. `stakeholder-comms:1:raid:11` means Elena is still linked to RAID 11).

  "Friday 2026-09-25 after the week" — `applyDemoWeek(master, "fri")` at `2026-09-25`:

  ```ts
  const FRIDAY = {
    hero: "soon stakeholder-comms stakeholders:<DPO id>",
    soon: [
      "soon stakeholder-comms stakeholders:<DPO id>",
      "soon milestone milestones:2",
      "soon task-attention open-points:5",
      "soon task-attention open-points:7",
      "soon task-attention open-points:8",
      "soon task-attention open-points:10",
      "soon task-due open-points:25",
      "soon task-due open-points:4",
    ],
    now: [],
    monitor: ["monitor raid raid:2", "monitor raid raid:4", "monitor raid raid:11", "monitor raid raid:<licence risk id>"],
  };
  ```

  Read `<DPO id>` and `<licence risk id>` from the fixture output by name. The hero is `groups[0]`.
  If the engine puts the schedule row in Friday's Monitor, the SPI band was not held: fix the data,
  do not add the row.

  "Tuesday to Thursday stay on the story" — for `d` in tue, wed, thu: the groups of
  `applyDemoWeek(master, previous day)` at `DEMO_WEEK_DATES[d]` (the morning, before that day's own
  steps; Tuesday uses `"mon"`). Assert every row's signature is in
  `ALLOWED = Monday ∪ Friday ∪ DAY_EXTRAS[d]`, where `DAY_EXTRAS` starts empty. A row that is not
  allowed is either removed from the data (Tasks 4 and 5) or added to `DAY_EXTRAS[d]` with a one-line
  comment saying why it belongs to the story. Also assert: no `raid:*:overdue` row, no
  `task-attention:*:stale` row, no `task-attention:*:unassigned` row on any of the three days.

- [ ] **Step 2: Run, expect FAIL** against today's master. The Monday diff must show today's noise
  (tasks 4, 5, 6, 27 overdue; RAID 13, 8, 9 overdue; RAID 1; task 11; stale rows), which is the
  expected red. A failure for any other reason (import error, harness crash) is a Task 1/2 bug.
- [ ] **Step 3: Commit the red test** `test: pin the demo week's next-actions rows (§715)` — the
  commit body says it is red until the master is reworked in the following commits. The branch is not
  pushed before Task 6.

### Task 4: Rework the master — the slip and the Monday clean-up

**Files:**
- Modify: `sample-workspace-small.json`

**Interfaces:**
- Consumes: the Monday test of Task 3 — this task ends when it is green.

Edits (spec "What E puts in the data" → "The slip" and "Signals at T0"):

- Milestone 5 "MVP target": `date` 2026-09-18, remove `achievedDate`, `linkedTaskIds` [23, 24, 25, 36];
  rewrite `description` (rich HTML) for the new story — the MVP is the customer lifecycle working end
  to end (register, change, delete; legacy shop DB as source; CRM and customer directory as targets),
  and it was not operational on the 18th because provisioning to the CRM fails.
- Task 25: To Do, `dueDate` 2026-09-18, remove `completedDate`, `lastUpdateDate` 2026-09-18,
  dependencies FS on 24 and on 36, a `noteLog` entry dated 2026-09-18 saying the demo was called off
  because provisioning to the CRM fails.
- New task 36 "Integrate CRM provisioning": To Do, assignee Noah Bennett (`resourceId` 2), `startDate`
  2026-09-01, `dueDate` 2026-09-16, FS on 24, `blockers` "", `lastUpdateDate` 2026-09-18.
- Tasks 23 and 24 stay Done; check their `completedDate` is before 2026-09-18.
- Pilot chain re-dated after the MVP, blockers cleared, links kept (4→5, 4→7, 5 and 6→8, 7 and 8→10):
  start from the probe-checked dates (start → due) — task 4 2026-09-22 → 2026-10-02,
  5 2026-10-05 → 10-09, 6 2026-09-22 → 10-09, 7 10-05 → 10-16, 8 10-12 → 10-28, 27 09-28 → 10-07,
  9 10-20 → 10-30, 10 10-29 → 11-04. With these, the review probe showed `task-due:4:soon` on Friday
  and no task-due row for 4 on Monday; if a later edit changes that, the pinned tests say so. Task 8
  ends after 2026-10-23, which keeps Pilot Go-Live (milestone 2, 2026-10-23) at risk.
- Task 11 "Quarterly OKR review": `dueDate` 2026-10-12.
- Every open task: `lastUpdateDate` within 2026-09-08 … 2026-09-18.
- RAID: 13 → Delivered; 8 and 9 → Resolved; 1 → Closed; every open item `localModifiedAt` within
  2026-09-08 … 2026-09-18; 4, 7 and 11 `targetDate` after 2026-09-25 (e.g. 2026-10-15).
- New RAID 15 Issue "GDPR erasure requests do not reach the CRM": High, Open, NO owner, raised
  2026-09-18, `localModifiedAt` 2026-09-18.
- Elena Fischer (stakeholder 1): `email` `elena.fischer@example.com`; remove 1 from RAID 2's and
  RAID 11's `stakeholderIds`.
- Steering committee: add meeting 2 on 2026-09-24, title "Steering — MVP slip", an agenda (MVP slip,
  CRM connector change, MFA change). Meeting 1 stays.
- Remove Maya's absence 4 (21–22 Sept). Noah's 9–13 Nov vacation stays.
- Maya (resource 4) `utilization["2026-09"]` ≥ 130 (probe used 140), so `workload:4` scores 52.
- Schedule: if `gantt:0` drops out or rises to Soon, adjust task progress until SPI is in [0.8, 0.9).

- [ ] **Step 1:** Label every test that reads the master before editing it:
  `grep -rln "sample-workspace-small" src e2e scripts`. Known values that move:
  `sample-workspace-budget.test.ts` pins bucket 1 `endDate` "2026-09-30" (MIGRATE in Task 5);
  `demo-snapshots.test.ts` compares the generated file (RECOMPUTE in Task 6); golden fixtures
  (RECOMPUTE in Task 6). Run the remaining `src/**` readers once now (under the lock, in batches, with
  `--maxWorkers=2`) to have a green baseline, and write the list with each label into the task report.
- [ ] **Step 2:** Make the edits. Edit the JSON with a node script (`JSON.parse` → change →
  `JSON.stringify(…, null, 2)` + the file's trailing newline), never by hand-typing ids into large
  diffs; check `git diff --stat` touches only the master.
- [ ] **Step 3:** Run `src/app/demo-week-signals.test.ts`. The Monday test must PASS; Tue–Fri may
  still fail (Task 5). Then run the labelled KEEP tests from Step 1; a KEEP test that fails is a data
  mistake, not a test to change.
- [ ] **Step 4: Commit** `feat: rework the demo master around the slipped MVP (§715)` —
  `git commit --only sample-workspace-small.json` (plus any test whose id expectations moved).

### Task 5: The week's material and the master's integrity

**Files:**
- Modify: `sample-workspace-small.json`
- Modify: `src/app/sample-workspace-budget.test.ts` (bucket 1 end date)
- Create: `src/app/demo-week-master.test.ts`

Edits (spec "What the week needs to exist"):

- The three near-duplicate follow-up pairs of `DEMO_DUPLICATE_PAIRS` (Task 2), logged on 2026-09-18,
  the two tasks of a pair by two different people; each task has an assignee, `lastUpdateDate`
  2026-09-18, a `dueDate` after 2026-09-25, status To Do.
- Knowledge item about the CRM interface decision taken at design sign-off; its title or body
  contains "CRM"; next `dl-N` id.
- Bucket "Identity Platform – T&M" `endDate` → 2026-10-31 (covers the re-plan fixture's months).
- Pilot tasks loose enough for Optimize with AI (task 34 "Pilot feedback fixes" stays on milestone 3).

- [ ] **Step 1: Write the failing tests** in `src/app/demo-week-master.test.ts`:
  - "every reference in the master resolves": milestone `linkedTaskIds`, task `dependencies[].taskId`,
    RAID/change `stakeholderIds`, stakeholder `resourceId`, bucket `taskIds`, absence `resourceId` all
    name an existing row.
  - "the master leaves the week's additions to the video": none of the names in Global Constraints'
    "must NOT exist" list is present (discipline name, stakeholder named like the DPO, milestone
    "MVP re-demo", change "Add a CRM provisioning connector", bucket "CRM connector (CR)", the two
    licence task names, the licence risk title), task 36's `blockers` is "", no absence of Noah Bennett
    starting 2026-09-28; the grade "Senior" exists.
  - "the reworked master still builds a coherent demo on other days": for today in 2026-09-21,
    2026-10-05, 2026-11-02, 2027-01-15 — `buildDemoWorkspace` decodes, every task satisfies
    status ⟺ completedDate, and `demoActionGroups` returns at least one non-monitor group.
  - "the week's material exists": three duplicate pairs by the names you chose, each pair with two
    different assignees; a knowledge item matching /CRM/; Friday's `detectInsights` input built from
    `applyDemoWeek(master, "fri")` at 2026-09-25 yields at least one insight of kind `milestoneSlip`
    (build the `InsightInput` the way `use-insight-lifecycle.ts` does; `priorOverdueCount: null`).
- [ ] **Step 2: Run, expect FAIL** on the material test (and on whatever else the master lacks).
- [ ] **Step 3: Edit the master;** MIGRATE `sample-workspace-budget.test.ts`'s pinned end date
  ("2026-09-30" → "2026-10-31"), and nothing else in that file unless the run shows it moved.
- [ ] **Step 4: Run** `demo-week-master.test.ts`, `demo-week-signals.test.ts` (all four days now PASS),
  `sample-workspace-budget.test.ts`, and the Step 1 KEEP list of Task 4. tsc 0 errors; eslint.
- [ ] **Step 5: Commit** `feat: the demo week's follow-ups, knowledge item and budget window (§715)`.

### Task 6: Re-plan fixture, regenerated artifacts, docs

**Files:**
- Create: `scripts/demo-video/fixtures/replan-forecast.csv` (or `.xlsx` if Import forecast does not
  accept CSV — check the file picker's accept list), and `scripts/demo-video/replan-fixture.test.ts`
  if `scripts/**/*.test.ts` is in vitest's include list, else `src/app/demo-replan-fixture.test.ts`.
- Regenerate: `sample-workspace-big.json`, `sample-workspace-huge.json`, `sample-demo-snapshots.json`,
  `src/app/__fixtures__/golden-*`.
- Modify: `scripts/demo-video/README.md` (one line: the fixture and what it is for), `CHANGELOG.md`
  (Unreleased → Changed: the demo project now tells the slipped-MVP week; cite §715).

Fixture contents: the planned hours per person of the bucket "Identity Platform – T&M" for October and
November 2026, for the existing team, under headers chosen so `detectLayout` cannot read them
(e.g. a person column titled "Who" and period columns titled "Wk-cluster A", "Wk-cluster B" with a
note row above the header). Fictional names that match the master's resources.

- [ ] **Step 1: Write the failing test** "the re-plan fixture defeats Detect columns": parse the
  fixture to rows and assert `detectLayout(rows).kind` is the kind of the module's `UNKNOWN` result;
  and "its people are the master's people": every person cell names a resource in the master.
- [ ] **Step 2: Run, expect FAIL** (file missing). **Step 3:** write the fixture. **Step 4:** PASS.
- [ ] **Step 5: Regenerate** in this order and run each pinning test after its generator:
  `npx vite-node scripts/generate-sample-workspace.ts` → `sample-workspace-variants.test.ts`;
  `npx vite-node scripts/generate-demo-snapshots.ts` → `demo-snapshots.test.ts`;
  `npx vite-node scripts/regen-golden-fixtures.ts` → `golden-workspace.test.ts`. Each generator prints a
  success line; a run that writes an empty workspace is a failure even at exit 0.
- [ ] **Step 6: Run** every `src/**` test from Task 4's Step 1 list, in batches under the lock. Any
  remaining red is labelled and either fixed in the data or migrated with a one-line reason in the
  report.
- [ ] **Step 7: Re-check A's clip needs.** For each row of "What A needs from project E" in
  `docs/superpowers/specs/2026-10-16-video-guides-recorder-design.md`, name the master row that
  serves it, or list the gap in the task report (a gap is brought back, not silently filled).
- [ ] **Step 8: Pre-push checks:** eslint on changed files; `npx tsc --noEmit` → 0 errors;
  `node scripts/gate-local.mjs --group static --keep-going --allow-dirty` (only the untracked
  `.superpowers/tmp` scripts may fail lint); `git log origin/main..HEAD --format=%B | grep -ciE
  "claude-session|https?://"` → 0.
- [ ] **Step 9: Commit** `chore: re-plan fixture and regenerated demo artifacts (§715)`.
