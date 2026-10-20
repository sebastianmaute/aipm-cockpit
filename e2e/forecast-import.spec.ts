// §718 — the forecast import modal under axe, in a real browser. The Budget view is in the a11y gate's
// `A11Y_VIEWS`, but that scan never opens the modal, and the unit suite never runs axe, so a contrast or
// labelling failure in the modal reached no gate. This opens it from the first bucket card, scans the source
// step, then reads a small CSV and scans the preview it shows.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, skipTour, waitForViewSettled } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { t } from "../src/app/i18n";

async function expectNoBlockingViolations(page: Page, step: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include("[role='dialog']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n");
  expect(blocking, `forecast import (${step}) a11y violations:\n${summary}`).toEqual([]);
}

test("the forecast import modal passes axe on its source step and after reading a sheet", async ({ page }) => {
  await skipTour(page);
  await gotoApp(page);
  await openView(page, "Budget");
  await waitForViewSettled(page);

  // The first bucket card's trigger; its name carries the bucket's row token.
  await page.getByRole("button", { name: new RegExp(`^${t("en-US", "forecastImportOpen").replace("…", "\\u2026")}`) }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoBlockingViolations(page, "source");

  // A wide sheet naming the seed's first resource: detection reads it, so the modal moves on from the source step.
  const resources = (SEED_WORKSPACE as { resources?: { firstName: string; lastName: string }[] }).resources ?? [];
  const person = resources[0] ? `${resources[0].firstName} ${resources[0].lastName}` : "Ann Lee";
  const csv = `Name,Jan 2026,Feb 2026,Mar 2026\r\n${person},10,20,30\r\n`;
  await dialog.getByLabel(t("en-US", "forecastImportFile")).setInputFiles({ name: "forecast.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  // Reading a sheet adds the column controls and the preview below the file field, which stays.
  await expect(dialog.getByRole("button", { name: t("en-US", "forecastImportEditColumns"), exact: true })).toBeVisible({ timeout: 15_000 });
  await expectNoBlockingViolations(page, "after reading a sheet");
});
