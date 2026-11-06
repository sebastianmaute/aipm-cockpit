import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdater, DRY_RUN_WIRED_LINE, unverifiedText } from "./updater";
import { UPDATE_DURATION_HINT } from "./lib/update-window";
import { RELEASES_URL } from "./lib/constants";
import { CANNOT_RUN_PREFIX, verifyUpdateSignature } from "./update-signature";

// ★★★ Regression test for fix round 2's Critical 1, item (d): nothing before this file exercised
// `createUpdater` itself, so `pickAutoUpdater` reverting to a direct `mod.autoUpdater` read (the
// original bug) would have shipped again with every other test in this repo still green. Mocks
// electron-updater with EXACTLY the shape the real package has under Electron's own runtime (no
// named `autoUpdater`, only `.default.autoUpdater` -- see electron-updater-loader.ts's doc comment
// and updater-module-shape.test.ts for the measurement) so this test fails the moment the call site
// stops going through the resolver. Proven RED/GREEN: task-6-report.md's fix-round-3 section records
// reverting the call site to `mod.autoUpdater` directly (RED) and restoring it (GREEN).
const fakeAutoUpdater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: true,
  allowPrerelease: true,
  allowDowngrade: true,
  disableWebInstaller: false,
  logger: null as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  downloadUpdate: vi.fn(() => Promise.resolve([])),
  quitAndInstall: vi.fn(),
  // NsisUpdater's hook (electron-updater 6.8.9, NsisUpdater.js): its default, which a signed build
  // replaces and an unsigned one leaves alone. Optional so a test can remove it.
  verifyUpdateCodeSignature: undefined as unknown,
}));

// No named `autoUpdater` export -- matching the real package's shape under a dynamic import
// (electron-updater-loader.ts's doc comment). If updater.ts ever reads `mod.autoUpdater` directly
// again, `wireUpdater` receives `undefined` here too, and every assertion below fails.
//
// ★ `autoUpdater: undefined` is EXPLICIT, not omitted, and that is load-bearing: a real unmocked
// module returns `undefined` SILENTLY for a missing property, but vitest's own mocked-namespace proxy
// throws "No 'autoUpdater' export is defined on the mock" for a key that is absent entirely (measured
// while writing this test -- the throw landed in createUpdater's LOAD try/catch and was reported as
// "failed to load", which read exactly like the real Critical-1 bug and cost a debugging round before
// the cause turned out to be this mock, not `pickAutoUpdater`). Declaring the key with an `undefined`
// value sidesteps vitest's strict check while still exercising the real fallback path.
vi.mock("electron-updater", () => ({ autoUpdater: undefined, default: { autoUpdater: fakeAutoUpdater } }));

const showMessageBox = vi.hoisted(() => vi.fn(() => Promise.resolve({ response: 0 })));
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// The "Update available" prompt is a BrowserWindow (lib/update-window.ts). This fake records each
// window and lets a test fire its events the way Electron would.
const fakeWindows = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeWindow {
    static instances: FakeWindow[] = [];
    static nextLoadFails = false;
    handlers: Record<string, Handler[]> = {};
    destroyed = false;
    loadURL = vi.fn<(url: string) => Promise<void>>(() =>
      FakeWindow.nextLoadFails ? Promise.reject(new Error("load failed")) : Promise.resolve());
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      FakeWindow.instances.push(this);
    }
    on(event: string, h: Handler) {
      (this.handlers[event] ??= []).push(h);
      return this;
    }
    once(event: string, h: Handler) {
      return this.on(event, h);
    }
    emit(event: string, ...args: unknown[]) {
      for (const h of this.handlers[event] ?? []) h(...args);
    }
    setMenu() {}
    show() {}
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit("closed");
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return FakeWindow;
});

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => "/tmp/aipm-cockpit-updater-test",
    getVersion: () => "1.0.0",
  },
  BrowserWindow: fakeWindows,
  dialog: { showMessageBox },
  shell: { openExternal },
}));

describe("createUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeAutoUpdater.logger = null;
  });

  it("wires the real autoUpdater singleton resolved from .default, not a named export", async () => {
    const log = vi.fn();
    await createUpdater({ log, window: () => null });

    expect(fakeAutoUpdater.autoDownload).toBe(false);
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(fakeAutoUpdater.allowPrerelease).toBe(false);
    expect(fakeAutoUpdater.allowDowngrade).toBe(false);
    expect(fakeAutoUpdater.logger).toMatchObject({
      info: expect.any(Function),
      warn: expect.any(Function),
      error: expect.any(Function),
      debug: expect.any(Function),
    });

    // Neither failure path fired -- see updater.ts's two separate try/catch blocks (fix round 2,
    // Critical 1b): a load failure logs "failed to load", a wiring failure logs "failed to wire".
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("failed to load"))).toBe(false);
    expect(lines.some((l) => l.includes("failed to wire"))).toBe(false);
  });

  // Releases ship the full installer; electron-updater would otherwise accept a web installer that
  // fetches the app at install time.
  it("refuses web installers", async () => {
    fakeAutoUpdater.disableWebInstaller = false;
    await createUpdater({ log: vi.fn(), window: () => null });
    expect(fakeAutoUpdater.disableWebInstaller).toBe(true);
  });

  it("registers a listener for every event wireUpdater depends on", async () => {
    await createUpdater({ log: vi.fn(), window: () => null });
    const registered = fakeAutoUpdater.on.mock.calls.map((c) => c[0]);
    for (const event of ["update-available", "update-not-available", "error", "download-progress", "update-downloaded"]) {
      expect(registered).toContain(event);
    }
  });

  // The installer runs silently after "Restart now", so for a few minutes nothing is visible and the
  // app can look frozen (seen on the first real update, 1.14.0-rc.1 → 1.14.0).
  it("the Update ready dialog warns that installing takes a few minutes and may look frozen", async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 }); // "On next quit": no quitAndInstall
    await createUpdater({ log: vi.fn(), window: () => null });
    const onDownloaded = fakeAutoUpdater.on.mock.calls.find((c) => c[0] === "update-downloaded")?.[1] as (info: { version: string }) => void;
    onDownloaded({ version: "9.9.9" });
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    const opts = (showMessageBox.mock.calls[0] as unknown[]).at(-1) as { message: string; detail?: string };
    expect(opts.message).toBe("AI PM Cockpit 9.9.9 is ready to install.");
    expect(opts.detail).toMatch(/few minutes/);
    expect(opts.detail).toMatch(/frozen/);
    // Only "Restart now" relaunches; "On next quit" leaves the app closed (install(true, false)).
    expect(opts.detail).toMatch(/After Restart now, it opens again by itself/);
    expect(opts.detail).toMatch(/After On next quit, .*start it again yourself/);
  });

  it("a manual check calls the real autoUpdater's checkForUpdates", async () => {
    const updater = await createUpdater({ log: vi.fn(), window: () => null });
    updater.check("manual");
    expect(fakeAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  // §741 — the smoke test's mode loads and wires the real updater, then never reaches the network.
  describe("with AIPM_UPDATER_DRY_RUN=1", () => {
    beforeEach(() => { vi.stubEnv("AIPM_UPDATER_DRY_RUN", "1"); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it("wires the real autoUpdater, logs the wired line, and skips every check", async () => {
      const log = vi.fn();
      const updater = await createUpdater({ log, window: () => null });
      expect(fakeAutoUpdater.autoDownload).toBe(false);
      expect(fakeAutoUpdater.on).toHaveBeenCalled();
      const lines = () => log.mock.calls.map((c) => String(c[0]));
      expect(lines()).toContain(DRY_RUN_WIRED_LINE);
      updater.check("startup");
      updater.check("manual");
      expect(fakeAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
      expect(showMessageBox).not.toHaveBeenCalled();
      expect(lines().filter((l) => l.includes("check skipped (AIPM_UPDATER_DRY_RUN=1)"))).toHaveLength(2);
    });

    it("still logs a wiring failure, and not the wired line", async () => {
      const log = vi.fn();
      fakeAutoUpdater.on.mockImplementationOnce(() => { throw new Error("boom"); });
      await createUpdater({ log, window: () => null });
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("failed to wire up"))).toBe(true);
      expect(lines).not.toContain(DRY_RUN_WIRED_LINE);
    });
  });
});

// A native message box cannot scroll, so the release notes now sit in a window of their own. The
// three choices must still mean what they meant in the box.
describe("the Update available window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeWindows.instances.length = 0;
    fakeWindows.nextLoadFails = false;
  });

  const announce = async (log = vi.fn()) => {
    // A manual check: `decideOnAvailable` always prompts for one, whatever skip file the machine has.
    const updater = await createUpdater({ log, window: () => null });
    updater.check("manual");
    const onAvailable = fakeAutoUpdater.on.mock.calls.find((c) => c[0] === "update-available")?.[1] as
      (info: { version: string; releaseNotes?: unknown }) => void;
    onAvailable({ version: "9.9.9", releaseNotes: "First line\nSecond line" });
  };
  const openWindow = async () => {
    await vi.waitFor(() => expect(fakeWindows.instances).toHaveLength(1));
    return fakeWindows.instances[0];
  };

  it("loads the notes into a sandboxed window instead of a message box", async () => {
    await announce();
    const win = await openWindow();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(win.opts.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    const url = String(win.loadURL.mock.calls[0][0]);
    const html = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8");
    expect(html).toContain("AI PM Cockpit 9.9.9 is available.");
    expect(html).toContain("First line\nSecond line");
  });

  it("Download and install starts the download and closes the window", async () => {
    await announce();
    const win = await openWindow();
    win.emit("page-title-updated", { preventDefault: vi.fn() }, "aipm-update:download");
    await vi.waitFor(() => expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(win.isDestroyed()).toBe(true);
  });

  it("closing the window counts as Later: nothing downloads", async () => {
    await announce();
    const win = await openWindow();
    win.close();
    await new Promise((r) => setTimeout(r, 0));
    expect(fakeAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("ignores a title that is not a choice, such as the page's own", async () => {
    await announce();
    const win = await openWindow();
    const ev = { preventDefault: vi.fn() };
    win.emit("page-title-updated", ev, "Update available");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(win.isDestroyed()).toBe(false);
    expect(fakeAutoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("falls back to the native box when the window cannot load, keeping the choice", async () => {
    fakeWindows.nextLoadFails = true;
    showMessageBox.mockResolvedValueOnce({ response: 0 }); // Download and install
    const log = vi.fn();
    await announce(log);
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    const opts = (showMessageBox.mock.calls[0] as unknown[]).at(-1) as { message: string; detail: string; buttons: string[] };
    expect(opts.message).toBe("AI PM Cockpit 9.9.9 is available.");
    expect(opts.buttons).toEqual(["Download and install", "Later", "Skip this version"]);
    // The box cannot scroll, so the install hint comes first and is never pushed off-screen.
    expect(opts.detail.startsWith(UPDATE_DURATION_HINT)).toBe(true);
    await vi.waitFor(() => expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(log.mock.calls.some((c) => String(c[0]).includes("using the native dialog"))).toBe(true);
  });
});

// A signed build (its packaged resources/app-update.yml names a publisher) checks every downloaded
// installer with verifyUpdateSignature, which fails closed; an unsigned build keeps electron-updater's
// default. A refused update says to download the release by hand and is never installed.
describe("a signed build's update check", () => {
  const DEFAULT_VERIFY = vi.fn(() => Promise.resolve(null));
  const SIGNED_FEED = "owner: sebastianmaute\nrepo: aipm-cockpit\nprovider: github\nupdaterCacheDirName: x\npublisherName:\n  - SignPath Foundation\n";
  const UNSIGNED_FEED = "owner: sebastianmaute\nrepo: aipm-cockpit\nprovider: github\nupdaterCacheDirName: x\n";
  let resources: string;
  const had = Object.getOwnPropertyDescriptor(process, "resourcesPath");

  beforeEach(() => {
    vi.clearAllMocks();
    fakeWindows.instances.length = 0;
    fakeWindows.nextLoadFails = false;
    fakeAutoUpdater.verifyUpdateCodeSignature = DEFAULT_VERIFY;
    fakeAutoUpdater.autoInstallOnAppQuit = false;
    resources = mkdtempSync(join(tmpdir(), "upd-res-"));
    Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true, writable: true });
  });
  afterEach(() => {
    rmSync(resources, { recursive: true, force: true });
    if (had) Object.defineProperty(process, "resourcesPath", had);
    else delete (process as { resourcesPath?: string }).resourcesPath;
  });
  const feed = (text: string) => writeFileSync(join(resources, "app-update.yml"), text);

  it("installs the fail-closed verifier when the packaged feed names a publisher", async () => {
    feed(SIGNED_FEED);
    const log = vi.fn();
    await createUpdater({ log, window: () => null });
    expect(fakeAutoUpdater.verifyUpdateCodeSignature).toBe(verifyUpdateSignature);
    expect(log.mock.calls.some((c) => String(c[0]).includes("failed to wire"))).toBe(false);
  });

  it("leaves electron-updater's default alone in an unsigned build, or with no feed at all", async () => {
    feed(UNSIGNED_FEED);
    await createUpdater({ log: vi.fn(), window: () => null });
    expect(fakeAutoUpdater.verifyUpdateCodeSignature).toBe(DEFAULT_VERIFY);
    rmSync(join(resources, "app-update.yml"));
    await createUpdater({ log: vi.fn(), window: () => null });
    expect(fakeAutoUpdater.verifyUpdateCodeSignature).toBe(DEFAULT_VERIFY);
  });

  it("installs the verifier when the feed exists but cannot be read (fail closed)", async () => {
    mkdirSync(join(resources, "app-update.yml"));
    await createUpdater({ log: vi.fn(), window: () => null });
    expect(fakeAutoUpdater.verifyUpdateCodeSignature).toBe(verifyUpdateSignature);
  });

  it("refuses to wire up a signed build whose updater has no signature hook", async () => {
    feed(SIGNED_FEED);
    const saved = fakeAutoUpdater.verifyUpdateCodeSignature;
    delete (fakeAutoUpdater as { verifyUpdateCodeSignature?: unknown }).verifyUpdateCodeSignature;
    try {
      const log = vi.fn();
      const updater = await createUpdater({ log, window: () => null });
      expect(log.mock.calls.some((c) => String(c[0]).includes("failed to wire up"))).toBe(true);
      updater.check("startup");
      expect(fakeAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    } finally {
      fakeAutoUpdater.verifyUpdateCodeSignature = saved;
    }
  });

  it("a refused update shows the manual-download message, opens the releases page, and never installs", async () => {
    feed(SIGNED_FEED);
    const log = vi.fn();
    const updater = await createUpdater({ log, window: () => null });
    updater.check("manual");
    const handler = (name: string) => fakeAutoUpdater.on.mock.calls.find((c) => c[0] === name)?.[1] as (arg: unknown) => void;
    handler("update-available")({ version: "9.9.9", releaseNotes: "notes" });
    await vi.waitFor(() => expect(fakeWindows.instances).toHaveLength(1));
    fakeWindows.instances[0].emit("page-title-updated", { preventDefault: vi.fn() }, "aipm-update:download");
    await vi.waitFor(() => expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(true);

    showMessageBox.mockResolvedValueOnce({ response: 1 }); // Open releases page
    handler("error")(Object.assign(
      new Error("New version 9.9.9 is not signed by the application owner: the installer's signature is NotSigned"),
      { code: "ERR_UPDATER_INVALID_SIGNATURE" },
    ));
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    const opts = (showMessageBox.mock.calls[0] as unknown[]).at(-1) as { message: string; detail: string; buttons: string[] };
    expect(opts.message).toBe("The update was not installed: its signature could not be verified.");
    expect(opts.detail).toMatch(/download .* by hand from the releases page/);
    expect(opts.detail).toContain("NotSigned");
    expect(opts.buttons).toEqual(["OK", "Open releases page"]);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(RELEASES_URL));
    expect(fakeAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    // Nothing is left armed to install on quit.
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(log.mock.calls.some((c) => /refused/.test(String(c[0])))).toBe(true);
  });

  // A check that could not run (PowerShell blocked by policy, failing, timing out) says nothing
  // about the update itself, so the dialog does not call its signature bad -- and still refuses it.
  it("a refusal because the check could not run says so, offers the manual download, and never installs", async () => {
    feed(SIGNED_FEED);
    const updater = await createUpdater({ log: vi.fn(), window: () => null });
    updater.check("manual");
    const handler = (name: string) => fakeAutoUpdater.on.mock.calls.find((c) => c[0] === name)?.[1] as (arg: unknown) => void;
    handler("update-available")({ version: "9.9.9", releaseNotes: "notes" });
    await vi.waitFor(() => expect(fakeWindows.instances).toHaveLength(1));
    fakeWindows.instances[0].emit("page-title-updated", { preventDefault: vi.fn() }, "aipm-update:download");
    await vi.waitFor(() => expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));

    showMessageBox.mockResolvedValueOnce({ response: 1 }); // Open releases page
    handler("error")(Object.assign(
      new Error(`New version 9.9.9 is not signed by the application owner: ${CANNOT_RUN_PREFIX}PowerShell exited with 1`),
      { code: "ERR_UPDATER_INVALID_SIGNATURE" },
    ));
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    const opts = (showMessageBox.mock.calls[0] as unknown[]).at(-1) as { message: string; detail: string; buttons: string[] };
    expect(opts.message).toBe("The update was not installed: its signature check could not run on this computer.");
    expect(opts.message).not.toMatch(/could not be verified/);
    expect(opts.detail).toMatch(/PowerShell, which may be blocked here \(for example by a policy\)/);
    expect(opts.detail).toMatch(/download .* by hand from the releases page/);
    expect(opts.detail).toContain("PowerShell exited with 1");
    expect(opts.buttons).toEqual(["OK", "Open releases page"]);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(RELEASES_URL));
    expect(fakeAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("unverifiedText keeps the mismatch wording for a real mismatch and the cannot-run wording for a check that did not run", () => {
    expect(unverifiedText("the installer's signature is NotSigned").message).toBe("The update was not installed: its signature could not be verified.");
    expect(unverifiedText(`${CANNOT_RUN_PREFIX}timed out after 60 s`).message).toBe("The update was not installed: its signature check could not run on this computer.");
  });

  // The next check would offer, and download, the very installer that was just refused. The refused
  // version is remembered for the session: never offered or downloaded again, while a newer one is.
  it("does not offer or download a refused version again in the same session; a newer one is offered", async () => {
    feed(SIGNED_FEED);
    const updater = await createUpdater({ log: vi.fn(), window: () => null });
    const handler = (name: string) => fakeAutoUpdater.on.mock.calls.find((c) => c[0] === name)?.[1] as (arg: unknown) => void;
    updater.check("startup");
    handler("update-available")({ version: "9.9.9", releaseNotes: "notes" });
    await vi.waitFor(() => expect(fakeWindows.instances).toHaveLength(1));
    fakeWindows.instances[0].emit("page-title-updated", { preventDefault: vi.fn() }, "aipm-update:download");
    await vi.waitFor(() => expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    handler("error")(Object.assign(new Error("New version 9.9.9 is not signed by the application owner"), { code: "ERR_UPDATER_INVALID_SIGNATURE" }));
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0)); // the refusal's dialog has closed

    // The next automatic check: the same version is neither offered nor downloaded.
    updater.check("startup");
    expect(fakeAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    handler("update-available")({ version: "9.9.9", releaseNotes: "notes" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fakeWindows.instances).toHaveLength(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    // A manual check says why instead of offering it.
    updater.check("manual");
    handler("update-available")({ version: "9.9.9", releaseNotes: "notes" });
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(2));
    const opts = (showMessageBox.mock.calls[1] as unknown[]).at(-1) as { message: string; detail: string };
    expect(opts.message).toBe("The update was not installed: its signature could not be verified.");
    expect(opts.detail).toContain("9.9.9 was refused earlier");
    expect(fakeWindows.instances).toHaveLength(1);
    expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));

    // A newer version is offered as usual.
    updater.check("startup");
    handler("update-available")({ version: "9.9.10", releaseNotes: "notes" });
    await vi.waitFor(() => expect(fakeWindows.instances).toHaveLength(2));
  });
});
