import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
// Use localhost, NOT 127.0.0.1: the Next dev server binds to localhost, and the
// client runtime (HMR WebSocket + RSC streaming) fails over 127.0.0.1, leaving
// the app shell mounted but never hydrated (empty <main>). localhost renders
// the full app.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Generous per-test timeout: the FIRST navigation against the dev webServer
  // pays a one-time Turbopack compile that can exceed the 30s default.
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html"], ["github"]] : "html",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Functional specs (smoke, app navigation, a11y). This is what CI runs.
      // desktop-smoke is ignored here as well as carrying its own project
      // below: it drives a PACKAGED Electron app that no CI runner builds, so
      // left in this project it would fail (or skip) in the blocking e2e job.
      name: "chromium",
      testIgnore: [/visual\.spec\.ts/, /desktop-smoke\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Visual-regression snapshots — opt-in (`npm run e2e:visual`), kept out of
      // the default run because baselines are per-platform (see visual.spec.ts).
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Packaged Electron desktop app — opt-in (`npm run e2e:desktop`), and
      // never in CI: it needs the artifact `npm run desktop:package` writes to
      // desktop/release/win-unpacked/.
      //
      // ★ timeout: main.ts waits up to 60s for the standalone server to become
      // ready and the spec then polls up to 90s for the window to leave
      // splash.html, so the 60s default above cannot cover one launch, let
      // alone a launch plus assertions.
      //
      // ★★ workers: 1 — both tests bind the FIXED port 17300 (not
      // configurable, see desktop/src/lib/constants.ts) and main.ts holds a
      // single-instance lock, so a second concurrent launch quits immediately
      // or refuses with "Port in use". The `use` block is inert here (the spec
      // drives Electron, not a browser) and is kept only for shape parity with
      // the projects above.
      name: "desktop",
      testMatch: /desktop-smoke\.spec\.ts/,
      timeout: 240_000,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    // Add firefox / webkit later if cross-browser coverage is needed:
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // { name: "webkit",  use: { ...devices["Desktop Safari"] } },
  ],
  // ★★ webServer is GLOBAL and unconditional in Playwright — there is no
  // per-project form — so it boots `npm run dev` on :3000 for the `desktop`
  // project too, which drives a packaged Electron app serving itself on
  // :17300 and never touches :3000. On a machine with no dev server already
  // running that is a Turbopack compile started as a pure side effect (and,
  // measured, the app's own port was free while :3000 was not listening at
  // all). PLAYWRIGHT_NO_WEBSERVER=1 turns it off; `npm run e2e:desktop` sets
  // it. Left ON by default so every browser project keeps today's behaviour.
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: "ignore",
        stderr: "pipe",
      },
});
