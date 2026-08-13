import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";

// open-followups §144(a): the browser-level proof of the toolbar keyboard
// contract. jsdom models tab order approximately, so the unit pins in
// rich-text-toolbar.test.tsx are necessary but not sufficient.
//
// ★ Reuses §144(b)'s reachable mount: the floating notes window, opened from a
// seeded task's notes badge on Open Points. Every other RichTextEditor mount
// sits behind a modal, an unscanned view, a non-default Settings section, or a
// closed <details>.
test("rich-text toolbar is one tab stop and arrows move within it", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Open Points");

  // DOM-click so the auto-launched guided tour overlay cannot intercept a real
  // pointer click. Assert it was found, so a rename fails loudly rather than
  // silently testing the Open Points table.
  const opened = await page.evaluate(() => {
    const btn = document.querySelector(
      'button[aria-label="Notes log – Design SSO architecture"]',
    );
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(opened, "Notes badge button not found on Open Points").toBe(true);
  await waitForViewSettled(page);

  await page.getByRole("button", { name: "Text style" }).first().focus();

  // ★★★ THE ROW MUST BE REACHABLE, and .focus() alone cannot show that — it
  // succeeds on a tabIndex=-1 element. Without this assertion the spec passes
  // unchanged in the one state that would make the whole feature unreachable:
  // every control at -1, so no Tab can ever enter the row. That state is not
  // hypothetical — it is exactly what a drifted `HANDLED` set produced
  // (undefined activeIndex → every ternary yields -1), and this spec is the
  // layer meant to backstop it.
  const entryTabIndex = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.tabIndex ?? null,
  );
  expect(entryTabIndex, "the focused control must be the row's tab stop").toBe(0);

  // Tag the row the focused control belongs to, so the Tab assertion below
  // cannot accidentally test a different toolbar.
  const tagged = await page.evaluate(() => {
    const row = document.activeElement?.closest('[role="toolbar"]');
    if (!row) return false;
    (row as HTMLElement).dataset.rovingProbe = "1";
    return true;
  });
  expect(tagged, 'focused control has no [role="toolbar"] ancestor').toBe(true);

  // ArrowRight moves focus WITHIN the row and changes no content.
  const before = await page.evaluate(
    () => document.querySelector(".ProseMirror")?.innerHTML ?? "",
  );
  await page.keyboard.press("ArrowRight");
  const afterArrow = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? "",
  );
  expect(afterArrow).toBe("Bold");
  const after = await page.evaluate(
    () => document.querySelector(".ProseMirror")?.innerHTML ?? "",
  );
  expect(after, "arrowing across the toolbar must not change the document").toBe(before);

  // ONE Tab leaves the row — the claim the whole slice rests on.
  await page.keyboard.press("Tab");
  const stillInside = await page.evaluate(() => {
    const row = document.querySelector('[data-roving-probe="1"]');
    return !!row && !!document.activeElement && row.contains(document.activeElement);
  });
  expect(stillInside, "one Tab should leave the toolbar row").toBe(false);
});
