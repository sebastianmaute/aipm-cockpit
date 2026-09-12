import { describe, expect, it } from "vitest";
import { isDesktopShellUserAgent } from "./desktop-shell";

describe("isDesktopShellUserAgent", () => {
  it("recognises the packaged app's own user agent", () => {
    // The shape Electron 33 actually sends: a Chrome UA with the app's own
    // product token and an `Electron/<version>` token appended.
    expect(
      isDesktopShellUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "aipm-cockpit/1.0.0 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36",
      ),
    ).toBe(true);
  });

  it("does not fire for the browsers the web app actually runs in", () => {
    // ★ The negative half is the one that matters: a false positive here
    // would strip the Print button from every browser user, which is the
    // opposite of the defect being fixed.
    expect(
      isDesktopShellUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      isDesktopShellUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe(false);
    expect(isDesktopShellUserAgent("")).toBe(false);
  });

  it("is case-sensitive, so an unrelated product name cannot trip it", () => {
    // Mutant this kills: swapping `includes("Electron")` for a
    // case-insensitive test. Electron always capitalises its token, so the
    // looser form buys nothing and widens what can match.
    expect(isDesktopShellUserAgent("SomeBrowser/1.0 electron-ish/2")).toBe(false);
    expect(isDesktopShellUserAgent("SomeBrowser/1.0 ELECTRON/2")).toBe(false);
  });

  it("reads THIS test environment as a browser", () => {
    // ★★★ THE ASSERTION THAT PROTECTS TEN OTHER TEST FILES. Every toolbar
    // test that asserts the trailing Print · reset-columns · reset-size group
    // (dashboard-panel, gantt, reports, resources-panel, timelog-panel,
    // activity-log-panel, tasks-section, documents-toolbar, raci-panel,
    // task-time-tracking-modal) depends on PrintButton still rendering under
    // jsdom. That depends entirely on jsdom's UA not containing "Electron".
    // Stated here as a positive observable rather than left as an assumption,
    // so if a jsdom upgrade ever changed it, ONE test would name the reason
    // instead of ten failing mysteriously.
    expect(isDesktopShellUserAgent(navigator.userAgent)).toBe(false);
  });
});
