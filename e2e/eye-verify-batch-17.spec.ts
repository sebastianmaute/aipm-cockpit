import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import { HARBOR_DARK } from "../src/app/builtin-schemes";
import { resolveSchemeColors } from "../src/app/scheme-tokens";

// The eye-verify KIT for batch 17 (docs/eye-verify-batch-17.md). It covers what the
// batch 16 kit left as "by hand" but a seeded browser CAN reach: the dark-scheme
// shots, the task editor with its RAID mini-form open, the AI Assistant composer,
// and a branded Word file to open in Word. Like batch 16 it asserts nothing about
// how a surface LOOKS; it opens each one and saves the evidence to
// eye-verify-output/batch-17/ (git-ignored).
//
// ★ OFF unless EYE_VERIFY=1, so CI's e2e job skips it. Run it alone:
//   EYE_VERIFY=1 npx playwright test e2e/eye-verify-batch-17.spec.ts --project=chromium --workers=1
// ★ Each test asserts that it REACHED its surface, because a screenshot of the
//   wrong view looks like evidence.

const OUT = "eye-verify-output/batch-17";

test.skip(!process.env.EYE_VERIFY, "eye-verify kit: set EYE_VERIFY=1 to run it");

// The app's own icon, so the Word header gets a real PNG to place and size.
const LOGO = `data:image/png;base64,${readFileSync("public/logo_256.png").toString("base64")}`;

async function open(page: Page, opts: { settings?: Record<string, unknown>; dark?: boolean } = {}): Promise<void> {
  if (opts.dark) await page.emulateMedia({ colorScheme: "dark" });
  // tourSeen: the guided tour's backdrop would otherwise sit on top of every shot.
  await page.addInitScript(
    ({ s, dark }) => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true, ...s }));
      if (!dark) return;
      // The default scheme is light-only and pins light whatever the theme says, so a
      // dark shot needs a dark-capable built-in. Same keys e2e/a11y.spec.ts seeds:
      // the boot script reads the first four, use-style re-resolves from the store.
      localStorage.setItem("aipm-cockpit-style", "custom");
      localStorage.setItem("aipm-cockpit-theme", "dark");
      localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");
      localStorage.setItem("aipm-cockpit-active-scheme-colors", JSON.stringify(dark));
      localStorage.setItem("aipm-cockpit-active-scheme-structural", "{}");
      localStorage.setItem("aipm-cockpit:color-schemes", JSON.stringify({ schemes: [], activeId: "harbor" }));
    },
    { s: opts.settings ?? {}, dark: opts.dark ? resolveSchemeColors(HARBOR_DARK) : null },
  );
  await gotoApp(page);
  if (opts.dark) await expect(page.locator("html")).toHaveClass(/\bdark\b/);
}

async function shoot(page: Page, name: string): Promise<void> {
  await waitForViewSettled(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test.describe("eye-verify kit, batch 17", () => {
  test("§59 Settings → Integrations in the dark scheme", async ({ page }) => {
    await open(page, { dark: true });
    await openView(page, "Settings");
    await page.getByRole("button", { name: "Integrations", exact: true }).first().click();
    await page.getByRole("checkbox", { name: /Microsoft 365 integration/ }).check();
    await page.getByRole("button", { name: "I understand", exact: true }).click();
    await page.getByRole("button", { name: /Add to Outlook/ }).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shoot(page, "01-settings-integrations-dark");
  });

  // ★ Batch 16 shot the Stakeholders REGISTER for this item (its 09); the quadrant
  // labels live in the Stakeholder Report card, so these two replace that shot.
  for (const dark of [false, true]) {
    test(`§41 Reports → Stakeholder Report, ${dark ? "dark" : "light"} scheme: quadrant labels and chips`, async ({ page }) => {
      await open(page, { dark });
      await openView(page, "Reports");
      // The card is not in the default arrangement; add it the way a user would.
      await page.getByRole("combobox", { name: "Add report", exact: true }).selectOption({ label: "Stakeholder Report" });
      const quadrant = page.locator("main").getByText("Manage Closely", { exact: true }).first();
      await quadrant.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shoot(page, `02-stakeholder-quadrants-${dark ? "dark" : "light"}`);
    });
  }

  test("§41 the task editor with the create-RAID mini-form open", async ({ page }) => {
    await open(page);
    await openView(page, "Open Points");
    // Task #3, not the first row: #1 is Jira-synced, and its editor is read-only.
    // The row control is named "#<id> — click to edit" (task-row.tsx).
    await page.getByRole("button", { name: /^#3 — click to edit/ }).first().click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    const createRaid = dialog.getByRole("button", { name: "+ Create RAID", exact: true });
    await createRaid.scrollIntoViewIfNeeded();
    await createRaid.click();
    await shoot(page, "03-task-editor-raid-open");
  });

  test("§41 AI Assistant: the attach and dictate buttons", async ({ page }) => {
    // Consent only, no key: the composer renders, and nothing is sent anywhere.
    await open(page, { settings: { ai: { consentAccepted: true } } });
    await openView(page, "AI Assistant");
    await expect(page.getByRole("button", { name: "Attach documents", exact: true })).toBeVisible();
    await shoot(page, "04-ai-assistant-composer");
  });

  test("§512 a branded Word export to open in Word", async ({ page }) => {
    await open(page, { settings: { branding: { logo: LOGO } } });
    await page.getByRole("button", { name: "Export tasks", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Export tasks", exact: true });
    await expect(menu).toBeVisible();
    const pending = page.waitForEvent("download");
    await menu.getByText("Word (.docx)", { exact: true }).click();
    const file = await pending;
    await file.saveAs(`${OUT}/05-branded-export.docx`);
  });
});
