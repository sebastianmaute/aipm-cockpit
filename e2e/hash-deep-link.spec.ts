import { test, expect, gotoApp } from "./seed";

test("a cold item deep link lands on the item's view and keeps the id in the URL", async ({ page }) => {
  await page.goto("/#raid/1");
  // Modern layout has no role="tab" primary nav — the sidebar renders plain
  // buttons and marks the active one with aria-current="page" (sidebar-nav.tsx).
  await expect(page.getByRole("button", { name: "RAID", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The deep-linked item's own editor is open, confirming the id routed too.
  await expect(page.getByRole("dialog", { name: "Editing RAID #1" })).toBeVisible();
  expect(page.url()).toContain("#raid/1");
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
  await expect(page.getByRole("heading", { name: "AI PM Cockpit", level: 1 })).toBeVisible();

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

test("repeating a resource deep link keeps an in-progress draft", async ({ page }) => {
  await gotoApp(page);
  await page.goto("/#resources/1");

  const firstName = page.getByRole("textbox", { name: "First name", exact: true });
  await firstName.fill("Draft-Only-Text");

  await page.goto("/#resources/1"); // repeat the same deep link

  await expect(firstName).toHaveValue("Draft-Only-Text");
});
