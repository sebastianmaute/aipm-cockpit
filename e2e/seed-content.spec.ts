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
// ★ SCOPED AS THE SEED'S GUARD, not the Documents view's. BrowserBackend
// persists NINE optional kv slices and the seed currently carries one of them;
// as the rest are seeded (docs/open-followups.md §99) they extend THIS file
// rather than adding a spec each.
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
