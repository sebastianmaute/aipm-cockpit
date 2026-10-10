// e2e/version-compare-live.spec.ts
//
// The version-compare surface on a REAL Turso project — the owed eye-check.
// History is Turso-only, so the e2e seed (browser storage) never reaches it, and
// axe never scans it; nothing in any gate covers it. This drives it end to end
// against the throwaway database and leaves screenshots for an eye-check:
//   - a project whose two tasks share one NAME, so every per-row control in the
//     diff must still carry a row-unique accessible name (§243, §257, §305);
//   - two named versions taken with "Save version now";
//   - "Compared with current" lists both tasks' changes;
//   - "Restore this" on one record reverts that task in the app and in the
//     database, and leaves the other alone;
//   - "Compare selected" and "Compare side by side" both render.
//
// ★★★ It reads only the throwaway pair and needs the app's database to BE the
// throwaway one (`live-turso-env.ts`); it skips, saying why, otherwise. Every
// write is scoped to its own partition and removed in `afterAll`; it drops
// nothing. Trace and video are off (the app carries the token).
// Run it alone, against a fresh server:
//   PORT=3100 npx playwright test e2e/version-compare-live.spec.ts --project=chromium --workers=1
// Screenshots land in this test's output directory (test-results/…).

import { test, expect, type Page } from "@playwright/test";
import { TABLE_NAMES } from "../src/app/turso-schema";
import {
  LIVE, appIsThrowaway, SKIP_NO_THROWAWAY, SKIP_APP_NOT_THROWAWAY, guardAppDatabase,
  rawPipeline as pipeline, txt,
} from "./live-turso-env";
import { ensureTenantSchema } from "./live-turso-schema";
import { FROZEN_NOW, openView } from "./seed";

test.use({ trace: "off", video: "off" });

/** This file's partition: no other suite writes or cleans it. */
const PID = "e2e-version-compare";
/** One name, two tasks: the case the row-unique names exist for. */
const TASK_NAME = "Compare probe task";
const TASK_IDS = ["93001", "93002"];
const BASELINE = "Baseline";
const AFTER = "After edit";
const EDIT_SUFFIX = " edited";

const PROJECT_ROW: Record<string, string> = {
  name: "Version compare probe",
  code: "VCP",
  projectManager: "E2E Runner",
  customer: "E2E Customer",
  products: "E2E Product",
  profitCenter: "E2E",
  naceSection: "J",
  deployment: "Cloud",
  startDate: "2026-06-01",
};

async function cleanPartition(): Promise<void> {
  await ensureTenantSchema();
  await pipeline([
    { sql: "DELETE FROM project_versions WHERE project_id = ?", args: [txt(PID)] },
    // The app's own live Trends capture writes here too; snapshot is outside TABLE_NAMES.
    { sql: "DELETE FROM snapshot WHERE project_id = ?", args: [txt(PID)] },
    ...TABLE_NAMES.map((t) => ({ sql: `DELETE FROM ${t} WHERE project_id = ?`, args: [txt(PID)] })),
    { sql: "DELETE FROM projects WHERE id = ?", args: [txt(PID)] },
  ]);
}

async function seedProject(): Promise<void> {
  const cols = ["id", "archived", ...Object.keys(PROJECT_ROW)];
  const results = await pipeline([
    {
      sql: `INSERT OR REPLACE INTO projects (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      args: [txt(PID), txt("0"), ...Object.values(PROJECT_ROW).map(txt)],
    },
    ...TASK_IDS.map((id) => ({
      sql: 'INSERT INTO tasks (id, project_id, "taskName", status) VALUES (?, ?, ?, ?)',
      args: [{ type: "integer", value: id }, txt(PID), txt(TASK_NAME), txt("Open")],
    })),
  ]);
  expect(results.filter((r) => r.type === "error").length, "seeding the probe project failed").toBe(0);
}

/** The stored task names, by id. */
async function storedTaskNames(): Promise<Record<string, string>> {
  const [res] = await pipeline([
    { sql: 'SELECT id, "taskName" FROM tasks WHERE project_id = ? ORDER BY id', args: [txt(PID)] },
  ]);
  const rows = res?.response?.result?.rows ?? [];
  return Object.fromEntries(rows.map((r) => [r[0]?.value ?? "", r[1]?.value ?? ""]));
}

async function storedVersionCount(): Promise<number> {
  const [res] = await pipeline([
    { sql: "SELECT COUNT(*) FROM project_versions WHERE project_id = ?", args: [txt(PID)] },
  ]);
  return Number(res?.response?.result?.rows?.[0]?.[0]?.value ?? "0");
}

async function installPortfolioTursoMode(page: Page): Promise<void> {
  await page.addInitScript((projectId) => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true, storageConfig: { kind: "turso" } }));
    localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    localStorage.setItem("aipm-cockpit:turso-current-project", projectId);
  }, PID);
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard", exact: true }).or(page.getByRole("button", { name: "Dashboard", exact: true })).first()).toBeVisible({ timeout: 90_000 });
}

/** Append `suffix` to the nth inline-editable task name and commit with Enter. */
async function appendToTaskName(page: Page, nth: number, suffix: string): Promise<void> {
  await page.getByTitle(/ — click to edit$/).filter({ hasText: TASK_NAME }).nth(nth).dblclick();
  const input = page.getByRole("textbox", { name: /^Task name – / });
  await expect(input).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(suffix);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
}

/** "Save version now", named. */
async function saveVersion(page: Page, label: string, expectedCount: number): Promise<void> {
  await page.getByRole("button", { name: "Save version now", exact: true }).click();
  await page.getByPlaceholder("Name this version").fill(label);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(storedVersionCount, { message: `version "${label}" never reached the database`, timeout: 30_000 }).toBe(expectedCount);
}

/** Every `aria-label` of a VISIBLE control inside `scope`, for the row-unique
 *  check. Visible only: the chat and RAID panels stay mounted while hidden
 *  (workspace-section), so their toolbars would read as duplicates of this one. */
async function controlNames(page: Page, scopeSelector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const scope = document.querySelector(sel);
    if (!scope) return [];
    return [...scope.querySelectorAll<HTMLElement>("button[aria-label], input[aria-label]")]
      .filter((e) => e.checkVisibility())
      .map((e) => e.getAttribute("aria-label") ?? "");
  }, scopeSelector);
}

const duplicates = (names: string[]): string[] => names.filter((n, i) => names.indexOf(n) !== i);

test.describe("version compare and restore — live Turso", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(() => !appIsThrowaway(), SKIP_APP_NOT_THROWAWAY);

  let blockedHosts: string[] = [];
  test.beforeEach(async ({ page }) => {
    blockedHosts = await guardAppDatabase(page);
  });
  test.afterEach(() => {
    expect(blockedHosts.length, "the app called a Turso database other than the throwaway one").toBe(0);
  });

  test.beforeAll(async () => {
    if (!appIsThrowaway()) return;
    await cleanPartition();
    await seedProject();
  });
  test.afterAll(async () => {
    if (!appIsThrowaway()) return;
    await cleanPartition().catch((err: unknown) => {
      console.warn(`version-compare cleanup failed (${err instanceof Error ? err.name : typeof err})`);
    });
  });

  test("compares two versions of a project whose tasks share a name, and restores one record", async ({ page }) => {
    const shot = (name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });
    await page.clock.install({ time: FROZEN_NOW });
    await installPortfolioTursoMode(page);
    await page.goto("/");
    await waitForShell(page);

    await openView(page, "Open Points");
    await expect(page.getByTitle(/ — click to edit$/).filter({ hasText: TASK_NAME }), "the seeded tasks never loaded from the live database").toHaveCount(2);

    await openView(page, "History");
    await saveVersion(page, BASELINE, 1);

    await openView(page, "Open Points");
    // The SAME suffix on both, so the two changed records carry one label in the
    // diff: the case the row-unique names exist for. The filter matches by
    // substring, so the edited first task is still row 0.
    await appendToTaskName(page, 0, EDIT_SUFFIX);
    await appendToTaskName(page, 1, EDIT_SUFFIX);
    await expect
      .poll(async () => Object.values(await storedTaskNames()).sort(), { message: "the edits never reached the database", timeout: 30_000 })
      .toEqual([`${TASK_NAME}${EDIT_SUFFIX}`, `${TASK_NAME}${EDIT_SUFFIX}`]);

    await openView(page, "History");
    await saveVersion(page, AFTER, 2);
    await shot("01-version-list");

    const versionNames = await controlNames(page, "main");
    expect(duplicates(versionNames), "two controls in the version list share an accessible name").toEqual([]);

    // Compared with current: the baseline differs from now in both tasks.
    await page.getByRole("button", { name: `Compared with current – ${BASELINE}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Changes", exact: true })).toBeVisible();
    await expect(page.getByText(TASK_NAME, { exact: false }).first()).toBeVisible();
    await shot("02-compared-with-current");
    const diffNames = await controlNames(page, "main");
    expect(diffNames.filter((n) => n.startsWith("Restore this – ")).length, "the diff does not offer a restore per changed task").toBeGreaterThanOrEqual(2);
    expect(duplicates(diffNames), "two controls in the diff share an accessible name (§305)").toEqual([]);

    // Restore exactly one record.
    const restore = page.getByRole("button", { name: /^Restore this – / }).first();
    await restore.click();
    await expect
      .poll(async () => Object.values(await storedTaskNames()).filter((n) => n === TASK_NAME).length, {
        message: "Restore this did not put one task back in the database",
        timeout: 30_000,
      })
      .toBe(1);
    const after = Object.values(await storedTaskNames());
    expect(after.filter((n) => n === `${TASK_NAME}${EDIT_SUFFIX}`).length, "the restore touched more than the one record").toBe(1);
    await shot("03-after-restore");

    // Compare two versions, inline and side by side.
    await page.getByRole("checkbox", { name: `Select to compare – ${BASELINE}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Select to compare – ${AFTER}`, exact: true }).check();
    await page.getByRole("button", { name: "Compare selected", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Changes", exact: true })).toBeVisible();
    await shot("04-compare-selected");
    expect(duplicates(await controlNames(page, "main")), "duplicate accessible names in the version-to-version diff").toEqual([]);
    await page.getByRole("button", { name: "Compare side by side", exact: true }).click();
    await shot("05-side-by-side");
    expect(duplicates(await controlNames(page, "main")), "duplicate accessible names in the side-by-side view").toEqual([]);
  });
});
