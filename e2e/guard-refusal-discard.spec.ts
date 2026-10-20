// open-followups §629: a restored journal whose save-back the destructive guard
// refuses loops on every reload, and the banner's "Discard this deletion" ends the
// loop. Measures that in installed Google Chrome. OPT-IN, never in CI:
//   $env:GUARD_LOOP_PROBE=1; $env:PORT=3108; npx playwright test e2e/guard-refusal-discard.spec.ts --project=chromium --workers=1
//
// ★ Installed Chrome (`channel: "chrome"`), because §629 asks for a real browser.
//   The unit tests in use-unload-journal.restore.test.tsx pin the same steps
//   against a stubbed backend; this spec drives the IndexedDB backend.
//
// ★★★ WHERE THE LOOP COMES FROM. A deliberate "Clear all" arms the guard's bypass
//   (`allowDestructiveSave`), so its own save is NOT refused. The loop needs the tab
//   to unload BEFORE that save lands: the journal then holds the cleared workspace,
//   and the next page load restores it with no bypass armed, so the guard refuses
//   the save-back. The spec pauses the page clock so the debounced save cannot run.
//
// ★★ WHY 1000 EXTRA TASKS. The guard refuses a mass deletion only when BOTH at least 5
//   records go AND at most 10% of them stay (`isMassDeletion` in
//   src/app/workspace-metrics.ts). SEED_WORKSPACE
//   holds 123 records by `workspaceRecordCount`, 42 of them tasks, so clearing its tasks
//   leaves 81 and is NOT refused. With 1000 more tasks, clearing all of them leaves 81 of
//   1123 (7.2%). Reproduce the count with vite-node on a scratch file that logs
//   `workspaceRecordCount(SEED_WORKSPACE)`.
//
// ★★★ THE LOAD-BEARING ASSERTIONS ARE ON STORAGE: the IndexedDB task count and
//   the journal key. The banner and the task list only show which step the app is on.
//
// ★★ NEGATIVE CONTROL, run by hand on 2026-10-20: disabling
//   `unloadJournal.dropUnconfirmed(journalProjectKey)` in `reloadCurrentProject`
//   (use-storage-backend.ts) turns this spec RED at "Discard left the journal"; 3 clean
//   runs of this version passed the same day. Re-do it before trusting a run after a
//   refactor of the unload path.
// ★★★ THAT CONTROL NEEDS THE CLOCK PAUSED AT DISCARD (step 3). After a Discard the
//   app also saves, and that save's confirmation (`noteSaveConfirmed` →
//   `clearUnloadJournal`) removes this tab's journal by itself. An earlier version of
//   this spec let it run, and stayed GREEN with `dropUnconfirmed` disabled; only with
//   both disabled did it go red.
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, reseedWorkspace, skipTour, waitForViewSettled } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { IDB_DB_NAME, IDB_ENTITY_STORES } from "../src/app/idb-layout";

test.use({ channel: "chrome" });
test.skip(!process.env.GUARD_LOOP_PROBE, "opt-in probe (§629): set GUARD_LOOP_PROBE=1");

/** `journalProjectKey` for the seeded project (seed.ts's registry: "e2e-1"). */
const JOURNAL_KEY = "aipm-cockpit:unload-journal:e2e-1";
const EXTRA = 1000;
const BANNER = "Saving is paused. A large deletion was withheld to protect your project."; // storageDestructiveBanner
const SEED_TASK = "Stakeholder workshop";

async function storedTaskCount(page: Page): Promise<number> {
  return page.evaluate(
    ({ db, store }) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(db);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(store, "readonly").objectStore(store).count();
          req.onerror = () => { open.result.close(); reject(req.error); };
          req.onsuccess = () => { open.result.close(); resolve(req.result); };
        };
      }),
    { db: IDB_DB_NAME, store: IDB_ENTITY_STORES.tasks },
  );
}

const readJournal = (page: Page) => page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY);

async function reloadToOpenPoints(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
  await openView(page, "Open Points");
  await waitForViewSettled(page);
}

test("§629: a refused journal save-back loops on reload, and Discard ends the loop", async ({ page }) => {
  test.setTimeout(240_000);
  const seedTasks = SEED_WORKSPACE.tasks as Array<Record<string, unknown>>;
  const total = seedTasks.length + EXTRA;
  const extra = Array.from({ length: EXTRA }, (_, i) => ({ ...seedTasks[0], id: 900_000 + i, taskName: `Bulk task ${i}`, jiraKey: undefined, noteLog: [] }));
  await reseedWorkspace(page, { tasks: extra });
  await skipTour(page);
  await gotoApp(page);
  await openView(page, "Open Points");
  await waitForViewSettled(page);
  expect(await storedTaskCount(page), "premise: the extra tasks are stored").toBe(total);
  await expect(page.getByText(SEED_TASK).first()).toBeVisible();

  // 1. Clear all tasks with the clock paused, so the debounced save never runs.
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByLabel("Type “yes, clear all tasks” to confirm").fill("yes, clear all tasks");
  // A second ahead of the page's clock, which keeps running while the call is in flight.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.getByRole("button", { name: "Clear all tasks", exact: true }).click();
  await expect(page.getByText(SEED_TASK)).toHaveCount(0);
  expect(await storedTaskCount(page), "premise: the deletion is not stored before the unload").toBe(total);

  // 2. The loop: each reload restores the cleared workspace from the journal, and
  //    the guard refuses its save-back. Storage never changes.
  for (const round of [1, 2]) {
    await page.reload();
    await page.clock.resume(); // the restored workspace's save-back needs its debounce to run
    await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
    await openView(page, "Open Points");
    await waitForViewSettled(page);
    await expect(page.getByText(BANNER), `round ${round}: the restore was not refused again`).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SEED_TASK), `round ${round}: seed tasks are showing, so the cleared workspace was not applied`).toHaveCount(0);
    expect(await readJournal(page), `round ${round}: no journal`).not.toBeNull();
    expect(await storedTaskCount(page), `round ${round}: storage changed`).toBe(total);
  }

  // 3. Discard: reload from storage, refusal cleared, journal dropped. The clock is
  //    paused first, so no debounced save can run and confirm: `dropUnconfirmed` is
  //    then the only thing that can remove the journal (see NEGATIVE CONTROLS).
  await page.getByRole("button", { name: "Discard this deletion", exact: true }).click();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.getByRole("button", { name: "Discard and reload", exact: true }).click();
  await expect(page.getByText(BANNER)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(SEED_TASK).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => readJournal(page), { message: "Discard left the journal" }).toBeNull();
  await page.clock.resume();

  // 4. The loop is over: a page reload restores nothing and refuses nothing. The
  //    UI checks pass at once; the journal and storage checks carry this step.
  await reloadToOpenPoints(page);
  await expect(page.getByText(SEED_TASK).first()).toBeVisible();
  await expect(page.getByText(BANNER)).toHaveCount(0);
  expect(await readJournal(page), "a journal came back after Discard").toBeNull();
  expect(await storedTaskCount(page), "Discard or the reload wrote the deletion").toBe(total);
});
