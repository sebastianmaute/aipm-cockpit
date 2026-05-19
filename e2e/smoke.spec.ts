import { test, expect } from "@playwright/test";

test.describe("app smoke", () => {
  test("home page loads with expected title and main region", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/List of Open Points Tracker/);
    await expect(page.locator("main")).toBeVisible();
  });
});
