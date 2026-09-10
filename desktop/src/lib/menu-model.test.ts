// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HELP_MENU_ITEMS,
  HELP_VIEW_HASH,
  formatVersionDetail,
  helpHashScript,
} from "./menu-model";

describe("HELP_MENU_ITEMS", () => {
  it("offers exactly the two entries the Help menu is meant to have", () => {
    expect(HELP_MENU_ITEMS.map((i) => i.id)).toEqual(["help", "version"]);
  });

  it("labels them for a non-technical reader", () => {
    expect(HELP_MENU_ITEMS.map((i) => i.label)).toEqual(["Help", "Version"]);
  });
});

describe("helpHashScript", () => {
  it("targets the app's own help view", () => {
    expect(helpHashScript()).toContain(JSON.stringify(HELP_VIEW_HASH));
  });

  it("clears the hash first so a repeat click still fires hashchange", () => {
    // ★★★ THIS IS THE POINT OF THE HELPER. Assigning an identical hash fires
    // no hashchange event, so opening Help while already on Help would be a
    // dead menu item -- the user clicks and nothing happens. The clear-then-set
    // pair is what makes it idempotent from the user's side.
    const script = helpHashScript();
    const clearAt = script.indexOf('window.location.hash = ""');
    const setAt = script.indexOf(JSON.stringify(HELP_VIEW_HASH));
    expect(clearAt).toBeGreaterThanOrEqual(0);
    expect(setAt).toBeGreaterThan(clearAt);
  });

  it("JSON-encodes the hash rather than interpolating it raw", () => {
    // The string is handed to executeJavaScript, so an unencoded value would
    // be a script-injection seam. Nothing user-supplied reaches it today; the
    // encoding is what keeps that true if someone later parameterises it.
    expect(helpHashScript('#a"; alert(1); "')).toContain('"#a\\"; alert(1); \\""');
  });
});

describe("formatVersionDetail", () => {
  it("names the version and where the log lives", () => {
    const text = formatVersionDetail("0.301.0", "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log");
    expect(text).toContain("0.301.0");
    expect(text).toContain("launch.log");
  });

  it("does not invent a codename it was not given", () => {
    // src/app/version.ts carries APP_MILESTONE, but the main process has no
    // access to it -- desktop/package.json holds the version alone. Printing a
    // stale or guessed codename beside a correct version is the exact defect
    // APP_VERSION_LABEL already shipped once, so this says nothing rather than
    // something plausible.
    expect(formatVersionDetail("0.301.0", "x")).not.toMatch(/"[A-Z][a-z]+"/);
  });
});
