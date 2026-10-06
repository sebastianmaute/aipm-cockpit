// src/../e2e/seed-content.spec.ts — does the seeded workspace actually REACH
// the running app?
//
// ★★★ THIS GUARDS A SILENT, SELF-CONCEALING REGRESSION. `e2e/seed.ts` writes the
// sample workspace (`e2e/seed-workspace.ts`) into IndexedDB. It used to do so from
// two HARDCODED lists, and a slice missing from them was dropped without a word:
// the view rendered its EMPTY STATE, and the axe gate then scanned a panel with no
// rows and no per-row controls — green, over nothing. Since §99 the stores and kv
// keys come from `src/app/idb-layout.ts`, and `src/app/idb-layout.test.ts` fails
// when a slice there reaches the seed with no data. This spec checks the other
// half: that what was written actually renders in the running app.
//
// ★★ "and nothing that could collide" used to be part of that sentence. Dropped
// 2026-08-08: axe has NO rule for two controls sharing an accessible name (see
// the insights test below), so a duplicate name is invisible to the gate whether
// the rows render or not. Seeding rows buys real coverage of everything else axe
// DOES check, plus assertions like the one below that axe cannot make.
//
// ★★★ THE FAILURE PRESENTS AS PROGRESS, which is why a guard is worth an e2e
// slot. Drop the seeded `documents` and all five Documents axe scans
// go GREEN — because the violation they currently protect lives in the preview
// pane, which stops existing once there is nothing to preview. The gate would
// report an improvement while coverage silently vanished. This spec turns that
// into a loud, named failure.
//
// ★ SCOPED AS THE SEED'S GUARD, not any one view's. Since §99 the seed carries
// every optional kv slice except three configuration slices (SEED_UNSEEDED_BY_DESIGN
// in e2e/seed-workspace.ts); a rendering check for a slice belongs in THIS file
// rather than a spec of its own. Not every seeded slice has one yet.
//
// ★ Asserts CONTENT, never "the seed ran". A seed that runs and writes nothing
// is exactly the bug.

import { test, expect, gotoApp, openView, seedTimelogSettings } from "./seed";

test("seeded documents reach the app, not just IndexedDB", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Documents");

  // Both titles: one from the sample master, one appended in seed-workspace.ts. Naming
  // them individually means a partial seed fails as loudly as a missing one.
  // ★ `exact: true` is REQUIRED, not tidiness. getByRole's `name` matches as a
  // SUBSTRING by default, and every per-row control embeds the title for row
  // uniqueness ("Download – Steering update", …) — so the loose form resolves
  // to 5 elements and fails on strict mode. Measured, not guessed: that is
  // exactly how this assertion failed on its first run.
  await expect(page.getByRole("button", { name: "Steering update", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kickoff pack", exact: true })).toBeVisible();

  // ★ The empty state must be ABSENT. Without this, a future list that renders
  // both a message AND rows would satisfy the assertions above while the pane
  // is really telling the user it has nothing.
  await expect(page.getByText("No documents yet.")).toHaveCount(0);
});

// ★★ Insights and Time bookings were both in A11Y_VIEWS and both scanned against
// their empty state until 2026-08-08, because neither slice exists in the sample
// master AND neither was in the seed's kv map then. Authoring them in the seed
// fixed both; the `cfg.enabled` gate (0.245.0) then put Time bookings back on its
// empty state until §171 seeded the Timelog settings for it. These specs are what
// keep that true: without them, dropping the seeded rows turns those axe scans
// green again by deleting the rows they are supposed to be checking.
test("seeded insights reach the app, not just IndexedDB", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Insights");

  // Every seeded row, named individually with its EXPECTED COUNT — a partial
  // seed must fail as loudly as a missing one. The titles are rendered from
  // `type` (insight-text.ts), never stored, so these also pin that the seeded
  // types are the real union members. Two rows are `milestoneSlip`, hence the 2.
  // ★ Scoped to the ROW, not `getByText`: the type filter's <select> carries an
  // <option> with the identical label for every insight type, so the bare text
  // locator resolves to two elements and dies on strict mode — and the option
  // exists whether or not a single insight was seeded, which is the opposite of
  // what this spec is for. Measured, not guessed: that is how it failed first run.
  // ★ These counts assume the digest card contributes no <li> for these rows —
  // true at the seeded dates (its own rows would ALSO carry the title, since
  // insight-digest-card.tsx's rowLabel is `title – detail`). If the digest window
  // ever reaches them the counts go up by one each; that is a real change, not a
  // flake, and it should be reflected here rather than loosened away.
  // ★★ THE DETAIL FRAGMENT IS NOT DECORATION — it is the only thing that can
  // tell a correctly-seeded row from a degraded one. `insightDetail`
  // (insights/insight-text.ts) reads a DIFFERENT `data` key per type and falls
  // back to "—" for a missing string and 0 for a missing number, so a row seeded
  // with another type's field names still renders, still counts, and still
  // passes every axe scan — it just says "0 active tasks are stale…". That
  // exact mismatch shipped in this file's own seed and was invisible to the
  // count assertions alone.
  for (const [title, count, detail] of [
    ["Milestone at risk", 2, "days overdue"], // §450: real plurals; both seeded rows are many days late
    ["Work is stalling", 1, "5 active tasks are stale"],
    ["Budget off plan", 1, "off plan by 18%"],
  ] as const) {
    const rows = page.getByRole("listitem").filter({ hasText: title });
    await expect(rows).toHaveCount(count);
    // `.first()` because "Milestone at risk" legitimately resolves to two rows;
    // both carry the same fragment, so the first is a sufficient witness.
    await expect(rows.first()).toContainText(detail);
  }

  // Four rows, four Dismiss controls (none of the seeded rows is terminal). THIS
  // is the assertion about the seed: every seeded row reached the app and got its
  // per-row controls. It stays true whether or not §126 is ever fixed.
  await expect(page.getByRole("button", { name: /^Dismiss – / })).toHaveCount(4);

  // ★★★ PINS THE FIX FOR docs/open-followups.md §126 (now CLOSED). It used to
  // pin the BUG — both `milestoneSlip` rows rendered a button whose accessible
  // name was exactly "Dismiss – Milestone at risk", because insightTitle() is
  // derived from `type` alone, a WCAG 2.4.6 failure. `buildRowTokens`
  // (src/app/row-tokens.ts) now disambiguates: a name unique in the rendered
  // list stays bare, but rows sharing a name get a 1-based OCCURRENCE INDEX
  // over just the colliding group, with ALL of them numbered including the
  // first — so the two milestoneSlip rows render "Dismiss – Milestone at risk
  // (1)" and "Dismiss – Milestone at risk (2)" (EN DASH U+2013), never the
  // bare form. The count-0 assertion below proves the collision is gone; the
  // two count-1 assertions after it prove the disambiguated pair survives.
  // ★★★ IF THIS EVER GOES RED, DO NOT LOOSEN OR DELETE IT — it is the ONLY
  // detector in the repo for this class: of axe-core 4.12.1's rules, not one
  // carrying a tag e2e/a11y.spec.ts requests flags two BUTTONS sharing an
  // accessible name. ★ TWO rules are adjacent and NEITHER is requested:
  // `identical-links-same-purpose` (links ONLY, tagged `wcag2aaa`) and
  // `table-duplicate-name` (a <caption> repeating the summary attribute —
  // `best-practice`). An earlier revision here
  // called the first "the one adjacent rule", which the command below refutes
  // — READ ITS OUTPUT, not the sentence above it. Reproduce:
  //   node -e 'const a=require("axe-core");console.log(a.getRules().filter(r=>/identical|duplicate|unique/i.test(r.ruleId)).map(r=>r.ruleId+" ["+r.tags.join(",")+"]").join("\n"))'
  // ★ That listing also returns `duplicate-id-aria` and `frame-title-unique`,
  // which DO carry requested tags — but they are about DOM ids and iframe
  // titles, never two CONTROLS sharing a name, so the conclusion is unchanged.
  // A green Insights axe run is not evidence the names are unique — this is.
  await expect(
    page.getByRole("button", { name: "Dismiss – Milestone at risk", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Dismiss – Milestone at risk (1)", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Dismiss – Milestone at risk (2)", exact: true }),
  ).toHaveCount(1);

  await expect(page.getByText("No insights yet")).toHaveCount(0);
});

test("seeded timelog project links reach the app, not just IndexedDB", async ({ page }) => {
  // §171: the view is gated on `cfg.enabled`, and the default is off, so the
  // integration has to be switched on first or only the not-configured screen
  // renders. With it on, the seeded `timelogLinks` surface as rows: timelog-panel.tsx
  // merges linked-but-unfetched projects into `knownProjectRefs` under their id.
  // The People table renders `sync.users`, which is network-only, so it stays
  // empty here: do NOT extend this test to assert people rows.
  const timelog = await seedTimelogSettings(page);
  await gotoApp(page);
  await openView(page, "Time bookings");

  await expect(page.getByRole("button", { name: "Clear link – 701", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear link – 702", exact: true })).toBeVisible();
  await expect(page.getByText("The Timelog integration is switched off", { exact: false })).toHaveCount(0);
  // ★ The one mount-time call is the seeded customer's project list (see
  // seedTimelogSettings). Waiting for it also proves the stub is wired, so the
  // check below is not vacuous.
  await expect.poll(() => timelog.paths()).toContain("/v1/project/get-all");
  // ★ Nothing fetched bookings or registrations, so the rows are the seeded ones.
  expect(timelog.paths().filter((path) => /time-|timesheet/.test(path))).toEqual([]);
});

test("Time bookings renders the not-configured gate when the integration is off", async ({ page }) => {
  // A switched-off Timelog must not be contacted at all (§171 review: the
  // picker used to load the seeded customer's projects with blank credentials).
  const timelogRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/timelog") timelogRequests.push(request.url());
  });
  await gotoApp(page);
  await openView(page, "Time bookings");

  // The default settings leave Timelog off (`defaultTimelogConfig.enabled` is
  // false), so the seeded rows above must NOT render here: this pins the gate
  // itself, the other half of the pair.
  await expect(page.getByText("The Timelog integration is switched off", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Configure Timelog", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear link – 701", exact: true })).toHaveCount(0);

  // ★ The Clear-all escape hatch is gated on `hasFetched`, which reads the
  // per-device actuals CACHE — a network fetch this run never performs. Its
  // ABSENCE is the assertion: it proves the empty state is the unfetched one,
  // which is what makes the two positives above meaningful.
  await expect(page.getByRole("button", { name: "Clear all", exact: true })).toHaveCount(0);
  // ★ Checked last, after the view has rendered: the call used to go out from
  // the picker's mount effect, which has run by now.
  expect(timelogRequests).toEqual([]);
});

// ★★ The Dashboard's board is the newest instance of this file's whole premise.
// It is in A11Y_VIEWS, but its tiles are GATED — `dashboard-panel.tsx` drops any
// placed tile whose own `spec.gate(gate)` is off (an inline filter, no shared
// helper), and several gates read seeded workspace data. A board that renders
// ONE tile, or none, still scans green: there would be no per-tile controls left
// for axe to look at, and the six Dashboard scans would report an improvement.
//
// ★ Asserts a FLOOR, not the exact tile count. The tiles that render today are
// kpi · topActions · insights · raid · upcoming · burn · milestones · changes
// (`trends` is Turso-gated off and `completionTrend` needs trend data), but that
// set moves with the seed and with the catalogue. Two is the number
// that matters — one tile cannot exercise a per-tile control's row-uniqueness at
// all. Re-measure rather than trusting this parenthesis:
//   page.locator('[data-testid^="tile-"]').count()
//
// ★★ The exact names below are the row-QUALIFIED ones. axe cannot see two
// controls sharing an accessible name at any seed size (see the insights test
// above), so this does not gate the collision — `dashboard-tile.test.tsx` does.
// What it gates is that the controls exist AND carry their tile's title, which is
// what makes the axe pass mean anything.
test("the seeded dashboard renders a populated board, not an empty one", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Dashboard");

  const grid = page.getByTestId("dashboard-grid");
  const tiles = grid.locator('[data-testid^="tile-"]');
  const tileCount = await tiles.count();
  expect(tileCount, "the seeded Dashboard board must render at least two tiles").toBeGreaterThanOrEqual(2);

  // Every rendered tile carries its own grip — so the count above is a count of
  // ARRANGEABLE tiles, not of sections that merely look like them.
  // ★★ §425: "Drag to reorder" (`reorderHandleDragOnly`), NOT "Drag or use
  // arrow keys to reorder". This panel passes `keyboard: false` to
  // `useListReorderDnd`, so its grips carry no `onKeyDown` and the arrow-key
  // wording promised a key that does nothing.
  // ★ Still scoped to the grid, and MORE necessary than before: Reports now
  // names its grips with this same key, so the two surfaces share the string
  // where they used to share `reorderHandle`. (`roles-editor.tsx` keeps
  // `reorderHandle` — its grips really do take arrow keys.) Neither other
  // surface is on this view today, but the scope is what keeps that true.
  // ★★ Playwright's `name` defaults to `exact: false` — a case-insensitive
  // SUBSTRING — and that cuts the RIGHT way here: "Drag or use arrow keys to
  // reorder" does NOT contain "Drag to reorder", so a tile left on the old
  // name is not matched and the count comes up SHORT rather than passing.
  // The per-title assertions below pass `exact: true` and pin the whole string.
  await expect(
    grid.getByRole("button", { name: "Drag to reorder" }),
  ).toHaveCount(tileCount);

  // The UNGATED catalogue tiles (`gate: ALWAYS` in DASHBOARD_TILES) — these render
  // for every project, so naming them cannot go stale with the seed's data.
  for (const title of ["At a glance", "Upcoming & overdue"]) {
    await expect(page.getByRole("region", { name: title, exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Drag to reorder – ${title}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `More actions – ${title}`, exact: true }),
    ).toBeVisible();
  }
});

// ★★ §557: seed-workspace.ts authors a `budgetHistory` slice (a baseline plus three
// changes) so the Reports budget block renders its history surfaces in the
// browser. Which run sees what:
//   change table + split rows → this test, the Reports axe scans (default
//     burn-down orientation) and visual.spec.ts's budget-report snapshot;
//   stepped line + markers    → this test (the chart's name), the cumulative
//     Reports scan in a11y.spec.ts and the same snapshot, which switches to
//     the cumulative orientation first.
// The Dashboard burn tile is compact (no table) and burn-down (no steps), so
// no Dashboard run shows either. Before this seed, no Playwright run drew any
// of them.
// ★ The table is found by its <caption>, which is its accessible name and
// carries the unit — "Budget changes (€)" while the chart unit is the default
// `eur` (`budgetChartUnit ?? "eur"` in burndown-chart-panel.tsx). The baseline
// is not a change, so three seeded changes mean exactly three body rows.
// ★ The chart's in-plot markers are `aria-hidden`; they reach assistive tech
// only through the chart's own `role="img"` name
// ("… Budget changes: <date> <amount> <bucket>; …"), so that name is the stable
// hook. The deleted bucket's marker must read "<amount> Pilot Workshop removed".
// ★★ The stepped line and its markers are drawn in the CUMULATIVE orientation
// only (`buildChartModel` skips `bacFields` when orientation is "burndown", the
// default), so the spec switches orientation first. Measured: in the default
// orientation the name carries no "Budget changes:" sentence at all.
// ★ `tourSeen` is seeded because the orientation switch is a real pointer
// click, and the auto-launched guided tour's backdrop intercepts it (measured:
// the click timed out on "Welcome to the PM Tracker"). Same fix as
// control-defects-eye-verify.spec.ts.
test("seeded budget history reaches the Reports change table and chart", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await gotoApp(page);
  await openView(page, "Reports");

  const table = page.getByRole("table", { name: "Budget changes (€)", exact: true });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody").getByRole("row");
  await expect(rows).toHaveCount(3);
  // Each seeded bucket, in date order — a partial or reordered seed fails here.
  await expect(rows.nth(0)).toContainText("Capped SOW (rate override)");
  await expect(rows.nth(1)).toContainText("Data Migration (fixed price)");
  await expect(rows.nth(2)).toContainText("Pilot Workshop");
  await expect(rows.nth(2)).toContainText("removed");
  // The variance split footer. `BudgetChangeTable` renders all three split
  // rows whenever a pace split exists, whatever their values, so the header
  // alone proves nothing about the seed. The seeded final BAC differs from
  // today's, so the unexplained figure must not be a zero: `signedFigure`
  // prefixes "+" only to a positive value, and a zero renders as a bare "€0".
  const unexplained = table.getByRole("row", { name: /^Unexplained budget change/ });
  await expect(unexplained).toHaveCount(1);
  // The positive half first, so an empty or unformatted cell cannot pass the
  // negative half vacuously.
  await expect(unexplained.getByRole("cell")).toHaveText(/€\d/);
  await expect(unexplained.getByRole("cell")).not.toHaveText(/^[+\-−]?€0(?:\.0+)?$/);

  await page
    .getByRole("radiogroup", { name: "Chart orientation", exact: true })
    .getByRole("radio", { name: "Cumulative", exact: true })
    .click();
  // One marker per seeded month, joined by "; " — three separate markers, in date order.
  const chart = page.getByRole("img", {
    name: /Budget changes: [^;]*Capped SOW \(rate override\); [^;]*Data Migration \(fixed price\); [^;]*Pilot Workshop removed\./,
  });
  await expect(chart).toHaveCount(1);
});
