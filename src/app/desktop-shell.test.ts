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
    // ★★★ THE ASSERTION THAT PROTECTS EVERY OTHER TEST OF A PRINT BUTTON.
    // They all depend on PrintButton still rendering under jsdom, which
    // depends entirely on jsdom's UA not containing "Electron". Stated here as
    // a positive observable rather than left as an assumption, so a jsdom
    // upgrade that changed the UA reds ONE test that names the reason instead
    // of a dozen failing mysteriously.
    //
    // ★★★ DERIVE THE DEPENDANTS, DO NOT TRUST A LIST. An earlier version of
    // this comment named ten files and was wrong in BOTH directions: it
    // included `task-time-tracking-modal.test.tsx`, which has no print button
    // at all (it was in the list only for using expectButtonOrder, a different
    // property), and omitted four real dependants -- help-view,
    // knowledge-panel, report-table and steering-committee-panel -- whose
    // `getByRole` calls THROW if PrintButton returns null, and one of which
    // asserts an exact ordered array beginning with the print name. No tally
    // is quoted here on purpose; it rots. Read today's set with:
    //   grep -rln printHint src --include=*.test.tsx
    // (this file is not among them -- it asserts the predicate, not the
    // button.)
    expect(isDesktopShellUserAgent(navigator.userAgent)).toBe(false);
  });
});
