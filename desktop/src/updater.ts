// electron-updater wired to the pure policy in lib/update-policy.ts. Checks only in a packaged
// build; nothing downloads or installs without the user's click. Excluded from the root tsc
// like main.ts; typechecked by `npm run desktop:typecheck`.
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASES_URL } from "./lib/constants";
import {
  decideOnAvailable, decideOnError, decideOnNotAvailable, parseSkipped, serializeSkipped,
  shouldStartCheck, type UpdateDecision, type UpdateTrigger,
} from "./lib/update-policy";

export interface Updater {
  check(trigger: UpdateTrigger): void;
}

export function createUpdater(deps: { log(line: string): void; window(): BrowserWindow | null }): Updater {
  const skipFile = () => join(app.getPath("userData"), "update-skip.json");
  const readSkipped = (): string | null => {
    try {
      return parseSkipped(readFileSync(skipFile(), "utf8"));
    } catch {
      return null;
    }
  };
  let inFlight = false;
  let trigger: UpdateTrigger = "startup";

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
    const w = deps.window();
    const r = w && !w.isDestroyed() ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    return r.response;
  };
  const act = async (d: UpdateDecision): Promise<void> => {
    if (d.kind === "silent") return;
    if (d.kind === "up-to-date") {
      await box({ type: "info", title: "AI PM Cockpit", message: `You have the latest version (${app.getVersion()}).`, buttons: ["OK"] });
      return;
    }
    if (d.kind === "error") {
      const r = await box({ type: "warning", title: "AI PM Cockpit", message: "Could not check for updates.", detail: d.message, buttons: ["OK", "Open releases page"], defaultId: 0, cancelId: 0 });
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
    inFlight = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.downloadUpdate().catch((e: unknown) => deps.log(`updater download: ${String(e)}`));
  };

  autoUpdater.on("update-available", (info) => {
    inFlight = false;
    void act(decideOnAvailable(trigger, info, readSkipped()));
  });
  autoUpdater.on("update-not-available", () => {
    inFlight = false;
    void act(decideOnNotAvailable(trigger));
  });
  autoUpdater.on("error", (err) => {
    inFlight = false;
    deps.window()?.setProgressBar(-1);
    void act(decideOnError(trigger, err));
  });
  autoUpdater.on("download-progress", (p) => deps.window()?.setProgressBar(p.percent / 100));
  autoUpdater.on("update-downloaded", (info) => {
    inFlight = false;
    deps.window()?.setProgressBar(-1);
    void box({
      type: "info", title: "Update ready", message: `AI PM Cockpit ${info.version} is ready to install.`,
      buttons: ["Restart now", "On next quit"], defaultId: 0, cancelId: 1,
    }).then((r) => {
      // quitAndInstall goes through app.quit(), so before-quit (killServer) and the window's own
      // close handling run first; isSilent=true reuses the existing per-user install directory.
      if (r === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
    });
  });

  return {
    check(t: UpdateTrigger): void {
      if (!app.isPackaged) {
        if (t === "manual") void box({ type: "info", title: "AI PM Cockpit", message: "Updates are checked only in the installed app.", buttons: ["OK"] });
        return;
      }
      if (!shouldStartCheck(inFlight)) {
        deps.log(`updater: ${t} check ignored, one is already running`);
        return;
      }
      inFlight = true;
      trigger = t;
      autoUpdater.checkForUpdates().catch((e: unknown) => deps.log(`updater check: ${String(e)}`));
    },
  };
}
