// e2e/demo-trends-live.spec.ts
//
// §696: the demo's Trends history against a REAL Turso database. With a usable
// Turso config the demo is created as a Turso project and its weekly history is
// written before the project becomes current (`createDemo`, `seedSnapshots`,
// `appendSnapshots`). Until this file, that ran only against stubbed clients and
// `node:sqlite`. Both entry points are driven — the start screen's "Explore the
// demo" card and the Projects panel's "Explore a demo project" — and each run:
//   - opens the demo with the guided tour;
//   - stores exactly the seeded weeks, with exactly one baseline;
//   - shows them in Trends, one row each, one ★;
//   - opens the demo again after a reload;
//   - deletes the demo with the app's own hard delete (`hardDeleteProject`), run from
//     the test process because the Projects panel cannot archive the open project,
//     leaving no project row and no snapshot behind.
//
// ★★★ It reads only the throwaway pair and needs the app's database to BE the
// throwaway one (`live-turso-env.ts`); it skips, saying why, otherwise. It
// creates and deletes one project per test; `afterAll` removes any demo a failed
// run left behind. Trace and video are off (the app carries the token).
// ★ The start-card test needs a database with NO Turso project in it: the card
// shows only then. With other projects present it fails (it cannot pass falsely).
// Run it alone, against a fresh server:
//   PORT=3100 npx playwright test e2e/demo-trends-live.spec.ts --project=chromium --workers=1
// The Trends screenshot lands in each test's output directory (test-results/…).

import { test, expect, type Page } from "@playwright/test";
import { hardDeleteProject } from "../src/app/turso-portfolio";
import { DEMO_SAMPLE_NAME, demoHistoryFor } from "../src/app/demo-project";
import type { Workspace } from "../src/app/workspace";
import { defaultSnapshotSettings } from "../src/app/settings-types";
import type { SnapshotRecord } from "../src/app/snapshot";
import sampleWorkspace from "../sample-workspace-small.json";
import demoSnapshots from "../sample-demo-snapshots.json";
import {
  LIVE, THROWAWAY, pipelineBase, appIsThrowaway, SKIP_NO_THROWAWAY, SKIP_APP_NOT_THROWAWAY, guardAppDatabase,
  rawPipeline as pipeline, txt,
} from "./live-turso-env";
import { ensureTenantSchema } from "./live-turso-schema";
import { openView } from "./seed";

test.use({ trace: "off", video: "off" });

const DEMO_NAME = `${DEMO_SAMPLE_NAME} (demo)`;

/** An ordinary project for the Projects-panel run: the panel is reachable only from inside a
 *  project, so one must exist and be open. Its own partition; deleted afterwards. */
const HOST_ID = "e2e-demo-host";
const HOST_ROW: Record<string, string> = { name: "Demo host probe", code: "DHP", startDate: "2026-06-01" };

async function seedHostProject(): Promise<void> {
  const cols = ["id", "archived", ...Object.keys(HOST_ROW)];
  const results = await pipeline([
    {
      sql: `INSERT OR REPLACE INTO projects (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      args: [txt(HOST_ID), txt("0"), ...Object.values(HOST_ROW).map(txt)],
    },
  ]);
  expect(results.filter((r) => r.type === "error").length, "seeding the host project failed").toBe(0);
}

/** How many weeks the demo should store TODAY. Not a constant: the history is shifted by whole
 *  plan periods to today and stops before the current week (`demoHistoryFor`), so the count
 *  depends on the date. The app's own function, fed what `useLoadDemo` feeds it. */
function expectedWeeks(): number {
  const today = new Date().toISOString().slice(0, 10);
  // `demoHistoryFor` reads only the plan granularity; building the whole demo workspace
  // would run the rich-text sanitizer, which needs a DOM this process does not have.
  const ws = { plan: { granularity: sampleWorkspace.plan.granularity } } as unknown as Workspace;
  return demoHistoryFor(demoSnapshots as unknown as readonly SnapshotRecord[], ws, today, defaultSnapshotSettings.cadence).length;
}

type Rows = { value: string }[][];
const rowsOf = (r: { response?: { result?: { rows?: Rows } } } | undefined): Rows => r?.response?.result?.rows ?? [];

/** Ids of every project row named like the demo (archived or not). */
async function demoProjectIds(): Promise<string[]> {
  const [res] = await pipeline([{ sql: "SELECT id FROM projects WHERE name = ?", args: [txt(DEMO_NAME)] }]);
  // A failed query must not read as "no rows": the post-delete checks rest on it.
  expect(res?.type, "the projects query failed").toBe("ok");
  return rowsOf(res).map((r) => r[0]?.value ?? "");
}

/** Stored snapshots for one project, split by origin. The seed writes ids
 *  `${projectId}:${capturedAt}` (demoRecordsFor); a live capture's id is its bare
 *  `capturedAt` (snapshot.ts). The seed stops before the current week and leaves that
 *  bucket to the app's own capture, so up to one live row is expected beside it. */
async function snapshotCounts(projectId: string): Promise<{ seeded: number; live: number; baselines: number }> {
  const [res] = await pipeline([
    {
      sql:
        "SELECT SUM(CASE WHEN id LIKE ? THEN 1 ELSE 0 END), SUM(CASE WHEN id LIKE ? THEN 0 ELSE 1 END), " +
        "SUM(CASE WHEN is_baseline = '1' THEN 1 ELSE 0 END) FROM snapshot WHERE project_id = ?",
      args: [txt(`${projectId}:%`), txt(`${projectId}:%`), txt(projectId)],
    },
  ]);
  expect(res?.type, "the snapshot query failed").toBe("ok");
  const row = rowsOf(res)[0] ?? [];
  const n = (i: number) => Number(row[i]?.value ?? "0");
  return { seeded: n(0), live: n(1), baselines: n(2) };
}

/** The throwaway database as the app's own Turso calls take it. */
const CONFIG = { httpUrl: pipelineBase(THROWAWAY.url), authToken: THROWAWAY.token };

/** Delete every demo project through the app's own hard delete (`hardDeleteProject`): the
 *  workspace tables in one transaction, then the side tables, snapshots among them (§204). */
async function removeDemos(): Promise<void> {
  for (const id of await demoProjectIds()) await hardDeleteProject(CONFIG, id);
}

/** Every project this file creates: the demos, and the Projects-panel run's host. */
async function removeAll(): Promise<void> {
  await removeDemos();
  await hardDeleteProject(CONFIG, HOST_ID);
}

/** Turso portfolio mode, with `current` open (or no project). `tourSeen` is set only when a host
 *  project is open, so the demo is what starts the tour. Installed once per page, so a reload
 *  keeps whatever the app has stored since. */
async function installPortfolioTursoMode(page: Page, current: string | null): Promise<void> {
  await page.addInitScript((currentId) => {
    if (sessionStorage.getItem("demo-trends-live:installed")) return;
    sessionStorage.setItem("demo-trends-live:installed", "1");
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify(currentId ? { tourSeen: true, storageConfig: { kind: "turso" } } : { storageConfig: { kind: "turso" } }),
    );
    localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    if (currentId) localStorage.setItem("aipm-cockpit:turso-current-project", currentId);
    else localStorage.removeItem("aipm-cockpit:turso-current-project");
  }, current);
}

/** The demo opened with the guided tour; dismiss it. */
async function expectTourThenSkip(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  await expect(skip, "the demo did not open with the guided tour").toBeVisible({ timeout: 60_000 });
  await skip.click();
  await expect(skip).toHaveCount(0);
}

/** Trends lists every stored snapshot, one row each, and marks exactly one baseline. */
async function expectTrendsHistory(page: Page, shotName: string, stored: number): Promise<void> {
  // Trends is a child of Dashboard in the sidebar, rendered only while that group is open.
  await openView(page, "Dashboard");
  await openView(page, "Trends");
  const rows = page.getByRole("checkbox", { name: /^Select snapshot/ });
  await expect(rows, "Trends does not list one row per stored snapshot").toHaveCount(stored, { timeout: 30_000 });
  await expect(page.locator("td").filter({ hasText: /^★$/ }), "Trends does not mark exactly one baseline").toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath(`${shotName}.png`), fullPage: false });
}

async function createAndVerify(
  page: Page,
  current: string | null,
  startFrom: () => Promise<void>,
  shotName: string,
): Promise<void> {
  await installPortfolioTursoMode(page, current);
  await page.goto("/");
  await startFrom();

  await expectTourThenSkip(page);
  await expect.poll(demoProjectIds, { message: "no demo project row reached the database", timeout: 60_000 }).toHaveLength(1);
  const [id] = await demoProjectIds();
  // Read once the current week's own capture has landed: read before it, the database says 23
  // while Trends goes on to show 24.
  await expect
    .poll(async () => (await snapshotCounts(id)).live, { message: "the app never captured the current week", timeout: 60_000 })
    .toBe(1);
  const counts = await snapshotCounts(id);
  expect(counts.seeded, "the stored history is not the seeded weeks the app computes for today").toBe(expectedWeeks());
  expect(counts.baselines, "the stored history does not have exactly one baseline").toBe(1);
  expect(counts.live, "more than the current week's own capture sits beside the seed").toBe(1);
  test.info().annotations.push({ type: "demo history", description: `${counts.seeded} seeded weeks + ${counts.live} live capture` });
  await expectTrendsHistory(page, shotName, counts.seeded + counts.live);

  // The project opens again after a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(DEMO_NAME.replace(/[()]/g, "\\$&")) }).first(), "the demo did not reopen after a reload").toBeVisible({ timeout: 60_000 });
  // The same history: the reload neither lost a week nor captured a second one.
  expect(await snapshotCounts(id), "the reload changed the stored history").toEqual(counts);
  await expectTrendsHistory(page, `${shotName}-after-reload`, counts.seeded + counts.live);

  // Deleted with the app's own hard delete, from this process: the Projects panel cannot
  // archive the open project, and the demo is the only one, so there is no UI path to it.
  await removeDemos();
  expect(await demoProjectIds(), "the demo project row is still in the database").toEqual([]);
  expect(await snapshotCounts(id), "the deleted demo left snapshots behind").toEqual({ seeded: 0, live: 0, baselines: 0 });
}

test.describe("§696 — the demo's Trends history on a live Turso database", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(() => !appIsThrowaway(), SKIP_APP_NOT_THROWAWAY);
  test.describe.configure({ mode: "serial" });
  // Two app loads, the demo's own creation and two Trends visits per test.
  test.setTimeout(240_000);

  let blockedHosts: string[] = [];
  test.beforeEach(async ({ page }) => {
    blockedHosts = await guardAppDatabase(page);
  });
  test.afterEach(() => {
    expect(blockedHosts.length, "the app called a Turso database other than the throwaway one").toBe(0);
  });

  test.beforeAll(async () => {
    if (!appIsThrowaway()) return;
    await ensureTenantSchema();
    await removeAll();
  });
  test.afterAll(async () => {
    if (!appIsThrowaway()) return;
    await removeAll().catch((err: unknown) => {
      console.warn(`demo cleanup failed (${err instanceof Error ? err.name : typeof err})`);
    });
  });

  test("from the start screen's card", async ({ page }) => {
    await createAndVerify(
      page,
      null,
      async () => {
        await page.getByRole("button", { name: "Explore the demo", exact: true }).click();
      },
      "trends-from-start-card",
    );
  });

  test("from the Projects panel", async ({ page }) => {
    await seedHostProject();
    await createAndVerify(
      page,
      HOST_ID,
      async () => {
        await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
        await openView(page, "Projects");
        await page.getByRole("button", { name: "Explore a demo project", exact: true }).click();
      },
      "trends-from-projects-panel",
    );
  });
});
