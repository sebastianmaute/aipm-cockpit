# Desktop app bundling — design

**Date:** 2026-09-10
**Status:** design approved section-by-section; two spikes open (see "Open questions")
**Goal:** a non-technical colleague installs the app on their own laptop, double-clicks an icon, and uses it. No terminal, no Node install, no `npm` anything.

---

## 1. Context and audience

Today the app is started from a CLI (`npm run dev` / `npm run build && npm start`) and used at `http://localhost:3000` in a browser. That is fine for developers and unusable for the intended audience.

**Audience:** non-technical colleagues, on their own laptops (Windows).
**Existing data:** exists, but is **disposable** — nobody needs today's browser-stored workspace carried into the packaged app.
**Update model:** the app self-updates from a network share.

### Non-goals

- Cross-platform builds. Windows first; macOS/Linux are not in scope and nothing here should block them later.
- Multi-user or server-hosted deployment. This is a single-user desktop app; a hosted client/server variant was discussed separately and is explicitly not this design.
- Carrying existing browser data across. Disposable by decision.

---

## 2. The constraint that determines everything

**The app cannot ship as static files.** Two independent reasons:

- `src/proxy.ts` is Next middleware providing the **per-request CSP nonce**. Next reads the CSP from the incoming request header, extracts `nonce-{value}`, and attaches it to framework scripts, page bundles and SSR-injected `<style>` blocks. `output: export` has neither middleware nor SSR.
- There are **12 API route handlers** (`confluence/page`, `ecb`, `jira/*` ×8, `stt`, `timelog`). These are server endpoints; several exist specifically as SSRF-guarded proxies and must not move into the client.

Therefore **every** packaging option runs a real Next server, which means a Node runtime ships with the app. This is what rules out a "pure Rust/Tauri, no Node" shell — Tauri would have to carry Node as a sidecar, spending exactly the footprint advantage that motivates it.

---

## 3. Decision: Electron

Three shapes were compared:

| | A. Launcher + system browser | B. Tauri shell + Node sidecar | C. Electron |
|---|---|---|---|
| Window | user's browser tab | own window (WebView2) | own window (bundled Chromium) |
| Node | bundled portable runtime | bundled as sidecar | native to the runtime |
| Size | ~60 MB | ~90 MB | ~200 MB |
| Auto-update | hand-rolled | `tauri-plugin-updater` | `electron-updater` |
| Toolchain | Node | Node **+ Rust** | Node |

**Chosen: C.** The deciding argument is that the runtime we must ship anyway *is* the runtime the shell is written in. B's headline benefit is a small binary, and the mandatory Node sidecar spends most of it while adding a second toolchain to every release. A is the least code but the worst fit for the audience: a stray server with no window is the support call this project exists to remove.

**Cost accepted:** ~200 MB installer, and Chromium's patch cadence becomes ours.

**Unverified, and it is why B is not merely "the leaner option":** whether the File System Access API is available in WebView2. File mode (`aipm-cockpit-project-handles`) depends on it. Electron is plain Chromium, so the question does not arise there. Anyone reopening the Tauri option must measure this first.

---

## 4. Architecture

### Process model

Two processes, one runtime:

- **Main process** (Electron) — owns the window, the lifecycle and the updater.
- **Server child** — the Next standalone server, spawned as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`. This reuses Electron's own Node; **no second Node runtime is bundled**.

### Build shape: `output: "standalone"`

`next build` traces only the modules the server needs and emits `.next/standalone/server.js`. Middleware is included, so the nonce CSP keeps working.

- **Env-gated** (`NEXT_STANDALONE=1`), not default-on, so no existing pipeline job changes shape. `build`'s artifact and `prod-smoke`'s `next start` are unaffected.
- **`.next/static` and `public/` are NOT copied into the standalone directory by Next.** The packaging step must copy them. Omitting this produces an app that boots and renders **completely unstyled with no assets** — a runtime failure, invisible at build time. Section 8's smoke test targets this specifically.

### The origin rules

The renderer is an HTTP origin, and IndexedDB is scoped to scheme+host+port. Four rules follow, and each has a concrete failure mode:

1. **Pinned port.** Never "any free port": a changing port is a changing origin, so the workspace appears wiped on every launch.
2. **`127.0.0.1`, never `localhost`.** Different origins. The choice is permanent from first release and must be recorded with its reason.
3. **Bind loopback only.** A server on `0.0.0.0` publishes the app *and* the colleague's workspace to the corporate LAN.
4. **Single-instance lock.** A second launch focuses the existing window. If the port is busy and it is not our server, **fail loudly** — the tempting fallback of grabbing the next free port is failure mode 1.

**Port: `17300`, fixed.** It must avoid `3000` (dev server), `3100` (isolated axe runs) and `3200` (`e2e:smoke:prod`, which refuses to start when its port is held) — a developer running the packaged app beside a dev server must not have either capture the other's origin. `17300` also sits below the Windows ephemeral range (which starts at 49152), so the OS will not hand it to an unrelated process as a temporary port.

Because the port is half the origin, **changing this number in a later release silently swaps every user's data store**. It is a permanent decision, not a configuration knob, and must not be made user-settable.

### Renderer trust

The page is remote content and gets no more trust than a browser tab: `contextIsolation: true`, `nodeIntegration: false`, no Node surface exposed. Anything the shell must expose goes through a narrow explicit preload API. Nothing does today.

### What moves, and what does not

The packaged app gets a **fresh, empty** Chromium profile. Storage technology is unchanged — same IndexedDB, same DB names, same `idb.ts`. Consequences, all one-time and all user-visible:

- Workspace rows in the browser's `aipm-cockpit` store are not present. Disposable by decision; if that ever changes, the migration path needs no new code (export JSON from the browser, import in the app).
- **Secrets must be re-entered once.** The device key lives in the separate `aipm-cockpit-secrets` DB and the five sealed secrets are encrypted against it: a new profile means a new device key. This must be in the rollout note or first launch reads as broken.
- **`aipm-cockpit-project-handles` does not survive** — file-mode users re-pick their project file once.
- Turso-backed data is server-side and appears immediately once the token is re-entered.

---

## 5. Repo layout, packaging and CI

**Same repo, `desktop/`.** Not a second repo: the shell moves in lockstep with the app it wraps, and this repo already gates that class of drift.

**Packager: `electron-builder`**, NSIS target — `electron-updater` is the same project and Section 7 depends on it.

**Per-user install, no elevation** (`perMachine: false` → `%LOCALAPPDATA%`). Corporate laptops routinely deny admin rights; a machine-wide installer turns "double-click to run" back into a ticket.

**A separate, manual CI job.** Electron builds are slow and the artifact is large; per-MR runs would dominate pipeline time and storage for no signal. It **consumes the existing `build` artifact** — the app is never rebuilt for packaging.

### Gate ripples

Three, all of which bite in CI rather than locally:

- **`version-sync-check`** — `src/app/version.ts` is the source of truth. `desktop/package.json` is a **new satellite** carrying the version and must be added to `version:sync`, never hand-edited. An unregistered satellite is exactly the silent drift that job exists to catch.
- **`lint`** — CI lints the **whole repo** at `--max-warnings=0`, not just `src`. `desktop/` is in scope from its first commit and needs its own eslint config for the Node/Electron main-process context.
- **Coverage floors** are `src/**` only, so `desktop/` raises no floor. Stated deliberately: its tests are opt-in quality, not gate-enforced, and a reader must not assume the floors cover it.

---

## 6. Startup, lifecycle and failure modes

### Launch sequence

1. Acquire the single-instance lock; if not acquired, focus the existing window and exit.
2. Show the window **immediately** with a local splash — not the server URL. The server needs a second or two, and pointing the window at a port that is not yet listening gives a white rectangle or a connection error, which reads as a crash.
3. Spawn the server child with `PORT=17300`, `HOSTNAME=127.0.0.1`, `NODE_ENV=production`.
4. **Poll for readiness** — `GET /` until 200, with a hard timeout. Not a fixed sleep: on a slow laptop a sleep is either a hang or a race.
5. On ready, load the URL.

### Shutdown

Closing the window quits the app and kills the server child. No tray icon — the window *is* the app, which is the simplest model for this audience.

The kill must be **port/PID-scoped**, never a blanket `taskkill /IM node.exe`; the same discipline `scripts/stop-dev.mjs` already follows. Here a stray kill would hit the user's editor or another Electron app.

**An orphaned server is the worst failure in this design**, because it composes with the loud-failure rule: it holds the pinned port, so the next launch correctly refuses to start and the app appears permanently broken. The child must die with the parent, **and** startup must adopt-or-report a server already on that port.

### Failure modes

Each gets a specific, non-technical message **and** a log file at `%LOCALAPPDATA%\aipm-cockpit\logs`. "It doesn't open" with no artifact is unsupportable at a distance.

| Failure | Behaviour |
|---|---|
| Port held by a foreign process | Name the port and what to do. **Never silently rebind.** |
| Server exits during startup | Friendly message + stderr tail in the log. Where the missing-`.next/static` failure surfaces. |
| Readiness timeout | Distinct message from a crash — different causes. |
| Server dies while running | Offer restart rather than leaving a dead window. |

---

## 7. Updates

**Mechanics.** `electron-builder` emits `latest.yml` + the installer. `electron-updater` reads that manifest, downloads in the background **after** the window is up (never blocking startup), then prompts *"Update ready — restart now / later"*. Prompt, never force: a silent restart mid-work is worse than a stale version.

**Version chain.** `src/app/version.ts` → `desktop/package.json` (the `version:sync` satellite) → embedded by `electron-builder` → `latest.yml`. The updater cannot disagree with the app about what version it is.

**Updates are non-destructive because of the pinned origin.** Same `127.0.0.1`, same port across versions → same IndexedDB store → workspace, sealed secrets and file handles all survive. This is the *reason* for rule 1 in Section 4, not a coincidence.

**Rollback.** Keep the previous installer on the share. NSIS refuses downgrades unless `allowDowngrade: true`; without it a bad release has no way back except manual uninstall.

### Security: unsigned

Decision: **ship unsigned.** No code-signing certificate is available.

Consequences, stated plainly:

- Windows SmartScreen shows an "unrecognized app" prompt on install — for the audience least equipped to dismiss it correctly. It belongs in the rollout instructions.
- `electron-updater` verifies the publisher signature on NSIS updates by default. Unsigned means **that check is disabled** (`verifyUpdateCodeSignature: false`).
- **The share's ACL therefore becomes the only integrity control on the update channel.** Anyone who can write to that path can push code that executes on every colleague's laptop, silently, at next launch. The share must be read-only for users and writable only by the release owner, and that ACL must be treated as a production control, not a convenience.

**Cheap hedge, not taken by default:** a **self-signed** certificate does nothing for SmartScreen but restores the updater's publisher-match check, giving tamper-evidence on the update chain for near-zero cost. Worth adopting if the share's ACLs are not firmly owned.

### As shipped, 2026-09-12: no auto-update yet

Everything above in this section describes the *intended* update path. **None of it is built.** What ships is a manual check. Two separate reasons, and they are not the same strength — conflating them is how this subsection read on its first draft.

**Auto-UPDATE is refused on the merits.** `electron-updater` needs a location it can `GET` without a human, and the GitLab project is `internal`: it serves nothing to an unauthenticated caller, so an app polling it on its own would never get a reply. The two ways to change that are both worse than the problem:

- **A shared token baked into the app.** Every laptop then carries a credential that reads the project, and that token becomes the only thing standing between an attacker and the update channel.
- **A writable network share.** Then the share's ACL is the only control — which the *Security: unsigned* note above already states plainly.

Both land in the same place, and the unsigned decision is what makes it sharp: with `verifyUpdateCodeSignature: false` there is no publisher check behind the fetch, so whichever of those two you pick is the **sole** integrity control over code that is fetched *and executed* on every colleague's machine at next launch. A link the user clicks keeps the authentication where it already is — in their own browser, as themselves — and keeps the *decision* to install with the person, which an unsigned channel makes the honest arrangement anyway.

**Decision, closed: no check.** What ships is the manual menu item alone — no polling, no version comparison, no automatic check of any kind. The reasoning above is why the manual route is the right one, not a staging post toward an automatic one; an earlier revision of this section argued the case FOR a version check at some length, which read as reopening a question the user had closed.

**Rejected alternative: an in-app login.** A `BrowserWindow` pointed at GitLab's own sign-in would avoid a baked credential entirely. It is nonetheless worse: the app would then hold the user's whole GitLab session — every project they can reach, not a scoped read of this one — inside a shell whose renderer is deliberately kept at browser-tab trust with no preload. Strictly more exposure than the token it replaces.

**What ships instead.** `RELEASES_URL` (`desktop/src/lib/constants.ts`) names the project's Releases page. `HELP_MENU_ITEMS` gains a third entry, **Help → Check for updates…**, last in the menu. The id→behaviour decision is the pure `helpAction` in `desktop/src/lib/menu-model.ts`, which returns a `HelpMenuAction`; `helpMenuClick` in `desktop/src/main.ts` switches on that and calls `shell.openExternal`. The split is not cosmetic: root `tsconfig.json` excludes `desktop/src/main.ts`, so a mapping written there is typechecked only by the desktop build (`allow_failure: true` on a merge request), while `menu-model.ts` is covered by the blocking `typecheck` job — and `helpMenuClick` runs eagerly during `start()`, where a throw rejects startup and takes the whole app down, so its default branch logs and returns a no-op instead. (`app.whenReady().then(start)` now has a `.catch` routing that rejection through `fail()`, so such a throw is at least visible — logged, with a dialog — rather than the silent non-start it used to be. It still leaves the user with no app, which is why the no-op branch stays.) `formatVersionDetail` now also states that updates are manual and repeats the URL, so the dialog a user already opens to answer "what version am I on" answers "and where is a newer one" in the same breath — silence there reads as *the app keeps itself current*, which would leave people on a stale build indefinitely.

That dialog also carries a second button, **Open releases page**, beside OK. The URL stays in the message text as well, because a screenshot of the dialog is a common way this gets passed around and a button is not readable in one. `VERSION_DIALOG_BUTTONS` pairs each label with a `VersionDialogAction` in one row, so the response index cannot come to mean something other than its label; `defaultId` and `cancelId` both point at OK, so Enter and Escape dismiss rather than launching a browser. The *entire* options object comes from the pure `versionDialogOptions`, for the same typecheck-scope reason as `helpAction` — an option spelled in `main.ts` is reachable by no unit test and no blocking job, so `defaultId: 1` would have shipped green. Both this button and the menu item call the single `openReleasesPage` in `desktop/src/main.ts` — one `shell.openExternal` call site, not two copies.

**Open question 1 stays open.** Choosing a manual route answers nothing about whether `electron-updater`'s generic provider works over UNC versus an internal HTTPS feed; that spike is still owed before an UPDATE FEED is committed to. ★ That is §9's pre-existing question about the updater, and it is not the version check closed above — do not read the two as one open topic.

---

## 8. Testing

**Structure the shell so most of it is testable.** The launch logic that matters is pure — readiness polling, classifying a busy port as ours vs foreign, log-path resolution, the update-prompt decision, downgrade handling. These live in modules with no Electron import, unit-tested under the existing vitest.

- Requires extending `vitest.config.ts` `include` to reach `desktop/**`. Coverage `include` stays `src/**`, so no floor moves.

**Packaged-app smoke via Playwright's Electron support** (`_electron.launch()`), inside the same manual job that builds the installer, so the artifact never leaves the job.

⚠️ **The obvious smoke test is vacuous.** "Window opens, title matches" passes against an app serving the missing-`.next/static` failure — booted, functional, entirely unstyled. The smoke therefore asserts:

1. A known element is present **and** carries a computed style that only exists if the Tailwind bundle loaded. This is the assertion that targets the known failure.
2. The rendered `data-app-version` matches the version that was built — the guard `e2e/a11y.spec.ts` already runs against the served app (open-followups §58), extended to the packaged one.

**One security assertion, automated rather than eyeballed:** the server answers on `127.0.0.1` and **refuses** on the machine's LAN address. This is the loopback-bind rule, and it is the kind of thing that silently regresses when someone widens a bind to fix a networking problem.

**Genuinely manual, listed as such:** the SmartScreen prompt flow on a clean machine, the update prompt end-to-end from the share, a downgrade, and orphaned-server recovery. Each needs a real Windows box and a real share; each is where this design would actually fail a colleague.

---

## 9. Open questions

Both are spike-then-decide. Neither blocks the rest of the design, and neither should be answered by assumption.

1. **Does `electron-updater`'s generic provider work against a UNC / `file://` share?** It is built HTTP-first. If UNC is unsupported or flaky, the fallback is an internal HTTPS location — GitLab's generic package registry is a candidate (custom auth header is supported). Must be resolved before the update path is committed to.
2. **Does SmartScreen prompt on updater-installed packages?** An unsigned installer fetched by a *browser* carries Mark-of-the-Web and prompts; one fetched by the app may not. If it does prompt, every update needs a click from a non-technical user, which materially changes how good this feels — and would strengthen the case for the self-signed hedge.

---

## 10. Rejected and deliberately not built

- **Static export + a thin native shell** — impossible; see Section 2.
- **`npm install` / `next build` on the user's laptop** (the original framing) — minutes per launch, needs a toolchain, and any transient registry failure becomes a support call. Build once in CI, ship the result.
- **`npm audit` on the user's machine** — it can only report there, and acting on it would mutate the very tree that was validated. Pin at build time, audit in the pipeline, ship a new bundle.
- **Tray icon / background residency** — closing the window quits. A running app with no window is the confusion this project removes.
- **Bundling a second Node runtime** — Electron's own Node is reused via `ELECTRON_RUN_AS_NODE`.
