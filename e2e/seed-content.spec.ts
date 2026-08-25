// src/../e2e/seed-content.spec.ts — does the seeded workspace actually REACH
// the running app?
//
// ★★★ THIS GUARDS A SILENT, SELF-CONCEALING REGRESSION. `e2e/seed.ts` writes the
// sample workspace into IndexedDB from two HARDCODED lists (entity stores + a kv
// map). A slice missing from them is dropped without a word, the view renders its
// EMPTY STATE, and the axe gate then scans a panel with no rows and no per-row
// controls — green, over nothing.
//
// ★★ "and nothing that could collide" used to be part of that sentence. Dropped
// 2026-08-08: axe has NO rule for two controls sharing an accessible name (see
// the insights test below), so a duplicate name is invisible to the gate whether
// the rows render or not. Seeding rows buys real coverage of everything else axe
// DOES check, plus assertions like the one below that axe cannot make.
//
// ★★★ THE FAILURE PRESENTS AS PROGRESS, which is why a guard is worth an e2e
// slot. Drop `documents` from the kv map today and all five Documents axe scans
// go GREEN — because the violation they currently protect lives in the preview
// pane, which stops existing once there is nothing to preview. The gate would
// report an improvement while coverage silently vanished. This spec turns that
// into a loud, named failure.
//
// ★ SCOPED AS THE SEED'S GUARD, not any one view's. BrowserBackend persists TEN
// optional kv slices and the seed carries four of them; as the rest are seeded
// (docs/open-followups.md §99) they extend THIS file rather than adding a spec
// each.
//
// ★ Asserts CONTENT, never "the seed ran". A seed that runs and writes nothing
// is exactly the bug.

import { test, expect, gotoApp, openView } from "./seed";

test("seeded documents reach the app, not just IndexedDB", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Documents");

  // Both titles: one from the sample master, one appended in seed.ts. Naming
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

// ★★ INSIGHTS ONLY — and this comment named Time bookings alongside it until
// 0.245.0. Both were in A11Y_VIEWS and both were scanned against their empty
// state until 2026-08-08, because neither slice exists in the sample master AND
// neither was in the seed's kv map. Authoring them in seed.ts fixed both; the
// `cfg.enabled` gate then put Time bookings BACK on its empty state (§171), so
// only Insights still has rows under the scan. This spec is what keeps that
// true: without it, dropping the `insights` kv row turns those axe scans green
// again by deleting the rows they are supposed to be checking.
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
    ["Milestone at risk", 2, "day(s) overdue"],
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

test("Time bookings renders the not-configured gate, so its tables reach NO e2e assertion", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Time bookings");

  // ★★★ THIS TEST IS THE INVERSE OF THE ONE IT REPLACES, AND THE FLIP IS THE
  // POINT. It used to assert `Clear link – 701`/`– 702`, because the seeded
  // `timelogLinks` kv key surfaced as real rows: timelog-panel.tsx merges
  // linked-but-unfetched projects into `knownProjectRefs` under a synthetic
  // name. 0.245.0 gated the whole view on `cfg.enabled` (timelog-panel.tsx,
  // `TimelogNotConfigured`), and NOTHING in e2e/seed.ts seeds timelog SETTINGS
  // — so `defaultTimelogConfig.enabled` (false) stands and those rows can no
  // longer render at all. The old assertion did not go stale gradually; it
  // became unsatisfiable in one commit, and only CI said so.
  // ★★★ SO THE PROJECTS AND PEOPLE TABLES NOW HAVE NO e2e COVERAGE OF ANY KIND
  // — not this spec, and not the axe scan either (Time bookings is in
  // A11Y_VIEWS, and what it scans is the empty state below). Their row-unique
  // control names survive ONLY in `timelog-panel.test.tsx`, which pins
  // `${timelogMatchClear} – 99` in two places. Recorded as open-followups §171
  // WITH the two ways out; seeding the settings is the one that would restore
  // both this assertion and the scan in a single change.
  // ★★ Do NOT "restore" the old lines without doing that seeding first — they
  // cannot pass, and a red run here means the gate is working.
  await expect(page.getByText("The Timelog integration is switched off", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Configure Timelog", exact: true })).toBeVisible();

  // ★ The Clear-all escape hatch is gated on `hasFetched`, which reads the
  // per-device actuals CACHE — a network fetch this run never performs. Its
  // ABSENCE is the assertion: it proves the empty state is the unfetched one,
  // which is what makes the two positives above meaningful.
  await expect(page.getByRole("button", { name: "Clear all", exact: true })).toHaveCount(0);
});

// ★★ The Dashboard's board is the newest instance of this file's whole premise.
// It is in A11Y_VIEWS, but its tiles are GATED — `dashboard-panel.tsx` drops any
// placed tile whose own `spec.gate(gate)` is off (an inline filter, no shared
// helper), and several gates read seeded workspace data. A board that renders
// ONE tile, or none, still scans green: there would be no per-tile controls left
// for axe to look at, and the six Dashboard scans would report an improvement.
//
// ★ Asserts a FLOOR, not the exact tile count. Nine tiles render today
// (kpi · topActions · insights · raid · upcoming · progress · burn · milestones ·
// changes; `trends` is Turso-gated off and `completionTrend` needs trend data),
// but that number moves with the seed and with the catalogue. Two is the number
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
  // ★ Scoped to the grid on purpose: `reorderHandle` also labels grips in
  // reports.tsx and roles-editor.tsx, neither of which is on this view today.
  await expect(
    grid.getByRole("button", { name: "Drag or use arrow keys to reorder" }),
  ).toHaveCount(tileCount);

  // Three UNGATED catalogue tiles — these render for every project, so naming
  // them cannot go stale with the seed's data.
  for (const title of ["At a glance", "Progress", "Upcoming & overdue"]) {
    await expect(page.getByRole("region", { name: title, exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Drag or use arrow keys to reorder – ${title}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `More actions – ${title}`, exact: true }),
    ).toBeVisible();
  }
});
