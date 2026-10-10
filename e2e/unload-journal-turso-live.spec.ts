// e2e/unload-journal-turso-live.spec.ts
//
// §629 on a REAL Turso project: does a draft that exists only in the page when it
// unloads still reach the database? `pagehide-draft-persist.spec.ts` measures the
// same two unloads on the browser backend (IndexedDB) only. On Turso the save is a
// plain `fetch` with no `keepalive`, which the browser may abort when the page goes,
// so the unload journal (`src/app/unload-journal.ts`, `src/app/use-unload-journal.ts`)
// is what is left to carry the draft. Its key is the Turso project id
// (`journalProjectKey`).
//
// Two cases, each on an unblurred task-name draft (`useInlineCellEdit`):
//  - reload: after the reload the draft is in the database, and the load consumed
//    the journal with no conflict notice;
//  - tab close (`page.close({ runBeforeUnload: true })`): a new page in the same
//    context reads the journal the closing page wrote, then loads the app; the
//    draft must be in the database, and the journal consumed with no notice.
// Either way the unload can end two ways and both must pass: the unload's own save
// reached Turso (the journal's content is then what loads, and it is cleared
// silently), or it did not (the journal's base matches, so it is restored and saved
// back). This file does not pin which one ran.
//
// ★★★ THE LOAD-BEARING ASSERTIONS ARE ON THE DATABASE, read from the test process,
// never on the UI. Before the unload the marker must be ABSENT from the stored task
// name: the draft lives only in component state, so nothing but the unload path can
// put it there.
//
// ★★★ LIVENESS: the task's name exists only as a row this file wrote to the live
// database. This file uses the BASE Playwright fixture, so nothing in IndexedDB or
// localStorage carries it, and seeing it rendered proves the app loaded from Turso.
//
// ★★★ NO FAKE CLOCK. `page.clock` would also drive the app's Turso fetch timeouts
// (see `version-history-documents.spec.ts`, `CLOCK_STEP_MS`), and nothing here
// needs fake time: no edit is committed before the unload.
//
// ★★★ It reads only the throwaway pair and needs the app's database to BE the
// throwaway one (`live-turso-env.ts`); it skips, saying why, otherwise. Every write
// is scoped to its own partition and removed in `afterAll`; it drops nothing. Trace
// and video are off (the app carries the token). CI runs it in live-turso.yml
// (`npm run e2e:live-app`). Run it alone, against a fresh server:
//   PORT=3100 npx playwright test e2e/unload-journal-turso-live.spec.ts --project=chromium --workers=1

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { TABLE_NAMES } from "../src/app/turso-schema";
import { SNAPSHOT_TABLE_NAMES } from "../src/app/snapshot-schema";
import { UNLOAD_JOURNAL_PREFIX } from "../src/app/unload-journal";
import {
  LIVE, appIsThrowaway, SKIP_NO_THROWAWAY, SKIP_APP_NOT_THROWAWAY, guardAppDatabase,
  rawPipeline as pipeline, txt,
} from "./live-turso-env";
import { ensureTenantSchema } from "./live-turso-schema";
import { openView } from "./seed";

test.use({ trace: "off", video: "off" });

/** This file's partition: no other suite writes or cleans it. */
const PID = "e2e-unload-journal";
/** `journalProjectKey("turso", PID, …)` is PID itself. */
const JOURNAL_KEY = `${UNLOAD_JOURNAL_PREFIX}${PID}`;
/** Unique in the repo, so seeing it rendered can only mean a load from Turso. */
const TASK_NAME = "S629 unload journal probe task";
const TASK_ID = "96291";

/** The conflict notice's accessible name: i18n.ts `unloadJournalConflict` (EN). */
const CONFLICT_NOTICE =
  "Unsaved changes from your last session could not be restored automatically because this project was changed elsewhere since.";

const PROJECT_ROW: Record<string, string> = {
  name: "Unload journal probe",
  code: "UJP",
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
  const results = await pipeline([
    { sql: "DELETE FROM project_versions WHERE project_id = ?", args: [txt(PID)] },
    // The app's own live Trends capture writes here too, and both tables are outside TABLE_NAMES.
    ...SNAPSHOT_TABLE_NAMES.map((t) => ({ sql: `DELETE FROM ${t} WHERE project_id = ?`, args: [txt(PID)] })),
    ...TABLE_NAMES.map((t) => ({ sql: `DELETE FROM ${t} WHERE project_id = ?`, args: [txt(PID)] })),
    { sql: "DELETE FROM projects WHERE id = ?", args: [txt(PID)] },
  ]);
  // `ensureTenantSchema` creates every tenant table, so only the side tables (versions and
  // snapshots) may answer "no such table" on a database the app has never captured into.
  const failed = results.filter((r) => r.type === "error" && !/no such table/i.test(r.error?.message ?? "")).length;
  expect(failed, "cleaning the probe partition failed").toBe(0);
}

async function seedProject(): Promise<void> {
  const cols = ["id", "archived", ...Object.keys(PROJECT_ROW)];
  const results = await pipeline([
    {
      sql: `INSERT OR REPLACE INTO projects (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      args: [txt(PID), txt("0"), ...Object.values(PROJECT_ROW).map(txt)],
    },
    {
      sql: 'INSERT INTO tasks (id, project_id, "taskName", status) VALUES (?, ?, ?, ?)',
      args: [{ type: "integer", value: TASK_ID }, txt(PID), txt(TASK_NAME), txt("Open")],
    },
  ]);
  expect(results.filter((r) => r.type === "error").length, "seeding the probe project failed").toBe(0);
}

/** The stored name of the probe task; "" when the row is missing. */
async function storedTaskName(): Promise<string> {
  const [res] = await pipeline([
    { sql: 'SELECT "taskName" FROM tasks WHERE project_id = ? AND id = ?', args: [txt(PID), { type: "integer", value: TASK_ID }] },
  ]);
  return res?.response?.result?.rows?.[0]?.[0]?.value ?? "";
}

/** On the CONTEXT, so the tab-close case's second page loads the same project. */
async function installPortfolioTursoMode(context: BrowserContext): Promise<void> {
  await context.addInitScript((projectId) => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true, storageConfig: { kind: "turso" } }));
    localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    localStorage.setItem("aipm-cockpit:turso-current-project", projectId);
  }, PID);
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard", exact: true }).or(page.getByRole("button", { name: "Dashboard", exact: true })).first()).toBeVisible({ timeout: 90_000 });
}

/** Loads the app on the probe project and leaves `marker` typed, unblurred, at the end
 *  of the task's name: a draft that exists only in the page. */
async function typeTaskNameDraft(page: Page, marker: string): Promise<void> {
  await page.goto("/");
  await waitForShell(page);
  await openView(page, "Open Points");
  const cell = page.getByTitle(/ — click to edit$/).filter({ hasText: TASK_NAME });
  await expect(cell, "the seeded task never rendered, so the project did not load from the live database").toHaveCount(1, { timeout: 30_000 });
  await cell.dblclick();
  const input = page.getByRole("textbox", { name: /^Task name – / });
  await expect(input).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${marker}`);
  await expect(input).toHaveValue(new RegExp(`${marker}$`));
  await expect(input, "the draft must still be unblurred at the unload").toBeFocused();
  expect(await storedTaskName(), "premise: the unsaved draft must not be in the database before the unload").not.toContain(marker);
}

async function readJournal(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY);
}

async function expectStored(marker: string): Promise<void> {
  await expect
    .poll(storedTaskName, { message: "the draft must have reached the Turso database", timeout: 30_000 })
    .toContain(marker);
}

/** The load consumed the project's journal and raised no conflict notice. */
async function expectJournalConsumed(page: Page): Promise<void> {
  await expect.poll(() => readJournal(page), { message: "the load must consume the journal", timeout: 30_000 }).toBeNull();
  await expect(page.getByRole("region", { name: CONFLICT_NOTICE })).toHaveCount(0);
}

test.describe("§629 — a draft unloaded on a live Turso project reaches the database", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(() => !appIsThrowaway(), SKIP_APP_NOT_THROWAWAY);
  test.describe.configure({ mode: "serial" });

  let blockedHosts: string[] = [];
  test.beforeEach(async ({ page, context }) => {
    blockedHosts = await guardAppDatabase(page);
    await installPortfolioTursoMode(context);
    await cleanPartition();
    await seedProject();
  });
  test.afterEach(() => {
    expect(blockedHosts.length, "the app called a Turso database other than the throwaway one").toBe(0);
  });
  test.afterAll(async () => {
    if (!appIsThrowaway()) return;
    await cleanPartition().catch((err: unknown) => {
      console.warn(`§629 cleanup failed (${err instanceof Error ? err.name : typeof err})`);
    });
  });

  test("reload: the draft reaches Turso and the journal is consumed", async ({ page }) => {
    const marker = "zq629reload";
    await typeTaskNameDraft(page, marker);
    await page.reload();
    await waitForShell(page);
    await expectStored(marker);
    await expectJournalConsumed(page);
  });

  test("tab close: a new page reads the journal back, and the draft reaches Turso", async ({ page, context }) => {
    const marker = "zq629close";
    await typeTaskNameDraft(page, marker);
    await page.close({ runBeforeUnload: true });
    // A same-origin document that runs no app code, so the journal is read before any load acts on it.
    const next = await context.newPage();
    await next.goto("/favicon.ico");
    // Polled: `page.close` resolves before the closing page's pagehide handlers finish
    // (pagehide-draft-persist.spec.ts's header has the measurement).
    await expect
      .poll(() => readJournal(next), { message: "the closing page's pagehide must have written the journal", timeout: 10_000 })
      .toContain(marker);
    await next.goto("/");
    await waitForShell(next);
    await expectStored(marker);
    await expectJournalConsumed(next);
  });
});
