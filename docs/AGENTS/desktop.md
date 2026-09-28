# Desktop — the Electron shell at runtime

Owns `desktop/src/`: `main.ts` (app lifecycle, windows, menu, PDF route), `server-child.ts` (the Next server child),
`updater.ts` (electron-updater wiring), and the pure, unit-tested decisions in `desktop/src/lib/`
(`window-open-policy.ts`, `print-target.ts`, `window-liveness.ts`, `menu-model.ts`, `pdf-export.ts`,
`update-policy.ts`, `electron-updater-loader.ts`, `port-owner.ts`, `readiness.ts`, `exit-reporting.ts`,
`log-paths.ts`, `constants.ts`). Also the renderer's half of each boundary: `src/app/desktop-shell.ts`
(`isDesktopShellUserAgent`, `DESKTOP_VERSION_REQUEST_EVENT`), `PrintButton`'s shell check in
`task-manager-ui.tsx`, `pdf-export-protocol.ts` and `use-desktop-version-request.ts`.

Does NOT own packaging, the installer, the fuses or `release.yml` (the `release.yml` section of
[`ci.md`](ci.md)), the `desktop:typecheck` gate itself (`ci.md`, the `static` job), or end-user
install help (`docs/desktop-rollout.md`). One fact, one doc.

★★ **The pattern for this whole tree: a decision moves out of `main.ts` into `desktop/src/lib/`
so a test can reach it.** `main.ts` has no test file and imports `electron` at the top, so no unit
test pins a decision left in it. `window-liveness.ts`'s header records the case that
forced the rule: a mutant printing the wrong window survived every gate until the decision moved
out. Add new logic as a pure `lib/` function plus its Electron call in `main.ts`, never inline.

## What checks it

- **Types.** The root `tsconfig.json` `exclude` lists `desktop/src/main.ts`, `server-child.ts`,
  `updater.ts` and the two tests that import electron or electron-updater (`updater.test.ts`,
  `updater-module-shape.test.ts`). The `lib/` modules are NOT excluded, so the root `npx tsc --noEmit`
  covers them. The excluded files are typechecked by `npm run desktop:typecheck`
  (`scripts/check-desktop-types.mjs`: `tsc -p desktop/tsconfig.json`, then `desktop/tsconfig.test.json`),
  which runs in the `static` group of `scripts/gate-local.mjs` and in CI's `static` job.
  ★ **"Only the manual desktop-package build compiles `main.ts`" is no longer true.** The comments
  in `menu-model.ts` and `main.ts` that said so were corrected on 2026-09-27, and §547 carries a dated
  correction. Verify the current scope with `grep -n "desktop" scripts/gate-local.mjs` rather than
  trusting any prose. ★ Locally, `desktop:typecheck` SKIPS with exit 0 when `desktop/node_modules`
  is missing; under CI it exits 2.
- **Tests.** `vitest.config.ts`'s `include` covers `desktop/**/*.{test,spec}.ts`. Coverage does not
  (it stays `src/**`).
- **Size.** `npm run size:check` walks `src` only (`grep -n "readdirSync" scripts/check-file-sizes.mjs`),
  so `main.ts` is outside the ratchet. Measure it with `wc -l desktop/src/main.ts`.
- **The packaged app.** `npm run e2e:desktop` (`e2e/desktop-smoke.spec.ts`) needs a prior
  `npm run desktop:package` and runs in no CI job. It is the only automated check that launches the shell.

## Startup: the pinned port and the server child

- **The origin is fixed.** `APP_HOST`/`APP_PORT`/`APP_ORIGIN` (`lib/constants.ts`) are
  `127.0.0.1:17300` and deliberately not configurable. ★★★ **Never fall back to another port.** The
  port is half the origin and IndexedDB is origin-scoped, so a different port is a different, empty
  workspace. `classifyPortOwner` (`lib/port-owner.ts`) answers `free`, `ours` (the response carries a
  `data-app-version` attribute equal to `app.getVersion()`), `stale` (the attribute carries a different
  version, §631) or `foreign` (no attribute). `start()` spawns a server only on `free`, loads the app
  without spawning on `ours`, and on `foreign` or `stale` shows a dialog ("Port in use", "Another
  version is still running") and quits. A `stale` server is never reused or killed: this launch did
  not spawn it and has no pid for it.
- **The server runs as `utilityProcess.fork`** of `standalone/server.js` under `process.resourcesPath`
  (`spawnServer`). ★★★ NOT `spawn(process.execPath)` with `ELECTRON_RUN_AS_NODE`: the packaged build
  turns the RunAsNode fuse off, so that path booted a second Electron GUI and the server never
  listened. `HOSTNAME` is `127.0.0.1`; a `0.0.0.0` bind would publish the workspace to the LAN, and
  the "answers on loopback and REFUSES on the LAN address" test in `e2e/desktop-smoke.spec.ts` asserts
  it. The child's env is `scrubbedEnv()`, which drops `NODE_OPTIONS`, `NODE_PATH` and
  `NODE_REPL_EXTERNAL_MODULE`. Whether the fuse already covers the child is unproven (§561).
- **Readiness is polled, not slept.** `waitForReady` (`lib/readiness.ts`) probes the origin every 250 ms
  for up to 60 s, then `fail()`s with a dialog.
- **Stopping it.** `killServer` runs from both `before-quit` and `process.on("exit")`, and is
  PID-scoped (on Windows `taskkill /PID <pid> /T /F`), never by image name, since that would kill the
  user's other Node and Electron processes. ★★★ **A server exit is a crash only by INTENT, not by exit code.**
  `taskkill /F` makes our own shutdown exit with code 1, so `shouldReportServerExit`
  (`lib/exit-reporting.ts`) reports only when `quitting` is false and a window is alive.
- **The log.** `resolveLogDir` gives `%LOCALAPPDATA%\aipm-cockpit\logs` (then `TEMP`, `TMP`, `.`), and
  `main.ts`'s `log` appends to `launch.log` there and never throws. Dialogs name that path.
- **One instance.** A second launch focuses the existing window and sets `#dashboard` through
  `helpHashScript(DASHBOARD_VIEW_HASH)`, a hash change rather than a reload, so unsaved work survives.
- ★★ **Only `start()` has a catch-all.** `app.whenReady().then(start).catch(...)` turns a startup throw
  into the `fail()` dialog. No `unhandledRejection` or `uncaughtException` handler exists, so every
  menu click and every `web-contents-created` listener carries its own try/catch. Touching
  `webContents` on a destroyed window throws SYNCHRONOUSLY, so a `.catch` on a promise cannot cover it.

## Windows, navigation and the sign-in popup

- **One listener wires every WebContents.** `app.on("web-contents-created", ...)` in `main.ts` installs
  the window-open handler, the navigation guards, the PDF route and the Version prime on EVERY
  WebContents, including popouts, which the renderer opens itself (`openPopoutWindow`,
  `broadcast-sync.ts`) and `main.ts` holds no reference to. Add new per-window wiring there, not as a
  second registration.
- **Opening a window.** `setWindowOpenHandler` calls `decideWindowOpen`: `about:blank`, the empty
  string or the app's own origin opens in-app; `http:`, `https:` and `mailto:` go to
  `shell.openExternal` and are denied in-app; anything else is denied. ★★★ **Compare ORIGINS, never
  `startsWith`**: `http://127.0.0.1:17300@evil.com/` starts with the app's origin string and its origin
  is `http://evil.com`. `originOnly` is what gets logged, because an OAuth URL's query carries codes.
- **Navigating.** `will-navigate` and `will-redirect` (main frame only) call `decideNavigation`. A server
  redirect is a separate event from `will-navigate`, so both are guarded.
- ★★★ **The Microsoft sign-in popup.** MSAL pre-opens `about:blank` and then `location.assign`s it to
  the identity host, so the window-open decision never sees the host; the navigation guard does.
  ENTRY into the flow needs both `createdAsBlankPopup` and `initiatorIsAppOpener` (latched per child in
  `did-create-window`, compared by `isAppOpenerFrame`) and an https host in `MS_IDENTITY_HOSTS` on the
  default port. A Microsoft link clicked inside a popout or an export tab fails one of the two, so it
  opens externally. Once in the flow ANY https host renders in-app (federated IdPs), until the popup
  navigates back to the app's origin or a load of it fails. The main window cannot enter: it has no
  `windowFacts` entry.
- ★★ **The flow flag is staged, then committed.** An allowed `will-*` hop stages it in `pendingAuthFlow`;
  `did-navigate` commits it; `did-fail-load` and `did-fail-provisional-load` discard it through
  `discardStagedAuthFlow`. `will-redirect` reads the staged value before the committed one. Three bugs in
  this wiring were found by review and none by a test, because it lives in `main.ts`. §547 files the
  missing harness.
- ★★ **Never script a page the shell does not own.** `isAppPage` gates the two Version-panel scripts,
  the only ones sent to a window other than the main window or the PDF tab: the `did-finish-load` prime
  and Help → Version. The sign-in popup can sit on any https host, and the script would hand it the
  absolute log path.

## Print and the menu

- ★★★ **The renderer cannot print in the shell.** Electron refuses a renderer-initiated `window.print()`
  (`menu-model.ts` names the binary string and the grep). So `PrintButton` renders `null` there,
  detected through `useSyncExternalStore` with a server snapshot of `false`: SSR emits every Print
  button and the first client render removes them, a flash that was accepted over a hydration mismatch.
  It hides rather than disables. The toolbar-order rule in `AGENTS.md` carries the consequence for button
  arity. Printing is File → Print… (`CmdOrCtrl+P`).
- **Which window prints.** `pickPrintTarget(focused, main)` is `liveWindow(focused ?? main)`.
  ★★★ **A destroyed focused window prints NOTHING**; it does not fall back to the main window, which
  would print what the user is not looking at. ★★ `win` is assigned once and never reset to `null`, so
  `if (win)` or `win?.` is not a liveness guard; ask `liveWindow`. A dismissed print dialog arrives as a
  failure, and `isPrintCancellation` (`/cancel/i`) keeps it out of the log.
- **The menu.** File is hand-built (Print…, a separator, `role: "quit"`); Edit, View and Window are
  Electron's roles; Help is `HELP_MENU_ITEMS` (Help, Version, Check for updates…). `helpAction` and
  `fileAction` are lookups in a `Record` keyed by the id union, so a missing mapping fails the typecheck.
  ★★★ **The click builders must not throw**: `buildMenu` runs eagerly inside `start()`, so a throw there
  means no app at all. Their `switch` defaults log and return a no-op click. Labels are English only,
  because the language lives in renderer settings and there is deliberately no IPC or preload.
- **Help → Version** runs `versionRequestScript`, which dispatches `DESKTOP_VERSION_REQUEST_EVENT` with
  `{ logPath, open }` and returns whether a listener handled it; if none did, the click retries once on
  the main window. Every app page is also primed with `open: false` on `did-finish-load`, so the log
  path is known before the panel opens. ★★ The event name is declared on both sides of the boundary,
  because `desktop/src` cannot import `src/app`; the "shared strings with the app" block in
  `menu-model.test.ts` reads `desktop-shell.ts` as text and pins the two equal.

## PDF export (§468, closed)

- The renderer opens its export tab under `PDF_EXPORT_FRAME_NAME` in the shell (`pdfWindowName`), and
  the window-open handler creates that frame hidden. ★★★ **The ready signal is a static `<title>`**
  (`pdfReadyTitleMarkup`, prefix `PDF_READY_TITLE_PREFIX`), not a script: the `about:blank` tab
  inherits the production CSP, whose `script-src` is nonce-only, so a script signal is blocked. The same
  CSP once blocked the tab's un-nonced `<style>` (the first packaged PDF printed unstyled); the renderer
  now nonces it, and `preparePdfPrint` still re-applies the head stylesheet with `insertCSS` before
  measuring, then fits each wide table on its own. `next dev` allows inline styles, so
  none of this reproduces against a dev server. `pdf-export.test.ts` pins both literals equal to the
  renderer's copy.
- `main.ts` waits for the title, polls `document.readyState` through `waitForReady`, then runs
  `printToPDF`, the save dialog and the write. ★★★ **The `PDF_EXPORT_TIMEOUT_MS` backstop is cleared
  once the page is ready**, before `printToPDF` and the save dialog, which may legitimately take longer.
  It is also cleared when the renderer closes the tab itself. Left armed, it closed the window while the
  save was about to succeed.

## The updater

- `createUpdater` returns a no-op updater when `AIPM_DISABLE_UPDATE_CHECK=1` (the packaged smoke test
  sets it). Otherwise it imports electron-updater DYNAMICALLY, so a broken package degrades to
  `unavailableUpdater` instead of killing the app while `main.ts` loads. ★★★ **`autoUpdater` is not a
  named export under a dynamic import in Node; it is on `.default`.** Reading `mod.autoUpdater`
  silently disabled updates in every installed copy while every gate stayed green. `pickAutoUpdater`
  checks both shapes, because vitest's loader synthesizes the named export, so a vitest run cannot see
  the defect.
  Loading and wiring have separate try/catch blocks, so a wiring defect is not logged as a load failure.
- Checks run only when `app.isPackaged`: once `STARTUP_CHECK_DELAY_MS` after startup, and from
  Help → Check for updates…. Nothing downloads without a click (`autoDownload` is false), "Skip this
  version" writes `update-skip.json` under `userData`, and `decideCheckRequest` routes a request that
  arrives mid-operation. A startup check stays silent unless it finds an update that was not skipped;
  a DOWNLOAD failure is always shown. `summarizeError` keeps the first line only, because electron-updater's HTTP errors
  embed the response headers, `set-cookie` included.
- "Restart now" is `quitAndInstall(true, true)`, which starts the installer BEFORE `before-quit` runs.
- The feed is the public GitHub Releases `latest.yml`; the installer is unsigned. What stands in for
  signing is recorded beside `RELEASES_URL` in `lib/constants.ts` and in §487/§563.

## Open register entries

§462 (no Linux installer) · §479 (1.0.1–1.0.3 never tagged) · §487 and
§563 (unsigned installer) · §547 (the sign-in state machine has no harness) · §561 (fuses confirmed on
a local package only). Re-list them with
`grep -nE "^## [0-9]+\..*(desktop|Electron|installer).*OPEN" docs/open-followups.md`.
