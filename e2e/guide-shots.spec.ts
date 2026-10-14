import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoApp, openView, skipTour, waitForViewSettled, FROZEN_NOW } from "./seed";
import { DEMO_BANNER_DONE_KEY } from "../src/app/demo-banner-state";
import { IDB_DB_NAME, IDB_ENTITY_STORES } from "../src/app/idb-layout";
import { splashMessages, splashScript } from "../desktop/src/lib/splash-status";
import { clearCallouts, markCallout } from "./guide-callouts";

// The install guide's screenshots (docs/assets/guide/) and the README gallery
// (docs/assets/*.png), §713. Run with `npm run docs:guide-shots` — the
// `guide-shots` project in playwright.config.ts, which pins the timezone,
// locale, colour scheme, motion and viewport, and boots its server with the
// deployment variables blanked. Never in CI and never a pixel gate: it WRITES
// the pictures, and a person reviews the PNG diff by eye.
//
// ★ It never reads the environment and never writes `*.manual.png` (the two
//   hand-captured shots) or `version-history.png` (a Turso-only view the
//   file-mode seed cannot render). Secret fields show fixed fakes only, and
//   the one outside call a fake could trigger (the Anthropic model list) is
//   answered here, never sent.
// ★ The seed at FROZEN_NOW IS the demo project: the demo shifts the sample
//   so its as-of date lands on today, and FROZEN_NOW equals that date.

const GUIDE_DIR = "docs/assets/guide";
const GALLERY_DIR = "docs/assets";

/** Obviously fake values — the only secrets a picture may show. */
const FAKE_API_KEY = "sk-ant-api03-EXAMPLE-EXAMPLE-EXAMPLE";
const FAKE_TIMELOG_ADDRESS = "https://app.timelog.com/acme/registration/week";

/** White space kept around a crop, in CSS pixels, so a callout's outline is never cut. The top is
 *  tighter: the line above the first element is the previous control, and a sliver of it reads as
 *  a cut, not as space. */
const CROP_PAD = 16;
const CROP_PAD_TOP = 8;

/**
 * Photograph the region from `from`'s top-left to `to`'s bottom-right, padded and clamped to the
 * viewport. A clip of the PAGE rather than `locator.screenshot`: the latter scrolls the element's
 * container itself, and the views here scroll inside their own panes.
 */
async function shotSpan(from: Locator, to: Locator, file: string, opts: { across?: Locator | Locator[] } = {}): Promise<void> {
  const page = from.page();
  // To the TOP of its pane, so the region below it has the most room before the viewport ends.
  await from.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  // `across` sets the width (the union of its boxes): a crop between two narrow controls would
  // otherwise cut the text beside them.
  const across = opts.across === undefined ? [] : Array.isArray(opts.across) ? opts.across : [opts.across];
  const c = await Promise.all(across.map((l) => l.boundingBox()));
  if (!a || !b || c.some((r) => r === null)) throw new Error(`shotSpan(${file}): a bound is not rendered`);
  const view = page.viewportSize();
  if (!view) throw new Error("shotSpan: no viewport");
  const xs = c.length > 0 ? c.filter((r) => r !== null) : [a, b];
  const x = Math.max(0, Math.min(...xs.map((r) => r.x)) - CROP_PAD);
  const y = Math.max(0, Math.min(a.y, b.y, ...xs.map((r) => r.y)) - CROP_PAD_TOP);
  const right = Math.min(view.width, Math.max(...xs.map((r) => r.x + r.width)) + CROP_PAD);
  const bottom = Math.min(view.height, Math.max(a.y + a.height, b.y + b.height) + CROP_PAD);
  await page.screenshot({ path: file, clip: { x, y, width: right - x, height: bottom - y }, animations: "disabled", caret: "hide" });
}

async function shot(locator: Locator, file: string): Promise<void> {
  await shotSpan(locator, locator, file);
}

/** Skip the tour and the one-time demo banner, as e2e/visual.spec.ts does. */
async function prepare(page: Page): Promise<void> {
  await skipTour(page);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), DEMO_BANNER_DONE_KEY);
  // A fake key must never reach Anthropic: answer the model list locally.
  await page.route("https://api.anthropic.com/**", (route) =>
    route.fulfill({ json: { data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5", type: "model" }] } }),
  );
}

/** Drop focus, so a focus ring does not sit on top of a callout. */
async function blurActive(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function openSettingsSection(page: Page, section: string): Promise<void> {
  await openView(page, "Settings");
  // Scoped to `main`: the sidebar carries nav items of the same name ("AI Assistant").
  await page.locator("main").getByRole("button", { name: section, exact: true }).first().click();
  await waitForViewSettled(page);
}

/** Tick an integration's switch, accepting the one-time credentials notice if it appears. */
async function enableIntegration(page: Page, checkbox: Locator): Promise<void> {
  if (await checkbox.isChecked()) return;
  await checkbox.check();
  const ack = page.getByRole("button", { name: "I understand", exact: true });
  if (await ack.isVisible()) await ack.click();
}

/** Empty one IndexedDB entity store before the app loads, so a view shows its empty state. */
async function clearEntityStore(page: Page, store: string): Promise<void> {
  await page.evaluate(
    ({ db, store }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(db);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(store, "readwrite");
          tx.objectStore(store).clear();
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { db: IDB_DB_NAME, store },
  );
}

test.beforeAll(() => {
  mkdirSync(GUIDE_DIR, { recursive: true });
});

test("harness: the Dashboard renders under the frozen clock", async ({ page }) => {
  await prepare(page);
  await gotoApp(page, FROZEN_NOW);
  await expect(page.locator("main").first()).toBeVisible();
});

test.describe("guide", () => {
  test("01 the first-start splash, after the slow-start note appears", async ({ page }) => {
    await page.goto(pathToFileURL("desktop/splash.html").href);
    const messages = splashMessages("en-US");
    await page.evaluate(splashScript("status", messages.starting));
    await page.evaluate(splashScript("slow", messages.slow));
    await expect(page.getByText(messages.slow)).toBeVisible();
    await page.screenshot({ path: `${GUIDE_DIR}/01-splash.png`, animations: "disabled", caret: "hide" });
  });

  test("02 the Turso setup steps in Settings", async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
    await openSettingsSection(page, "Integrations");
    await enableIntegration(page, page.getByRole("checkbox", { name: "Turso storage backend", exact: true }));
    const guide = page.getByRole("link", { name: "Step-by-step guide ↗", exact: true });
    await expect(guide).toBeVisible();
    // The URL field is hidden when the server's environment sets a database: its presence is the
    // proof that this run's server started with the deployment variables blanked (playwright.config.ts).
    const url = page.getByRole("textbox", { name: "Database URL", exact: true });
    await expect(url).toBeVisible();
    const turso = page.getByRole("checkbox", { name: "Turso storage backend", exact: true });
    const steps = page.locator("ol").filter({ has: url });
    await blurActive(page);
    await markCallout(guide);
    await shotSpan(turso, guide, `${GUIDE_DIR}/02-turso-steps.png`, { across: steps });
    await clearCallouts(page);
  });

  test("03 the AI key field with a fake key", async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
    await openSettingsSection(page, "AI Assistant");
    const enable = page.getByRole("checkbox", { name: "Enable AI assistant", exact: true });
    await enableIntegration(page, enable);
    const key = page.getByLabel("Anthropic API key", { exact: true });
    await key.fill(FAKE_API_KEY);
    await expect(key).toHaveValue(FAKE_API_KEY);
    await blurActive(page);
    const group = page.getByRole("group", { name: "AI assistant", exact: true });
    const heading = group.getByText("AI assistant", { exact: true });
    const passphrase = page.getByRole("checkbox", { name: "Require a passphrase to unlock", exact: true });
    await markCallout(key);
    await shotSpan(heading, passphrase, `${GUIDE_DIR}/03-ai-key.png`, { across: key });
    await clearCallouts(page);
  });

  test("04 the Timelog address, pasted", async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
    await openSettingsSection(page, "Integrations");
    const enable = page.getByRole("checkbox", { name: "Enable Timelog integration", exact: true });
    await enableIntegration(page, enable);
    const address = page.getByRole("textbox", { name: "Your Timelog address", exact: true });
    await address.fill(FAKE_TIMELOG_ADDRESS);
    await blurActive(page);
    const tenant = page.getByRole("textbox", { name: "Tenant", exact: true });
    await expect(tenant).toHaveValue("acme");
    await markCallout(address);
    await shotSpan(page.getByText("Timelog time bookings", { exact: true }), tenant, `${GUIDE_DIR}/04-timelog-address.png`);
    await clearCallouts(page);
  });

  test("05 Functions: Time bookings asks for Resources", async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
    await openView(page, "Projects");
    await page.getByRole("button", { name: "Edit project", exact: true }).first().click();
    const functions = page.getByRole("region", { name: "Functions", exact: true });
    const bookings = functions.getByRole("checkbox", { name: "Time bookings", exact: true });
    await bookings.check();
    await functions.getByRole("checkbox", { name: "Resources", exact: true }).uncheck();
    await blurActive(page);
    const notice = functions.getByRole("status").filter({ hasText: "Resources is off" });
    await expect(notice).toBeVisible();
    await notice.scrollIntoViewIfNeeded();
    await markCallout(notice);
    await shotSpan(bookings, notice, `${GUIDE_DIR}/05-functions.png`, { across: functions });
    await clearCallouts(page);
  });

  test("06 roles and rates, reached from the budget checklist", async ({ page }) => {
    await prepare(page);
    await clearEntityStore(page, IDB_ENTITY_STORES.budgets);
    await gotoApp(page, FROZEN_NOW);
    await openView(page, "Budget");
    await page.getByRole("button", { name: "Manage roles", exact: true }).first().click();
    await waitForViewSettled(page);
    const card = page.getByText("Rate card", { exact: true }).first();
    await expect(card).toBeVisible();
    // The rate table is wider than its panel, which clips it: the panel's own Print button marks its right edge.
    const print = page.locator("main").getByRole("button", { name: /print/i }).first();
    await shotSpan(card, page.getByRole("button", { name: "Add role", exact: true }), `${GUIDE_DIR}/06-roles.png`, { across: [card, print] });
  });

  test("07 the resource form, email marked for Timelog", async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
    await openView(page, "Resources");
    await openView(page, "Directory");
    await page.getByRole("button", { name: "+ Add resource", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "New resource" });
    await dialog.getByRole("textbox", { name: /^First name/ }).fill("Alex");
    await dialog.getByRole("textbox", { name: /^Last name/ }).fill("Example");
    const email = dialog.getByRole("textbox", { name: /^Email/ }).first();
    await email.fill("alex@acme.example");
    await expect(email).toHaveValue("alex@acme.example");
    await blurActive(page);
    await markCallout(email);
    await shotSpan(
      dialog.getByText("New resource", { exact: true }),
      dialog.getByRole("button", { name: "Save resource", exact: true }),
      `${GUIDE_DIR}/07-resource-form.png`,
    );
    await clearCallouts(page);
  });

  test("08 the budget setup checklist on an empty budget", async ({ page }) => {
    await prepare(page);
    await clearEntityStore(page, IDB_ENTITY_STORES.budgets);
    await gotoApp(page, FROZEN_NOW);
    await openView(page, "Budget");
    const checklist = page.getByRole("region", { name: "Set up your budget", exact: true });
    await expect(checklist).toBeVisible();
    await shot(checklist, `${GUIDE_DIR}/08-budget-checklist.png`);
  });

  // ★ No demo-banner shot: the dashboard banner hides wherever the demo would be refused
  //   (`isLocalDemoBlocked`), and the seed's browser project is exactly that case (§712).

  test("09 the Getting started Help entry, with the install guide link", async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
    // The header's Help toggle (it carries aria-expanded), not the sidebar's Help view.
    await page.locator("button[aria-expanded]").and(page.getByRole("button", { name: "Help", exact: true })).click();
    const help = page.getByRole("dialog", { name: "Help", exact: true });
    await help.getByRole("searchbox").fill("Getting started");
    await help.getByText("Getting started: set up a budget", { exact: true }).first().click();
    await expect(help.getByText(/Turn on the functions you need/).first()).toBeVisible();
    const guide = help.getByRole("link", { name: "Installation & setup guide ↗", exact: true });
    await expect(guide).toBeVisible();
    await blurActive(page);
    await markCallout(guide);
    await shot(help, `${GUIDE_DIR}/09-help-entry.png`);
    await clearCallouts(page);
  });
});

/** Scroll an element to the top of its pane. */
async function scrollToTop(target: Locator): Promise<void> {
  await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
}

/** Full-window gallery shot: the Next dev-mode badge hidden, the view settled. */
async function galleryShot(page: Page, name: string): Promise<void> {
  await blurActive(page);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await waitForViewSettled(page);
  await page.screenshot({ path: `${GALLERY_DIR}/${name}.png`, animations: "disabled", caret: "hide" });
}

// The README gallery: 16 of its 17 pictures (version-history.png shows a Turso-only view).
// ★ 1696×917 at 1.5× is the existing images' 2544×1376 pixels at a density a reader can still read.
test.describe("gallery", () => {
  test.use({ viewport: { width: 1696, height: 917 }, deviceScaleFactor: 1.5 });

  test.beforeEach(async ({ page }) => {
    await prepare(page);
    await gotoApp(page, FROZEN_NOW);
  });

  test("dashboard", async ({ page }) => {
    await expect(page.getByText("Overall:", { exact: false }).first()).toBeVisible();
    await galleryShot(page, "dashboard");
  });

  test("open-points", async ({ page }) => {
    await openView(page, "Open Points");
    await expect(page.locator("main").getByRole("table").first()).toBeVisible();
    await galleryShot(page, "open-points");
  });

  test("swimlanes", async ({ page }) => {
    await openView(page, "Open Points");
    await page.locator("main").getByText("Swimlanes", { exact: true }).click();
    // The lane picker exists only in the swimlane layout.
    await expect(page.getByRole("combobox").filter({ hasText: "Add person lane" })).toBeVisible();
    await galleryShot(page, "swimlanes");
  });

  test("gantt", async ({ page }) => {
    await openView(page, "Gantt");
    // Past the finished tasks, to the rows with live bars, milestones and dependency arrows.
    await scrollToTop(page.locator("main").getByText("Backend API skeleton", { exact: true }).first());
    await page.locator("main").getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByText("Show or hide chart layers", { exact: false }).first()).toBeVisible();
    await galleryShot(page, "gantt");
  });

  test("raid", async ({ page }) => {
    await openView(page, "RAID");
    await page.locator("main tbody tr").first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await galleryShot(page, "raid");
  });

  test("budget", async ({ page }) => {
    await openView(page, "Budget");
    await expect(page.locator("main").getByRole("table").first()).toBeVisible();
    await galleryShot(page, "budget");
  });

  test("budget-report-efficiency", async ({ page }) => {
    await openView(page, "Reports");
    await openView(page, "Budget Report");
    await page.locator("main").getByText("At current efficiency", { exact: true }).first().click();
    await expect(page.getByText("EAC at current efficiency", { exact: false }).first()).toBeVisible();
    await scrollToTop(page.locator("main").getByText("Forecast", { exact: true }).first());
    await galleryShot(page, "budget-report-efficiency");
  });

  test("budget-report-pace", async ({ page }) => {
    await openView(page, "Reports");
    await openView(page, "Budget Report");
    // At current pace is the default forecast.
    await expect(page.getByText("EAC at current pace", { exact: false }).first()).toBeVisible();
    await scrollToTop(page.locator("main").getByText("Forecast", { exact: true }).first());
    await galleryShot(page, "budget-report-pace");
  });

  test("changes", async ({ page }) => {
    await openView(page, "Changes");
    // A change row opens its editor on click; the title is the fourth cell.
    await page.locator("main tbody tr:visible").first().locator("td").nth(3).click();
    // The editor's own Notes log button: the row behind the dialog carries one too.
    await page.getByRole("dialog").getByRole("button", { name: /Notes log/ }).first().click();
    await expect(page.getByText(/^Notes log — /).first()).toBeVisible();
    await galleryShot(page, "changes");
  });

  test("stakeholders", async ({ page }) => {
    await openView(page, "Stakeholders");
    // The name cell is the edit button: it carries the stakeholder's name as `title`.
    await page.locator("main tbody tr:visible").first().locator("td button[title]").first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await galleryShot(page, "stakeholders");
  });

  test("raci", async ({ page }) => {
    await openView(page, "Stakeholders");
    await openView(page, "RACI Matrix");
    await expect(page.locator("main").getByRole("table").first()).toBeVisible();
    await galleryShot(page, "raci");
  });

  test("knowledge", async ({ page }) => {
    await openView(page, "Knowledge");
    await expect(page.locator("main").getByRole("link").first()).toBeVisible();
    await galleryShot(page, "knowledge");
  });

  test("operating-guides", async ({ page }) => {
    await openSettingsSection(page, "AI Assistant");
    // The guides list shows only while the assistant is on.
    await enableIntegration(page, page.getByRole("checkbox", { name: "Enable AI assistant", exact: true }));
    await page.locator("main").getByRole("button", { name: "Operating guides", exact: true }).click();
    await expect(page.getByText("Operating guides", { exact: true }).nth(1)).toBeVisible();
    await galleryShot(page, "operating-guides");
  });

  test("information-flows", async ({ page }) => {
    await openSettingsSection(page, "Information flows");
    await expect(page.locator("main svg").first()).toBeVisible();
    await galleryShot(page, "information-flows");
  });

  test("new-project", async ({ page }) => {
    await openView(page, "Projects");
    await page.locator("main").getByRole("button", { name: /New project/ }).first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await galleryShot(page, "new-project");
  });

  test("help", async ({ page }) => {
    await openView(page, "Help");
    await expect(page.locator("main").getByText("Concepts", { exact: false }).first()).toBeVisible();
    await galleryShot(page, "help");
  });
});
