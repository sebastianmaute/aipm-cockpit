import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdater } from "./updater";

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
  logger: null as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  downloadUpdate: vi.fn(() => Promise.resolve([])),
  quitAndInstall: vi.fn(),
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
    const opts = (showMessageBox.mock.calls[0] as unknown[]).at(-1) as { message: string; buttons: string[] };
    expect(opts.message).toBe("AI PM Cockpit 9.9.9 is available.");
    expect(opts.buttons).toEqual(["Download and install", "Later", "Skip this version"]);
    await vi.waitFor(() => expect(fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(log.mock.calls.some((c) => String(c[0]).includes("using the native dialog"))).toBe(true);
  });
});
