import type { Page } from "@playwright/test";
import { test, expect, openView, reseedWorkspace, FROZEN_NOW } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";

// §679 (#602) and §680 (#603): a long note log, and a long draft, must stay reachable.
// Both are layout properties, which jsdom cannot measure, so they are pinned here.

const LONG = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6);
const NOTE_COUNT = 15;

function notes(): Record<string, unknown>[] {
  return Array.from({ length: NOTE_COUNT }, (_, i) => ({
    id: i + 1,
    authorName: "E2E",
    timestamp: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
    html: `<p>Note ${i + 1}: ${LONG}</p>`,
    text: `Note ${i + 1}: ${LONG}`,
  }));
}

/** The seed, with a long note log on task #3 and on every change. */
async function boot(page: Page): Promise<void> {
  const ws = structuredClone(SEED_WORKSPACE) as Record<string, unknown>;
  ws.tasks = (ws.tasks as Record<string, unknown>[]).map((t) => (t.id === 3 ? { ...t, noteLog: notes() } : t));
  ws.changes = (ws.changes as Record<string, unknown>[]).map((c) => ({ ...c, noteLog: notes() }));
  await page.addInitScript(() => localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true })));
  await reseedWorkspace(page, ws);
  await page.clock.install({ time: FROZEN_NOW });
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("note log scrolling (§679, §680)", () => {
  test("§679 the task editor's inline log has no scroller of its own, so the form reaches the oldest note", async ({ page }) => {
    await boot(page);
    await openView(page, "Open Points");
    // Task #3: #1 and #2 are Jira-synced and read-only.
    await page.getByRole("button", { name: /^#3 — click to edit/ }).first().click();
    const dialog = page.getByRole("dialog").first();
    const summary = dialog.locator("summary", { hasText: "Notes log" });
    await summary.scrollIntoViewIfNeeded();
    await summary.click();
    const list = dialog.locator("details ul").first();
    await expect(list.locator(":scope > li")).toHaveCount(NOTE_COUNT);

    // Neither the list nor the box around it scrolls: the form is the one scroller.
    const nested = await list.evaluate((ul) => {
      const box = ul.parentElement as HTMLElement;
      return {
        listOverflow: ul.scrollHeight - ul.clientHeight,
        boxOverflow: box.scrollHeight - box.clientHeight,
      };
    });
    expect(nested.listOverflow).toBeLessThanOrEqual(1);
    expect(nested.boxOverflow).toBeLessThanOrEqual(1);

    // Wheeling over the form reaches the oldest note inside the form's visible area.
    // (The middle of the form, not the list: the list now starts below the fold.)
    const formBox = await dialog.locator("form").first().boundingBox();
    await page.mouse.move(formBox!.x + formBox!.width / 2, formBox!.y + formBox!.height / 2);
    const oldest = list.locator(":scope > li").last();
    await expect(oldest).toContainText("Note 1:");
    const inView = () =>
      oldest.evaluate((li) => {
        const f = (li.closest("form") as HTMLElement).getBoundingClientRect();
        const r = li.getBoundingClientRect();
        return r.top >= f.top - 1 && r.bottom <= f.bottom + 1;
      });
    // Step the wheel and stop once the oldest note is fully inside the form: the fields
    // after the log could carry it past the top if the wheel ran straight to the end.
    let reached = await inView();
    for (let i = 0; i < 120 && !reached; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(30);
      reached = await inView();
    }
    expect(reached).toBe(true);
  });

  test("§680 a long draft in the floating notes window scrolls inside its composer, and the notes stay in view", async ({ page }) => {
    await boot(page);
    await openView(page, "Changes");
    // :visible because the RAID panel stays mounted (hidden) on every tab.
    await page.locator("tr[data-deeplink-row]:visible").first().locator("td").nth(2).click();
    await page.getByRole("dialog").first().getByRole("button", { name: /^Notes log \(/ }).click();
    const win = page.locator("[role=dialog].fixed.resize");
    await expect(win).toBeVisible();
    const composer = win.locator("[contenteditable=true]").first();
    await composer.click();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.insertText(`Line ${i}: ${LONG}`);
      await page.keyboard.press("Shift+Enter");
    }

    const geo = await win.evaluate((w) => {
      const ce = w.querySelector("[contenteditable=true]") as HTMLElement;
      const firstNote = w.querySelector("ul > li") as HTMLElement;
      const wr = w.getBoundingClientRect();
      const nr = firstNote.getBoundingClientRect();
      return {
        composerScrolls: ce.scrollHeight > ce.clientHeight + 1,
        composerBottom: ce.getBoundingClientRect().bottom,
        windowBottom: wr.bottom,
        noteTop: nr.top,
      };
    });
    expect(geo.composerScrolls).toBe(true);
    expect(geo.composerBottom).toBeLessThan(geo.windowBottom);
    expect(geo.noteTop).toBeLessThan(geo.windowBottom);
  });
});
