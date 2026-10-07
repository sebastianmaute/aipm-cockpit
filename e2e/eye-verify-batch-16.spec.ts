import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

// The eye-verify KIT for batch 16 (docs/eye-verify-batch-16.md). It asserts
// nothing about how a surface LOOKS — no test can — it opens each surface the
// owner owes a look at, in the state the register entry names, and saves a
// full-page screenshot to eye-verify-output/batch-16/ (git-ignored). The owner reads
// the screenshots against the checklist instead of finding each surface by hand.
//
// ★ OFF unless EYE_VERIFY=1, so CI's e2e job skips it. Run it alone:
//   EYE_VERIFY=1 npx playwright test e2e/eye-verify-batch-16.spec.ts --project=chromium --workers=1
// ★ Each test does assert that it REACHED its surface (a heading, a tab, a
//   dialog). A screenshot of the wrong view is worse than none, because it
//   looks like evidence.

// Not test-results/: Playwright empties that folder at the start of every run.
const OUT = "eye-verify-output/batch-16";

test.skip(!process.env.EYE_VERIFY, "eye-verify kit: set EYE_VERIFY=1 to run it");

async function open(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  // tourSeen: the guided tour's backdrop would otherwise sit on top of every shot.
  await page.addInitScript((s) => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true, ...s }));
  }, settings);
  await gotoApp(page);
}

async function shoot(page: Page, name: string): Promise<void> {
  await waitForViewSettled(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test.describe("eye-verify kit, batch 16", () => {
  test("§677 Reports: the By priority block at its default height", async ({ page }) => {
    await open(page);
    await openView(page, "Reports");
    await expect(page.locator("main").getByText(/priority/i).first()).toBeVisible();
    await shoot(page, "01-reports-by-priority");
  });

  test("§102 Resources calendar: the chevron stepper and the Today button", async ({ page }) => {
    await open(page);
    await openView(page, "Resources");
    await openView(page, "Calendar");
    await expect(page.getByRole("button", { name: "Previous", exact: false }).first()).toBeVisible();
    await shoot(page, "02-resources-calendar-stepper");
  });

  test("§59 Settings → Integrations: the two stacked calendar toggles and the disabled row", async ({ page }) => {
    await open(page);
    await openView(page, "Settings");
    await page.getByRole("button", { name: "Integrations", exact: true }).first().click();
    // The calendar toggles render only with Microsoft 365 on. Ticking it here changes this
    // throwaway browser profile only; nothing is signed in.
    await page.getByRole("checkbox", { name: /Microsoft 365 integration/ }).check();
    // Turning an integration on first shows the credentials disclaimer.
    await page.getByRole("button", { name: "I understand", exact: true }).click();
    // The settings pane scrolls on its own, so a full-page shot does not reach the toggles: centre them.
    await page.getByRole("button", { name: /Add to Outlook/ }).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shoot(page, "03-settings-integrations");
  });

  test("§102 Settings → Diagnostics: the four action buttons", async ({ page }) => {
    await open(page, { expertMode: true });
    await openView(page, "Settings");
    await page.getByRole("button", { name: "Diagnostics", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
    await shoot(page, "04-settings-diagnostics");
  });

  test("§102 the Help menu toggle in the header, opened", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Help", exact: true }).first().click();
    await shoot(page, "05-help-menu-open");
  });

  test("§21 the Change editor, opened from a row", async ({ page }) => {
    await open(page);
    await openView(page, "Changes");
    // The first cell holds the row checkbox and stops the click; open from the title cell.
    // :visible because the RAID panel stays mounted (hidden) on every tab, rows and all.
    await page.locator("tr[data-deeplink-row]:visible").first().locator("td").nth(2).click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await shoot(page, "06-change-editor");
  });

  test("§21 the Milestone editor, opened from a row", async ({ page }) => {
    await open(page);
    await openView(page, "Milestones");
    // The milestone name is a button in its row (milestones-panel.tsx); a row click opens nothing.
    await page.locator("main table button.text-left").first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await shoot(page, "07-milestone-editor");
  });

  test("§41 the task editor: create-RAID and new-linked-task on one row", async ({ page }) => {
    await open(page);
    await openView(page, "Open Points");
    // Task #3, not the first row: #1 is Jira-synced and read-only. Scroll the
    // two buttons into the frame — they sit below the fields (eye check, batch 17).
    await page.getByRole("button", { name: /^#3 — click to edit/ }).first().click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "+ New linked task", exact: true }).scrollIntoViewIfNeeded();
    await shoot(page, "08-task-editor");
  });

  test("§41 Stakeholders: the quadrant labels and chips", async ({ page }) => {
    await open(page);
    await openView(page, "Stakeholders");
    await shoot(page, "09-stakeholders");
  });
});
