import { test, expect, FROZEN_NOW } from "./seed";

// §618 — MEASURED, not reasoned: jsdom has no layout, so only a real browser
// can say whether the classic header fits. The classic search keeps a 384px
// preferred width (`lg:w-96`) and may shrink to a 224px floor (`lg:min-w-56`).
// Before the fix the header content was 1073px wide at every viewport from lg
// up (measured against unfixed app-header.tsx/shell-chrome.tsx), so the page
// scrolled sideways at 1024 and 1100 (docScroll 1113 vs innerWidth 1024/1100).
// ★★ This only reproduces with the settings the beforeEach below sets: the
// default boot (AI off, expertMode off) leaves the header comfortably under
// every one of these widths (measured header width 944-1456px, never
// overflowing) — see the beforeEach comment for what widens it.
const WIDTHS = [1024, 1100, 1390, 1600] as const;
const SEARCH_FLOOR_PX = 224;
const SEARCH_BASIS_PX = 384;

test.describe("classic header fits from lg up (§618)", () => {
  test.beforeEach(async ({ page }) => {
    // Settings are a SHALLOW merge over defaults (use-settings.ts), so each key
    // here switches one thing and leaves everything else at its default.
    // `layout: "classic"` alone under-reproduces §618: the default boot has
    // neither AI nor expert mode on, so the header's icon row is only 7
    // buttons wide (Add task/Bell/Voice/Export/Help/Version/Settings) and the
    // row under the title carries just the project switcher + search — never
    // wide enough to overflow at any of WIDTHS (measured, see the file
    // comment above). `expertMode: true` adds the Save/Apply-template icons
    // to that row (action-menus.tsx); `ai: {enabled, apiKey}` (the sole gate
    // `isAiEnabled` checks, settings-types.ts) adds the AI-assistant icon
    // AND the Ask-Claude pill beside the project switcher. Together they
    // reproduce the original §618 report ("project picker, sync, Ask-Claude
    // and eight trailing icon buttons") closely enough to measure the real
    // overflow at 1024/1100 (see the file comment's numbers).
    await page.addInitScript(() => {
      localStorage.setItem(
        "aipm-cockpit:settings",
        JSON.stringify({
          layout: "classic",
          expertMode: true,
          ai: { enabled: true, apiKey: "e2e-probe-key" },
        }),
      );
    });
  });

  for (const width of WIDTHS) {
    test(`no sideways scroll and a usable search at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      // Not gotoApp() (e2e/seed.ts): it waits for a sidebar nav item literally
      // named "Dashboard", which the classic shell never renders — its
      // workspace tab strip (workspace-section-chrome.tsx) lists AI
      // Assistant/Reports/Gantt/RAID/Resources/Budget/Activity only, no
      // Dashboard tab. That wait hangs for the full 60s test timeout
      // regardless of load speed (measured: all 4 widths timed out on it, the
      // page fully rendered underneath). Navigate directly instead and wait on
      // the classic shell's own title heading, freezing the clock the same
      // way gotoApp does for date-derived content.
      await page.clock.install({ time: FROZEN_NOW });
      await page.goto("/");
      await page
        .getByRole("heading", { name: "AI PM Cockpit", level: 1, exact: true })
        .waitFor({ timeout: 90_000 });
      // Positive proof the classic layout took effect: only the classic shell
      // has an h1 literally named "AI PM Cockpit".
      await expect(page.getByRole("heading", { name: "AI PM Cockpit", level: 1, exact: true })).toBeVisible();
      const m = await page.evaluate(() => {
        const h1 = [...document.querySelectorAll("h1")].find((h) => h.textContent === "AI PM Cockpit")!;
        const header = h1.closest("header")!;
        const search = document.querySelector<HTMLElement>('input[role="combobox"][aria-label="Global search"]')!;
        return {
          docScroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          headerScroll: header.scrollWidth,
          headerClient: header.clientWidth,
          search: Math.round(search.getBoundingClientRect().width),
        };
      });
      const why = JSON.stringify(m);
      expect(m.docScroll, why).toBeLessThanOrEqual(m.inner);
      expect(m.headerScroll, why).toBeLessThanOrEqual(m.headerClient);
      if (width >= 1390) expect(m.search, why).toBe(SEARCH_BASIS_PX);
      else expect(m.search, why).toBeGreaterThanOrEqual(SEARCH_FLOOR_PX);
    });
  }
});
