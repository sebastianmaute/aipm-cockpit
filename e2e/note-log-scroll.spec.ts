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
  // Since 2026-10-08 the task editor has no inline log: its button pops out the
  // floating window, like the Change and RAID editors (the owner's request). §679
  // is then the window's list reaching the oldest note of a long log.
  test("§679 the task editor's Notes log button opens the floating window, whose list reaches the oldest note", async ({ page }) => {
    await boot(page);
    await openView(page, "Open Points");
    // Task #3: #1 and #2 are Jira-synced and read-only.
    await page.getByRole("button", { name: /^#3 — click to edit/ }).first().click();
    const editor = page.getByRole("dialog").first();
    // No inline log in the editor: no disclosure and no note text.
    await expect(editor.locator("details", { hasText: "Notes log" })).toHaveCount(0);
    await expect(editor.getByText("Note 1:")).toHaveCount(0);
    await editor.getByRole("button", { name: `Notes log (${NOTE_COUNT})`, exact: true }).click();
    const win = page.locator("[role=dialog].fixed.resize");
    await expect(win).toBeVisible();
    const list = win.locator("ul").first();
    await expect(list.locator(":scope > li")).toHaveCount(NOTE_COUNT);

    // Newest first, so the oldest note is last. Step the wheel over the list until
    // it is fully inside the window.
    const oldest = list.locator(":scope > li").last();
    await expect(oldest).toContainText("Note 1:");
    const inView = () =>
      oldest.evaluate((li) => {
        const w = (li.closest("[role=dialog]") as HTMLElement).getBoundingClientRect();
        const r = li.getBoundingClientRect();
        return r.top >= w.top - 1 && r.bottom <= w.bottom + 1;
      });
    const box = await list.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(box!.height / 2, 40));
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
