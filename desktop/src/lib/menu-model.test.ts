// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASES_URL } from "./constants";
import {
  DASHBOARD_VIEW_HASH,
  DESKTOP_VERSION_REQUEST_EVENT,
  FILE_MENU_ITEMS,
  HELP_MENU_ITEMS,
  HELP_VIEW_HASH,
  type HelpMenuAction,
  type HelpMenuItemId,
  fileAction,
  helpAction,
  helpHashScript,
  versionRequestScript,
} from "./menu-model";

describe("HELP_MENU_ITEMS", () => {
  it("offers exactly the three entries the Help menu is meant to have, in order", () => {
    // ORDER IS THE ASSERTION, not just membership. buildMenu maps this array
    // straight into the submenu, so the array IS the rendered order -- and
    // "Check for updates" sits last on purpose: it is the only entry that
    // leaves the app for an external browser, and putting it there leaves the
    // two entries that already shipped exactly where users found them.
    expect(HELP_MENU_ITEMS.map((i) => i.id)).toEqual(["help", "version", "updates"]);
  });

  it("labels them for a non-technical reader", () => {
    expect(HELP_MENU_ITEMS.map((i) => i.label)).toEqual([
      "Help",
      "Version",
      "Check for updates…",
    ]);
  });

  it("ends the updates label with a real ellipsis, not three periods", () => {
    // Windows menu convention: a trailing U+2026 means "this opens something"
    // rather than acting immediately -- which is exactly what this item does.
    // "..." renders almost identically, so the escape is spelled out here to
    // make the requirement checkable by eye as well as by the assertion.
    const updates = HELP_MENU_ITEMS.find((i) => i.id === "updates");
    expect(updates?.label).toBe("Check for updates\u2026");
  });
});

describe("helpAction", () => {
  // The table is written out by hand on purpose. Deriving it from
  // HELP_ACTIONS would make the assertion a restatement of the code and it
  // would pass whatever the code said -- including with two ids swapped,
  // which is the mutant this exists for.
  const TABLE: ReadonlyArray<readonly [HelpMenuItemId, HelpMenuAction]> = [
    ["help", "open-help"],
    ["version", "show-version"],
    ["updates", "open-releases"],
  ];

  it("maps each id to the action main.ts switches on", () => {
    // ★★★ THE SWAP MUTANT. Nothing else in this file or in main.ts can catch
    // it: exchange the `version` and `updates` VALUES in HELP_ACTIONS and
    // every other test here still passes -- the ids are unchanged, the labels
    // are unchanged, the menu still has three entries, and main.ts still has
    // a case for both actions. It just opens the Version panel when you ask
    // for updates and opens a browser when you ask for the version. tsc
    // cannot see it either: both values inhabit the same union.
    for (const [id, action] of TABLE) {
      expect(helpAction(id)).toBe(action);
    }
  });

  it("covers every entry the menu actually offers", () => {
    // The runtime companion to the Record's compile-time exhaustiveness: it
    // fails if a menu entry is added without a row here, and (compared as
    // SETS, so a reorder is left to the ordering test above) it does not
    // double-report a reordering.
    expect(new Set(TABLE.map(([id]) => id))).toEqual(
      new Set(HELP_MENU_ITEMS.map((i) => i.id)),
    );
  });

  it("gives each entry an action of its own", () => {
    // Catches the copy-paste mutant -- a second id pointed at an action that
    // is already taken (`updates: "show-version"`). One entry then silently
    // does another's job, which is exactly the defect the old two-way ternary
    // in main.ts shipped.
    const actions = HELP_MENU_ITEMS.map((i) => helpAction(i.id));
    // ★ The truthiness filter is NOT pointless despite the return type:
    // helpAction is a Record lookup, so a key that went missing behind a cast
    // yields `undefined`, and the Set check alone would not notice -- three
    // ids where one is undefined still gives a set of size three.
    expect(actions.filter((a) => !!a)).toHaveLength(HELP_MENU_ITEMS.length);
    expect(new Set(actions).size).toBe(HELP_MENU_ITEMS.length);
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

/** A minimal CustomEvent standing in for the real DOM constructor, so
 *  versionRequestScript's output can be run (`new Function`) and observed
 *  without a jsdom environment (this file is `@vitest-environment node`). */
class StubCustomEvent {
  readonly type: string;
  readonly detail: unknown;
  readonly cancelable: boolean;
  defaultPrevented = false;
  constructor(type: string, init?: { cancelable?: boolean; detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
    this.cancelable = init?.cancelable ?? false;
  }
  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

/**
 * Actually EVALUATES a versionRequestScript() build, supplying `window` and
 * `CustomEvent` as the exact free identifiers the real page provides --
 * `new Function("window", "CustomEvent", "return " + script)` -- rather than
 * pattern-matching the source text. `dispatchWith` stands in for the real
 * `window.dispatchEvent` (in the packaged app: React's event listener,
 * possibly calling `preventDefault()`); it decides what the script's
 * `!window.dispatchEvent(ev)` completion value resolves to.
 *
 * ★★★ THIS IS WHAT M1 ASKED FOR: a "the substring is present" assertion
 * cannot tell a correctly-JSON-encoded hostile path from one that merely
 * LOOKS right, because the mutant it needs to catch (splicing the path into
 * the script by hand) still contains the same characters SOMEWHERE in the
 * output. Reading `dispatched.detail.logPath` back out of an event the
 * script itself constructed is the only check that cannot be fooled that
 * way -- either the string that comes out equals the string that went in,
 * or it does not.
 */
function runScript(
  script: string,
  dispatchWith: (ev: StubCustomEvent) => boolean,
): { result: unknown; dispatched: StubCustomEvent | null } {
  let dispatched: StubCustomEvent | null = null;
  const windowStub = {
    dispatchEvent: (ev: StubCustomEvent): boolean => {
      dispatched = ev;
      return dispatchWith(ev);
    },
  };
  const fn = new Function("window", "CustomEvent", `return ${script}`);
  const result: unknown = fn(windowStub, StubCustomEvent);
  return { result, dispatched };
}

describe("versionRequestScript", () => {
  it("dispatches the shared event name on window", () => {
    const script = versionRequestScript("C:\\logs\\launch.log", true);
    expect(script).toContain("new CustomEvent(");
    expect(script).toContain("window.dispatchEvent(");
    expect(script).toContain(JSON.stringify(DESKTOP_VERSION_REQUEST_EVENT));
  });

  it("carries the log path and the open flag as one JSON-encoded detail object", () => {
    const logPath = "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log";
    const script = versionRequestScript(logPath, true);
    // ★★★ A Windows log path holds backslashes -- string concatenation would
    // corrupt them. JSON.stringify is the only safe way to interpolate it
    // into a script string, and this asserts the ENCODED form is present,
    // not merely that the raw text appears somewhere (which a naive
    // concatenation would also satisfy for a path with no special chars).
    // The stronger, mutation-resistant version of this claim is the actual
    // evaluation below ("M1 fix").
    expect(script).toContain(JSON.stringify({ logPath, open: true }));
  });

  it("the open flag distinguishes a priming ping from an actual open request", () => {
    // Main sends `open: false` once per page load (did-finish-load, to
    // remember the log path without popping the modal) and `open: true`
    // from the Help → Version menu click -- two different scripts, or the
    // app's listener could not tell them apart.
    const prime = versionRequestScript("x", false);
    const openRequest = versionRequestScript("x", true);
    expect(prime).toContain(JSON.stringify({ logPath: "x", open: false }));
    expect(openRequest).toContain(JSON.stringify({ logPath: "x", open: true }));
    expect(prime).not.toBe(openRequest);
  });

  it("produces a script that is itself valid JS with the expected shape", () => {
    // Not executed against a real `window` (this file runs under
    // @vitest-environment node) -- parsed, so a malformed interpolation that
    // still happens to contain the right substrings is still caught.
    const script = versionRequestScript("C:\\logs\\launch.log", true);
    expect(() => new Function(script)).not.toThrow();
  });

  describe("M1 fix: the log path survives a hostile round trip", () => {
    const HOSTILE_PATHS = [
      'C:\\Users\\a"b\\launch.log',
      "C:\\Users\\a'b\\launch.log",
      "C:\\Users\\a`b\\launch.log",
      "C:\\Users\\a${b}\\launch.log",
      "C:\\Users\\a</script>b\\launch.log",
      "C:\\Users\\a\u2028b\\launch.log",
      "C:\\trailing\\backslash\\",
    ];

    it("round-trips every hostile path exactly through an actual evaluation", () => {
      for (const logPath of HOSTILE_PATHS) {
        const script = versionRequestScript(logPath, true);
        const { dispatched } = runScript(script, () => true);
        expect(dispatched).not.toBeNull();
        expect((dispatched as StubCustomEvent).detail).toEqual({ logPath, open: true });
      }
    });
  });

  describe("M4 fix: the returned expression reports whether a listener handled the request", () => {
    it("evaluates to true when dispatchEvent reports the event was prevented (handled)", () => {
      const script = versionRequestScript("x", true);
      const { result } = runScript(script, (ev) => {
        ev.preventDefault();
        // dispatchEvent's own contract: false once the event was prevented.
        return false;
      });
      expect(result).toBe(true);
    });

    it("evaluates to false when nothing handled it", () => {
      const script = versionRequestScript("x", true);
      const { result } = runScript(script, () => true);
      expect(result).toBe(false);
    });

    it("creates the event as cancelable, or preventDefault could never suppress it", () => {
      const script = versionRequestScript("x", true);
      const { dispatched } = runScript(script, () => true);
      expect((dispatched as StubCustomEvent).cancelable).toBe(true);
    });
  });
});

describe("shared strings with the app", () => {
  // ★ Read as TEXT, never imported: desktop's tsconfig rootDir is
  // `desktop/src`, so this file cannot import anything under `src/app` --
  // `tsc -p desktop/tsconfig.json` (part of Verification) would fail the
  // moment a test file under that rootDir did. Reading the app's source with
  // node:fs sidesteps that while still catching a drift between the two
  // independently-declared copies.
  const desktopShellSrc = readFileSync(
    join(__dirname, "..", "..", "..", "src", "app", "desktop-shell.ts"),
    "utf8",
  );
  const versionSrc = readFileSync(
    join(__dirname, "..", "..", "..", "src", "app", "version.ts"),
    "utf8",
  );

  it("dispatches the SAME event name src/app/desktop-shell.ts declares", () => {
    const m = /export const DESKTOP_VERSION_REQUEST_EVENT = "([^"]+)";/.exec(desktopShellSrc);
    expect(m).not.toBeNull();
    expect(DESKTOP_VERSION_REQUEST_EVENT).toBe(m?.[1]);
  });

  it("sends the user to the SAME Releases URL the app's Version panel links to", () => {
    const m = /export const APP_RELEASES_URL =\s*"([^"]+)";/.exec(versionSrc);
    expect(m).not.toBeNull();
    expect(RELEASES_URL).toBe(m?.[1]);
  });
});

describe("FILE_MENU_ITEMS", () => {
  it("offers Print with the accelerator a Windows user will reach for", () => {
    expect(FILE_MENU_ITEMS.map((i) => i.id)).toEqual(["print"]);
    expect(FILE_MENU_ITEMS.map((i) => i.label)).toEqual(["Print\u2026"]);
    expect(FILE_MENU_ITEMS[0].accelerator).toBe("CmdOrCtrl+P");
  });

  it("ends the Print label with a real ellipsis, not three periods", () => {
    // Same Windows convention as the Help menu's updates item: a trailing
    // U+2026 means "this opens something" -- here, the print dialog.
    expect(FILE_MENU_ITEMS[0].label).toBe("Print\u2026");
  });
});

describe("fileAction", () => {
  it("maps print to the action main.ts switches on", () => {
    // Hand-written, not derived from FILE_ACTIONS -- deriving it would
    // restate the code and pass whatever the code said.
    expect(fileAction("print")).toBe("print-window");
  });

  it("covers every entry the File menu offers", () => {
    // ★★★ WHAT THIS DOES NOT CATCH: the earlier comment claimed it "reds if an
    // entry is added with no mapping", which is false -- a second
    // FileMenuItemId member with no FILE_ACTIONS key is a COMPILE error (the
    // Record is keyed by the union), so this never gets to run. What is left
    // for it is the cast case below.
    const actions = FILE_MENU_ITEMS.map((i) => fileAction(i.id));
    expect(actions.filter((a) => !!a)).toHaveLength(FILE_MENU_ITEMS.length);
    expect(new Set(actions).size).toBe(FILE_MENU_ITEMS.length);
  });

  it("reads the table rather than returning a constant", () => {
    // ★★★ THIS WAS A MISSING TEST, NOT AN EQUIVALENT MUTANT, and the previous
    // comment here asserted the opposite: "with a ONE-MEMBER union no runtime
    // assertion can tell a table lookup from a constant". One can, and the
    // same comment named the input two paragraphs earlier without noticing --
    // an id cast past the union, where a real lookup misses and yields
    // undefined while a constant return cannot. MEASURED both ways this round:
    // 32/32 pass against the real code; with `return FILE_ACTIONS[id]`
    // replaced by `return "print-window"` it is 1 failed / 31 passed, and this
    // is the assertion that fails. No second menu item was needed, so the
    // "test-driven feature creep" objection was a false dichotomy too.
    //
    // ★★ WHAT IT PINS, so it is not read as type-safety theatre: only that the
    // function DISPATCHES on its argument. The cast is the vehicle -- the
    // types already forbid this call, and this is the same undefined-through-
    // a-cast shape `helpAction`'s equivalent test above exercises.
    expect(fileAction("bogus" as unknown as Parameters<typeof fileAction>[0])).toBeUndefined();
  });
});

describe("DASHBOARD_VIEW_HASH", () => {
  it("builds a dashboard-navigation script from the shared hash helper", () => {
    const script = helpHashScript(DASHBOARD_VIEW_HASH);
    // Clearing first guarantees a hashchange even when the fragment already
    // matches, so a relaunch while already on the Dashboard is not a no-op.
    expect(script).toContain('window.location.hash = "";');
    expect(script).toContain(JSON.stringify(DASHBOARD_VIEW_HASH));
  });

  it("points DASHBOARD_VIEW_HASH at the dashboard view", () => {
    expect(DASHBOARD_VIEW_HASH).toBe("#dashboard");
  });
});

