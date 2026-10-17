import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, waitForViewSettled } from "./seed";
import { RELEASE_HIDDEN_VIEWS } from "../src/app/feature-modules";

// Accessibility scan of the Forecast view's Scenarios mode (§502, saved scenarios): the editor with one row of
// each kind, then the comparison it produces. Same tags and the same blocking rule as `a11y.spec.ts`.
// ★★ Skipped while "forecast" sits in RELEASE_HIDDEN_VIEWS: a held-back view cannot be routed to. Nobody has run
// this spec yet; its first run is owed when the view is un-hidden (docs/AGENTS/forecast.md "Saved scenarios").

async function scanBlocking(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n");
  expect(blocking, `${label} a11y violations:\n${summary}`).toEqual([]);
}

test.describe("Forecast scenarios a11y", () => {
  test.skip(RELEASE_HIDDEN_VIEWS.includes("forecast"), "the Forecast view is held back from the release");

  test("a11y: Forecast — Scenarios editor and comparison", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => { window.location.hash = "#forecast"; });
    await waitForViewSettled(page);
    await expect(page.getByRole("heading", { name: "Forecast", level: 1, exact: true })).toBeVisible();

    // The seed's completions fall mostly outside the default window; "All history" gives a forecast state.
    await page.getByRole("combobox", { name: "History", exact: true }).selectOption("all");
    await expect(page.locator("#panel-forecast svg[role=img]")).toBeVisible();

    await page.getByRole("radio", { name: "Scenarios", exact: true }).click();
    await page.getByRole("button", { name: "New scenario", exact: true }).click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Axe check");
    await editor.getByRole("button", { name: "+ Availability change", exact: true }).click();
    await editor.getByRole("button", { name: "+ Add people", exact: true }).click();
    await editor.getByRole("button", { name: "+ Scope change", exact: true }).click();
    // Row 2 is the Add-people row: a placeholder needs no directory person.
    await editor.getByRole("combobox", { name: "Change 2: Who", exact: true }).selectOption("placeholder");
    await editor.getByRole("textbox", { name: "Change 2: Label", exact: true }).fill("Contractor");

    await scanBlocking(page, "Scenarios editor");

    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "Axe check", exact: true })).toBeVisible();

    await scanBlocking(page, "Scenarios comparison");
  });
});
