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

// ★★ Insights and Time bookings are BOTH in A11Y_VIEWS and both were scanned
// against their empty state until 2026-08-08, because neither slice exists in
// the sample master AND neither was in the seed's kv map. They are authored in
// seed.ts now, so the scans finally see rows — and this spec is what keeps that
// true. Without it, dropping either kv row turns five axe scans green again by
// deleting the rows they are supposed to be checking.
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

  // ★★★ CHARACTERIZATION OF A KNOWN-OPEN DEFECT — docs/open-followups.md §126.
  // READ THIS BEFORE "FIXING" A RED RUN ON THE NEXT LINE. It pins the BUG, not the
  // wanted behaviour: both `milestoneSlip` rows render a button whose accessible
  // name is exactly "Dismiss – Milestone at risk", because insightTitle() is
  // derived from `type` alone. Two controls, same name, different targets — a
  // WCAG 2.4.6 failure, now REACHABLE at scan time instead of theoretical.
  // ★★★ WHOEVER CLOSES §126 MUST FLIP THIS ASSERTION, and a red line here after
  // that fix is the fix WORKING. The flip: once the per-row name is qualified
  // (e.g. "Dismiss – Milestone at risk – Design Sign-off"), change the expected
  // count below from 2 to 0 and add positive assertions for the two now-distinct
  // names. Do NOT relax it to a range and do NOT delete it.
  // ★★ Keep it either way, because it is the ONLY detector in the repo: axe-core
  // 4.12.1 has no rule for two BUTTONS sharing an accessible name, and the one
  // adjacent rule (`identical-links-same-purpose`) is links-only and `wcag2aaa`,
  // a tag e2e/a11y.spec.ts does not request. A green Insights axe run is not
  // evidence the names are unique — this line is.
  const DUPLICATE_DISMISS_NAME_IS_A_KNOWN_DEFECT = 2; // §126 fix ⇒ 0
  await expect(
    page.getByRole("button", { name: "Dismiss – Milestone at risk", exact: true }),
  ).toHaveCount(DUPLICATE_DISMISS_NAME_IS_A_KNOWN_DEFECT);

  await expect(page.getByText("No insights yet")).toHaveCount(0);
});

test("seeded timelog project links reach the app, not just IndexedDB", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Time bookings");

  // ★ Only the PROJECT links surface without a network fetch: timelog-panel.tsx
  // merges linked-but-unfetched projects into `knownProjectRefs` under a
  // synthetic name (the id), so 701/702 render as real rows with row-qualified
  // controls. The People table renders `sync.users`, which is network-only, so
  // it stays empty here — do NOT extend this test to assert people rows.
  await expect(page.getByRole("button", { name: "Clear link – 701", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear link – 702", exact: true })).toBeVisible();
});
