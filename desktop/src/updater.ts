// electron-updater wired to the pure policy in lib/update-policy.ts. Checks only in a packaged
// build; nothing downloads or installs without the user's click. Excluded from the root tsc
// like main.ts; typechecked by `npm run desktop:typecheck`.
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASES_URL } from "./lib/constants";
import {
  decideCheckRequest, decideOnAvailable, decideOnError, decideOnNotAvailable, parseSkipped,
  serializeSkipped, type UpdateDecision, type UpdatePhase, type UpdateTrigger,
} from "./lib/update-policy";

export interface Updater {
  check(trigger: UpdateTrigger): void;
}

type ElectronUpdaterModule = typeof import("electron-updater");

const NOT_PACKAGED_MESSAGE = "Updates are checked only in the installed app.";
const LOAD_FAILED_MESSAGE = "The updater could not be loaded.";

// Every check request the app is skipping because an operator asked it to, in one place -- e2e:desktop
// sets this so a smoke run never meets a modal update dialog (fix round 1, review R11 Minor 5). Logged
// so a real deployment with it accidentally set is diagnosable rather than silently update-less.
function checksDisabled(): boolean {
  return process.env.AIPM_DISABLE_UPDATE_CHECK === "1";
}

// A no-op Updater whose manual check reports why it cannot check, with the same releases-page
// fallback the real error dialog offers. Used both when checks are disabled and when
// electron-updater itself fails to load (fix round 1, review R11 Important 1c).
function unavailableUpdater(deps: { log(line: string): void; window(): BrowserWindow | null }, message: string): Updater {
  const box = (opts: MessageBoxOptions): Promise<number> => {
    const w = deps.window();
    return (w && !w.isDestroyed() ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)).then((r) => r.response);
  };
  return {
    check(t: UpdateTrigger): void {
      if (t !== "manual") return;
      void box({
        type: "warning", title: "AI PM Cockpit", message: "Could not check for updates.", detail: message,
        buttons: ["OK", "Open releases page"], defaultId: 0, cancelId: 0,
      }).then((r) => {
        if (r === 1) void shell.openExternal(RELEASES_URL).catch((e: unknown) => deps.log(`open releases page: ${String(e)}`));
      });
    },
  };
}

function wireUpdater(
  autoUpdater: ElectronUpdaterModule["autoUpdater"],
  deps: { log(line: string): void; window(): BrowserWindow | null },
): Updater {
  const skipFile = () => join(app.getPath("userData"), "update-skip.json");
  const readSkipped = (): string | null => {
    try {
      return parseSkipped(readFileSync(skipFile(), "utf8"));
    } catch {
      return null;
    }
  };

  // Three independent bits of "what is the updater doing right now", read by decideCheckRequest so a
  // request arriving mid-operation is never just dropped with a log line (fix round 1, review R11
  // Important 3, Minor 1):
  //  - checking:    a checkForUpdates() call is outstanding.
  //  - downloading: a downloadUpdate() call is outstanding.
  //  - prompting:   one of THIS updater's own dialogs is on screen (wrapped into `box` below, so
  //                 every dialog this file shows -- available/ready/error/up-to-date/busy/not-
  //                 packaged -- sets it, not just the "Update available" prompt Minor 1 named).
  let checking = false;
  let downloading = false;
  let prompting = false;
  let trigger: UpdateTrigger = "startup";
  // The operation an in-flight error belongs to, read by the "error" listener below. Sampled at the
  // moment each operation STARTS, so an error that arrives after downloadUpdate() was called is
  // always reported as a download failure even though the SAME `autoUpdater` object also fired the
  // checking-phase events earlier in this run's lifetime.
  let phase: UpdatePhase = "checking";

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (m: unknown) => deps.log(`updater: ${String(m)}`),
    warn: (m: unknown) => deps.log(`updater warn: ${String(m)}`),
    error: (m: unknown) => deps.log(`updater error: ${String(m)}`),
    debug: () => {},
  };

  const box = async (opts: MessageBoxOptions): Promise<number> => {
    prompting = true;
    try {
      const w = deps.window();
      const r = w && !w.isDestroyed() ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
      return r.response;
    } finally {
      prompting = false;
    }
  };

  const act = async (d: UpdateDecision): Promise<void> => {
    if (d.kind === "silent") return;
    if (d.kind === "up-to-date") {
      await box({ type: "info", title: "AI PM Cockpit", message: `You have the latest version (${app.getVersion()}).`, buttons: ["OK"] });
      return;
    }
    if (d.kind === "error") {
      // The MESSAGE line names which operation failed; a checking-phase failure and a downloading-
      // phase failure both offer the same OK / Open releases page choice.
      const message = d.phase === "downloading" ? "The update could not be downloaded." : "Could not check for updates.";
      const r = await box({ type: "warning", title: "AI PM Cockpit", message, detail: d.message, buttons: ["OK", "Open releases page"], defaultId: 0, cancelId: 0 });
      if (r === 1) void shell.openExternal(RELEASES_URL).catch((e: unknown) => deps.log(`open releases page: ${String(e)}`));
      return;
    }
    const r = await box({
      type: "info", title: "Update available", message: `AI PM Cockpit ${d.version} is available.`, detail: d.notes,
      buttons: ["Download and install", "Later", "Skip this version"], defaultId: 0, cancelId: 1,
    });
    if (r === 2) {
      try { writeFileSync(skipFile(), serializeSkipped(d.version)); } catch (e: unknown) { deps.log(`updater skip write: ${String(e)}`); }
      return;
    }
    if (r !== 0) return;
    downloading = true;
    phase = "downloading";
    autoUpdater.autoInstallOnAppQuit = true;
    // electron-updater's own downloadUpdate() ALWAYS calls dispatchError() (emitting "error") before
    // rejecting its promise on failure -- verified against the installed package
    // (AppUpdater.js's downloadUpdate(), the errorHandler passed to doDownloadUpdate().catch()), the
    // SAME shape checkForUpdates() uses below. This .catch is therefore only to keep the rejection
    // from surfacing as an unhandled promise rejection; acting on it here too would show the error
    // dialog TWICE for one failure.
    autoUpdater.downloadUpdate().catch(() => {});
  };

  autoUpdater.on("update-available", (info) => {
    checking = false;
    void act(decideOnAvailable(trigger, info, readSkipped()));
  });
  autoUpdater.on("update-not-available", () => {
    checking = false;
    void act(decideOnNotAvailable(trigger));
  });
  autoUpdater.on("error", (err) => {
    // Capture before either flag is cleared: `phase` already names which operation this belongs to.
    const erroredPhase = phase;
    checking = false;
    downloading = false;
    deps.window()?.setProgressBar(-1);
    void act(decideOnError(trigger, erroredPhase, err));
  });
  autoUpdater.on("download-progress", (p) => deps.window()?.setProgressBar(p.percent / 100));
  autoUpdater.on("update-downloaded", (info) => {
    downloading = false;
    deps.window()?.setProgressBar(-1);
    void (async () => {
      const r = await box({
        type: "info", title: "Update ready", message: `AI PM Cockpit ${info.version} is ready to install.`,
        buttons: ["Restart now", "On next quit"], defaultId: 0, cancelId: 1,
      });
      // ★ quitAndInstall calls this.install() SYNCHRONOUSLY first (BaseUpdater.js), which spawns the
      // NSIS installer immediately -- the installer is already RUNNING by the time quitAndInstall
      // schedules app.quit() on its own setImmediate. before-quit (killServer) and the window's own
      // close handling therefore run AFTER the installer has started, not before it (fix round 1,
      // review R11 Minor 2 -- the earlier comment here, and the spec's "the app's normal quit path,
      // so unsaved-work protection runs first", both had the order backwards; the spec correction is
      // routed through Task 9, not edited here). isSilent=true reuses the existing per-user install
      // directory.
      if (r === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
    })();
  });

  return {
    check(t: UpdateTrigger): void {
      if (!app.isPackaged) {
        if (t === "manual") void box({ type: "info", title: "AI PM Cockpit", message: NOT_PACKAGED_MESSAGE, buttons: ["OK"] });
        return;
      }
      const decision = decideCheckRequest({ checking, downloading, prompting });
      switch (decision) {
        case "start":
          checking = true;
          phase = "checking";
          trigger = t;
          // checkForUpdates() also ALWAYS emits "error" before rejecting on failure (same shape as
          // downloadUpdate(), see the comment in `act` above) -- this .catch only silences the
          // rejection.
          autoUpdater.checkForUpdates().catch(() => {});
          return;
        case "promote":
          if (t === "manual") {
            trigger = "manual";
            deps.log("updater: manual check requested while one was already running; it will report when it finishes");
          } else {
            deps.log("updater: startup check request ignored, one is already running");
          }
          return;
        case "downloading":
          void box({ type: "info", title: "AI PM Cockpit", message: "An update is already downloading.", buttons: ["OK"] });
          return;
        case "prompting":
          deps.log(`updater: ${t} check ignored, a dialog is already open`);
          return;
      }
    },
  };
}

export async function createUpdater(deps: { log(line: string): void; window(): BrowserWindow | null }): Promise<Updater> {
  if (checksDisabled()) {
    deps.log("updater: checks disabled (AIPM_DISABLE_UPDATE_CHECK=1)");
    return {
      check(t: UpdateTrigger): void {
        deps.log(`updater: ${t} check skipped (AIPM_DISABLE_UPDATE_CHECK=1)`);
      },
    };
  }
  // Loaded lazily (a dynamic import, not a static top-level one) so a load failure -- a missing or
  // corrupted node_modules/electron-updater in a bad package -- degrades to a logged no-op updater
  // instead of throwing while main.ts's module graph is still loading, which would take the whole app
  // down before a single window opens (fix round 1, review R11 Important 1c). main.ts's own import of
  // THIS module (`./updater`) stays a normal static import; only the electron-updater dependency
  // inside it is deferred, and main.ts now awaits this function's result.
  try {
    const mod: ElectronUpdaterModule = await import("electron-updater");
    return wireUpdater(mod.autoUpdater, deps);
  } catch (e: unknown) {
    deps.log(`updater: electron-updater failed to load: ${String(e)}`);
    return unavailableUpdater(deps, LOAD_FAILED_MESSAGE);
  }
}
