import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";

/**
 * §234 — switching a LIVE workspace from one storage backend to another, end to
 * end, through the Settings control that does it. That is the flow that moves
 * data, and nothing else drives it: the Turso specs reach their database through
 * `NEXT_PUBLIC_TURSO_DATABASE_URL`, never through this switch.
 *
 * Browser (IndexedDB, the seed) → Local JSON file. Headless Chromium cannot
 * show a save picker, so `showSaveFilePicker` is stubbed to hand back a FAKE
 * file handle whose bytes live on `window.__e2eFile`. Everything after the pick
 * is the product: the conversion confirm, `onRequestStorageSwitch`'s forced
 * write of the live workspace through `LocalFileBackend`, the hand-over to the
 * new backend, and its load when "Reload project" asks for one.
 *
 * ★★ WHAT THIS DOES NOT PROVE: that a real file is written. The app's write and
 *  read-back go through the File System Access INTERFACE, against the fake. A
 *  real origin-private (OPFS) handle was tried first and dropped: headless
 *  Chromium crashes the whole browser when it reads an OPFS handle back out of
 *  IndexedDB, which the app does with the handle it stores.
 *
 * ★ This stub is installed per PAGE, after the seed's per-CONTEXT in-memory stub,
 *  so it is the one the app sees.
 *
 * Run on a free port. The run boots its own server from THIS checkout and stops it
 * afterwards; on a taken port it refuses rather than attaching (since §58 (b)):
 *   PORT=3250 npx playwright test e2e/storage-switch.spec.ts --project=chromium --workers=1
 */

/** Skip the welcome tour, whose modal would sit over every control. Only when no
 *  settings exist yet, so a later navigation never resets what the app stored. */
async function skipTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = "aipm-cockpit:settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ tourSeen: true }));
  });
}

const FILE = "e2e-storage-switch.json";

test("switching Browser → Local JSON file writes the live workspace there, and the app then reads the file", async ({ page }) => {
  await skipTour(page);
  await page.addInitScript((name) => {
    // A file handle whose bytes live on `window.__e2eFile`, where the test reads
    // and edits them. A CLASS, so the app can store an instance in IndexedDB:
    // the methods sit on the prototype and the instance clones as its own fields.
    const w = window as unknown as { __e2eFile: string; showSaveFilePicker: unknown };
    w.__e2eFile = "";
    // A real file's lastModified moves only on a write; the app's save-revision check reads it.
    let mtime = 1;
    class E2EFileHandle {
      readonly kind = "file";
      readonly name = name;
      async queryPermission(): Promise<string> { return "granted"; }
      async requestPermission(): Promise<string> { return "granted"; }
      async getFile(): Promise<File> { return new File([w.__e2eFile], name, { type: "application/json", lastModified: mtime }); }
      async createWritable() {
        return {
          write: async (c: unknown) => { w.__e2eFile = typeof c === "string" ? c : await new Blob([c as BlobPart]).text(); },
          close: async () => { mtime += 1; },
          abort: async () => {},
        };
      }
    }
    w.showSaveFilePicker = async () => new E2EFileHandle();
  }, FILE);

  await gotoApp(page);
  await openView(page, "Settings");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("combobox", { name: "Storage", exact: true }).selectOption("local-json");
  await expect(page.getByText("Converted and switched to Local JSON file.", { exact: true })).toBeVisible({ timeout: 20_000 });

  // The file holds the seeded workspace: every seeded task, by name.
  const file = await page.evaluate(() => (window as unknown as { __e2eFile: string }).__e2eFile);
  const written = JSON.parse(file) as { tasks: { id: number; taskName: string }[] };
  expect(written.tasks.map((t) => t.taskName).sort()).toEqual((SEED_WORKSPACE.tasks as { taskName: string }[]).map((t) => t.taskName).sort());

  // The app now reads the FILE: change a task in it, reload the project, and the
  // change shows on Open Points.
  const renamed = "zq renamed inside the JSON file";
  await page.evaluate((text) => {
    const w = window as unknown as { __e2eFile: string };
    const ws = JSON.parse(w.__e2eFile) as { tasks: { taskName: string }[] };
    ws.tasks[0].taskName = text;
    w.__e2eFile = JSON.stringify(ws);
  }, renamed);
  // Two controls carry this name (the project switcher's icon button and the storage section's button).
  await page.getByRole("button", { name: "Reload project", exact: true }).first().click();
  await openView(page, "Open Points");
  await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
