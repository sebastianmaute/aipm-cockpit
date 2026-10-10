import type { Page } from "@playwright/test";
import { expect, reseedWorkspace, FROZEN_NOW, NAV_SELECTOR } from "./seed";
import { SEED_WORKSPACE } from "./seed-workspace";
import { scaleWorkspace } from "../src/app/scale-workspace";
import type { Workspace } from "../src/app/workspace";

// Shared by the §5 perf probes (perf-task-table.spec.ts, perf-task-board.spec.ts), so the
// two time the same workspaces the same way and their numbers can be set side by side.

export const OUT = "eye-verify-output/perf";
export const RUNS = 3;
export const SEED_TASKS = (SEED_WORKSPACE.tasks as unknown[]).length;
// The seed has 27 tasks; these factors give 513, 999 and 1998.
export const SIZES = [
  { size: 500, factor: 19 },
  { size: 1000, factor: 37 },
  { size: 2000, factor: 74 },
] as const;
export const SEARCH = "Search task name, assignee, blockers, notes…";
// ★ "a" matches EVERY seed task (each assignee name holds one), so a search for it times
// the keystroke's re-render, not a filter. "Noah" matches 7 of the 27 seed tasks.
export const FILTER = "Noah";
// ★ Twice the search debounce (150 ms, filters-context.tsx): a count read twice this far
// apart cannot be a count from before the debounce fired.
export const SETTLE_MS = 300;
export const SHELL_TIMEOUT = 180_000;
export const POLL = { timeout: 120_000, intervals: [20] };

export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Timed on the NODE side: the boot installs Playwright's fake clock in the page, so an
 *  in-page performance.now() would read the frozen clock. */
export async function timed(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

/** Resolves once `count` has held still for two reads SETTLE_MS apart. */
export async function settled(page: Page, count: () => Promise<number>): Promise<number> {
  let last = Number.NaN;
  for (;;) {
    const n = await count();
    if (n === last) return n;
    last = n;
    await page.waitForTimeout(SETTLE_MS);
  }
}

/** gotoApp's two waits with a longer limit: the 2002-task workspace takes longer than
 *  gotoApp's default 5 s to show the shell, and raising that for every spec would hide
 *  a slow boot everywhere else. */
export async function bootScaled(page: Page, factor: number): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await reseedWorkspace(page, scaleWorkspace(SEED_WORKSPACE as unknown as Workspace, factor) as unknown as Record<string, unknown>);
  await page.clock.install({ time: FROZEN_NOW });
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible({ timeout: SHELL_TIMEOUT });
  await page.waitForFunction(
    ({ name, sel }) =>
      [...document.querySelectorAll(sel)].some(
        (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ") === name,
      ),
    { name: "Dashboard", sel: NAV_SELECTOR },
    { timeout: SHELL_TIMEOUT },
  );
}

/** How long the page stays busy: a task queued from Node runs only when the main thread
 *  is free. */
export const busyMs = (page: Page): Promise<number> =>
  timed(() => page.evaluate(() => new Promise<void>((r) => setTimeout(r, 0))));
