import { defineConfig, devices } from "@playwright/test";

// ★★★ A SEPARATE CONFIG, DELIBERATELY — do NOT fold these projects into
// `playwright.config.ts`. Adding a `firefox` project there would make CI run
// EVERY spec in `e2e/` twice (the a11y gate included, which is ~129 tests), for
// no gain: every other spec in this repo asserts product behaviour that is
// engine-independent.
//
// What lives here instead is the one class of behaviour that is NOT
// engine-independent, and that the unit suite is STRUCTURALLY INCAPABLE of
// seeing: jsdom's element-removal focus semantics are Firefox's, not
// Chromium's. Chromium dispatches `focusout` on a container with
// `relatedTarget === null`, synchronously, as a focused descendant is removed;
// Firefox and jsdom dispatch none. A `focusout` handler that reads a null
// `relatedTarget` as "focus left the panel" therefore clears its own flag in
// Chromium ONLY — and the focus restore in `src/app/popover-panel.tsx` dies
// there while every jsdom test stays green. Two implementations shipped dead
// behind fully green gates before this config existed.
//
// ★ `testDir` is a NEW directory so the main config (`testDir: "./e2e"`) can
// never pick these specs up. Verify the separation, don't assume it:
//   npx playwright test --list            (must NOT list e2e-crossengine/*)
//   npx playwright test -c playwright.crossengine.config.ts --list
const PORT = Number(process.env.PORT ?? 3300);
// Use localhost, NOT 127.0.0.1 — same reason as the main config: the Next dev
// server binds to localhost and the client runtime (HMR WebSocket + RSC
// streaming) fails over 127.0.0.1, leaving the shell mounted but never hydrated.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e-crossengine",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Generous per-test timeout: the FIRST navigation against the dev webServer
  // pays a one-time Turbopack compile that can exceed the 30s default.
  timeout: 60_000,
  retries: 0,
  // ★★ ALWAYS 1, local runs included. This repo has a measured local-contention
  // failure mode where over-subscribed Playwright runs die on
  // "Test timeout of 60000ms exceeded" inside `page.evaluate` — printed as a
  // FAILURE with no diagnostic text at all. A cross-engine spec exists to
  // produce a per-engine verdict; a contention false-red would masquerade as
  // one of the two answers it is meant to distinguish.
  workers: 1,
  reporter: process.env.CI ? [["html"], ["github"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    // ★★ LOAD-BEARING. `PORT` is read here with a DEFAULT, so without this the
    // config would poll :3300 while `next dev` bound :3000 — and on a developer
    // machine `reuseExistingServer` would then happily attach to whatever is
    // already on :3000, which may be the user's own live-data tab.
    env: { PORT: String(PORT) },
  },
});
