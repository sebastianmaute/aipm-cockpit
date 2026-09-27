// e2e/pagehide-draft-persist.spec.ts
//
// Measures, in real Chromium, whether a draft committed on `pagehide` (§622,
// §625) SURVIVES the unload, not merely whether it is committed. Every unit
// test of `useCommitOnPageHide` stubs the save synchronously, so none of them
// can see whether the asynchronous backend write the commit starts survives the
// unload. This file can.
//
// ★★★ SCOPE: ONE BACKEND. The seed fixture's project uses `kind: "browser"`
// (IndexedDB), which is also the app's `defaultStorageConfig`. The local file,
// SharePoint, Turso and the packaged desktop app are not covered; see §629.
//
// ★★★ HISTORY (2026-09-27, before §629's fix): the draft was committed and its
// save started, but on a REAL reload the IndexedDB write never landed, and on a
// tab close it did not land for the heading (the task cell's won the race).
//
// ★★★ WITH THE UNLOAD JOURNAL (§629, src/app/unload-journal.ts): the outgoing
// workspace is written synchronously to localStorage at `pagehide`, and the next
// load restores it when its base fingerprint matches what the backend returned
// (use-unload-journal.ts). The tests per editor:
//  - "page stays": a `pagehide` dispatched while the page stays alive. The
//    commit runs and the save it starts lands. This proves the commit path and
//    the storage reader below, so a red elsewhere is not a blind reader.
//  - "reload": the draft is in IndexedDB after the reload, restored from the
//    journal and saved back, and that save's confirmation clears the journal.
//  - "tab close" (`page.close({ runBeforeUnload: true })`): the journal the
//    closing page wrote is read back from localStorage by a NEW page in the
//    SAME context, which then loads the app; the draft must be in IndexedDB.
//    The heading's is `test.fail` — see `tabCloseFails`.
// Plus: a heading blur-then-immediate-reload, and a base mismatch that must
// show the conflict notice, whose Discard removes the key.
//
// ★★★ THE LOAD-BEARING ASSERTIONS ARE ON STORAGE (IndexedDB and the journal's
//  localStorage key), not the UI. Before the unload the typed marker must be
//  ABSENT from IndexedDB: the draft lives only in component state, so the only
//  way it can reach storage is the `pagehide` path. Without that premise a save
//  from any other trigger would pass.
//
// ★★ NEGATIVE CONTROLS, run by hand on 2026-09-27:
//  - turning the `useCommitOnPageHide(...)` call into a bare, never-called
//    arrow in `useBlockDraft` (document-block-editors.tsx) and in
//    `useInlineCellEdit` (use-inline-cell-edit.ts) turns BOTH "page stays"
//    tests RED at their storage assertion;
//  - replacing the `unloadJournal.restoreOnLoad(...)` call in
//    use-storage-backend.ts's load effect with `null` turns the reload tests
//    RED; see §629 for the run.
//  Re-do both before trusting a run after a refactor of the unload path.
//
// Run against a fresh server from THIS checkout, never one another worktree
// started on the default port (`reuseExistingServer` would attach to it):
//   PORT=3107 npx playwright test e2e/pagehide-draft-persist.spec.ts --project=chromium --workers=1
//   PORT=3107 npm run stop
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

type Where = { kv: string } | { store: string };

/** The journal key for the seeded project: `journalProjectKey` in
 *  src/app/unload-journal.ts returns the registry's `currentProjectId` for a
 *  non-Turso kind, and seed.ts's registry sets it to "e2e-1". */
const JOURNAL_KEY = "aipm-cockpit:unload-journal:e2e-1";

/** The conflict notice's accessible name: i18n.ts `unloadJournalConflict` (EN). */
const CONFLICT_NOTICE =
  "Unsaved changes from your last session could not be restored automatically because this project was changed elsewhere since.";

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

async function readJournal(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY);
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

function headingInput(page: Page) {
  return page.getByRole("textbox", { name: /^Heading text – Block \d+$/ }).first();
}

/** Types `marker` at the end of the first heading block and leaves it focused. */
async function typeHeadingDraft(page: Page, marker: string): Promise<void> {
  await gotoApp(page);
  await openDocumentBlockEditor(page);
  const heading = headingInput(page);
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
    "premise: the uncommitted or unsaved draft must not be in storage before the unload",
  ).toBe(false);
}

async function expectLanded(page: Page, where: Where, marker: string): Promise<void> {
  await expect
    .poll(() => storedContains(page, where, marker), {
      message: "the draft must have landed in IndexedDB",
    })
    .toBe(true);
}

/** The restored journal's save-back confirmed and cleared this project's key,
 *  and no conflict notice was raised for it. */
async function expectJournalConsumed(page: Page): Promise<void> {
  await expect.poll(() => readJournal(page), { message: "the confirmed save-back must clear the journal" }).toBeNull();
  await expect(page.getByRole("region", { name: CONFLICT_NOTICE })).toHaveCount(0);
}

async function pageHideWhilePageStays(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
}

/** A new page in the SAME context (same localStorage and IndexedDB), parked on
 *  a same-origin document that runs no app code. */
async function sameOriginReader(context: BrowserContext): Promise<Page> {
  const reader = await context.newPage();
  await reader.goto("/favicon.ico");
  return reader;
}

// ★★ `tabCloseFails`: measured 2026-09-27 with the journal in place (see §629).
//  - The heading's tab close writes NO journal: the new page reads null. Its
//    reload does write one, so the heading's commit reaches `doSave` too late
//    for a close, though not for a reload. Pinned as `test.fail`.
//  - The task cell's tab close writes the journal inside the event, and its
//    IndexedDB write ALSO won the race (as before the journal). The next load
//    then holds the draft AND a journal whose base no longer matches, so the
//    conflict notice shows and the journal stays. Both race outcomes put the
//    draft in IndexedDB (landed, or restored), so only that is asserted; the
//    journal's consumption is not.
const EDITORS = [
  { name: "document heading (useBlockDraft)", where: { kv: "documents" } as Where, type: typeHeadingDraft, tabCloseFails: true },
  { name: "task name inline cell (useInlineCellEdit)", where: { store: "tasks" } as Where, type: typeTaskNameDraft, tabCloseFails: false },
];

test.describe("a draft committed on pagehide: does it survive the unload? (IndexedDB, Chromium)", () => {
  test.beforeEach(async ({ context }) => {
    // The guided tour's backdrop would take the real pointer clicks below.
    // On the CONTEXT, so the tab-close tests' second page gets it too.
    await context.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
  });

  EDITORS.forEach(({ name, where, type, tabCloseFails }, i) => {
    test(`${name}: page stays — the commit's save lands`, async ({ page }) => {
      const marker = `zqpagehide${i}a`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await pageHideWhilePageStays(page);
      await expectLanded(page, where, marker);
    });

    test(`${name}: reload — the draft survives via the unload journal`, async ({ page }) => {
      const marker = `zqpagehide${i}b`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await reload(page);
      await expectLanded(page, where, marker);
      await expectJournalConsumed(page);
    });

    test(`${name}: tab close — a new page reads the journal back, and the draft is stored`, async ({ page, context }) => {
      test.fail(tabCloseFails, "§629: the heading's tab close writes no unload journal in Chromium");
      const marker = `zqpagehide${i}c`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await page.close({ runBeforeUnload: true });
      const next = await sameOriginReader(context);
      expect(await readJournal(next), "the closing page's pagehide must have written the journal").toContain(marker);
      await gotoApp(next);
      await expectLanded(next, where, marker);
    });
  });

  test("document heading: blur then an immediate reload — the committed value survives", async ({ page }) => {
    const where: Where = { kv: "documents" };
    const marker = "zqpagehideblur";
    await typeHeadingDraft(page, marker);
    // Commit by blur: the debounced save (SAVE_DEBOUNCE_MS, 500) is scheduled, not yet run.
    await page.keyboard.press("Tab");
    await expect(headingInput(page)).not.toBeFocused();
    await expectAbsentBeforeUnload(page, where, marker);
    await reload(page);
    await expectLanded(page, where, marker);
    await expectJournalConsumed(page);
  });

  test("a journal whose base no longer matches shows the conflict notice; Discard removes it", async ({ page, context }) => {
    const where: Where = { kv: "documents" };
    const drafted = "zqpagehidemma";
    const changed = "zqpagehidemmb";
    // 1. A journal: an unblurred task-name draft, then the pagehide of a tab
    //    close — the editor whose close writes it (see `tabCloseFails`). Whether
    //    its IndexedDB write also lands does not matter: step 2 changes the
    //    stored project either way.
    await typeTaskNameDraft(page, drafted);
    await page.close({ runBeforeUnload: true });
    const next = await sameOriginReader(context);
    const journal = await readJournal(next);
    expect(journal, "the closing page's pagehide must have written the journal").toContain(drafted);
    // 2. Set it aside, so the app's next load does not restore it, and change the
    //    stored project through the app's own save path (a blur commit).
    await next.evaluate((key) => localStorage.removeItem(key), JOURNAL_KEY);
    await typeHeadingDraft(next, changed);
    await next.keyboard.press("Tab");
    await expectLanded(next, where, changed);
    await expect.poll(() => readJournal(next), { message: "a visible page's save writes no journal" }).toBeNull();
    // 3. Put the journal back: its base is the fingerprint of the project BEFORE
    //    the change, so the reload's load cannot match it.
    await next.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: JOURNAL_KEY, value: journal as string });
    await reload(next);
    const notice = next.getByRole("region", { name: CONFLICT_NOTICE });
    await expect(notice).toBeVisible();
    expect(await readJournal(next), "the notice describes the set-aside journal, kept in place").toContain(drafted);
    // 4. Discard: the notice goes and so does the key; the changed project stays.
    await notice.getByRole("button", { name: "Discard" }).click();
    await expect(notice).toHaveCount(0);
    expect(await readJournal(next), "Discard must remove the journal key").toBeNull();
    await openDocumentBlockEditor(next);
    await expect(headingInput(next), "a mismatched journal is not applied").toHaveValue(new RegExp(`${changed}$`));
  });
});
