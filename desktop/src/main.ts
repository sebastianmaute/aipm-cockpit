import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { APP_ORIGIN, APP_PORT } from "./lib/constants";
import { classifyPortOwner, type PortProbe } from "./lib/port-owner";
import { shouldReportServerExit } from "./lib/exit-reporting";
import { HELP_MENU_ITEMS, formatVersionDetail, helpHashScript } from "./lib/menu-model";
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
  const help: MenuItemConstructorOptions[] = HELP_MENU_ITEMS.map((item) =>
    item.id === "help"
      ? {
          label: item.label,
          click: () => {
            // Set the fragment on the page that is already loaded rather than
            // navigating: a reload would discard unsaved work.
            void win?.webContents.executeJavaScript(helpHashScript()).catch((e: unknown) => {
              log(`help menu: ${String(e)}`);
            });
          },
        }
      : {
          label: item.label,
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: item.label,
              message: formatVersionDetail(app.getVersion(), join(logDir, "launch.log")),
              buttons: ["OK"],
            });
          },
        },
  );

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "fileMenu" },
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

  app.whenReady().then(start);

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
