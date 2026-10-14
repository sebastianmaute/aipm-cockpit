import { mkdirSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { test, expect, gotoApp, skipTour, FROZEN_NOW } from "./seed";
import { DEMO_BANNER_DONE_KEY } from "../src/app/demo-banner-state";

// The install guide's screenshots (docs/assets/guide/) and the README gallery
// (docs/assets/*.png), §713. Run with `npm run docs:guide-shots` — the
// `guide-shots` project in playwright.config.ts, which pins the timezone,
// locale, colour scheme, motion and viewport. Never in CI and never a pixel
// gate: it WRITES the pictures, and a person reviews the PNG diff by eye.
//
// ★ It never reads the environment and never writes `*.manual.png` (the two
//   hand-captured shots) or `version-history.png` (a Turso-only view the
//   file-mode seed cannot render). Secret fields show fixed fakes only.
// ★ The seed at FROZEN_NOW IS the demo project: the demo shifts the sample
//   so its as-of date lands on today, and FROZEN_NOW equals that date.

const GUIDE_DIR = "docs/assets/guide";
const GALLERY_DIR = "docs/assets";

async function shot(locator: Locator, file: string): Promise<void> {
  await locator.screenshot({ path: file, animations: "disabled", caret: "hide" });
}

/** Skip the tour and, unless a test wants it, the one-time demo banner (as e2e/visual.spec.ts does). */
async function prepare(page: import("@playwright/test").Page, opts: { demoBanner?: boolean } = {}): Promise<void> {
  await skipTour(page);
  if (!opts.demoBanner) {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), DEMO_BANNER_DONE_KEY);
  }
}

test.beforeAll(() => {
  mkdirSync(GUIDE_DIR, { recursive: true });
});

test("harness: the Dashboard renders under the frozen clock", async ({ page }) => {
  await prepare(page);
  await gotoApp(page, FROZEN_NOW);
  await expect(page.locator("main").first()).toBeVisible();
});

// Referenced by the guide and gallery blocks below.
void shot;
void GALLERY_DIR;
