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
vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => "/tmp/aipm-cockpit-updater-test",
    getVersion: () => "1.0.0",
  },
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
