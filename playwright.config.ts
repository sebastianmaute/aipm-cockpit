import { defineConfig, devices } from "@playwright/test";
import { BOOT_NONCE_ENV, mintBootNonce, reuseDevServer, runStartsDevServer } from "./src/app/checkout-token";
import { appHasTursoToken } from "./e2e/live-turso-env";

const PORT = Number(process.env.PORT ?? 3000);
// Use localhost, NOT 127.0.0.1: the Next dev server binds to localhost, and the
// client runtime (HMR WebSocket + RSC streaming) fails over 127.0.0.1, leaving
// the app shell mounted but never hydrated (empty <main>). localhost renders
// the full app.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
// §58 (b): one random nonce per run, minted here (the main process mints it; each
// worker re-evaluates this file and keeps the inherited value), handed to the
// webServer below and read back by e2e/a11y.spec.ts's guard from data-boot-nonce.
const BOOT_NONCE = runStartsDevServer(process.env) ? mintBootNonce(process.env) : undefined;

// ★★★ Live-Turso specs that DROP tables (`e2e/live-turso-env.ts` names the database
// they may touch). Every live spec shares ONE throwaway database, and the default
// run is fullyParallel, so a spec dropping `document_assets` or every workspace
// table beside the partition-scoped UI specs would pull tables out from under
// them. They live in their own project, which runs its files one at a time and
// which `chromium` ignores; run it on its own (`npm run e2e:live-destructive`),
// never in the same invocation as `chromium`.
const LIVE_TURSO_DESTRUCTIVE = /(turso-ddl-probe-live|turso-revision-live)\.spec\.ts/;

// ★★★ NO TRACE AND NO VIDEO WHEN THE APP CARRIES A TURSO TOKEN. With
// `NEXT_PUBLIC_TURSO_AUTH_TOKEN` set, every page's client bundle holds the token
// and sends `Authorization: Bearer …`: a trace records that header, and CI
// uploads `playwright-report/` on failure, so with Turso secrets it would publish
// it. Video goes off with it: no token is known to appear in a frame (every token
// field is type="password", and the Turso one is hidden while an env token is
// set), but a video is the one artifact nobody audits frame by frame. Decided
// from the env Next itself would load (`appHasTursoToken`), not from
// `process.env` alone. Failures then debug from screenshots and logs; screenshots
// stay on because the app never renders a token as plain text. Locally this also
// applies to a developer whose `.env.local` holds their own token, so it says so
// once per run rather than leaving a missing trace to look like a bug.
const APP_HAS_TURSO_TOKEN = appHasTursoToken();
if (APP_HAS_TURSO_TOKEN && !process.env.TEST_WORKER_INDEX) {
  console.log("playwright: trace and video are off, because the app carries a Turso token (see playwright.config.ts)");
}

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
    trace: APP_HAS_TURSO_TOKEN ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: APP_HAS_TURSO_TOKEN ? "off" : "retain-on-failure",
  },
  projects: [
    {
      // Functional specs (smoke, app navigation, a11y). This is what CI runs.
      // desktop-smoke is ignored here as well as carrying its own project
      // below: it drives a PACKAGED Electron app that no CI runner builds, so
      // left in this project it would fail (or skip) in the blocking e2e job.
      name: "chromium",
      testIgnore: [/visual\.spec\.ts/, /desktop-smoke\.spec\.ts/, LIVE_TURSO_DESTRUCTIVE],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Visual-regression snapshots — opt-in (`npm run e2e:visual`), kept out of
      // the default run because baselines are per-platform (see visual.spec.ts).
      // ★ §573: `timezoneId`/`locale` are pinned HERE, not just the clock
      // (`VISUAL_FROZEN_NOW` in visual.spec.ts). A frozen UTC instant alone
      // still leaks the machine's local timezone into anything that reads
      // local getters — `dashboard-panel.tsx`'s greeting hour
      // (`new Date().getHours()`) and `gantt-engine.ts`'s `localTodayUTC()`
      // (built from local `getFullYear()/getMonth()/getDate()`, by design —
      // see its docstring) both do. UTC keeps the local calendar date/hour
      // identical to the pinned UTC instant's own date/hour, so both of those
      // read as if machine-timezone-independent; `en-US` pins `navigator.language`
      // the same way
      // for anything that formats via the browser default locale (the app's
      // own date/number formatting already passes an explicit locale, see
      // `gantt-engine.ts`). Chromium/a11y (`chromium` project above) is
      // deliberately left on the machine's own timezone/locale — this only
      // narrows the `visual` project.
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], timezoneId: "UTC", locale: "en-US" },
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
    {
      // Table-dropping live-Turso specs (see LIVE_TURSO_DESTRUCTIVE above):
      // opt-in (`npm run e2e:live-destructive`), one file at a time. They drive
      // no browser, so no app server is needed (PLAYWRIGHT_NO_WEBSERVER=1).
      name: "live-turso-destructive",
      testMatch: LIVE_TURSO_DESTRUCTIVE,
      workers: 1,
      fullyParallel: false,
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
  // The condition is `runStartsDevServer` (checkout-token.ts), the same predicate the axe
  // guard in e2e/a11y.spec.ts uses to decide whether the served app must be this checkout.
  webServer: !runStartsDevServer(process.env)
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        timeout: 120_000,
        // ★★ Off by default since §58 (b): a run starts its own server, booted with its
        // own nonce, and fails loudly when the port is taken instead of attaching to a
        // server from another worktree or an older run. PLAYWRIGHT_REUSE_SERVER=1 opts
        // back in; boot that server with the same E2E_BOOT_NONCE or the guard refuses it.
        reuseExistingServer: reuseDevServer(process.env),
        env: BOOT_NONCE ? { [BOOT_NONCE_ENV]: BOOT_NONCE } : {},
        stdout: "ignore",
        stderr: "pipe",
      },
});
