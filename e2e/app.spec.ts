import { test, expect, gotoApp, openView, PRIMARY_VIEWS } from "./seed";

test.describe("seeded app", () => {
  test("boots into the main UI, not the empty-state", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByText("No projects yet")).toHaveCount(0);
  });

  test("navigates every primary view without console or page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await gotoApp(page);

    for (const name of PRIMARY_VIEWS) {
      await openView(page, name);
      // The view's content region stays mounted across navigation.
      await expect(page.locator("main").first()).toBeVisible();
    }

    expect(errors, `runtime errors during navigation:\n${errors.join("\n")}`).toEqual([]);
  });
});
