// open-followups §661: does a local-file save that waits on its Web Lock at tab
// close reach the file? OPT-IN, never in CI:
//   $env:LOCAL_FILE_PROBE=1; npx playwright test e2e/local-file-close-save.spec.ts --project=chromium --workers=1
//
// ★★★ RUNS IN INSTALLED GOOGLE CHROME (`channel: "chrome"`), NOT PLAYWRIGHT'S
//     BUNDLED CHROMIUM. Measured 2026-10-08: the bundled Chromium closes the page
//     (no `crash` event, no console output) the moment a page reads a stored
//     Origin Private File System handle back out of IndexedDB after a reload, in a
//     page running no app code at all; installed Chrome and Edge read it fine.
//     The app's local-file backend restores its file from exactly such a stored
//     handle, so under the bundled build every local-file e2e dies on load. That
//     is what stopped the batch-16 attempt on this entry.
//
// The project is seeded directly rather than through the Settings conversion: an
// OPFS file holding the seed workspace, its handle in the slot LocalFileBackend
// reads (`kv` / `file-handle:local-json`), and `storageConfig` set to local-json.
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { workspaceToJson, type Workspace } from "../src/app/workspace";

test.use({ channel: "chrome" });
test.skip(!process.env.LOCAL_FILE_PROBE, "opt-in probe (§661): set LOCAL_FILE_PROBE=1");

const FILE = "close-save-661.json";
const TASK = "Stakeholder workshop"; // a seed task with no Jira key, so it edits inline

async function readFile(page: Page): Promise<string> {
  return page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(name)).getFile()).text();
  }, FILE);
}

test("§661: a tab closed with an unsaved local-file edit — the file misses it, the journal restores it", async ({ page, context }) => {
  test.setTimeout(180_000);
  const newName = `Close-save ${Date.now()}`;
  await page.addInitScript(() => {
    const k = "aipm-cockpit:settings";
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ tourSeen: true }));
  });
  // Boot once on the default backend so the app's IndexedDB exists, then seed the file project.
  await gotoApp(page);
  await waitForViewSettled(page);
  await page.evaluate(async ({ name, text }) => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("aipm-cockpit");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ handle: fh, binding: null }, "file-handle:local-json");
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    // A FRESH settings object, never the stored one read back: settings are a shallow
    // merge over defaults, and copying the stored blob would re-write whatever the app
    // put there (CodeQL flags that flow as clear-text secrets, rightly in general).
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true, storageConfig: { kind: "local-json" } }));
  }, { name: FILE, text: workspaceToJson(SEED_WORKSPACE as unknown as Workspace) });

  await page.reload();
  await gotoApp(page);
  await openView(page, "Open Points");
  await waitForViewSettled(page);
  // ANTI-VACUITY: the project really is the file (the sidebar names it).
  await expect(page.getByText(FILE)).toBeVisible();

  // Edit one task name inline and close the tab before the debounced save runs.
  await page.getByText(TASK, { exact: true }).first().dblclick();
  const input = page.locator("tr[data-deeplink-row] input:not([type=checkbox])").first();
  await expect(input).toBeVisible();
  await input.fill(newName);
  await input.press("Enter");
  await expect(page.getByText(newName)).toBeVisible();
  expect(await readFile(page), "the debounced save already ran; the edit no longer tests the close").not.toContain(newName);
  await page.close({ runBeforeUnload: true });

  // A fresh page on the origin reads the file and the journal.
  const p2 = await context.newPage();
  await p2.goto("/favicon.ico");
  await p2.waitForTimeout(1500);
  // MEASURED 2026-10-08, 3 of 3: the close-time save requests its lock and the tab is
  // gone before it writes, so the FILE does not have the edit. ★ This pins today's
  // defect, not the goal: if the file save stops waiting for its lock at close (the
  // other option §661 leaves to the owner), INVERT this assertion; do not delete it.
  expect(await readFile(p2), "the close-time save reached the file (the finding changed)").not.toContain(newName);
  const journal = await p2.evaluate(() =>
    Object.entries(localStorage).filter(([k]) => k.startsWith("aipm-cockpit:unload-journal:")).map(([, v]) => v).join(""));
  expect(journal, "the unload journal does not hold the edit").toContain(newName);

  // Reopening restores the edit from the journal and saves it to the file.
  await p2.goto("/");
  await openView(p2, "Open Points");
  await waitForViewSettled(p2);
  await expect(p2.getByText(newName)).toBeVisible();
  await expect.poll(() => readFile(p2), { timeout: 15_000 }).toContain(newName);
});
