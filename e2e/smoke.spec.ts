import { test, expect } from "@playwright/test";

test.describe("app smoke", () => {
  test("home page loads with the title and project empty-state", async ({
    page,
  }) => {
    // Unseeded (no project in the registry) the app opens on the empty-state
    // create/load dialog — there is no <main> landmark on this screen (it's a
    // forced modal). The seeded app + its <main> are covered by app.spec.ts.
    await page.goto("/");
    await expect(page).toHaveTitle(/AI PM Cockpit/);
    await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();
  });
});
