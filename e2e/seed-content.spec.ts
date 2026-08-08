// src/../e2e/seed-content.spec.ts — does the seeded workspace actually REACH
// the running app?
//
// ★★★ THIS GUARDS A SILENT, SELF-CONCEALING REGRESSION. `e2e/seed.ts` writes the
// sample workspace into IndexedDB from two HARDCODED lists (entity stores + a kv
// map). A slice missing from them is dropped without a word, the view renders its
// EMPTY STATE, and the axe gate then scans a panel with no rows, no per-row
// controls and nothing that could collide — green, over nothing.
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

  // All three, named individually — a partial seed must fail as loudly as a
  // missing one. The titles are rendered from `type` (insight-text.ts), never
  // stored, so these also pin that the seeded types are the real union members.
  // ★ Scoped to the ROW, not `getByText`: the type filter's <select> carries an
  // <option> with the identical label for every insight type, so the bare text
  // locator resolves to two elements and dies on strict mode — and the option
  // exists whether or not a single insight was seeded, which is the opposite of
  // what this spec is for. Measured, not guessed: that is how it failed first run.
  for (const title of ["Milestone at risk", "Work is stalling", "Budget off plan"]) {
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(1);
  }

  // ★ THE COLLISION IS THE POINT. Three rows means three "Dismiss – <title>"
  // controls, which is the only condition under which axe could ever see a
  // WCAG 2.4.6 duplicate-name failure here; with one row the gate is green
  // whatever the labels say. Asserting the COUNT pins that condition, not just
  // that some row exists.
  await expect(page.getByRole("button", { name: /^Dismiss – / })).toHaveCount(3);

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
