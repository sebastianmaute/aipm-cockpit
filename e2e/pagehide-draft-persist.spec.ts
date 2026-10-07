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
//    SAME context, which then loads the app; the draft must be in IndexedDB,
//    and the load must consume the journal with no conflict notice.
// Plus: a heading blur-then-immediate-reload (the debounce paused, so only the
// journal can carry it), a task-cell tab close whose own IndexedDB write ALSO
// landed (the journal already landed: cleared silently), and a base mismatch
// that must show the conflict notice, once per action (Discard, Restore anyway).
//
// ★★★ READ THE JOURNAL WITH A POLL AFTER A CLOSE. `page.close({ runBeforeUnload:
// true })` resolves before the closing page has finished its `pagehide`
// handlers. Measured 2026-09-27 (diag-heading-close): the heading's handler runs
// a synchronous ~115-128 ms `flushSync` re-render of the Documents view before
// the journal write, so a one-shot read by the new page saw null in 3 of 3
// runs, while a read 1 s later held the draft. The task cell's (~50 ms) won the
// same race. So every journal read after a close is `expect.poll`.
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
//    use-storage-backend.ts's load effect with `null` turns RED every reload
//    test (the blur-then-reload one included), both tab-close tests, the
//    landed-journal test and both mismatch tests; see §629 for the run;
//  - deleting the already-landed branch of `restoreOnLoad` (use-unload-journal.ts)
//    turns the task cell's tab-close test and the landed-journal test RED;
//  - deleting the `page.clock.pauseAt` in the blur-then-reload test turns it
//    RED at its premise (the debounced save landed before the reload).
//  Re-do all four before trusting a run after a refactor of the unload path.
//
// Run on a free port. The run boots its own server from THIS checkout and stops it
// afterwards; on a taken port it refuses rather than attaching (since §58 (b)):
//   PORT=3107 npx playwright test e2e/pagehide-draft-persist.spec.ts --project=chromium --workers=1
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

/** The load consumed this project's key — restored and cleared by its save-back's
 *  confirmation, or cleared at once as already landed — and raised no conflict notice. */
async function expectJournalConsumed(page: Page): Promise<void> {
  await expect.poll(() => readJournal(page), { message: "the load must consume the journal" }).toBeNull();
  await expect(page.getByRole("region", { name: CONFLICT_NOTICE })).toHaveCount(0);
}

/** A tab close: the closing page's `pagehide` must have written `marker` into the
 *  journal. Polled — see the header on why a one-shot read races the close. */
async function expectJournalWritten(reader: Page, marker: string): Promise<void> {
  await expect
    .poll(() => readJournal(reader), { message: "the closing page's pagehide must have written the journal" })
    .toContain(marker);
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

// A tab close has two race outcomes on this backend, and each must end with the
// draft stored and the journal consumed without a notice: the closing page's own
// IndexedDB write lands (the journal's content is then what loads, so it is
// cleared as already landed), or it does not (the journal's base matches, so it
// is restored and saved back). Which one ran is pinned only by the landed-journal
// test below, which asserts its premise.
const EDITORS = [
  { name: "document heading (useBlockDraft)", where: { kv: "documents" } as Where, type: typeHeadingDraft },
  { name: "task name inline cell (useInlineCellEdit)", where: { store: "tasks" } as Where, type: typeTaskNameDraft },
];

test.describe("a draft committed on pagehide: does it survive the unload? (IndexedDB, Chromium)", () => {
  test.beforeEach(async ({ context }) => {
    // The guided tour's backdrop would take the real pointer clicks below.
    // On the CONTEXT, so the tab-close tests' second page gets it too.
    await context.addInitScript(() => {
      localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    });
  });

  EDITORS.forEach(({ name, where, type }, i) => {
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
      const marker = `zqpagehide${i}c`;
      await type(page, marker);
      await expectAbsentBeforeUnload(page, where, marker);
      await page.close({ runBeforeUnload: true });
      const next = await sameOriginReader(context);
      await expectJournalWritten(next, marker);
      await gotoApp(next);
      await expectLanded(next, where, marker);
      await expectJournalConsumed(next);
    });
  });

  test("task name inline cell: a tab close whose own IndexedDB write also landed — the journal clears silently", async ({ page, context }) => {
    const where: Where = { store: "tasks" };
    const marker = "zqpagehidelanded";
    await typeTaskNameDraft(page, marker);
    await expectAbsentBeforeUnload(page, where, marker);
    await page.close({ runBeforeUnload: true });
    const next = await sameOriginReader(context);
    await expectJournalWritten(next, marker);
    // The premise, read before any app code runs on this page: the close's save
    // landed too, so the journal's content IS what the next load returns.
    await expect
      .poll(() => storedContains(next, where, marker), { message: "premise: the closing page's IndexedDB write landed" })
      .toBe(true);
    await gotoApp(next);
    await expectJournalConsumed(next);
    expect(await storedContains(next, where, marker), "the landed value stays stored").toBe(true);
  });

  test("document heading: blur then an immediate reload — the committed value survives", async ({ page }) => {
    const where: Where = { kv: "documents" };
    const marker = "zqpagehideblur";
    await typeHeadingDraft(page, marker);
    // Pause the (installed, see gotoApp) clock BEFORE the blur: the debounced save
    // (500 ms) it schedules then cannot run before the reload, so the flush the
    // reload's pagehide starts, and the journal it writes, are the only path.
    // A second ahead of the page's clock, which keeps running while the call is in flight.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await page.keyboard.press("Tab");
    await expect(headingInput(page)).not.toBeFocused();
    // Twice the debounce in REAL time: a running clock would have saved by now.
    await page.waitForTimeout(1_000);
    await expectAbsentBeforeUnload(page, where, marker);
    await page.reload();
    await page.clock.resume(); // the restored workspace's save-back needs its debounce to run
    await expect(page.locator("main").first()).toBeVisible({ timeout: 60_000 });
    await expectLanded(page, where, marker);
    await expectJournalConsumed(page);
  });

  const RESOLUTIONS = [
    { action: "Discard", applied: false },
    { action: "Restore anyway", applied: true },
  ] as const;

  RESOLUTIONS.forEach(({ action, applied }, i) => {
    test(`a journal whose base no longer matches shows the conflict notice; ${action} resolves it`, async ({ page, context }) => {
      const where: Where = { kv: "documents" };
      const drafted = `zqpagehidemm${i}a`;
      const changed = `zqpagehidemm${i}b`;
      // 1. A journal: an unblurred task-name draft, then the pagehide of a tab close.
      await typeTaskNameDraft(page, drafted);
      await page.close({ runBeforeUnload: true });
      const next = await sameOriginReader(context);
      await expectJournalWritten(next, drafted);
      const journal = await readJournal(next);
      // 2. Set it aside, so the app's next load does not act on it, and change the
      //    stored project through the app's own save path (a blur commit). The
      //    close's own IndexedDB write may already have moved the stored project
      //    off the journal's base (it did in 2 of 2 probe runs on 2026-09-27, before
      //    the landed-journal fix); this step makes
      //    the mismatch certain either way. It also keeps the journal's CONTENT
      //    off what the reload loads, which a landed close write alone would not:
      //    that load would clear the journal silently. And it gives the last
      //    assertion something to tell "applied" from "not applied" by.
      await next.evaluate((key) => localStorage.removeItem(key), JOURNAL_KEY);
      await typeHeadingDraft(next, changed);
      await next.keyboard.press("Tab");
      await expectLanded(next, where, changed);
      // 3. Put the journal back: its base and its content both differ from what the
      //    reload loads, so the notice must show.
      await next.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: JOURNAL_KEY, value: journal as string });
      await reload(next);
      const notice = next.getByRole("region", { name: CONFLICT_NOTICE });
      await expect(notice).toBeVisible();
      expect(await readJournal(next), "the notice describes the set-aside journal, kept in place").toContain(drafted);
      // 4. The action: the notice goes and so does the key (Discard removes it; Restore
      //    anyway's save-back confirmation clears it).
      await notice.getByRole("button", { name: action }).click();
      await expect(notice).toHaveCount(0);
      await expect.poll(() => readJournal(next), { message: `${action} must end with the journal key removed` }).toBeNull();
      if (applied) {
        // The journal predates step 2, so applying it and saving it back drops `changed`.
        await expect
          .poll(() => storedContains(next, where, changed), { message: "Restore anyway must apply and save the journal" })
          .toBe(false);
      } else {
        await openDocumentBlockEditor(next);
        await expect(headingInput(next), "a discarded journal is not applied").toHaveValue(new RegExp(`${changed}$`));
      }
    });
  });
});
