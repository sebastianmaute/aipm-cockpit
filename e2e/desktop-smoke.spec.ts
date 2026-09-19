import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { APP_HOST, APP_ORIGIN, APP_PORT } from "../desktop/src/lib/constants";
import { APP_VERSION } from "../src/app/version";

// Smoke test for the PACKAGED Electron desktop app.
//
// ★★★ IT LAUNCHES THE PACKAGED EXECUTABLE, NEVER `desktop/dist/main.js`.
// Unpackaged, `process.resourcesPath` is
// `desktop/node_modules/electron/dist/resources`, which holds no `standalone/`
// — so `spawnServer(process.resourcesPath)` (desktop/src/main.ts) points
// `server-child.ts` at a `standalone/server.js` that does not exist, the
// readiness probe never succeeds, and the app dies in its own "did not finish
// starting" dialog. The whole point of this spec is the PACKAGE, so it drives
// the artifact electron-builder produced.
//
// ★★★ IT DOES NOT USE PLAYWRIGHT'S `_electron.launch`, AND CANNOT. That launch
// injects `--inspect=0` and waits for the Node inspector, and the packaged exe
// ships with the `enableNodeCliInspectArguments` fuse OFF (electronFuses in
// desktop/electron-builder.yml, open-followups §561), so it refuses the flag
// and the launch times out before any assertion runs -- measured 2026-09-18.
// Instead the exe is spawned with `--remote-debugging-port=0`, a CHROMIUM
// switch that no Electron fuse gates, and the renderer is reached with
// `chromium.connectOverCDP`. Never "fix" this by packaging an unfused build
// for the test: the fused binary is the thing that ships.
//
// ★★ It is deliberately OUT of the CI `e2e` job (`playwright.config.ts` gives
// it its own `desktop` project, and the `chromium` project ignores this file):
// no packaged app exists on a CI runner, and a spec that skips on every CI run
// is a gate that reports success.
//
// ★★ `__dirname`, NOT `import.meta.url` — Playwright transpiles specs to CJS,
// so `import.meta` is a syntax error here (same note as
// e2e/meta-decode-loss.spec.ts).
const BUILDER_YML = join(__dirname, "..", "desktop", "electron-builder.yml");

// The top-level `productName:` of electron-builder.yml, tolerating surrounding
// quotes and a trailing `# comment`. A tiny reader rather than a YAML
// dependency: this spec needs exactly one scalar, and a missing or empty one
// throws at load, naming the file, instead of yielding a wrong path.
function readProductName(yml: string): string {
  const line = yml.match(/^productName:[ \t]*(.*)$/m);
  if (!line) {
    throw new Error(`No top-level \`productName:\` line in ${BUILDER_YML}`);
  }
  const raw = line[1].trim();
  const quoted = raw.match(/^(["'])(.*?)\1(?:\s+#.*)?$/);
  const value = (quoted ? quoted[2] : raw.replace(/\s+#.*$/, "")).trim();
  if (value === "") {
    throw new Error(`\`productName:\` in ${BUILDER_YML} is empty`);
  }
  return value;
}

const PRODUCT_NAME = readProductName(readFileSync(BUILDER_YML, "utf8"));

// ★ DERIVED from productName, never spelled a second time. electron-builder
// names the exe `${productFilename}.exe`, and productFilename is productName
// passed through sanitizeFileName (app-builder-lib appInfo.js) unless an
// `executableName` is set, which this config does not do. A hardcoded name
// here would, after a rename, name an exe the build no longer writes.
//
// ★★ This derivation SKIPS sanitizeFileName, so it matches only while that is
// the identity on productName (it is for "AI PM Cockpit": the packaged exe
// carries exactly that name). A productName it would rewrite yields a path
// the build never writes -- which requirePackagedExe() below turns into a
// FAILURE rather than a skip, because win-unpacked/ then exists without it.
const UNPACKED_DIR = join(__dirname, "..", "desktop", "release", "win-unpacked");
const PACKAGED_EXE = join(UNPACKED_DIR, `${PRODUCT_NAME}.exe`);

// SKIP only when there is no package at all; FAIL when there is one but the
// derived exe is not in it. A skip in the second case would report success
// over a package this spec can no longer find -- the rename trap above.
function requirePackagedExe(): void {
  if (existsSync(PACKAGED_EXE)) return;
  if (existsSync(UNPACKED_DIR)) {
    const exes = readdirSync(UNPACKED_DIR).filter((f) => f.toLowerCase().endsWith(".exe"));
    throw new Error(
      `${UNPACKED_DIR} exists but holds no "${basename(PACKAGED_EXE)}" (derived from ` +
        `electron-builder.yml productName); it holds: ${exes.join(", ") || "(no .exe)"}. ` +
        `Either the package is stale or the derivation no longer matches sanitizeFileName.`,
    );
  }
  test.skip(true, `No packaged app at ${PACKAGED_EXE} — build one with \`npm run desktop:package\`.`);
}

// The window may sit on splash.html for as long as main.ts's own readiness
// budget (60s) plus the standalone server's cold start, so this is generous by
// design rather than by guess.
const WINDOW_BUDGET_MS = 90_000;
const POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ★★ THE APP REUSES ONE WINDOW: `main.ts` creates a single BrowserWindow,
// `loadFile`s splash.html into it, and only later `loadURL`s the app origin.
// So the FIRST page CDP reports is a `file://…splash.html` page, and an
// assertion made on it sees the splash markup — no themed background, no
// `data-app-version`. Polling by URL rather than by page INDEX is correct
// for that, and stays correct if the splash is ever moved into a window of its
// own (which is the shape "take the first page" would silently get wrong).
// It scans every context, since a CDP-attached browser reports the app's
// pages under whichever context Chromium hands back.
async function appWindow(browser: Browser): Promise<Page> {
  const deadline = Date.now() + WINDOW_BUDGET_MS;
  let lastSeen = "(no window yet)";
  while (Date.now() < deadline) {
    for (const page of browser.contexts().flatMap((c) => c.pages())) {
      const url = page.url();
      if (url.startsWith(APP_ORIGIN)) return page;
      lastSeen = url;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `No window reached ${APP_ORIGIN} within ${WINDOW_BUDGET_MS}ms. ` +
      `Last window URL seen: ${lastSeen}. A window still on splash.html means ` +
      `the standalone server never became ready — check the launch log named ` +
      `in the app's own error dialog.`,
  );
}

// ★★★ BOTH TESTS BIND THE SAME FIXED PORT (17300 is not configurable — see
// desktop/src/lib/constants.ts) and main.ts holds a single-instance lock, so
// they must not overlap AND the previous server child must be gone before the
// next launch. `taskkill` returns before the OS has torn the listener down,
// so the second launch's port-owner probe would classify a dying server as
// "foreign" and refuse to start with a "Port in use" dialog.
//
// Waiting on the CONDITION (nothing answers on the port) rather than sleeping
// a guessed interval: a sleep that is long enough today is a flake tomorrow.
async function waitForPortRelease(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(APP_ORIGIN, { signal: AbortSignal.timeout(1_000) });
    } catch {
      return; // Nothing is listening — the port is free.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Something is still serving ${APP_ORIGIN} 30s after the app was killed. ` +
      `A leaked server child holds the pinned port and every subsequent launch ` +
      `will refuse to start.`,
  );
}

// ★★★ PRE-FLIGHT: the port must be free BEFORE a launch. An installed copy of
// the app holds 17300 while it runs, and it serves the same
// `data-app-version` marker, so main.ts's `classifyPortOwner` rates it "ours"
// -- not "foreign" -- and the app under test spawns NO server of its own. Its
// window then loads the INSTALLED copy's server, so the boot test's assertions
// run against the wrong build and pass whenever the two versions match (reasoned
// from main.ts's owner branches, not measured). What this spec actually
// reported was waitForPortRelease()'s "leaked server child" (then worded
// "after app.close()"), blaming the package for a process it never started.
//
// ★★★ TWO CHECKS, AND THE CONNECT IS THE ONE THAT MIRRORS THE APP. main.ts
// decides ownership with an HTTP fetch of APP_ORIGIN (`probePort`), i.e. by
// CONNECTING to 127.0.0.1 -- so this connects first, and anything that
// accepts fails the pre-flight: an installed copy, a same-checkout
// `next dev`/`next start`, or any foreign server. A bind alone is NOT enough,
// and was all this used to do: measured 2026-09-11 with Node, a holder bound
// to 0.0.0.0, to `::`, or at Node's default listen let a bind on 127.0.0.1
// SUCCEED -- the port read as free -- while a connect to 127.0.0.1 succeeded
// in all of those cases. Only a holder on 127.0.0.1 itself made the bind fail.
// The bind stays as a second check, on the address the app's server binds.
// Its reason to exist: a socket BOUND to 127.0.0.1:17300 but not listening
// (e.g. an outgoing client with localPort 17300) refuses the connect yet
// blocks the bind -- measured 2026-09-11, only this check caught it.
const PORT_HELD_HINT =
  `is ${PRODUCT_NAME} (installed copy) or a dev server running? Close it and re-run.`;

function portAcceptsConnections(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: APP_HOST, port: APP_PORT });
    socket.setTimeout(2_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function assertPortFree(): Promise<void> {
  if (await portAcceptsConnections()) {
    throw new Error(
      `port ${APP_PORT} in use before launch (something accepted a connection to ` +
        `${APP_HOST}:${APP_PORT}) — ${PORT_HELD_HINT}`,
    );
  }
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `port ${APP_PORT} in use before launch (${APP_HOST}:${APP_PORT} cannot be ` +
                `bound) — ${PORT_HELD_HINT}`,
            )
          : error,
      );
    });
    probe.listen(APP_PORT, APP_HOST, () => probe.close(() => resolve()));
  });
}

type Launched = {
  child: ChildProcess;
  profile: string;
  // The spawn's own `error` event, if it fired (e.g. the exe could not be
  // started). Read through a getter because it arrives asynchronously.
  spawnError: () => Error | undefined;
};

// ★★★ EVERY LAUNCH GETS A THROWAWAY `--user-data-dir`, AND WITHOUT IT THE
// STYLING ASSERTION BELOW IS VACUOUS. Measured 2026-09-10, not reasoned: with
// the package's `resources/standalone/.next/static` renamed aside, a run on
// the app's REAL profile passed — `document.styleSheets[0].cssRules.length`
// was 97 and body's background was `rgb(255, 255, 255)` — while a Node-side
// `fetch` of that same stylesheet URL returned **404**. Chromium was serving
// the bundle out of the persistent HTTP cache in the user-data dir, written by
// an earlier styled run. The same probe with a fresh dir reported
// `rgba(0, 0, 0, 0)` and 0 rules, i.e. exactly the failure this spec exists to
// catch. So the vacuity was in the LAUNCH, not in the expectation.
//
// ★ It also stops the smoke test writing IndexedDB, localStorage and a cache
// into the developer's real desktop-app profile, which the first cut did.
//
// ★ Reuse-safe launch: the `finally` in each test is what keeps a FAILED
// assertion from leaking a live app onto the pinned port and turning the next
// test red for an unrelated reason — which is what makes a mutation run
// readable at all.
async function launchPackagedApp(extraArgs: readonly string[] = []): Promise<Launched> {
  await assertPortFree();
  const profile = mkdtempSync(join(tmpdir(), "aipm-desktop-smoke-"));
  const child = spawn(PACKAGED_EXE, [`--user-data-dir=${profile}`, ...extraArgs], {
    stdio: "ignore",
  });
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  return { child, profile, spawnError: () => spawnError };
}

// Throws if the exe never started or has already exited: every poll below
// would otherwise run out its whole budget waiting on a process that is gone.
function assertStillRunning({ child, spawnError }: Launched): void {
  const error = spawnError();
  if (error) throw new Error(`Packaged exe did not start: ${error.message}`);
  if (child.exitCode !== null) {
    throw new Error(`Packaged exe exited with code ${child.exitCode} during start-up.`);
  }
}

// Chromium writes the port it actually bound for `--remote-debugging-port=0`
// to line 1 of `<user-data-dir>/DevToolsActivePort` -- measured on the fused
// package 2026-09-18. Reading it (rather than choosing a port) means no second
// fixed port this spec could collide on.
async function connectOverCdp(launched: Launched): Promise<Browser> {
  const portFile = join(launched.profile, "DevToolsActivePort");
  const deadline = Date.now() + WINDOW_BUDGET_MS;
  while (Date.now() < deadline) {
    assertStillRunning(launched);
    let port = "";
    try {
      port = readFileSync(portFile, "utf8").split(/\r?\n/)[0].trim();
    } catch {
      // Not written yet.
    }
    if (/^[1-9]\d*$/.test(port)) {
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `${portFile} held no DevTools port within ${WINDOW_BUDGET_MS}ms — did the exe ` +
      `ignore --remote-debugging-port?`,
  );
}

// Polls APP_ORIGIN until it answers 200 and returns the last status seen (0 =
// nothing answered). No CDP: the loopback/LAN test needs only the server.
async function waitForAppOrigin(launched: Launched): Promise<number> {
  const deadline = Date.now() + WINDOW_BUDGET_MS;
  let status = 0;
  while (Date.now() < deadline) {
    assertStillRunning(launched);
    try {
      status = (await fetch(APP_ORIGIN, { signal: AbortSignal.timeout(2_000) })).status;
      if (status === 200) return status;
    } catch {
      // Not listening yet.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return status;
}

// How long a graceful quit gets before this spec gives up and forces the app
// down. Generous but bounded -- the same "wait on the condition, not a guess"
// discipline as waitForPortRelease(), just with an upper bound because there
// is no condition here to poll: only `exit`.
const GRACEFUL_QUIT_BUDGET_MS = 20_000;

// Resolves `true` once `child` has actually exited, `false` once `budgetMs`
// passes without that. A `taskkill` call RETURNING is not the process
// exiting -- see the note above waitForPortRelease(). `signalCode !== null`
// counts as exited too (N-8, final-rereview.md): a POSIX child that exited on
// a signal before this call has `exitCode === null` with `signalCode` set, so
// checking `exitCode` alone would wait out the whole budget on a process that
// has already exited and then throw a misleading force-kill error. Windows,
// where this smoke runs, is unaffected either way.
function waitForExit(child: ChildProcess, budgetMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, budgetMs);
    function onExit(): void {
      clearTimeout(timer);
      resolve(true);
    }
    child.once("exit", onExit);
  });
}

// PID-scoped, never by image name -- the same discipline as killServer in
// desktop/src/server-child.ts. `/T /F` takes the whole process tree down
// directly and unconditionally, including the utility-process server, so
// waitForPortRelease() passes whether or not killServer() did anything at
// all. Used ONLY as killApp()'s fallback, after a graceful quit failed to
// exit the app within budget.
function forceKillApp(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

// ★★★ GRACEFUL FIRST, AND THAT IS THE WHOLE POINT OF THIS FUNCTION. The old
// code went straight to `taskkill /T /F`, which tears the process tree down
// itself and never asks the app to quit -- so this spec proved nothing about
// `killServer(serverChild)`, the "child MUST die with the parent" guard in
// desktop/src/main.ts. `taskkill /PID <pid>` WITHOUT `/F` sends WM_CLOSE to
// the process's top-level window, the same message Windows sends when a user
// clicks the window's own close button; that reaches main.ts's
// `window-all-closed` -> `app.quit()` -> `before-quit` chain, which is what
// actually calls `killServer`. Reaching the `/T /F` fallback now FAILS the
// test rather than silently "working" -- but that only proves the APP quit
// within budget, not that `killServer` ran: a round-1 mutant (`killServer`
// made a no-op) left this spec green anyway, because Windows tears the
// utility-process child down with the app regardless. `killServer` staying
// unproven is filed as an owed item in open-followups §561, not a gap §561
// flags this spec for.
async function killApp(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid)], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Already gone.
  }
  if (await waitForExit(child, GRACEFUL_QUIT_BUDGET_MS)) return;
  forceKillApp(child);
  throw new Error(
    `Packaged app (PID ${pid}) did not quit within ${GRACEFUL_QUIT_BUDGET_MS}ms of a ` +
      `graceful close request and had to be force-killed. A graceful quit should reach ` +
      `window-all-closed -> app.quit() -> before-quit -> killServer() in ` +
      `desktop/src/main.ts -- investigate that chain, don't raise this budget.`,
  );
}

async function shutdown({ child, profile }: Launched, browser?: Browser): Promise<void> {
  // A CDP-connected browser's close() only DISCONNECTS; killApp() below does
  // the real shutdown.
  await browser?.close().catch(() => undefined);
  try {
    await killApp(child);
    await waitForPortRelease();
  } finally {
    // Runs even when killApp() or waitForPortRelease() throws -- cleanup must
    // not depend on the app having shut down cleanly.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A profile directory Windows still holds open is harmless — it is under
      // the OS temp dir. Never fail a smoke test on its own cleanup.
    }
  }
}

test.describe.serial("packaged desktop app", () => {
  test("boots, is styled, and reports this version", async () => {
    requirePackagedExe();

    const launched = await launchPackagedApp(["--remote-debugging-port=0"]);
    let browser: Browser | undefined;
    try {
      browser = await connectOverCdp(launched);
      const page = await appWindow(browser);

      // ★★★ RACE FIX. appWindow() resolves the instant the window's URL
      // flips to the app origin, which can be BEFORE the stylesheet has
      // applied under CPU load -- measured 2026-09-10: this spec failed with
      // "body background is fully transparent" against a GOOD build, then
      // passed 3/3 on immediate re-run with no code change. A <link
      // rel="stylesheet"> blocks the `load` event, so waiting for `load`
      // waits out exactly that race without weakening the anti-vacuity
      // checks below -- with .next/static missing (the mutation this spec
      // exists to catch), `load` still fires (after the 404) and every
      // assertion below still fails.
      await page.waitForLoadState("load");

      // ★★★ ANTI-VACUITY 1. A "window opened" assertion passes against an app
      // whose .next/static never got copied into the package — it boots and
      // serves, it is merely unstyled. Assert a computed style that can only
      // be there if the CSS bundle loaded. Mutation-proved by renaming
      // desktop/release/win-unpacked/resources/standalone/.next/static aside
      // and observing THIS message.
      const bg = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(
        bg,
        "body has no themed background — the CSS bundle did not load, so .next/static is missing from the package",
      ).not.toBe("");
      expect(
        bg,
        "body background is fully transparent — the CSS bundle did not load, so .next/static is missing from the package",
      ).not.toBe("rgba(0, 0, 0, 0)");

      // ★★ A SECOND, INDEPENDENT WITNESS, because the one above rests on a
      // colour: `--surface`, `--background` and `--foreground` all resolve to
      // real values on an UNSTYLED page (measured `#ffffff`/`#646461`, set
      // inline by the SSR scheme apply), so a token-based check would have
      // been vacuous — and a future inline background would quietly make the
      // computed-colour check vacuous the same way. Rule count cannot be
      // faked by an inline style: measured 97 styled, 0 unstyled (the 404
      // error page still yields a CSSStyleSheet object, so counting SHEETS
      // rather than RULES would not discriminate either).
      const cssRules = await page.evaluate(() =>
        Array.from(document.styleSheets).reduce((n, sheet) => {
          try {
            return n + sheet.cssRules.length;
          } catch {
            return n; // Unparseable (e.g. a 404 HTML body served as CSS).
          }
        }, 0),
      );
      expect(
        cssRules,
        "no stylesheet rules reached the document — the CSS bundle did not load, so .next/static is missing from the package",
      ).toBeGreaterThan(0);

      // ★★★ THIS COMES LAST AND THE ORDER IS LOAD-BEARING. An UNSTYLED body
      // has a zero-size box, so Playwright reports it `hidden` — measured, the
      // mutation run failed here with `expect(locator).toBeVisible() failed /
      // Received: hidden` and NOTHING about CSS, which reads like a broken
      // selector and sends the reader hunting for the wrong defect. Placed
      // after the two assertions above, the missing-bundle case names itself
      // and this one keeps its own job: catching a window that rendered
      // nothing at all.
      await expect(page.locator("body")).toBeVisible();

      // ★★★ ANTI-VACUITY 2. Prove the package is THIS checkout's build, not a
      // stale one from an earlier version. Mirrors the guard in
      // e2e/a11y.spec.ts (open-followups §58), extended to the packaged app.
      // ★★ It does NOT rule out a server someone left on the port: a
      // same-checkout `next dev` reports this very version. That job belongs
      // to assertPortFree()'s connect check, which fails the launch whenever
      // anything already answers on the app's origin.
      const served = await page.evaluate(() =>
        document.documentElement.getAttribute("data-app-version"),
      );
      expect(
        served,
        `Packaged app reports ${served ?? "(absent)"} but this checkout is ${APP_VERSION}.`,
      ).toBe(APP_VERSION);
    } finally {
      await shutdown(launched, browser);
    }
  });

  test("answers on loopback and REFUSES on the LAN address", async () => {
    requirePackagedExe();

    // Resolved BEFORE launching: skipping after launch would leak an app onto
    // the pinned port for the rest of the run.
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    test.skip(lan === undefined, "no non-loopback IPv4 interface on this machine");
    // test.skip() throws, so nothing below runs — but TS cannot see that.
    if (lan === undefined) return;

    // No CDP here: this test needs only the server, so it takes no debugging
    // port it does not use.
    const launched = await launchPackagedApp();
    try {
      // ★ CONTROL FIRST. A server that is simply down refuses on every
      // address, so without this the "refused on the LAN" half below proves
      // nothing at all.
      const loopback = await waitForAppOrigin(launched);
      expect(
        loopback,
        `${APP_HOST}:${APP_PORT} did not answer, so the LAN assertion below proves nothing`,
      ).toBe(200);

      // ★★★ THE SECURITY ASSERTION. A 0.0.0.0 bind would publish the app —
      // and the user's entire workspace — to the corporate LAN.
      // server-child.ts pins HOSTNAME to 127.0.0.1 and names this spec as the
      // reason; this is that check. It is the kind of thing that silently
      // regresses when someone widens a bind to fix a networking problem.
      await expect(
        fetch(`http://${lan}:${APP_PORT}/`, { signal: AbortSignal.timeout(3_000) }),
      ).rejects.toThrow();
    } finally {
      await shutdown(launched);
    }
  });
});

// The SHA-256 of zero bytes. Hashing an EMPTY stream is what the probe below
// did when ExtractAssociatedIcon failed under PowerShell's default
// `$ErrorActionPreference = 'Continue'`, which it ran under before the 'Stop'
// line was added: the failed call was only statement-terminating, so every
// later statement errored and carried on over an empty MemoryStream, and the
// script exited 0 having hashed nothing -- which made "differs from stock"
// pass against a missing stock exe. A real icon never hashes to this; it is
// the backstop should 'Stop' ever be dropped again.
const EMPTY_SHA256 =
  "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
const SHA256_HEX = /^[0-9A-F]{64}$/;

const RESOURCE_EDITING_HINT =
  "`win.signAndEditExecutable` in desktop/electron-builder.yml must not be " +
  "`false` (unset = default true); `signExecutable` affects signing only";

type ExeIdentity = {
  productName: string | null;
  companyName: string | null;
  legalCopyright: string | null;
  packagedIconHash: string;
  appIcoIconHash: string;
  stockIconHash: string;
};

// Runs the identity probe and returns its parsed output. Every failure --
// the probe not starting or timing out, a non-zero exit, output that is not
// JSON, JSON of the wrong shape -- throws with the probe's own stdout AND
// stderr attached, since stderr is where PowerShell explains itself.
function runIdentityProbe(script: string): ExeIdentity {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `\n--- stdout ---\n${result.stdout ?? ""}\n--- stderr ---\n${result.stderr ?? ""}`;
  if (result.error) {
    throw new Error(`Identity probe did not run: ${result.error.message}${output}`);
  }
  if (result.status !== 0) {
    throw new Error(`Identity probe exited ${result.status ?? `on ${result.signal}`}${output}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Identity probe printed no parseable JSON (${String(error)})${output}`);
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  const strings = ["productName", "companyName", "legalCopyright"] as const;
  const hashes = ["packagedIconHash", "appIcoIconHash", "stockIconHash"] as const;
  if (
    strings.some((key) => record[key] !== null && typeof record[key] !== "string") ||
    hashes.some((key) => typeof record[key] !== "string")
  ) {
    throw new Error(`Unexpected identity-probe output${output}`);
  }
  return parsed as ExeIdentity;
}

const DESKTOP_PACKAGE_JSON = join(__dirname, "..", "desktop", "package.json");

// The author NAME exactly as electron-builder derives it, since that is what
// it stamps as CompanyName: app-builder-lib appInfo.js `companyName` returns
// `author.name` AFTER normalizePackageData.js has run `unParsePerson` then
// `parsePerson` over it. That round trip flattens an object author to
// "name <email> (url)" and re-parses it, so BOTH forms keep only the text
// before the first `<` or `(`, trimmed -- an object `{ name: "Acme (EU)" }`
// becomes "Acme". Measured 2026-09-11 by running electron-builder's own
// normalizePackageData on five authors (plain string, string with email and
// url, and three objects): this rule on the string / on `.name` matched it
// every time. A hardcoded name here would go stale on the first edit to
// package.json and blame the build for it.
const AUTHOR_NAME_RE = /^([^(<]+)/;

function readAuthorName(pkgJson: string): string {
  const author: unknown = (JSON.parse(pkgJson) as { author?: unknown }).author;
  let raw = "";
  if (typeof author === "string") {
    raw = author;
  } else if (typeof author === "object" && author !== null) {
    const field = (author as { name?: unknown }).name;
    raw = typeof field === "string" ? field : "";
  }
  const name = AUTHOR_NAME_RE.exec(raw)?.[1] ?? "";
  if (name.trim() === "") {
    throw new Error(
      `No \`author\` name in ${DESKTOP_PACKAGE_JSON} — without one electron-builder ` +
        `writes no CompanyName and the exe keeps Electron's "GitHub, Inc.".`,
    );
  }
  return name.trim();
}

// ★★★ REGRESSION PIN for the resource-editing fix in
// desktop/electron-builder.yml. With the old `signAndEditExecutable: false`,
// resource editing was skipped entirely and the packaged exe silently kept
// Electron's own icon and ProductName ('Electron') -- electron-builder says
// so only in an info-level log line, never a warning or failure, and nothing
// else in this file would have caught it, since the boot test asserts
// CSS/version-string, never the exe's own binary metadata.
//
// ★★ CompanyName and LegalCopyright are pinned to desktop/package.json's
// `author`, because it is CompanyName's only source and LegalCopyright's
// default (a `copyright:` key in the builder config would override the
// latter -- appInfo.js `copyright`; this config sets none). With resource
// editing on but no author, CompanyName stayed Electron's "GitHub, Inc."
// (measured 2026-09-11) -- a second way to ship Electron's identity that the
// ProductName and icon pins cannot see.
//
// ★★ OUTSIDE the serial describe on purpose. A failure in a serial test skips
// every later test in its group, so inside it a broken boot would have hidden
// this one. It launches nothing and binds no port, so it needs none of the
// launch/shutdown discipline the boot tests do.
test("packaged exe carries the app's product identity and icon, not Electron's", () => {
  // Platform FIRST: on any other OS the missing-exe message below would send
  // the reader off to build a package this test could never inspect. The
  // probe is Windows-only: the icon hashes need System.Drawing's
  // ExtractAssociatedIcon and the VersionInfo strings come from `Get-Item`
  // (FileVersionInfo). It runs under `powershell` because Windows PowerShell
  // 5.1 ships with every Windows install; pwsh may not be present (it runs the
  // same probe fine where it is -- measured with pwsh 7.6.6).
  test.skip(
    process.platform !== "win32",
    "PowerShell/System.Drawing icon + VersionInfo probe is Windows-only",
  );
  requirePackagedExe();

  const stockElectronExe = join(
    __dirname,
    "..",
    "desktop",
    "node_modules",
    "electron",
    "dist",
    "electron.exe",
  );
  const appIco = join(__dirname, "..", "public", "app.ico");
  const authorName = readAuthorName(readFileSync(DESKTOP_PACKAGE_JSON, "utf8"));

  // ★★ THROW, never skip: without the stock exe the "not Electron's icon"
  // assertion has nothing to compare against, and a skip would report success.
  for (const [what, path, remedy] of [
    ["stock Electron exe", stockElectronExe, "run `npm --prefix desktop install`"],
    ["app icon", appIco, "it is the source electron-builder.yml `win.icon` names"],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`No ${what} at ${path} — the icon comparison needs it; ${remedy}.`);
    }
  }

  // ★★★ ALL THREE icons go through the SAME API, ExtractAssociatedIcon,
  // app.ico included. `New-Object System.Drawing.Icon(<ico>, w, h)` was the
  // first choice for the app.ico side and does NOT match: measured
  // 2026-09-11 under Windows PowerShell 5.1 (pwsh 7 gives a third value,
  // C58E77A3…), at the extracted 32x32 it hashed 2477954E… while the packaged
  // exe hashed 23C9617F… -- and ExtractAssociatedIcon on app.ico hashed
  // 23C9617F…, identical to the exe, to the full 64 digits. The image is the
  // same; the two constructions do not produce byte-identical bitmaps (every
  // entry in app.ico is PNG-compressed). Comparing through one API makes the
  // equality a property of the ICON, not of the decoder.
  //
  // `$ErrorActionPreference = 'Stop'` comes FIRST, before anything can fail.
  // One JSON object rather than a line per value, because a null
  // ProductName writes NO line and would shift every value after it into the
  // wrong slot. Single-quoted literals for the paths: '' escapes a literal
  // single quote, which a Windows path can contain (C:\Users\o'brien).
  //
  // ★ BOM-less UTF-8 console output, because Windows PowerShell 5.1 otherwise
  // writes stdout in the console code page: measured 2026-09-11, the "©" in
  // LegalCopyright reached Node as U+FFFD by default and as U+00A9 with this
  // line, and the output still began with "{" (no BOM for JSON.parse to trip
  // on). An author name with non-ASCII letters would be mangled the same way.
  const psEscape = (path: string): string => path.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
    "Add-Type -AssemblyName System.Drawing",
    "function IconHash($path) {",
    "  $bmp = ([System.Drawing.Icon]::ExtractAssociatedIcon($path)).ToBitmap()",
    "  $ms = New-Object System.IO.MemoryStream",
    "  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $sha = [System.Security.Cryptography.SHA256]::Create()",
    "  ([BitConverter]::ToString($sha.ComputeHash($ms.ToArray()))).Replace('-', '')",
    "}",
    `$packaged = '${psEscape(PACKAGED_EXE)}'`,
    `$stock = '${psEscape(stockElectronExe)}'`,
    `$appIco = '${psEscape(appIco)}'`,
    "$versionInfo = (Get-Item -LiteralPath $packaged).VersionInfo",
    "[pscustomobject]@{",
    "  productName = $versionInfo.ProductName",
    "  companyName = $versionInfo.CompanyName",
    "  legalCopyright = $versionInfo.LegalCopyright",
    "  packagedIconHash = IconHash $packaged",
    "  appIcoIconHash = IconHash $appIco",
    "  stockIconHash = IconHash $stock",
    "} | ConvertTo-Json -Compress",
  ].join("\n");

  const identity = runIdentityProbe(script);

  // ★★ ANTI-VACUITY: every hash must be a real SHA-256 of a real image before
  // any comparison between them means anything.
  for (const [what, hash] of [
    ["packaged exe", identity.packagedIconHash],
    ["public/app.ico", identity.appIcoIconHash],
    ["stock electron.exe", identity.stockIconHash],
  ] as const) {
    expect(hash, `${what} icon hash is not a SHA-256 hex digest`).toMatch(SHA256_HEX);
    expect(
      hash,
      `${what} icon hash is the SHA-256 of EMPTY input — ExtractAssociatedIcon ` +
        `failed and the probe hashed nothing`,
    ).not.toBe(EMPTY_SHA256);
  }

  expect(
    identity.productName,
    `packaged exe's VersionInfo ProductName should be "${PRODUCT_NAME}" ` +
      `(electron-builder.yml productName), not Electron's default -- ${RESOURCE_EDITING_HINT}`,
  ).toBe(PRODUCT_NAME);
  expect(
    identity.companyName,
    `packaged exe's VersionInfo CompanyName should be "${authorName}" ` +
      `(desktop/package.json author) -- electron-builder writes CompanyName only ` +
      `from \`author\`, so "GitHub, Inc." means the exe predates it; repackage`,
  ).toBe(authorName);
  expect(
    identity.legalCopyright,
    `packaged exe's LegalCopyright should name "${authorName}" ` +
      `(electron-builder's default copyright is "Copyright © <year> <author>")`,
  ).toContain(authorName);
  expect(
    identity.packagedIconHash,
    `packaged exe's icon is stock Electron's -- resource editing was skipped; ` +
      RESOURCE_EDITING_HINT,
  ).not.toBe(identity.stockIconHash);
  // The positive pin: "not Electron's" would pass for ANY other icon,
  // including a wrong `win.icon:` path that still resolves to some .ico.
  expect(
    identity.packagedIconHash,
    "packaged exe's icon is not public/app.ico -- check `win.icon` in " +
      "desktop/electron-builder.yml",
  ).toBe(identity.appIcoIconHash);
});
