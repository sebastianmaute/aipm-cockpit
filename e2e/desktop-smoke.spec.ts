import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
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
// here would, after a rename, name an exe the build no longer writes: if none
// is left in win-unpacked/, every test in this file SKIPS -- a gate reporting
// success -- and if a stale one is, the identity test fails with a
// ProductName mismatch that blames the build when this spec is out of date.
const PACKAGED_EXE = join(
  __dirname,
  "..",
  "desktop",
  "release",
  "win-unpacked",
  `${PRODUCT_NAME}.exe`,
);

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
// So `app.firstWindow()` resolves against a `file://…splash.html` page, and an
// assertion made on it sees the splash markup — no themed background, no
// `data-app-version`. Polling by URL rather than by window INDEX is correct
// for that, and stays correct if the splash is ever moved into a window of its
// own (which is the shape `firstWindow()` would silently get wrong).
async function appWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + WINDOW_BUDGET_MS;
  let lastSeen = "(no window yet)";
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
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
// next launch. `app.close()` returns before the OS has torn the listener down,
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
    `Something is still serving ${APP_ORIGIN} 30s after app.close(). ` +
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
// reported was waitForPortRelease()'s "leaked server child ... after
// app.close()", blaming the package for a process it never started. A foreign
// holder is caught too, before main.ts's own "Port in use" dialog. Binding the
// port ourselves on the app's host asks the OS the same question the app's
// server will, so it fails first and names the likely culprit.
async function assertPortFree(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `port ${APP_PORT} in use before launch — is ${PRODUCT_NAME} ` +
                `(installed copy) running? Close it and re-run.`,
            )
          : error,
      );
    });
    probe.listen(APP_PORT, APP_HOST, () => probe.close(() => resolve()));
  });
}

type Launched = { app: ElectronApplication; profile: string };

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
async function launchPackagedApp(): Promise<Launched> {
  await assertPortFree();
  const profile = mkdtempSync(join(tmpdir(), "aipm-desktop-smoke-"));
  return {
    app: await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${profile}`],
    }),
    profile,
  };
}

async function shutdown({ app, profile }: Launched): Promise<void> {
  await app.close();
  await waitForPortRelease();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A profile directory Windows still holds open is harmless — it is under
    // the OS temp dir. Never fail a smoke test on its own cleanup.
  }
}

test.describe.serial("packaged desktop app", () => {
  test("boots, is styled, and reports this version", async () => {
    test.skip(
      !existsSync(PACKAGED_EXE),
      `No packaged app at ${PACKAGED_EXE} — build one with \`npm run desktop:package\`.`,
    );

    const launched = await launchPackagedApp();
    try {
      const page = await appWindow(launched.app);

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

      // ★★★ ANTI-VACUITY 2. Prove the window shows THIS build, not a dev
      // server someone left on the port. Mirrors the guard in e2e/a11y.spec.ts
      // (open-followups §58), extended to the packaged app.
      const served = await page.evaluate(() =>
        document.documentElement.getAttribute("data-app-version"),
      );
      expect(
        served,
        `Packaged app reports ${served ?? "(absent)"} but this checkout is ${APP_VERSION}.`,
      ).toBe(APP_VERSION);
    } finally {
      await shutdown(launched);
    }
  });

  test("answers on loopback and REFUSES on the LAN address", async () => {
    test.skip(
      !existsSync(PACKAGED_EXE),
      `No packaged app at ${PACKAGED_EXE} — build one with \`npm run desktop:package\`.`,
    );

    // Resolved BEFORE launching: skipping after launch would leak an app onto
    // the pinned port for the rest of the run.
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    test.skip(lan === undefined, "no non-loopback IPv4 interface on this machine");
    // test.skip() throws, so nothing below runs — but TS cannot see that.
    if (lan === undefined) return;

    const launched = await launchPackagedApp();
    try {
      await appWindow(launched.app);

      // ★ CONTROL FIRST. A server that is simply down refuses on every
      // address, so without this the "refused on the LAN" half below proves
      // nothing at all.
      const loopback = await fetch(APP_ORIGIN).then((r) => r.status);
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
  packagedIconHash: string;
  appIcoIconHash: string;
  stockIconHash: string;
};

function parseExeIdentity(stdout: string): ExeIdentity {
  const parsed: unknown = JSON.parse(stdout);
  const record = (parsed ?? {}) as Record<string, unknown>;
  const hashes = ["packagedIconHash", "appIcoIconHash", "stockIconHash"] as const;
  const productName = record.productName;
  if (
    (productName !== null && typeof productName !== "string") ||
    hashes.some((key) => typeof record[key] !== "string")
  ) {
    throw new Error(`Unexpected identity-probe output: ${stdout}`);
  }
  return parsed as ExeIdentity;
}

// ★★★ REGRESSION PIN for the resource-editing fix in
// desktop/electron-builder.yml. With the old `signAndEditExecutable: false`,
// resource editing was skipped entirely and the packaged exe silently kept
// Electron's own icon and ProductName ('Electron') -- electron-builder says
// so only in an info-level log line, never a warning or failure, and nothing
// else in this file would have caught it, since the boot test asserts
// CSS/version-string, never the exe's own binary metadata. (CompanyName is
// deliberately NOT asserted: it stays Electron's "GitHub, Inc." even WITH
// resource editing on, because electron-builder writes it only from a
// package.json `author` and desktop/package.json has none.)
//
// ★★ OUTSIDE the serial describe on purpose. A failure in a serial test skips
// every later test in its group, so inside it a broken boot would have hidden
// this one. It launches nothing and binds no port, so it needs none of the
// launch/shutdown discipline the boot tests do.
test("packaged exe carries the app's product identity and icon, not Electron's", () => {
  // Platform FIRST: on any other OS the missing-exe message below would send
  // the reader off to build a package this test could never inspect.
  // ExtractAssociatedIcon + VersionInfo via System.Drawing are Windows-only
  // (Windows PowerShell 5.1, not pwsh -- System.Drawing is available there
  // without an extra package reference).
  test.skip(
    process.platform !== "win32",
    "PowerShell/System.Drawing icon + VersionInfo probe is Windows-only",
  );
  test.skip(
    !existsSync(PACKAGED_EXE),
    `No packaged app at ${PACKAGED_EXE} — build one with \`npm run desktop:package\`.`,
  );

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
  // 2026-09-11, at the extracted 32x32 it hashed 2477954E… while the packaged
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
  const psEscape = (path: string): string => path.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
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
    "[pscustomobject]@{",
    "  productName = (Get-Item -LiteralPath $packaged).VersionInfo.ProductName",
    "  packagedIconHash = IconHash $packaged",
    "  appIcoIconHash = IconHash $appIco",
    "  stockIconHash = IconHash $stock",
    "} | ConvertTo-Json -Compress",
  ].join("\n");

  const identity = parseExeIdentity(
    execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    }),
  );

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
