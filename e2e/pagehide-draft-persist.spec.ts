// e2e/pagehide-draft-persist.spec.ts
//
// Measures, in real Chromium, whether a draft committed on `pagehide` (§622,
// §625) LANDS in storage, not merely whether it is committed. Every unit test
// of `useCommitOnPageHide` stubs the save synchronously, so none of them can
// see whether the asynchronous backend write the commit starts survives the
// unload. This file can.
//
// ★★★ SCOPE: ONE BACKEND. The seed fixture's project uses `kind: "browser"`
// (IndexedDB), which is also the app's `defaultStorageConfig`. The local file,
// SharePoint, Turso and the packaged desktop app are not covered; see §629.
//
// ★★★ WHAT IT MEASURED (2026-09-27): the draft is committed and its save is
// started, but on a REAL reload the IndexedDB write does not land, and on a tab
// close it did not land for the heading (the task cell's won the race; see the
// note on `pinTabClose`). The tests per editor:
//  - "page stays": a `pagehide` dispatched while the page stays alive. The
//    commit runs and the save it starts lands. This proves the commit path and
//    the storage reader below, so the unload tests' red is not a blind reader.
//  - "reload" and "tab close" (`page.close({ runBeforeUnload: true })`):
//    `test.fail()`, the known defect §629. When §629 is fixed they pass,
//    Playwright reports the expected failure as an error, and the `test.fail`
//    lines must go.
//
// ★★★ THE LOAD-BEARING ASSERTIONS ARE ON THE IndexedDB RECORD, not the UI.
//  Before the unload the typed marker must be ABSENT from storage: the draft
//  lives only in component state, so the only way it can reach storage is the
//  `pagehide` path. Without that premise a save from any other trigger would
//  pass.
//
// ★★ NEGATIVE CONTROL, run by hand on 2026-09-27: turning the
//  `useCommitOnPageHide(...)` call into a bare, never-called arrow in
//  `useBlockDraft` (document-block-editors.tsx) and in `useInlineCellEdit`
//  (use-inline-cell-edit.ts) turns BOTH "page stays" tests RED at their storage
//  assertion. With `test.fail` removed, the reload and tab-close tests fail at
//  that same assertion, not earlier. Re-do both before trusting a run after a refactor of
//  the unload path.
//
// Run against a fresh server from THIS checkout, never one another worktree
// started on the default port (`reuseExistingServer` would attach to it):
//   PORT=3107 npx playwright test e2e/pagehide-draft-persist.spec.ts --project=chromium --workers=1
//   PORT=3107 npm run stop
import type { Page } from "@playwright/test";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

type Where = { kv: string } | { store: string };

/** True when the JSON of an IndexedDB `kv` record, or of a whole entity store,
 *  contains `marker`. Opens the app's database at its CURRENT version (no
 *  version argument) and closes it again, so it never upgrades anything. */
async function storedContains(page: Page, where: Where, marker: string): Promise<boolean> {
  return page.evaluate(
    ({ where, marker }) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open("aipm-cockpit");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const name = "kv" in where ? "kv" : where.store;
          const store = db.transaction(name, "readonly").objectStore(name);
          const req = "kv" in where ? store.get(where.kv) : store.getAll();
          req.onerror = () => { db.close(); reject(req.error); };
          req.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(req.result ?? null).includes(marker));
          };
        };
      }),
    { where, marker },
  );
}

async function openDocumentBlockEditor(page: Page): Promise<void> {
  await openView(page, "Documents");
  // Same DOM click as a11y.spec.ts; the label is pinned in both toggle states.
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Edit blocks");
    (btn as HTMLElement | undefined)?.click();
    return !!btn;
  });
  expect(clicked, "Edit blocks toggle not found in Documents").toBe(true);
  await waitForViewSettled(page);
}

/** Types `marker` at the end of the first heading block and leaves it focused. */
async function typeHeadingDraft(page: Page, marker: string): Promise<void> {
  await gotoApp(page);
  await openDocumentBlockEditor(page);
  const heading = page.getByRole("textbox", { name: /^Heading text – Block \d+$/ }).first();
  await heading.click();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${marker}`);
  await expect(heading).toHaveValue(new RegExp(`${marker}$`));
  await expect(heading, "the draft must still be unblurred at the unload").toBeFocused();
}

/** Types `marker` at the end of an inline-editable task name and leaves it focused. */
async function typeTaskNameDraft(page: Page, marker: string): Promise<void> {
  await gotoApp(page);
  await openView(page, "Open Points");
  // A row with inline cells (a Jira-linked row has none), then a double-click
  // on its name: a single click opens the edit modal instead.
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: /^Assignee – / }) }).first();
  await row.getByTitle(/^[^#].* — click to edit$/).dblclick();
  const input = page.getByRole("textbox", { name: /^Task name – / });
  await expect(input, "the draft must still be unblurred at the unload").toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${marker}`);
  await expect(input).toHaveValue(new RegExp(`${marker}$`));
}

async function expectAbsentBeforeUnload(page: Page, where: Where, marker: string): Promise<void> {
  expect(
    await storedContains(page, where, marker),
    "premise: the unblurred draft must not be in storage before the unload",
  ).toBe(false);
}

async function expectLanded(page: Page, where: Where, marker: string): Promise<void> {
  await expect
    .poll(() => storedContains(page, where, marker), {
      message: "the pagehide commit's save must have landed in IndexedDB",
    })
    .toBe(true);
}

async function pageHideWhilePageStays(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
}

const EDITORS = [
  { name: "document heading (useBlockDraft)", where: { kv: "documents" } as Where, type: typeHeadingDraft, pinTabClose: true },
  { name: "task name inline cell (useInlineCellEdit)", where: { store: "tasks" } as Where, type: typeTaskNameDraft, pinTabClose: false },
];

test.describe("a draft committed on pagehide: does its save land? (IndexedDB, Chromium)", () => {
  test.beforeEach(async ({ page }) => {
    // The guided tour's backdrop would take the real pointer clicks below.
    await page.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
  });

  EDITORS.forEach(({ name, where, type, pinTabClose }, i) => {
    test(`${name}: page stays — the commit's save lands`, async ({ page }) => {
      const marker = `zqpagehide${i}a`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await pageHideWhilePageStays(page);
      await expectLanded(page, where, marker);
    });

    test(`${name}: reload — the commit's save is lost (known defect §629)`, async ({ page }) => {
      test.fail(true, "§629: the IndexedDB write started on pagehide does not survive a real reload");
      const marker = `zqpagehide${i}b`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await reload(page);
      await expectLanded(page, where, marker);
    });

    // ★★ `pinTabClose` is set for the heading only. For the task-name cell a tab close LANDED in 5 of 5 runs
    //  on 2026-09-27 while its reload was lost in every run: the unload races
    //  the IndexedDB write and the smaller one can win. A race won is not a
    //  guarantee, so neither outcome is pinned for that editor (see §629).
    const testTabClose = pinTabClose ? test : test.skip;
    testTabClose(`${name}: tab close — the commit's save is lost (known defect §629)`, async ({ page, context }) => {
      test.fail(true, "§629: the IndexedDB write started on pagehide does not survive closing the tab");
      const marker = `zqpagehide${i}c`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await page.close({ runBeforeUnload: true });
      // A same-origin page in the same context reads the same IndexedDB.
      const reader = await context.newPage();
      await reader.goto("/favicon.ico");
      await expectLanded(reader, where, marker);
    });
  });
});
