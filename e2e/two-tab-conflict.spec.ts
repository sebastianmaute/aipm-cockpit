// e2e/two-tab-conflict.spec.ts
//
// §4 in real Chromium: two pages of ONE context (same IndexedDB, same
// BroadcastChannel, same Web Locks) open the seeded browser-storage project.
//  - An edit in B reaches A, and neither pauses: A adopts B's revision and does
//    not autosave content it only mirrored.
//  - A save that would overwrite a newer stored version pauses A with the
//    conflict banner, and nothing of A's reaches storage. Each resolution is
//    then driven through the banner: Reload, Overwrite, Download my version.
//
// ★★★ THE FOREIGN WRITER IS A REVISION BUMP, NOT A SECOND EDIT. BrowserBackend
// stamps an integer under the IndexedDB `kv` key "revision" on every save
// (KV_REVISION_KEY in src/app/browser-backend.ts) and refuses a save when the
// stored value is not the one it last loaded or wrote. `bumpStoredRevision`
// raises that value by one "behind A's back", holding the same Web Lock the
// app's saves take (BROWSER_SAVE_LOCK_NAME), so it can never interleave with a
// save in flight. It is what a write from another device or a closed tab
// looks like to A: the stored revision moved and A was never told.
//
// ★★ THE LOAD-BEARING ASSERTIONS ARE ON STORAGE. A refused save must leave A's
// marker absent from the `tasks` store; Overwrite must put it there; Reload and
// Overwrite are then read back through the UI of a page that loads from
// storage (A after Reload, B after a reload).
//
// ★ The conflict banner cannot be reached by e2e/a11y.spec.ts (its views load
// one page on a quiet seed, so nothing is ever paused), so the Download test
// runs axe itself on the page with the banner showing.
//
// Run against a fresh server from THIS checkout (`reuseExistingServer` would
// attach to another worktree's server on the default port):
//   PORT=3107 npx playwright test e2e/two-tab-conflict.spec.ts --project=chromium --workers=1
//   PORT=3107 npm run stop
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { test, expect, gotoApp, openView } from "./seed";

/** i18n.ts `storageSavePausedConflict` (EN). */
const CONFLICT_HEADLINE =
  "This project was changed in another tab or on another device. Your changes since then are not saved yet.";

/** True when the `tasks` store holds a record whose JSON contains `marker`. Opens
 *  the app's database at its CURRENT version, so it never upgrades anything. */
async function storedTasksContain(page: Page, marker: string): Promise<boolean> {
  return page.evaluate(
    (marker) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open("aipm-cockpit");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
          req.onerror = () => { db.close(); reject(req.error); };
          req.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(req.result).includes(marker));
          };
        };
      }),
    marker,
  );
}

async function storedRevision(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("aipm-cockpit");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("kv", "readonly").objectStore("kv").get("revision");
          req.onerror = () => { db.close(); reject(req.error); };
          req.onsuccess = () => { db.close(); resolve(Number(req.result ?? 0)); };
        };
      }),
  );
}

/** A foreign writer: raise the stored revision by one under the app's own save
 *  lock. Returns the new value. */
async function bumpStoredRevision(page: Page): Promise<number> {
  return page.evaluate(() =>
    navigator.locks.request("aipm-cockpit:save:browser", () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("aipm-cockpit");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("kv", "readwrite");
          const kv = tx.objectStore("kv");
          const req = kv.get("revision");
          let next = 0;
          req.onsuccess = () => {
            next = Number(req.result ?? 0) + 1;
            kv.put(next, "revision");
          };
          tx.oncomplete = () => { db.close(); resolve(next); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }),
    ),
  );
}

async function openProject(page: Page): Promise<void> {
  await gotoApp(page);
  await openView(page, "Open Points");
}

/** A and B: two pages of one context, both on Open Points. A is the fixture's
 *  page, whose IndexedDB the fixture seeded; B shares it. */
async function openTwo(page: Page, context: BrowserContext): Promise<{ a: Page; b: Page }> {
  await openProject(page);
  const b = await context.newPage();
  await openProject(b);
  return { a: page, b };
}

/** Appends ` marker` to the first inline-editable task name and commits it
 *  with Enter. The same row in every page, since both load the same seed. */
async function editFirstTaskName(page: Page, marker: string): Promise<void> {
  // A row with inline cells (a Jira-linked row has none), then a double-click
  // on its name: a single click opens the edit modal instead.
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: /^Assignee – / }) }).first();
  await row.getByTitle(/^[^#].* — click to edit$/).dblclick();
  const input = page.getByRole("textbox", { name: /^Task name – / });
  await expect(input).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${marker}`);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(page.getByText(marker).first()).toBeVisible();
}

function conflictBanner(page: Page): Locator {
  return page.getByRole("alert", { name: "Saving paused", exact: true }).filter({ hasText: CONFLICT_HEADLINE });
}

const PAUSED_ACTION = "Saving paused - show how to resolve it";

/** The sidebar footer's paused indicator (sidebar-footer.tsx). The pause's toast
 *  carries an action of the same name, so the indicator is found by its aria-label. */
function sidebarPaused(page: Page): Locator {
  return page.locator(`button[aria-label="${PAUSED_ACTION}"]`);
}

/** No banner and no sidebar indicator. (Not the toast: it times out on its own
 *  and may still be showing after a resolution.) */
async function expectNoPause(page: Page): Promise<void> {
  await expect(page.getByRole("alert", { name: "Saving paused", exact: true })).toHaveCount(0);
  await expect(sidebarPaused(page)).toHaveCount(0);
}

/** Bump the stored revision behind A's back, then edit in A: A must pause, and
 *  nothing of A's may reach storage. Returns the revision the pause was raised on. */
async function raiseConflict(a: Page, marker: string): Promise<number> {
  const bumped = await bumpStoredRevision(a);
  await editFirstTaskName(a, marker);
  await expect(conflictBanner(a)).toBeVisible();
  await expect(sidebarPaused(a)).toBeVisible();
  expect(await storedTasksContain(a, marker), "a refused save writes nothing").toBe(false);
  expect(await storedRevision(a), "a refused save stamps nothing").toBe(bumped);
  return bumped;
}

/** Clicks a banner action that confirms first, then the dialog's commit button. */
async function confirmBannerAction(page: Page, action: "Reload" | "Overwrite", commit: string): Promise<void> {
  await conflictBanner(page).getByRole("button", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: commit, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
  await openView(page, "Open Points");
}

test.describe("§4 two tabs on browser storage (IndexedDB, Chromium)", () => {
  test.beforeEach(async ({ context }) => {
    // The guided tour's backdrop would take the real pointer clicks below.
    await context.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
  });

  test("an edit in B is saved, mirrored to A, and pauses neither", async ({ page, context }) => {
    const { a, b } = await openTwo(page, context);
    const marker = "zqtwotabmirror";
    const before = await storedRevision(b);
    await editFirstTaskName(b, marker);
    await expect.poll(() => storedTasksContain(b, marker), { message: "B's edit must be saved" }).toBe(true);
    await expect(a.getByText(marker).first(), "B's edit must reach A").toBeVisible();
    expect(await storedRevision(b), "B's save stamps one new revision").toBe(before + 1);
    await expectNoPause(a);
    await expectNoPause(b);
    // A adopted B's revision: its own next edit saves without a pause.
    const own = "zqtwotabafter";
    await editFirstTaskName(a, own);
    await expect.poll(() => storedTasksContain(a, own), { message: "A's own edit after the mirror must save" }).toBe(true);
    await expectNoPause(a);
    await expectNoPause(b);
  });

  test("a stale save pauses A; Reload shows the stored version and saving resumes", async ({ page, context }) => {
    const { a } = await openTwo(page, context);
    const refused = "zqtwotabreload";
    await raiseConflict(a, refused);

    await confirmBannerAction(a, "Reload", "Discard my changes and reload");
    await expect(conflictBanner(a)).toHaveCount(0);
    await expectNoPause(a);
    await expect(a.getByText(refused), "Reload shows the stored version").toHaveCount(0);

    const next = "zqtwotabresumed";
    await editFirstTaskName(a, next);
    await expect.poll(() => storedTasksContain(a, next), { message: "A's next edit after Reload must save" }).toBe(true);
    await expectNoPause(a);
  });

  test("Overwrite writes A's version, and B's next load shows it", async ({ page, context }) => {
    const { a, b } = await openTwo(page, context);
    const mine = "zqtwotaboverwrite";
    const bumped = await raiseConflict(a, mine);

    await confirmBannerAction(a, "Overwrite", "Overwrite the other version");
    await expect.poll(() => storedTasksContain(a, mine), { message: "Overwrite must write A's version" }).toBe(true);
    await expect.poll(() => storedRevision(a), { message: "Overwrite stamps past the revision it replaced" }).toBe(bumped + 1);
    await expect(conflictBanner(a)).toHaveCount(0);
    await expectNoPause(a);

    await reload(b);
    await expect(b.getByText(mine).first(), "B's next load shows A's version").toBeVisible();
    await expectNoPause(b);
  });

  // ★★ Overwrite is CONDITIONAL: it replaces storage only while storage still holds the revision the
  // pause was raised on (use-conflict-resolution.ts arms `forceNextSave(seen)`). A blind overwrite
  // passes the test above, so this one moves storage AGAIN while the banner shows.
  test("Overwrite refuses when the other version moved again after the banner was shown", async ({ page, context }) => {
    const { a } = await openTwo(page, context);
    const mine = "zqtwotabmovedagain";
    const shown = await raiseConflict(a, mine);
    const movedAgain = await bumpStoredRevision(a);
    expect(movedAgain).toBe(shown + 1);

    await confirmBannerAction(a, "Overwrite", "Overwrite the other version");
    // The gate reopens (the banner goes), the next autosave is refused, and the pause returns.
    await expect(conflictBanner(a), "the Overwrite reopens the save gate").toHaveCount(0);
    await expect(conflictBanner(a), "a refused Overwrite pauses again").toBeVisible();
    await expect(sidebarPaused(a)).toBeVisible();
    expect(await storedTasksContain(a, mine), "an Overwrite of a version nobody was shown writes nothing").toBe(false);
    expect(await storedRevision(a), "a refused Overwrite stamps nothing").toBe(movedAgain);

    // The new pause was raised on the newer version, so its Overwrite may replace that one.
    await confirmBannerAction(a, "Overwrite", "Overwrite the other version");
    await expect.poll(() => storedTasksContain(a, mine), { message: "the second Overwrite writes A's version" }).toBe(true);
    await expect.poll(() => storedRevision(a)).toBe(movedAgain + 1);
    await expectNoPause(a);
  });

  test("Download my version downloads a conflict file and keeps the pause; the banner passes axe", async ({ page, context }) => {
    const { a } = await openTwo(page, context);
    const mine = "zqtwotabdownload";
    await raiseConflict(a, mine);

    const results = await new AxeBuilder({ page: a })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = blocking.map((v) => `${v.impact} · ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n");
    expect(blocking, `conflict banner a11y violations:\n${summary}`).toEqual([]);

    const download = a.waitForEvent("download");
    await conflictBanner(a).getByRole("button", { name: "Download my version", exact: true }).click();
    expect((await download).suggestedFilename()).toContain("conflict");
    await expect(conflictBanner(a), "Download leaves the pause standing").toBeVisible();
    await expect(sidebarPaused(a)).toBeVisible();
    expect(await storedTasksContain(a, mine), "Download writes nothing to storage").toBe(false);
  });
});
