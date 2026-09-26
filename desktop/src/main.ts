import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type UtilityProcess,
  type WebContents,
  type WebFrameMain,
} from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ORIGIN, APP_PORT } from "./lib/constants";
import { classifyPortOwner, type PortProbe } from "./lib/port-owner";
import { shouldReportServerExit } from "./lib/exit-reporting";
import {
  decideNavigation,
  decideWindowOpen,
  isAppOpenerFrame,
  isAppPage,
  originOnly,
  type LatchedOpenerFrame,
  type NavigationContext,
} from "./lib/window-open-policy";
import {
  isDocumentReadyState,
  isPdfExportFrame,
  pdfFilenameFromTitle,
  pdfMetadataTitleFromFilename,
  PDF_EXPORT_READY_POLL_INTERVAL_MS,
  PDF_EXPORT_TIMEOUT_MS,
} from "./lib/pdf-export";
import {
  DASHBOARD_VIEW_HASH,
  FILE_MENU_ITEMS,
  type FileMenuItemId,
  HELP_MENU_ITEMS,
  type HelpMenuItemId,
  fileAction,
  helpAction,
  helpHashScript,
  versionRequestScript,
} from "./lib/menu-model";
import { resolveLogDir } from "./lib/log-paths";
import { isPrintCancellation, pickPrintTarget } from "./lib/print-target";
import { STARTUP_CHECK_DELAY_MS } from "./lib/update-policy";
import { liveWindow } from "./lib/window-liveness";
import { waitForReady } from "./lib/readiness";
import { killServer, spawnServer } from "./server-child";
import { createUpdater, type Updater } from "./updater";

let serverChild: UtilityProcess | null = null;
let win: BrowserWindow | null = null;
let updater: Updater | null = null;
// Set the moment WE decide to stop. killServer goes through `taskkill /F` on
// Windows, so a deliberate shutdown exits the child with code 1 -- exactly
// what a crash looks like. Without this flag every normal close ended with an
// error dialog claiming the background service had stopped unexpectedly.
let quitting = false;

// ★ PER-WEBCONTENTS AUTH-FLOW STATE, keyed by the WebContents object itself
// (never by `.id`: ids are only unique among LIVE WebContents and Electron
// reuses them, so a numeric key could read a closed popup's flow state as a
// brand-new one's). A `WeakMap` rather than a `Map` on purpose: a popup
// closes and its WebContents is garbage-collected without this file ever
// being told to delete an entry -- the window-close/webContents-destroyed
// events exist, but nothing here needs them if the map cannot leak. Read via
// `authFlowFor` below, which is also where "no entry yet" becomes `false`.
const authFlowState = new WeakMap<WebContents, boolean>();
function authFlowFor(contents: WebContents): boolean {
  return authFlowState.get(contents) === true;
}

// ★★★ N-I1 FIX (review-3-fix1-report.md). Facts latched ONCE per child
// webContents, at the moment `did-create-window` fires on the OPENER --
// "emitted _after_ successful creation of a window via window.open"
// (electron.d.ts, the doc comment on `did-create-window`) -- never re-read
// from a live Electron property afterward on every navigation event, which
// is exactly what M-A flagged in round 1's `isChildWindow: contents.opener
// !== null` (a live read COOP on an identity host's response can sever
// mid-flow).
//
// ★ Keyed by `.id`, per the brief -- unlike `authFlowState` above, which is
// keyed by the WebContents object itself. Both are safe against id reuse
// (this Map deletes its entry on `destroyed`, so a reused id never finds a
// stale fact), but the object key would work here too; the id key is what
// M-A asked for and makes the lifecycle (`delete` on `destroyed`) explicit
// rather than relying on GC.
interface WindowFacts {
  // Was this window's FIRST committed/initial URL `about:blank` or empty --
  // the shape `window.open("about:blank", ...)` and MSAL's own popup
  // creation take? `details.url` here is the SAME resolved URL
  // `setWindowOpenHandler` already decided on (HandlerDetails.url), so this
  // can only be true for a window this app's own policy already allowed.
  createdAsBlankPopup: boolean;
  // ★★★ m3 FIX (review-3-fix2-report.md). PLAIN VALUES latched once --
  // `processId`+`frameToken`, never a `WebFrameMain` OBJECT captured by
  // reference (round 2's approach). electron.d.ts documents no object-
  // identity guarantee across separate reads of the same frame; it does
  // document that `processId`/`frameToken` identify a frame. See
  // `isAppOpenerFrame` in window-open-policy.ts for the comparison and its
  // doc-line citations. `null` only for a webContents this map never saw
  // created (the main window, or if `did-create-window` itself never fired
  // for some reason).
  openerFrame: LatchedOpenerFrame | null;
}
const windowFacts = new Map<number, WindowFacts>();
function factsFor(contents: WebContents): WindowFacts {
  return windowFacts.get(contents.id) ?? { createdAsBlankPopup: false, openerFrame: null };
}

// ★★★ M-C FIX. The auth-flow flag now commits on `did-navigate` (a main-
// frame navigation completing), never inside `will-navigate`/`will-redirect`
// themselves -- round 1 wrote `authFlowState` the moment a will-* decision
// ALLOWED a hop, before Chromium had actually committed it. A later
// `will-redirect` denial, or the navigation simply failing (offline, DNS),
// left the flag on `true` with the page still showing whatever it showed
// before, which widens exactly the window N-I1 closes. `pendingAuthFlow`
// holds the NEXT value for an in-flight, not-yet-committed navigation;
// `did-navigate` commits it, `did-fail-load` (main frame) discards it
// without touching the confirmed `authFlowState`.
const pendingAuthFlow = new WeakMap<WebContents, boolean>();

// ★★★ m2/n2 FIX (review-3-fix2-report.md), called from BOTH `did-fail-load`
// and `did-fail-provisional-load` (m2: a CANCELLED navigation -- e.g. a
// later navigation superseding it, or `preventDefault()` from a will-*
// denial -- fires `did-fail-provisional-load`, NOT `did-fail-load`;
// electron.d.ts's doc on the former: "This event is like `did-fail-load`
// but emitted when the load was cancelled (e.g. `window.stop()` was
// invoked)." Without also discarding here, a `pendingAuthFlow` staged by an
// entry hop that was then denied/redirected-away-from could survive
// indefinitely, uncommitted, until some LATER unrelated navigation's
// `did-navigate` wrongly committed it).
//
// n2: a failed ATTEMPT to return to `APP_ORIGIN` (the local server briefly
// unreachable, offline, etc.) still ends the flow -- the flow's purpose is
// over the moment the popup tries to come home, whether or not that
// specific attempt lands; retrying only re-attempts the same return, and
// there is no benefit to leaving `authFlowState` on `true` against
// whatever error page Chromium shows instead. This COMMITS `false`
// directly (not via `pendingAuthFlow`, which is simply discarded) because
// there is nothing further to wait for.
function discardStagedAuthFlow(contents: WebContents, validatedURL: string): void {
  pendingAuthFlow.delete(contents);
  try {
    if (new URL(validatedURL).origin === APP_ORIGIN) {
      authFlowState.set(contents, false);
    }
  } catch {
    // Empty or unparsable: not a return to the app, nothing to end.
  }
}

const logDir = resolveLogDir(process.env);
function log(line: string): void {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "launch.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // Logging must never take the app down.
  }
}

async function probePort(): Promise<PortProbe> {
  try {
    const res = await fetch(APP_ORIGIN, { redirect: "manual" });
    return { reachable: true, status: res.status, body: await res.text() };
  } catch {
    return { reachable: false };
  }
}

function fail(title: string, message: string): void {
  log(`FAIL ${title}: ${message}`);
  dialog.showErrorBox(title, `${message}\n\nDetails: ${join(logDir, "launch.log")}`);
  app.quit();
}

// HOW each File menu action is carried out. Same split as helpMenuClick
// below: `fileAction` in menu-model.ts decides WHAT, this decides HOW.
//
// ★★★ THIS IS THE ONLY WORKING PRINT ROUTE IN THE PACKAGED APP. A
// renderer-initiated window.print() is refused by Electron (see the note on
// FILE_MENU_ITEMS), so the main process has to do it.
//
// ★★ IT MUST NOT THROW, for the same reason helpMenuClick must not -- and
// here the risk is real rather than theoretical, because printing on a
// destroyed webContents throws SYNCHRONOUSLY inside a click handler. A menu
// click is NOT covered by the startup .catch at the bottom of this file (that
// catches rejections from start() only), and no unhandledRejection handler
// exists, so this is one of the few places where a local try/catch is the
// whole safety net.
function fileMenuClick(id: FileMenuItemId): () => void {
  const action = fileAction(id);
  switch (action) {
    case "print-window":
      return () => {
        // ★★★ THE FOCUSED WINDOW, NOT `win`. This shipped printing `win`
        // unconditionally, which is wrong the moment a SECOND window exists --
        // and the app makes real ones: `openPopoutWindow`
        // (src/app/broadcast-sync.ts) does a `window.open` to a same-origin
        // URL, which this shell's OWN `setWindowOpenHandler` (installed on
        // every WebContents via `web-contents-created`, below) allows through
        // as a genuine BrowserWindow -- Electron's default window-open
        // handling no longer runs at all, this shell's policy decides every
        // case. Its callers, matched as CALLS rather than by name (a
        // bare-name grep here listed `document-editor.tsx`, whose only
        // occurrence is a COMMENT):
        //   grep -rn "openPopoutWindow(" src --include=*.tsx \
        //     | grep -v "\.test\." | grep -vE "^\S+: *(//|\*)"
        // -- today shell-chrome, task-manager and workspace-section-chrome.
        //
        // ★★ THE MECHANISM IS REASONED, NOT MEASURED, and an earlier version of
        // this comment stated it as fact while labelling the weaker inference
        // below: `Menu.setApplicationMenu` installs one menu for the whole app,
        // so CmdOrCtrl+P is expected to be live in every window and therefore
        // to have printed the MAIN view from a popout. The code supports it; no
        // run has shown it. Same standing as the consequence -- src/app/
        // export.ts offers the export tab's Ctrl+P as the user's fallback when
        // auto-print does not fire, which on that reading printed a different
        // document entirely.
        //
        // ★★ WHEN NOTHING IS FOCUSED, pickPrintTarget falls back to the main
        // window. That path should be unreachable from the accelerator: an
        // application-menu accelerator needs one of our own windows focused,
        // and nothing registers a global shortcut -- verify with
        //   grep -rn "globalShortcut" desktop/src
        // ★★ WHICH RETURNS NOTHING outside this comment naming it. Read an
        // empty result as impossible, not as failure: naming a symbol in the
        // command that looks for it makes the comment match itself. The first
        // version of this line claimed the command "returns nothing", which
        // was false the moment it was written -- the same trap this commit
        // fixes in task-manager-ui.tsx, applied there and missed here.
        // ★ `setWindowOpenHandler` used to be part of this same grep, back
        // when this shell installed none -- it now has real hits (below, via
        // `web-contents-created`), which would have made that combined grep
        // misleading rather than confirming. Dropped from the command for
        // that reason, not because the reasoning about global shortcuts
        // changed. So with the app backgrounded the OS routes Ctrl+P
        // elsewhere. Reasoned, not measured, like the mechanism above. It is
        // still a DECISION: if some path does reach the item unfocused,
        // printing the main view serves the user better than silence.
        //
        // ★ The choice itself is pure and TESTED in lib/print-target.ts --
        // including that a destroyed focused window prints nothing rather than
        // falling back. Only the two Electron lookups below are eye-verified.
        const target = pickPrintTarget(BrowserWindow.getFocusedWindow(), win);
        if (target === null) {
          log("print: no window to print");
          return;
        }
        try {
          // ★ `{}` rather than omitting options: the callback is the SECOND
          // parameter, so there is no way to pass it without one. Empty means
          // Chromium's own defaults, which is what we want -- the point is to
          // show the user their normal print dialog, not to preconfigure it.
          target.webContents.print({}, (success: boolean, failureReason: string) => {
            if (success) return;
            // ★★ A CANCELLED DIALOG LANDS HERE TOO, and it is not a failure.
            // Logging it would put a scary line in launch.log every time
            // somebody changed their mind.
            if (isPrintCancellation(failureReason)) return;
            log(`print failed: ${failureReason}`);
          });
        } catch (e: unknown) {
          log(`print: ${String(e)}`);
        }
      };
    default: {
      // Log and degrade, never throw -- see helpMenuClick's default.
      const unhandled: never = action;
      log(`file menu: no handler for action ${String(unhandled)} (id ${id})`);
      return () => {
        log(`file menu: clicked ${id}, which has no handler`);
      };
    }
  }
}

// Runs `script` (a versionRequestScript() build) in `target` and reports
// whether a listener handled it. NEVER throws or rejects -- a destroyed-
// window race, a script error, and "nothing was listening" all fold into
// `false`, logged where that is new information (an unexpected throw) and
// silent where it is not (the caller already knows what an unhandled `false`
// means and decides what to do about it -- see the show-version case, which
// retries once).
//
// ★★★ THIS IS THE FIX FOR THE SILENT NO-OP. `pickPrintTarget` targets
// whichever window is FOCUSED, which is correct for File → Print (the user
// wants to print what they are looking at) but not for Version: a focused
// window that is not a TaskManager page at all -- the PDF/export popup, or
// (M-2, final-review-report.md: an "external-link window" no longer exists
// at HEAD; the one remaining case is the MSAL sign-in popup, see I-1 below
// at the show-version case) -- has no listener, and before this fix the
// event was dispatched into the void with nothing logged and nothing shown.
// `versionRequestScript`'s return value (`!window.dispatchEvent(ev)`) makes
// that observable from here. `requestVersionPanel` itself never checks
// WHICH page `target` is showing -- that is the caller's job (I-1), because
// this function's only job is to run the given script and report the
// result.
function requestVersionPanel(target: BrowserWindow, script: string): Promise<boolean> {
  try {
    return target.webContents.executeJavaScript(script).then(
      (handled: unknown) => handled === true,
      (e: unknown) => {
        log(`version menu: ${String(e)}`);
        return false;
      },
    );
  } catch (e: unknown) {
    log(`version menu: ${String(e)}`);
    return Promise.resolve(false);
  }
}

// HOW each Help menu action is carried out. WHICH action an id means is
// decided by the pure `helpAction` in menu-model.ts, where it is
// unit-testable and covered by the blocking root typecheck; this file owns
// only the Electron calls.
//
// ★★★ EXHAUSTIVE BY ACTION, never a two-way ternary. This was `item.id ===
// "help" ? openHelp : showVersion`, which silently treated EVERY other id as
// the Version handler -- so adding a third entry gave it the wrong handler
// with nothing red anywhere.
//
// ★★★ AND IT MUST NOT THROW. This function runs EAGERLY inside buildMenu()'s
// `.map`, which start() awaits -- so a throw during menu construction rejects
// start() and takes the WHOLE APP down: fail() shows "did not start" and
// quits. The user gets no app at all, where the default branch below costs
// them one inert menu item. That trade is what decides this.
//
// ★★ PREMISE UPDATED, conclusion unchanged. This used to say the throw meant
// "no window, no fail() dialog and nothing in launch.log", which was true
// while `app.whenReady().then(start)` had no `.catch`. It has one now (see
// the startup block at the bottom of this file), so such a throw is VISIBLE
// -- logged, with a dialog. It still leaves the user with no app, which is
// why the default branch still logs and returns a no-op rather than throwing.
function helpMenuClick(id: HelpMenuItemId): () => void {
  const action = helpAction(id);
  switch (action) {
    case "open-help":
      return () => {
        // ★★★ THE SAME LIVENESS DECISION THE PRINT BRANCH MAKES, and this
        // branch went without it for a release. `win?.` is NOT a guard here:
        // `win` is assigned once and never set back to null (`grep -n "win = "
        // desktop/src/main.ts` is a single line), so the optional chain is
        // always true after start() -- while the window it names can be
        // DESTROYED. Reachable: a popout is open, the user closes the main
        // window, `window-all-closed` therefore does not fire, the app lives on
        // with its application menu, and Help → Help touches a dead `win`.
        //
        // ★★ AND `.catch` CANNOT COVER IT. Touching `webContents` on a
        // destroyed window throws SYNCHRONOUSLY, so no promise is ever created
        // to reject; a menu click is not covered by the startup `.catch`
        // either. The try/catch is the whole safety net, exactly as it is in
        // the print branch below.
        const target = liveWindow(win);
        if (target === null) {
          log("help menu: no window to open help in");
          return;
        }
        try {
          // Set the fragment on the page that is already loaded rather than
          // navigating: a reload would discard unsaved work.
          void target.webContents.executeJavaScript(helpHashScript()).catch((e: unknown) => {
            log(`help menu: ${String(e)}`);
          });
        } catch (e: unknown) {
          log(`help menu: ${String(e)}`);
        }
      };
    case "show-version":
      return () => {
        // ★★★ OPENS THE APP'S OWN VERSION MODAL NOW, not a native dialog --
        // see menu-model.ts's versionRequestScript for why the script itself
        // lives there (pure, unit-tested) rather than being built inline
        // here, which is the one file the blocking typecheck skips and no
        // unit test can import.
        //
        // ★ SAME TARGET-SELECTION AS File → Print (pickPrintTarget,
        // print-target.ts): prefer the FOCUSED window when it is one of
        // ours, else `win`. A popout asking for the Version panel should get
        // its OWN copy of the modal rather than main.ts stealing focus back
        // to the main window -- `pickPrintTarget` already encodes exactly
        // that decision (`liveWindow(focused ?? main)`), so this reuses it
        // rather than re-deciding the same liveness question a third way.
        // `pickPrintTarget` itself does not, and should not, know what page
        // the window it picks is showing -- see I-1 immediately below.
        const target = pickPrintTarget(BrowserWindow.getFocusedWindow(), win);
        if (target === null) {
          log("version menu: no window to open the Version panel in");
          return;
        }
        const script = versionRequestScript(join(logDir, "launch.log"), true);
        // ★★★ I-1 FIX (final-review-report.md). NEVER `executeJavaScript`
        // into a page this shell does not own. `pickPrintTarget` can pick
        // the MSAL sign-in popup -- once the flow is under way it can be on
        // ANY https host (`decideNavigation`) -- and running app script
        // there would both execute in a third-party page and hand it the
        // absolute launch-log path (`versionRequestScript`'s argument) in a
        // dispatched event's `detail`. `isAppPage` (window-open-policy.ts)
        // is the same guard the `did-finish-load` prime uses below. When the
        // picked target is not ours, go straight to the main window instead
        // of scripting `target` at all -- not a retry-after-failure, a
        // redirect BEFORE the first attempt.
        const effectiveTarget = isAppPage(target.webContents.getURL(), APP_ORIGIN)
          ? target
          : liveWindow(win);
        if (effectiveTarget === null) {
          log("version menu: no window to open the Version panel in");
          return;
        }
        // ★★★ RETRY ONCE ON THE MAIN WINDOW when the effective target did
        // not handle it (requestVersionPanel's `false`). An app page can
        // still have no listener yet (a race with TaskManagerInner mounting
        // it); `win` always carries one once it does. If the effective
        // target already WAS `win`, or `win` itself is gone, there is
        // nowhere left to retry -- log and stop.
        void requestVersionPanel(effectiveTarget, script).then((handled) => {
          if (handled) return;
          if (effectiveTarget === win) {
            log("version menu: no listener responded");
            return;
          }
          const mainTarget = liveWindow(win);
          if (mainTarget === null) {
            log("version menu: no listener responded, and the main window is gone");
            return;
          }
          void requestVersionPanel(mainTarget, script).then((handledOnMain) => {
            if (!handledOnMain) log("version menu: no listener responded on the main window either");
          });
        });
      };
    case "check-for-updates":
      return () => updater?.check("manual");
    default: {
      // ★★★ LOG AND DEGRADE, NEVER THROW -- see the note above this function.
      // The `never` assignment is the compile-time half: a new HelpMenuAction
      // with no case here fails `tsc -p desktop/tsconfig.json` (the desktop
      // build). That job is BLOCKING only on a tag, so this runtime branch is
      // the half that has to hold on a merge request, and it costs the user
      // one inert menu item rather than an app that will not open.
      const unhandled: never = action;
      log(`help menu: no handler for action ${String(unhandled)} (id ${id})`);
      return () => {
        log(`help menu: clicked ${id}, which has no handler`);
      };
    }
  }
}

// Populate the Help menu, which Electron's default menu leaves empty here.
//
// ★ The other submenus stay ROLE-BASED (Electron's own File/Edit/View/Window),
// so this adds the missing menu without taking ownership of behaviour nobody
// asked us to change. View keeps reload and devtools deliberately: they are
// what makes a remote "it looks wrong" report diagnosable on a laptop we
// cannot reach.
//
// ★★ Labels are English-only. The app itself is EN/DE, but the language lives
// in renderer settings and the main process has no reader for it -- adding one
// would mean an IPC channel and a preload, which is the Node surface this
// shell deliberately does not expose. Recorded as a known limitation, not an
// oversight.
function buildMenu(): void {
  const help: MenuItemConstructorOptions[] = HELP_MENU_ITEMS.map((item) => ({
    label: item.label,
    click: helpMenuClick(item.id),
  }));

  // ★★★ File is now hand-built rather than `{ role: "fileMenu" }`, and
  // `{ role: "quit" }` is what keeps a Windows user whole. MEASURED, not
  // recalled --
  //   grep -aoh 'label:"File".\{0,60\}' \
  //     desktop/node_modules/electron/dist/electron.exe
  // prints, verbatim and minified:
  //   label:"File",submenu:[n?{role:"close"}:{role:"quit"}]},editmenu:{label:"
  // ★ `n` is the INFERENCE, not the output: the `editmenu` immediately after
  // it gates the mac-only paste roles on the same `n`, so `n` is isMac. On
  // Windows the File menu was therefore exactly ONE item, Quit, and NOT
  // Close -- substituting Close here would have quietly relabelled it.
  //
  // ★ Quit unconditionally, no isMac branch: this shell is packaged for
  // Windows only (electron-builder runs `--win`, and killServer already
  // hardcodes taskkill), so a darwin branch would be untested speculation
  // about a platform we do not ship.
  const file: MenuItemConstructorOptions[] = [
    ...FILE_MENU_ITEMS.map((item) => ({
      label: item.label,
      accelerator: item.accelerator,
      click: fileMenuClick(item.id),
    })),
    { type: "separator" },
    { role: "quit" },
  ];

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "File", submenu: file },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      { label: "Help", submenu: help },
    ]),
  );
}

async function start(): Promise<void> {
  updater = await createUpdater({ log, window: () => (win && !win.isDestroyed() ? win : null) });
  buildMenu();
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    // The splash artwork's own ground (public/splash-aipm-cockpit.svg paints
    // #003459 across its full viewBox, and desktop/splash.html matches it).
    // Without this, Electron's default white shows for the frame or two before
    // the splash paints, which reads as a broken window on every launch.
    backgroundColor: "#003459",
    webPreferences: {
      // The renderer loads an HTTP origin: remote content, trusted no more
      // than a browser tab would be.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(join(__dirname, "..", "splash.html"));

  const owner = classifyPortOwner(await probePort());

  if (owner === "foreign") {
    // ★★★ NEVER rebind to a free port. The port is half the origin, so a
    // different port is a different IndexedDB store — the user's workspace
    // would silently vanish. Fail loudly instead.
    fail(
      "Port in use",
      `Another program is already using port ${APP_PORT} on this computer. ` +
        `AI PM Cockpit cannot start until that program is closed. ` +
        `It will not use a different port, because its saved data belongs to this one.`,
    );
    return;
  }

  if (owner === "free") {
    serverChild = spawnServer(process.resourcesPath);
    // Both streams are piped, so both are drained: an unread pipe fills and
    // stalls the server on its next write.
    serverChild.stdout?.on("data", (d: Buffer) => log(`server: ${d.toString().trimEnd()}`));
    serverChild.stderr?.on("data", (d: Buffer) => log(`server: ${d.toString().trimEnd()}`));
    serverChild.on("exit", (code) => {
      log(`server exited with code ${code}`);
      if (shouldReportServerExit({ quitting, windowAlive: !!win && !win.isDestroyed() })) {
        dialog.showErrorBox(
          "AI PM Cockpit stopped",
          `The application's background service stopped unexpectedly (code ${code}). ` +
            `Please close and reopen AI PM Cockpit.\n\nDetails: ${join(logDir, "launch.log")}`,
        );
      }
    });

    const ready = await waitForReady({
      probe: async () => (await probePort()).reachable,
      timeoutMs: 60000,
      intervalMs: 250,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });

    if (!ready.ready) {
      fail(
        "AI PM Cockpit did not start",
        "The application's background service did not finish starting in time.",
      );
      return;
    }
  }

  await win.loadURL(APP_ORIGIN);
  setTimeout(() => updater?.check("startup"), STARTUP_CHECK_DELAY_MS);
}

// One instance. A second launch focuses the window that already exists.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // ★★★ `if (win)` WAS NOT A GUARD, and keeping it would have made the
    // try/catch below dead code on the very state it exists for. `win` is
    // assigned once and never set back to null (see window-liveness.ts), so
    // the truthiness check only covers the moments before start() runs -- and
    // `isMinimized()`/`focus()` throw SYNCHRONOUSLY on a DESTROYED window just
    // as `webContents` does, so the throw would leave this handler before
    // reaching the navigation at all. Reachable: a popout is open, the user
    // closes the main window, `window-all-closed` therefore does not fire, and
    // the app lives on to receive a relaunch. One liveness idiom for the shell.
    const target = liveWindow(win);
    if (target === null) {
      log("second-instance: no window to focus");
      return;
    }
    if (target.isMinimized()) target.restore();
    target.focus();
    // A relaunch should land on the Dashboard. Set the fragment on the page
    // that is already loaded rather than navigating: a reload would discard
    // unsaved work (same reasoning as the Help menu item).
    try {
      void target.webContents
        .executeJavaScript(helpHashScript(DASHBOARD_VIEW_HASH))
        .catch((e: unknown) => {
          log(`second-instance: ${String(e)}`);
        });
    } catch (e: unknown) {
      log(`second-instance: ${String(e)}`);
    }
  });

  // ★★★ PRIMES EVERY WINDOW'S REMEMBERED LOG PATH, main AND every popout
  // alike, the moment its page finishes loading -- so the log-path row in
  // the Version panel is never missing just because Help → Version happened
  // to be clicked before the menu route ever fired for that window.
  //
  // ★ `web-contents-created` FIRES FOR EVERY WebContents THE APP EVER
  // CREATES, not just `win`. Popouts are never built by THIS file -- the
  // renderer's `window.open()` (src/app/broadcast-sync.ts openPopoutWindow)
  // is turned into a real BrowserWindow, now via the `setWindowOpenHandler`
  // installed below (formerly Electron's own DEFAULT window-open handling,
  // before this shell overrode it), so main.ts holds no reference to a
  // popout's BrowserWindow to attach a per-window listener to. Registering
  // globally on `app` is the only way to reach one. It also covers `win`
  // itself for free (its creation in start() fires this same event), so
  // there is no separate "prime the main window" call anywhere else.
  //
  // ★ `web-contents-created` (a WebContents), not `browser-window-created`
  // (a BrowserWindow whose `.webContents` you would then read) -- the two
  // fire at the same moments for a window-backed WebContents, but this one
  // hands over exactly the object `did-finish-load` lives on, with nothing
  // to unwrap.
  //
  // ★ Scoped to the app's OWN origin (`isAppPage`, window-open-policy.ts) so
  // this never touches the PDF/export popup or (M-2, final-review-report.md:
  // an "external-link window" no longer exists at HEAD -- the Releases link,
  // GitHub and LinkedIn all now leave via `shell.openExternal` and never
  // render in-app at all) the MSAL sign-in popup, which DOES have listeners
  // of its own once it lands on a Microsoft page. The PDF/export popup has
  // no listener for the dispatched event either way (dispatchEvent on an
  // unlistened window is a harmless no-op) and `isAppPage` denying it is
  // belt-and-braces there; for the sign-in popup, refusing to script it at
  // all is the whole point (I-1) -- there is nothing to prime in a page we
  // do not own, and on that page "no listener" is not the only concern.
  //
  // ★★★ ALSO WHERE THE WINDOW-OPEN POLICY AND THE TOP-LEVEL NAVIGATION GUARD
  // ARE WIRED, one listener rather than a second `app.on("web-contents-
  // created", ...)` registration: it needs the exact same "every WebContents,
  // including popouts, reached only via `app`" reasoning immediately above,
  // and a second registration would either restate that comment or silently
  // rely on a reader having read this one. `decideWindowOpen` (lib/window-
  // open-policy.ts) is the pure decision; this is only the Electron wiring.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("did-finish-load", () => {
      // ★★ TOUCHING `webContents` ON A DESTROYED WINDOW THROWS SYNCHRONOUSLY
      // -- the same rule `helpMenuClick`/`fileMenuClick`/`requestVersionPanel`
      // guard with a try/catch. This listener's `contents` cannot itself be
      // the destroyed one (an event a WebContents fires on itself implies it
      // is still alive to fire it), but `getURL()` is Chromium-backed, and a
      // synchronous throw inside a `did-finish-load` handler has nowhere else
      // to land: it is not a rejected promise (no `.catch` reaches it) and
      // this file installs no `uncaughtException` handler, so an uncaught one
      // here has the same blast radius as it would from a menu click.
      //
      // ★★★ M-6 FIX (final-review-report.md). This used to be
      // `new URL(contents.getURL()).origin !== APP_ORIGIN` inline, which
      // THROWS on an unparsable URL rather than denying -- and
      // `contents.getURL()` on the PDF/export tab (`window.open("",
      // "_blank")`) can plausibly BE unparsable (`""`) before that tab's own
      // navigation lands. That made this catch block fire, and log a
      // `version prime: TypeError: Invalid URL` line, on every PDF/document
      // export -- reasoned, not measured (M-6 was never watched against a
      // real export). `isAppPage` folds the unparsable case into a plain
      // `false` instead, so this returns silently there, same as it always
      // has for the app's own origin mismatches.
      try {
        if (!isAppPage(contents.getURL(), APP_ORIGIN)) return;
        void contents
          .executeJavaScript(versionRequestScript(join(logDir, "launch.log"), false))
          .catch((e: unknown) => {
            log(`version prime: ${String(e)}`);
          });
      } catch (e: unknown) {
        log(`version prime: ${String(e)}`);
      }
    });

    // ★★★ THE ONLY setWindowOpenHandler IN THE SHELL, and it now runs for
    // EVERY WebContents (see the block comment above) -- a popout created
    // without one would otherwise fall through to Electron's own default,
    // which is exactly the unrestricted behaviour this commit removes.
    // `{ action: "allow" }` with no `overrideBrowserWindowOptions`
    // deliberately preserves today's popout window shape: per
    // `DidCreateWindowDetails.options` in electron.d.ts, the created
    // window's options are "parsed options from the `features` string from
    // `window.open()`[, then] security-related webPreferences inherited
    // from the parent, and options given by `webContents.
    // setWindowOpenHandler`" -- so `openPopoutWindow`'s own
    // `"popup=yes,width=1200,height=800"` features string and this app's
    // sandboxed/contextIsolated webPreferences both still apply without
    // this handler repeating either.
    //
    // ★ NO AUTH-FLOW AWARENESS NEEDED HERE, deliberately -- see
    // `decideNavigation`'s doc comment in window-open-policy.ts for the
    // measured reason (`use-ms-auth.ts` never sets `navigatePopups: false`,
    // so MSAL never calls `window.open` with a non-blank URL for this app).
    // The window-OPEN decision stays exactly `decideWindowOpen`; the auth
    // fix lives entirely in the navigation guards below.
    try {
      contents.setWindowOpenHandler((details) => {
        const decision = decideWindowOpen(details.url, APP_ORIGIN);
        switch (decision) {
          case "allow-in-app":
            // ★ §468 — this branch is already `allow-in-app`, which
            // `decideWindowOpen` grants only to `about:blank`/empty or a
            // same-APP_ORIGIN URL (never to an external host — that decision
            // already routed to `open-external` above), so the `frameName`
            // check adds no new host. It only narrows WITHIN that set: a
            // window opened under the exact frame name the renderer uses for
            // PDF export starts hidden, print-target-shaped, instead of a
            // visible tab. Every other `about:blank`/app-origin open
            // (popouts, the plain HTML/document print tabs) is unaffected.
            return isPdfExportFrame(details.frameName)
              ? { action: "allow", overrideBrowserWindowOptions: { show: false } }
              : { action: "allow" };
          // ★★ ONE OF FOUR shell.openExternal CALL SITES (M-1, final-review-report.md
          // -- this comment used to say "the only" one, which stopped being true once
          // the navigation guards below could reach it too): this case, the
          // `will-navigate`/`will-redirect` `open-external` branches further down this
          // file, and the updater's "Open releases page" button on its error dialog
          // (updater.ts, shown only when a manual "Check for updates…" check fails). The
          // Help menu's "Check for updates…" item itself no longer opens a browser --
          // `helpMenuClick` routes it to `updater?.check("manual")` -- so it is not a
          // fifth site, and neither is the Version panel's own Releases link
          // (src/app/version-info.tsx), an ordinary in-page <a target="_blank"> whose
          // `open` is routed through THIS case via `decideWindowOpen`.
          case "open-external":
            void shell.openExternal(new URL(details.url).href).catch((e: unknown) => {
              log(`window-open: ${String(e)}`);
            });
            return { action: "deny" };
          case "deny":
            log(`window-open: denied ${originOnly(details.url)}`);
            return { action: "deny" };
        }
      });
    } catch (e: unknown) {
      // ★★ MUST NOT THROW, same reasoning as the did-finish-load listener
      // above -- and here a throw is worse: the SAME line would re-throw on
      // every future `web-contents-created` for the lifetime of the process,
      // not just once.
      log(`window-open handler install: ${String(e)}`);
    }

    // ★★★ N-I1 FIX: LATCHES `windowFacts` FOR EVERY CHILD THIS `contents`
    // CREATES, the moment Electron confirms creation -- "Emitted _after_
    // successful creation of a window via window.open" (electron.d.ts's
    // `did-create-window` doc). `details.url` is the SAME resolved URL
    // `setWindowOpenHandler` already allowed (`HandlerDetails.url` and
    // `DidCreateWindowDetails.url` describe the same value), so a window can
    // only be recorded `createdAsBlankPopup: true` if this shell's own
    // policy already decided to allow it in-app as `about:blank`/empty.
    //
    // ★ m3 FIX: `contents.mainFrame.processId`/`.frameToken` (THIS
    // webContents' top frame, the one that just called `window.open`) are
    // captured ONCE as PLAIN VALUES -- never the `WebFrameMain` object
    // itself (round 2's approach, which relied on an object-identity
    // guarantee electron.d.ts does not document; see `isAppOpenerFrame`'s
    // doc comment in window-open-policy.ts). Still never `childContents.
    // opener` read later, which is the live property M-A flagged as
    // COOP-fragile.
    try {
      contents.on("did-create-window", (childWindow, details) => {
        const childContents = childWindow.webContents;
        windowFacts.set(childContents.id, {
          createdAsBlankPopup: details.url === "" || details.url === "about:blank",
          openerFrame: {
            processId: contents.mainFrame.processId,
            frameToken: contents.mainFrame.frameToken,
          },
        });
        childContents.once("destroyed", () => windowFacts.delete(childContents.id));
      });
    } catch (e: unknown) {
      log(`did-create-window handler install: ${String(e)}`);
    }

    // ★ §468 -- the PDF export route. The window-open handler above already
    // rendered this child HIDDEN (`show: false`) because its frame name is
    // `PDF_EXPORT_FRAME_NAME`; this is where main actually prints it.
    //
    // ★★★ §468 review round 2 -- the renderer signals "rendered" through a
    // STATIC `<title>` element (`pdfReadyTitleMarkup`, src/app/pdf-export-
    // protocol.ts), never a script. The tab is `document.write`n into an
    // `about:blank` child, which inherits the app's production CSP (a
    // nonce-only `script-src`, src/proxy.ts); a script-based signal has no
    // nonce and is blocked outright, so this reaches main purely from
    // parsing -- `page-title-updated` fires before any script (blocked or
    // not) would even run.
    //
    // ★ The title arriving does NOT mean the page has finished rendering --
    // the title sits early in `<head>`, so it can be parsed well before the
    // rest of the document has laid out. `waitForReady` (lib/readiness.ts,
    // already pure and tested) polls `document.readyState` via
    // `executeJavaScript` -- a privileged main-process call, unaffected by
    // the page's CSP -- until `isDocumentReadyState` reports true or the
    // same `PDF_EXPORT_TIMEOUT_MS` budget runs out.
    //
    // ★ `titleHandled` stops re-entering this async body on a SECOND
    // `page-title-updated` while the first is still in flight (the title is
    // stable once set, but nothing prevents a future renderer change from
    // touching it twice). `done` is the wider latch: once anything --
    // success, cancel, error, or the outer timeout -- has concluded the
    // export, nothing else may act on this window again.
    //
    // ★ §468 review Minor B / round 2 -- `timeout` bounds how long main
    // waits for the SEQUENCE UP TO "ready to print" (ready title, then
    // readyState "complete"). A crashed renderer or a hung render would
    // otherwise leave this hidden window open forever, and because it still
    // owns the named `window.open` target, a LATER export reuses the same
    // browsing context and never fires a fresh `did-create-window` --
    // silently swallowed behind the stuck first one. Left running (not
    // cleared) while `waitForReady` polls, so it can still cut that poll
    // short.
    //
    // ★★★ §468 re-review N1 -- it is cleared the MOMENT the page is known
    // ready, BEFORE `printToPDF`/the save dialog run, not in the async
    // body's `finally` (an earlier revision of this fix cleared it only in
    // `finally` and was wrong: printToPDF and a native save dialog can both
    // legitimately run past this budget, and the old placement left the
    // timeout armed through both -- see the fix's own comment at the clear
    // site for the two ways that broke). The `finally` clear stays as a
    // defensive no-op for any path that throws before reaching that line.
    try {
      contents.on("did-create-window", (childWindow, details) => {
        if (!isPdfExportFrame(details.frameName)) return;
        let done = false;
        let titleHandled = false;
        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          log(`pdf export: timed out after ${PDF_EXPORT_TIMEOUT_MS}ms waiting for the ready signal`);
          dialog.showErrorBox(
            "PDF export failed",
            `The PDF export took too long and was cancelled.\n\nDetails: ${join(logDir, "launch.log")}`,
          );
          if (!childWindow.isDestroyed()) childWindow.close();
        }, PDF_EXPORT_TIMEOUT_MS);
        // ★ §468 final re-review M6 -- if the RENDERER closes this window
        // itself (document-download.ts's pdf branch calls `tab.close()` and
        // rethrows when preparing the document fails, before it ever writes
        // the ready `<title>`), no `page-title-updated` with the ready
        // prefix ever arrives, so neither `done` nor `timeout` is otherwise
        // touched. Without this listener the armed `timeout` fires 60s later
        // against an already-closed window and shows "took too long and was
        // cancelled" -- a second, MISLEADING error on top of the real one the
        // renderer's own caller already surfaced. `once`, not `on`: this
        // window can only close once, and every OTHER close in this handler
        // (timeout, success, cancel, error) already sets `done`/clears
        // `timeout` itself before calling `.close()`, so by the time this
        // fires here it is a harmless no-op for those paths -- it never
        // shows a dialog of its own, so it cannot double-report anything.
        childWindow.once("closed", () => {
          done = true;
          clearTimeout(timeout);
        });
        childWindow.webContents.on("page-title-updated", (_e, title) => {
          if (titleHandled || done) return;
          const filename = pdfFilenameFromTitle(title);
          if (!filename) return;
          titleHandled = true;
          void (async () => {
            try {
              const ready = await waitForReady({
                probe: async () => {
                  if (childWindow.isDestroyed()) return false;
                  const state: unknown = await childWindow.webContents.executeJavaScript("document.readyState");
                  return typeof state === "string" && isDocumentReadyState(state);
                },
                timeoutMs: PDF_EXPORT_TIMEOUT_MS,
                intervalMs: PDF_EXPORT_READY_POLL_INTERVAL_MS,
                now: () => Date.now(),
                sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              });
              // The outer `timeout` may already have fired (and closed the
              // window) while this was polling -- nothing left to do.
              if (done) return;
              if (!ready.ready) throw new Error("document did not finish rendering before the export timed out");

              // ★ §468 re-review N1 -- the page is now known ready, so the
              // "ready signal never arrived" backstop no longer applies, and
              // it must stop being ABLE to fire from here on: printToPDF and
              // the save dialog can legitimately take longer than
              // `PDF_EXPORT_TIMEOUT_MS` (a user can sit in a native file
              // picker as long as they like), and the timeout previously
              // stayed armed through both -- so a slow save showed "took too
              // long and was cancelled" and closed the window WHILE
              // `writeFileSync` was about to succeed (the file lands on disk
              // right after the user is told the export failed), or firing
              // mid-`printToPDF` made it reject into the catch below for a
              // SECOND error box on top of the timeout's own one. Clearing
              // here, before either call, is what makes the doc comment
              // above ("cleared only once printing has actually started")
              // true; the `finally` block below also clears it, defensively,
              // for any path that throws before reaching this line.
              done = true;
              clearTimeout(timeout);

              // A clean metadata title for the PDF itself, not the
              // ready-signal text -- `executeJavaScript` again runs
              // regardless of the page's CSP.
              await childWindow.webContents.executeJavaScript(
                `document.title = ${JSON.stringify(pdfMetadataTitleFromFilename(filename))};`,
              );
              const data = await childWindow.webContents.printToPDF({ printBackground: true });
              const parent = BrowserWindow.fromWebContents(contents);
              const { canceled, filePath } = parent
                ? await dialog.showSaveDialog(parent, {
                    defaultPath: filename,
                    filters: [{ name: "PDF", extensions: ["pdf"] }],
                  })
                : await dialog.showSaveDialog({
                    defaultPath: filename,
                    filters: [{ name: "PDF", extensions: ["pdf"] }],
                  });
              if (!canceled && filePath) writeFileSync(filePath, data);
            } catch (e: unknown) {
              // ★ §468 review I3 -- a printToPDF/save-dialog/writeFileSync
              // failure used to be logged only, so a user who clicked Save
              // was told nothing and believed the file existed. Cancel never
              // reaches this catch (no error is thrown for it), so Cancel
              // still shows nothing, same as before.
              log(`pdf export: ${String(e)}`);
              dialog.showErrorBox(
                "PDF export failed",
                `The PDF could not be saved.\n\nDetails: ${join(logDir, "launch.log")}`,
              );
            } finally {
              done = true;
              clearTimeout(timeout);
              if (!childWindow.isDestroyed()) childWindow.close();
            }
          })();
        });
      });
    } catch (e: unknown) {
      log(`pdf export handler install: ${String(e)}`);
    }

    // ★★★ AUTH-FLOW CONTEXT FOR THIS WEBCONTENTS, shared by `will-navigate`
    // and `will-redirect` below -- both read the SAME `windowFacts` entry,
    // because a Microsoft sign-in can enter the flow on an ordinary
    // navigation (`location.assign`, MSAL's own path -- see
    // `decideNavigation`'s doc comment) and continue it through a SERVER
    // redirect (a federated IdP forwarding back to login.microsoftonline.com,
    // or vice versa) with no navigation event of the other kind in between.
    // `inAuthFlow` is NOT read here -- each call site below passes its own
    // (see the m1 fix at `will-redirect`), so this only assembles the two
    // fields that never differ between them.
    //
    // ★ m3 FIX: `isAppOpenerFrame` (window-open-policy.ts), not an object-
    // reference comparison -- see its doc comment and `WindowFacts.
    // openerFrame` above for the citations. `details.initiator`
    // (electron.d.ts: "The frame which initiated the navigation... or null
    // if the navigation was not initiated by a frame", present on both
    // `WebContentsWillNavigateEventParams`, around electron.d.ts:24560, and
    // `WebContentsWillRedirectEventParams`, around :24590) structurally
    // satisfies `isAppOpenerFrame`'s `FrameIdentity` parameter type (a
    // `WebFrameMain` has every property that shape asks for).
    const navContextFor = (
      details: { initiator?: WebFrameMain | null },
      inAuthFlow: boolean,
    ): NavigationContext => {
      const facts = factsFor(contents);
      return {
        createdAsBlankPopup: facts.createdAsBlankPopup,
        initiatorIsAppOpener: isAppOpenerFrame(details.initiator, facts.openerFrame, APP_ORIGIN),
        inAuthFlow,
      };
    };

    // ★ GUARDS PLAIN-LINK NAVIGATION (no `target`, so no `window.open` and
    // no `setWindowOpenHandler` call) of the TOP-LEVEL frame -- the gap the
    // handler above cannot close. Confirmed in electron.d.ts:
    // `WebContentsWillNavigateEventParams` "does not fire for same document
    // navigations using window.history api and reference fragment
    // navigations", so this app's own `#hash` view routing (nav-config.ts /
    // task-manager's hash-based view switch) and Next's client-side routing
    // are both untouched -- neither is a top-level navigation in Electron's
    // sense. Also where MSAL's `location.assign(authorityUrl)` on its
    // pre-opened `about:blank` popup lands (see `decideNavigation`), which is
    // why this now carries auth-flow context rather than the plain
    // `decideWindowOpen` this commit's first cut used.
    //
    // ★ DELIBERATELY SCOPED TO `isMainFrame`: this shell renders no
    // cross-origin `<iframe>` of its own (`git grep -n iframe src/app`
    // outside comments returns nothing), and the one cross-origin subframe
    // this app ever loads -- MSAL's `acquireTokenSilent` hidden iframe
    // (`use-ms-auth.ts:266`) -- is governed by `frame-src` in `src/proxy.ts`,
    // not by top-level navigation guards. A subframe guard is out of scope
    // by that reasoning, not merely unimplemented; add one only if a
    // same-origin iframe embedding untrusted content is ever introduced.
    //
    // ★★★ M-C: `allow-in-app` no longer writes `authFlowState` directly --
    // it stashes the NEXT value in `pendingAuthFlow` and lets `did-navigate`
    // (below) commit it once Chromium confirms the navigation actually
    // landed. `deny`/`open-external` never touch `pendingAuthFlow` at all:
    // the navigation is cancelled either way, so there is nothing pending to
    // stash, and `authFlowState` is simply left as it was (its value is
    // already the committed truth from whatever DID land last).
    try {
      contents.on("will-navigate", (details) => {
        if (!details.isMainFrame) return;
        // ★ COMMITTED state only -- unlike will-redirect below (the m1
        // fix), a will-navigate always starts a NEW top-level navigation,
        // so there is no earlier `pendingAuthFlow` for THIS attempt to
        // inherit; whatever is in `pendingAuthFlow` right now belongs to
        // whatever the PREVIOUS navigation staged (already superseded).
        const ctx = navContextFor(details, authFlowFor(contents));
        const { decision, authFlow } = decideNavigation(details.url, APP_ORIGIN, ctx);
        if (decision === "allow-in-app") {
          pendingAuthFlow.set(contents, authFlow);
          return;
        }
        details.preventDefault();
        if (decision === "open-external") {
          void shell.openExternal(new URL(details.url).href).catch((e: unknown) => {
            log(`will-navigate: ${String(e)}`);
          });
        } else {
          log(`will-navigate: denied ${originOnly(details.url)}`);
        }
      });
    } catch (e: unknown) {
      log(`will-navigate handler install: ${String(e)}`);
    }

    // ★★★ SERVER REDIRECTS ARE A SEPARATE EVENT FROM `will-navigate`, and
    // before this commit nothing policed them: `will-navigate` only sees the
    // navigation's INITIAL URL, so a same-origin/allow-in-app page (or a
    // popout) that received a 30x to another origin would render that other
    // origin in-app and chromeless -- exactly what this whole file exists to
    // prevent, and exactly the shape an OAuth authorize response takes
    // (Azure AD redirects to a federated IdP, then back). Confirmed in
    // electron.d.ts: "Emitted when a server side redirect occurs during
    // navigation. ... Calling event.preventDefault() will prevent the
    // navigation (not just the redirect)." -- so `preventDefault()` here
    // cancels the WHOLE in-flight navigation, not merely this one hop, which
    // is why the `open-external`/`deny` branches below never also need to
    // stop a later `did-navigate`. No open redirect exists in this app today
    // (`grep -rn "NextResponse.redirect\|redirect(\|Response.redirect"
    // src/proxy.ts src/app/api` is empty), so this is defence in depth
    // against a future one, not a fix for a reachable bug -- and it is load-
    // bearing for I-1: MSAL's popup navigates to login.microsoftonline.com
    // and Azure AD then 30x's it to the tenant's federated IdP, a SERVER
    // redirect this event is the only guard for.
    try {
      contents.on("will-redirect", (details) => {
        if (!details.isMainFrame) return;
        // ★★★ m1 FIX. STAGED value first, falling back to committed --
        // `pendingAuthFlow.get(contents) ?? authFlowFor(contents)`. A
        // redirect belongs to the SAME in-flight navigation that a
        // preceding will-navigate may have just staged: Azure AD can answer
        // MSAL's `location.assign(authorityUrl)` with a DIRECT 30x to a
        // tenant's federated IdP (home-realm-discovery auto-acceleration),
        // arriving here before any `did-navigate` has committed anything.
        // Reading only the COMMITTED flag (round 2's behaviour) made that
        // hop `open-external` -- a regression from round 1, where the flag
        // was written at will-navigate time and so was already `true` here.
        // ★ N3-1 (review-3-fix3-report.md): scoped to a staged `true`. A
        // staged `false` is NOT limited to a `createdAsBlankPopup` +
        // opener-initiated navigation -- `decideNavigation`'s "return to the
        // app" branch stages `false` for ANY ordinary same-origin
        // `will-navigate`/`will-redirect`, main window included (it never
        // gets a `windowFacts` entry, so it always reads
        // `createdAsBlankPopup: false`). Harmless either way: a staged
        // `false` and a committed `false` are indistinguishable to this `??`
        // fallback and to every downstream decision, and a fresh `true` can
        // still only be MINTED by that one entry condition (see
        // `decideNavigation`'s own doc comment for the induction) -- this
        // fallback never invents a `true` for an ordinary page.
        const inAuthFlow = pendingAuthFlow.get(contents) ?? authFlowFor(contents);
        const ctx = navContextFor(details, inAuthFlow);
        const { decision, authFlow } = decideNavigation(details.url, APP_ORIGIN, ctx);
        if (decision === "allow-in-app") {
          pendingAuthFlow.set(contents, authFlow);
          return;
        }
        details.preventDefault();
        if (decision === "open-external") {
          void shell.openExternal(new URL(details.url).href).catch((e: unknown) => {
            log(`will-redirect: ${String(e)}`);
          });
        } else {
          log(`will-redirect: denied ${originOnly(details.url)}`);
        }
      });
    } catch (e: unknown) {
      log(`will-redirect handler install: ${String(e)}`);
    }

    // ★★★ M-C, THE COMMIT HALF. "Emitted when a main frame navigation is
    // done" (electron.d.ts's `did-navigate` doc) -- this event is inherently
    // main-frame-only (unlike will-navigate/will-redirect, it has no
    // `isMainFrame` parameter to check), and fires exactly once a navigation
    // has actually landed, whether that navigation was ever seen by
    // `will-navigate` at all (a programmatic `loadURL`, e.g. `win.loadURL(
    // APP_ORIGIN)` at startup, never fires will-navigate, but DOES fire
    // did-navigate) -- so a missing `pendingAuthFlow` entry here is the
    // ordinary case, not an error, and is silently ignored.
    try {
      contents.on("did-navigate", () => {
        const pending = pendingAuthFlow.get(contents);
        if (pending === undefined) return;
        authFlowState.set(contents, pending);
        pendingAuthFlow.delete(contents);
      });
    } catch (e: unknown) {
      log(`did-navigate handler install: ${String(e)}`);
    }

    // ★★★ M-C/n2, THE DISCARD HALF. A main-frame load that fails (offline,
    // DNS, a denied navigation that still left something in flight) never
    // reaches `did-navigate`, so without this the flag some `will-*`
    // decision staged would sit in `pendingAuthFlow` uncommitted --
    // harmless on its own (never read again until the next navigation
    // overwrites it), but a stale entry is exactly the kind of state this
    // fix removes elsewhere. `discardStagedAuthFlow` (module scope, shared
    // with `did-fail-provisional-load` below) also ends a COMMITTED flow
    // outright if the failed load's `validatedURL` origin is `APP_ORIGIN`
    // (n2). Explicit `isMainFrame` check here: unlike `did-navigate`,
    // `did-fail-load` DOES fire for subframes.
    try {
      contents.on(
        "did-fail-load",
        (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
          if (!isMainFrame) return;
          discardStagedAuthFlow(contents, validatedURL);
        },
      );
    } catch (e: unknown) {
      log(`did-fail-load handler install: ${String(e)}`);
    }

    // ★★★ m2 FIX. `did-fail-load` does NOT fire for a CANCELLED navigation
    // -- Electron emits `did-fail-provisional-load` for that instead
    // ("This event is like `did-fail-load` but emitted when the load was
    // cancelled (e.g. `window.stop()` was invoked)", electron.d.ts, the doc
    // comment immediately above the event). A `will-redirect` denial calls
    // `preventDefault()`, which cancels the navigation this way -- so
    // without this handler, an entry hop that staged `true` and then got
    // redirected somewhere this policy denies would leave `pendingAuthFlow`
    // stuck, uncommitted, for a LATER unrelated navigation's `did-navigate`
    // to wrongly commit. Same signature, same `isMainFrame` guard, same
    // shared discard/n2 logic as `did-fail-load` above.
    try {
      contents.on(
        "did-fail-provisional-load",
        (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
          if (!isMainFrame) return;
          discardStagedAuthFlow(contents, validatedURL);
        },
      );
    } catch (e: unknown) {
      log(`did-fail-provisional-load handler install: ${String(e)}`);
    }
  });

  // ★★★ THE .catch IS LOAD-BEARING. Without it, a throw anywhere in start()
  // -- menu construction, the BrowserWindow, the splash load -- was an
  // UNHANDLED REJECTION: no window, no dialog, nothing in launch.log, and an
  // app that simply never appeared. It now surfaces through the same fail()
  // dialog as every other startup failure, so the user is told and the reason
  // is on disk.
  //
  // ★★ SCOPE, so nobody reads this as more than it is: it catches rejections
  // FROM start() and nothing else. No unhandledRejection or
  // uncaughtException handler is installed, so a throw from a later async
  // path -- a menu click, the server child's exit handler -- is still
  // uncaught. Deliberately not built here.
  app
    .whenReady()
    .then(start)
    .catch((e: unknown) => {
      // ★★ THE REASON GOES IN THE LOG, NOT THE DIALOG. fail() logs only the
      // sentence it is handed, and shows that same sentence to the user, so a
      // raw error string cannot live in it. Without this line the dialog
      // would name a failure whose cause appears nowhere -- and the rollout
      // note tells users to send launch.log. fail() then does the logging of
      // the verdict, the dialog and the quit; none of that is repeated here.
      log(`start rejected: ${String(e)}`);
      fail("AI PM Cockpit did not start", "The application could not finish starting.");
    });

  // Closing the window quits: the window IS the app. No tray icon.
  app.on("window-all-closed", () => app.quit());

  // ★★★ The child MUST die with the parent. An orphan holds the pinned port,
  // so the next launch correctly refuses to start and the app appears
  // permanently broken.
  app.on("before-quit", () => {
    quitting = true;
    killServer(serverChild);
  });
  process.on("exit", () => {
    quitting = true;
    killServer(serverChild);
  });
}
