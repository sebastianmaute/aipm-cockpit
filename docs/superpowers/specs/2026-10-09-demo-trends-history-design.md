# Demo project with Trends history — design

Date: 2026-10-09. Status: approved in conversation, section by section; this document is the written spec.

## Why

The demo project ("Explore a demo project") shows no Trends history. Trends records a snapshot only
while a project lives on Turso, and the demo is always a local (IndexedDB) project: started in Turso
portfolio mode, `createDemoProject` even switches the app to file mode and reloads. So the feature
that shows how a project moved over time is never visible in the demo. The sample project also spans
only 2026-06-01 to 2026-12-18 with "today" 3.5 months in, which is too little history to tell a story.

Users also need to know the demo exists and what it needs. Today it is one unexplained secondary
button on the empty state, and it is not reachable at all once a project exists.

## Decisions (owner, 2026-10-09)

1. In Turso mode with a usable Turso configuration, the demo is created as a **Turso project** and
   gets a **seeded Trends history**. Without Turso it stays a local project, as today. Trends stays
   Turso-only.
2. The **sample master** (`sample-workspace-small.json`) itself is extended, not a separate demo file.
3. The empty state presents the demo as a **card** (option A) that explains what it contains, and
   **guides a user without Turso** to set it up first if they want the Trends history.
4. A second entry point, **"Explore a demo project" in the project menu**, makes it reachable when
   projects already exist.

## Part 1 — The empty state and the guided path

### The demo card

The empty state's start actions become three cards: **New project** (create), **Open existing**
(load a file; load from Turso where configured) and **Explore the demo**. The archived list and the
Backend setup section stay below, unchanged.

The demo card's text depends on the mode:

- **Local (no usable Turso config, or file portfolio mode):** "Customer Identity Platform: a 12-month
  project, 7 months in. Tasks, RAID, budget, Gantt and a guided tour." Then an info note: "Trends,
  which shows how the project moved week by week, needs Turso, the optional cloud database that also
  syncs projects across devices. Set it up first to get {n} weeks of Trends history in the demo."
  Actions: **Explore the demo** (primary; today's local demo) and **Set up Turso first** (secondary).
- **Turso mode with a usable config:** the same description plus "Includes {n} weeks of Trends history.
  Adds "Customer Identity Platform (demo)" to your Turso database; delete it any time." Action:
  **Explore the demo**.

`{n}` is the number of seeded records (about 27 for the current master), read from the snapshot file
at run time, never written as a literal.

All copy goes through i18n (EN + DE). Controls use the shared `Button`; the cards use existing
surface tokens (no new component sizes or tones, per the §684–§695 standardisation decision).

### The guided path (no Turso yet)

1. **Set up Turso first** opens the existing `BackendSetupWizard` at its Storage step, and stores a
   one-shot demo intent in localStorage (`aipm-cockpit:demo-intent`), because switching the portfolio
   mode reloads the app.
2. The user configures Turso and switches the portfolio to Turso in that step (existing behaviour,
   which reloads).
3. After the reload, the app reads and **clears** the intent:
   - Empty Turso database: the empty state shows the Turso card with a one-time note, "Turso
     connected. Explore the demo to include {n} weeks of Trends history."
   - Turso database already holding projects: the empty state does not show, so an info toast offers
     **Explore the demo** as its action.
4. Closing the wizard without switching clears the intent; the card stays in its local form.

A local demo created before Turso was set up stays local and never gains history. The user can
create a Turso demo from the project menu and delete the local one. Migrating a local demo's history
is out of scope.

### Project menu entry

"Explore a demo project" is added to the project menu in both modes, so the demo is reachable when
projects exist. It runs the same create path as the card (Part 2) and does not replace or touch any
existing project. In file mode it creates a local demo, as the empty-state button does today.

## Part 2 — Data

### The 12-month sample master

- Plan: **2026-03-02 to 2027-02-26**, month granularity. `DEMO_AS_OF` stays **2026-09-18**, so the
  demo date shift (`demoShiftFor` / `shiftWorkspaceDates`) and the e2e frozen clocks (`FROZEN_NOW`,
  `VISUAL_FROZEN_NOW`) are unchanged.
- Story, authored into the data:
  - kickoff in March;
  - design sign-off in May;
  - the MVP slips in July because a vendor is late (a RAID item);
  - a change request approved in early September (the existing changes are already dated then);
  - then pilot, rollout and closure after "today".
- Added content:
  - early-phase tasks already Done, with `completedDate`s across March to August;
  - monthly budget periods from March to February, with actuals from March to September;
  - about 6 milestones;
  - activity-log entries spread from March to September.
- Consequences, to be done in the same change:
  - regenerate `-big` and `-huge` (`scripts/generate-sample-workspace.ts`);
  - regenerate `__fixtures__/golden-*`;
  - update the tests that count rows or check totals, and re-baseline the visual snapshots.
  - Per the plan-omits-the-tests rule, the plan lists every file that reads the master
    (`git grep -l sample-workspace-small`, 35 files on 2026-10-09) with a verdict each.

### The seeded Trends history

- A new script, `scripts/generate-demo-snapshots.ts`, writes **`sample-demo-snapshots.json`** at the
  repo root. It is committed and regenerated like `-big` and `-huge`; never hand-edited.
- For each **Friday from the second week after kickoff up to the last Friday before `DEMO_AS_OF`**
  (about 27 weeks), the script reconstructs the project as of that date:
  - tasks whose `completedDate` is later are reopened;
  - budget actuals in later periods are dropped;
  - RAID items, changes and activity entries created later are removed.
- It then calls the same engines the live capture uses (the dashboard model, then `buildSnapshot`),
  so every figure is consistent with the project. `trigger` is `"auto"`, `cadence` is `"weekly"`, and
  the first record is the baseline.
- **Accepted limitation:** effort is not dated per task, so the reconstruction approximates what each
  week looked like. The docs say so.
- A test pins that the committed file equals a fresh run of the generator, as the golden fixtures do
  for the serializers.

### Creating the Turso demo

`loadDemo` builds the shifted workspace as today, then branches on portfolio mode:

- **Turso mode with a usable config:**
  1. Create the project through `createTursoProject(meta, { importedWorkspace: ws })`, the path the
     create wizard's import already uses, with the name "Customer Identity Platform (demo)".
  2. Shift every seeded record by the same shift as the workspace (`capturedAt`, `forecastEndDate`,
     `planEndDate`, milestone `target`/`forecast`, series `period`s). Then recompute `id` and `bucket`
     from the shifted `capturedAt` (`bucketKey`).
  3. Write them in **one batch** to the new project's `snapshot` rows, and set the first as baseline.
     A batch store function is added beside `appendSnapshot`, built from the same statements.
  4. The seeded history ends at the week before "today", so the current week is left to the normal
     auto-capture, and there is no duplicate bucket.
- **Cadence:** with the user's snapshot cadence at `monthly`, only the last record of each month is
  seeded. With `daily`, the weekly records are seeded as they are, and the gap markers between them
  are accepted (there is no daily data to replay).
- **Failure handling:**
  - If the Turso create fails, fall back to the local demo, with a toast that it was created
    locally.
  - If only the snapshot write fails, the demo project stays, with a toast that Trends history could
    not be added.
- **Every other case** (file mode, or Turso mode without a usable config): today's local path,
  unchanged except that it no longer switches the portfolio to file mode when Turso is usable.

Snapshots are not workspace data: the `snapshot` table is already outside `TABLE_NAMES`, so none of
the six write paths changes.

## Testing

- **Unit:**
  - the as-of reconstruction (each removal rule, with a fixture that has rows on both sides of the
    date);
  - the record shift and bucket recomputation;
  - cadence thinning;
  - the batch statements, run against `node:sqlite` as `turso-schema.execute.test.ts` does;
  - the demo intent's set-and-clear on each wizard outcome.
- **Component:**
  - both card variants;
  - the guided-path buttons;
  - the one-time connected note;
  - the toast when projects exist;
  - the project-menu entry in both modes.
- **The generator:** the committed file equals a fresh run.
- **Live Turso (owed, like other Turso-only flows):** create the demo against a real database, open
  Trends, delete the demo. CI cannot see this; the e2e seed runs in file mode.
- **a11y:** the empty state is not in `A11Y_VIEWS`, so the card's controls get accessible-name unit
  tests and an eye-verification.

## Out of scope

- Migrating a local demo's history into Turso.
- Showing Trends for local projects.
- A daily-cadence replay.
