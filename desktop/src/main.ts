import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { APP_ORIGIN, APP_PORT, RELEASES_URL } from "./lib/constants";
import { classifyPortOwner, type PortProbe } from "./lib/port-owner";
import { shouldReportServerExit } from "./lib/exit-reporting";
import {
  FILE_MENU_ITEMS,
  type FileMenuItemId,
  HELP_MENU_ITEMS,
  type HelpMenuItemId,
  fileAction,
  helpAction,
  helpHashScript,
  isPrintCancellation,
  versionDialogAction,
  versionDialogOptions,
} from "./lib/menu-model";
import { resolveLogDir } from "./lib/log-paths";
import { waitForReady } from "./lib/readiness";
import { killServer, spawnServer } from "./server-child";

let serverChild: ChildProcess | null = null;
let win: BrowserWindow | null = null;
// Set the moment WE decide to stop. killServer goes through `taskkill /F` on
// Windows, so a deliberate shutdown exits the child with code 1 -- exactly
// what a crash looks like. Without this flag every normal close ended with an
// error dialog claiming the background service had stopped unexpectedly.
let quitting = false;

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
        // Same window-liveness idiom shouldReportServerExit already uses.
        if (!win || win.isDestroyed()) {
          log("print: no window to print");
          return;
        }
        try {
          // ★ `{}` rather than omitting options: the callback is the SECOND
          // parameter, so there is no way to pass it without one. Empty means
          // Chromium's own defaults, which is what we want -- the point is to
          // show the user their normal print dialog, not to preconfigure it.
          win.webContents.print({}, (success: boolean, failureReason: string) => {
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

// ★★ THE ONLY shell.openExternal CALL SITE. Two routes reach it -- the Help
// menu's "Check for updates…" item and the Version dialog's second button --
// and they share this function rather than a copy each, so the URL, the
// error handling and the log line cannot drift between them.
//
// ★ Hand the page to the user's OWN browser, where they are already signed in
// to an `internal` GitLab. There is no updater and no feed to poll -- see
// RELEASES_URL for why the app must not hold a credential of its own.
function openReleasesPage(): void {
  void shell.openExternal(RELEASES_URL).catch((e: unknown) => {
    log(`open releases page: ${String(e)}`);
  });
}

// HOW each Help menu action is carried out. WHICH action an id means is
// decided by the pure `helpAction` in menu-model.ts, where it is
// unit-testable and covered by the blocking root typecheck; this file owns
// only the Electron calls.
//
// ★★★ EXHAUSTIVE BY ACTION, never a two-way ternary. This was `item.id ===
// "help" ? openHelp : showVersion`, which silently treated EVERY other id as
// the Version dialog -- so adding a third entry gave it the wrong handler
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
function helpMenuClick(id: HelpMenuItemId, label: string): () => void {
  const action = helpAction(id);
  switch (action) {
    case "open-help":
      return () => {
        // Set the fragment on the page that is already loaded rather than
        // navigating: a reload would discard unsaved work.
        void win?.webContents.executeJavaScript(helpHashScript()).catch((e: unknown) => {
          log(`help menu: ${String(e)}`);
        });
      };
    case "show-version":
      return () => {
        // ★★★ EVERY OPTION COMES FROM menu-model.ts, none is spelled here.
        // Buttons, defaultId, cancelId and noLink are load-bearing (Enter and
        // Escape must not open a browser), and this file is the one desktop
        // file the blocking typecheck skips and no unit test can import -- so
        // an option written here would be pinned by nothing. Only the `.then`
        // below is eye-verified.
        void dialog
          .showMessageBox(
            versionDialogOptions({
              title: label,
              version: app.getVersion(),
              logPath: join(logDir, "launch.log"),
              releasesUrl: RELEASES_URL,
            }),
          )
          .then(({ response }) => {
            // The dialog answers with an INDEX; menu-model.ts owns what each
            // index means, so this file never compares a raw number.
            if (versionDialogAction(response) === "open-releases") openReleasesPage();
          })
          .catch((e: unknown) => {
            log(`version dialog: ${String(e)}`);
          });
      };
    case "open-releases":
      return openReleasesPage;
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
    click: helpMenuClick(item.id, item.label),
  }));

  // ★★★ File is now hand-built rather than `{ role: "fileMenu" }`, and
  // `{ role: "quit" }` is what keeps a Windows user whole. MEASURED, not
  // recalled: the role expands to `label:"File",submenu:[isMac ?
  // {role:"close"} : {role:"quit"}]` -- read out of the installed binary with
  //   grep -aoh 'label:"File".\{0,180\}' \
  //     desktop/node_modules/electron/dist/electron.exe
  // So on Windows it was exactly ONE item, Quit, and NOT Close. Substituting
  // Close here would have quietly relabelled it.
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
}

// One instance. A second launch focuses the window that already exists.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
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
