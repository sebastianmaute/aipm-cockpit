import { test, expect } from "./seed";

test("a cold item deep link lands on the item's view and keeps the id in the URL", async ({ page }) => {
  await page.goto("/#raid/1");
  // Modern layout has no role="tab" primary nav — the sidebar renders plain
  // buttons and marks the active one with aria-current="page" (sidebar-nav.tsx).
  await expect(page.getByRole("button", { name: "RAID", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The deep-linked item's own editor is open, confirming the id routed too.
  await expect(page.getByRole("dialog", { name: "Editing RAID #1", exact: true })).toBeVisible();
  // Retrying, not a one-shot snapshot: this is the ONE assertion carrying the
  // §535 claim (the passive view→hash effect must not rewrite `/1` away while
  // `activeTab` catches up), and the write it guards can land a tick after the
  // editor becomes visible. A bare `expect(page.url())` reads once and would
  // fail on timing rather than on the defect.
  await expect.poll(() => page.url()).toContain("#raid/1");
});

test("a page loaded in the classic layout is not routed by a stale hash", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout: "classic" }));
  });
  await page.goto("/#budget");

  // Positive proof the classic layout genuinely took effect (not merely that
  // nothing routed): only the classic shell has a heading literally named
  // "AI PM Cockpit" — modern's top-bar h1 is always the current view's name,
  // and modern's own "AI PM Cockpit" text is an <img> alt, not a heading. A
  // silently-ignored settings write (shallow merge, wrong shape) would leave
  // this false.
  await expect(
    page.getByRole("heading", { name: "AI PM Cockpit", level: 1, exact: true }),
  ).toBeVisible();

  // Positive proof of WHERE the user landed: this copy only renders inside
  // the Dashboard tabpanel (dashboard-delta-strip.tsx), which is
  // conditionally mounted on activeTab === "dashboard" — it does not exist in
  // the DOM at all on any other view, including Budget.
  await expect(page.getByText("Welcome — here's your project at a glance.")).toBeVisible();

  // Supplementary: the workspace tab strip (classic-only — modern renders
  // WorkspaceSection with fullBleed and never shows it at all) carries a
  // Budget tab, and it is not the selected one.
  const budgetTab = page.getByRole("tab", { name: "Budget", exact: true });
  await expect(budgetTab).toHaveAttribute("aria-selected", "false");

  // The core witness: classic disables useHashView entirely
  // (`hydrated && layout === "modern"`), so the hash itself must be left
  // exactly as loaded. Before the fix, the pre-hydration cold apply ran once
  // against default (modern) settings and silently rewrote it to "#dashboard".
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#budget");
});

// §540 (the repeated-resource-deep-link draft guard in
// use-resource-directory.ts's handleEditResource) is deliberately NOT
// witnessed here. A version of this test navigated to "/#resources/1" twice
// and asserted the in-progress "First name" draft survived. Run live against
// the reverted guard it came back GREEN: ResourceEditModal resets its draft
// on the INNER `resource` object's reference identity, but the guard only
// bails the WRAPPER `{resource, isNew}` — and this test's own repeat never
// changes the inner reference either way, because `resources` is a plain
// useState array nothing here ever replaces, so `resources.find(...)` hands
// back the SAME object on both navigations regardless of the guard. The
// assertion was true in both arms for a reason unconnected to the defect.
// Redesigning it would need a genuine concurrent write between the two
// opens (a second writer replacing the stored row) — exactly what §540
// protects against, but staging that in Playwright means a second tab or an
// AI tool call, far more machinery than this coverage is worth. §540 is
// already pinned at the unit level in resource-directory.test.tsx (33 tests,
// including a mutation-verified `{ ...prev }` case a call-count assertion
// alone would have missed). Do not re-add an e2e repeat-deep-link test for
// this guard without first proving it can fail — see docs/open-followups.md
// §535/§536/§540 history for how this one was caught.
