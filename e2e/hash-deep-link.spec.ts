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

  // Classic disables useHashView entirely (`hydrated && layout === "modern"`).
  // Wait for the workspace tab strip to mount (proof hydration settled) and
  // confirm it never routed to Budget, then confirm the hash itself was left
  // untouched — before the fix, the pre-hydration cold apply ran once against
  // default (modern) settings and silently rewrote it to "#dashboard".
  const budgetTab = page.getByRole("tab", { name: "Budget", exact: true });
  await expect(budgetTab).toBeVisible();
  await expect(budgetTab).toHaveAttribute("aria-selected", "false");
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
