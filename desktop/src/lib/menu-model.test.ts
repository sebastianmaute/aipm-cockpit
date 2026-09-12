// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELEASES_URL } from "./constants";
import {
  FILE_MENU_ITEMS,
  HELP_MENU_ITEMS,
  HELP_VIEW_HASH,
  type HelpMenuAction,
  type HelpMenuItemId,
  VERSION_DIALOG_BUTTONS,
  VERSION_DIALOG_CANCEL_ID,
  VERSION_DIALOG_DEFAULT_ID,
  fileAction,
  formatVersionDetail,
  helpAction,
  helpHashScript,
  isPrintCancellation,
  versionDialogAction,
  versionDialogOptions,
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
    // a case for both actions. It just shows the version dialog when you ask
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

describe("formatVersionDetail", () => {
  it("names the version, where the log lives, and where new versions live", () => {
    const text = formatVersionDetail(
      "0.301.0",
      "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs\\launch.log",
      RELEASES_URL,
    );
    expect(text).toContain("AI PM Cockpit");
    expect(text).toContain("0.301.0");
    expect(text).toContain("launch.log");
    // ★ The log path is NOT decoration: the rollout note tells a user to send
    // that file when reporting a problem, and this dialog is the only place
    // the app says where it is. Keep all three.
    expect(text).toContain(RELEASES_URL);
  });

  it("says updates are manual, so nobody waits for a prompt that never comes", () => {
    // There is no auto-updater (no feed host; the GitLab project is internal
    // and serves nothing unauthenticated). A user who assumes the app updates
    // itself simply runs an old build forever. The dialog has to say so.
    const text = formatVersionDetail("0.301.0", "x", RELEASES_URL);
    expect(text).toMatch(/manual/i);
  });

  it("interpolates the URL it is handed rather than hardcoding one", () => {
    // THIS TEST IS THE REASON the URL is a parameter at all: a hardcoded copy
    // would pass the assertion above while drifting from constants.ts the
    // moment the project moves. (Not import hygiene -- constants.ts imports
    // nothing and touches no Electron API.)
    const text = formatVersionDetail("0.301.0", "x", "https://example.invalid/releases");
    expect(text).toContain("https://example.invalid/releases");
    expect(text).not.toContain(RELEASES_URL);
  });

  it("does not invent a codename it was not given", () => {
    // src/app/version.ts carries APP_MILESTONE, but the main process has no
    // access to it -- desktop/package.json holds the version alone. Printing a
    // stale or guessed codename beside a correct version is the exact defect
    // APP_VERSION_LABEL already shipped once, so this says nothing rather than
    // something plausible.
    expect(formatVersionDetail("0.301.0", "x", RELEASES_URL)).not.toMatch(/"[A-Z][a-z]+"/);
  });
});

describe("VERSION_DIALOG_BUTTONS", () => {
  it("offers OK first and the releases button second", () => {
    // ORDER IS THE CONTRACT, not a preference: dialog.showMessageBox hands
    // back an INDEX into this array, so swapping these two rows silently
    // changes what every response number means.
    expect(VERSION_DIALOG_BUTTONS.map((b) => b.label)).toEqual(["OK", "Open releases page"]);
  });

  it("pins each row's action value, positionally", () => {
    // What makes a label unable to arrive WITHOUT an action is the
    // VersionDialogButton interface, at compile time -- not this assertion.
    // What this pins is which action each INDEX carries, which no type can.
    expect(VERSION_DIALOG_BUTTONS.map((b) => b.action)).toEqual(["dismiss", "open-releases"]);
  });
});

describe("versionDialogAction", () => {
  it("reads the response index through the button table", () => {
    expect(versionDialogAction(0)).toBe("dismiss");
    expect(versionDialogAction(1)).toBe("open-releases");
  });

  it("sends the releases button down the SAME action as the menu item", () => {
    // ★★ This is the "do not duplicate the shell.openExternal call site"
    // requirement written as an assertion. main.ts switches on these strings,
    // so as long as they are equal both routes land on its one
    // openReleasesPage() helper. Change one and not the other and the dialog
    // button quietly falls through to main.ts's log-and-degrade default --
    // an inert button, with nothing else red.
    expect(versionDialogAction(1)).toBe(helpAction("updates"));
  });

  it("makes Enter and Escape do the harmless thing", () => {
    // ★★★ THE ONE THAT MATTERS. Enter fires defaultId and Escape fires
    // cancelId, so if either pointed at the releases button, dismissing this
    // dialog the way every user dismisses a dialog would launch a browser.
    // Asserted as a PROPERTY of the two ids rather than as the number 0, so
    // it survives a deliberate reordering and still catches an accidental
    // one. Mutant: set either id to 1 -- this goes red and nothing else does.
    expect(versionDialogAction(VERSION_DIALOG_DEFAULT_ID)).toBe("dismiss");
    expect(versionDialogAction(VERSION_DIALOG_CANCEL_ID)).toBe("dismiss");
  });

  it("treats an index outside the table as a dismissal", () => {
    // ★★ NOT because "a window could close out from under the dialog" --
    // that was a false reason and this call is parentless anyway. The honest
    // two: neither tsconfig sets noUncheckedIndexedAccess, so
    // BUTTONS[response] is TYPED non-undefined while the number itself
    // arrives from another process; and a row added through a cast would
    // widen the array without widening the union. Either way the safe
    // direction is to do NOTHING -- the unsafe one opens a browser the user
    // never asked for. Mutant: change the fallback to "open-releases".
    expect(versionDialogAction(99)).toBe("dismiss");
    expect(versionDialogAction(-1)).toBe("dismiss");
    expect(versionDialogAction(VERSION_DIALOG_BUTTONS.length)).toBe("dismiss");
  });
});

describe("versionDialogOptions", () => {
  const OPTS = versionDialogOptions({
    title: "Version",
    version: "0.301.0",
    logPath: "C:\\logs\\launch.log",
    releasesUrl: RELEASES_URL,
  });

  it("carries the message formatVersionDetail produces", () => {
    expect(OPTS.message).toBe(
      formatVersionDetail("0.301.0", "C:\\logs\\launch.log", RELEASES_URL),
    );
    expect(OPTS.title).toBe("Version");
    expect(OPTS.type).toBe("info");
  });

  it("hands Electron the button labels in table order", () => {
    // ★★ THE HALF THAT WAS UNPINNED UNTIL NOW. Asserting the table's labels
    // proved nothing about what the DIALOG receives -- main.ts built this
    // object itself, and main.ts is the one desktop file the blocking
    // typecheck skips and no unit test can reach. Building it here moves the
    // whole options object inside both.
    expect(OPTS.buttons).toEqual(VERSION_DIALOG_BUTTONS.map((b) => b.label));
  });

  it("points Enter and Escape at a button that only dismisses", () => {
    // ★★★ THE GUARANTEE, now end to end. Previously this was asserted about
    // the CONSTANTS while main.ts was free to pass `defaultId: 1` -- or to
    // omit both lines, which on Windows leaves Escape on index 0 but Enter
    // on Electron's own default -- with every test, lint and typecheck
    // green and Enter opening a browser.
    //
    // Mutants, all red here and nowhere else: `defaultId: 1` or
    // `cancelId: 1` inside versionDialogOptions; deleting either key from
    // the returned object (it is required on VersionDialogOptions, so that
    // one is also a compile error in the BLOCKING job); pointing either at
    // the releases row after a reorder.
    expect(versionDialogAction(OPTS.defaultId)).toBe("dismiss");
    expect(versionDialogAction(OPTS.cancelId)).toBe("dismiss");
    // And the same fact stated against the table, so a reader does not have
    // to trust versionDialogAction to see what is being claimed.
    expect(VERSION_DIALOG_BUTTONS[OPTS.defaultId].action).toBe("dismiss");
    expect(VERSION_DIALOG_BUTTONS[OPTS.cancelId].action).toBe("dismiss");
  });

  it("keeps noLink on, so neither button renders as a command link", () => {
    // Windows promotes any button it does not recognise as a stock button
    // into a large command link. "Open releases page" would then read as the
    // primary action rather than as OK's peer. Mutant: drop the key (a
    // compile error too -- it is required) or set it false.
    expect(OPTS.noLink).toBe(true);
  });

  it("returns a MUTABLE buttons array", () => {
    // ★★★ NOT a style point -- the installed electron 33.4.11 typings declare
    // `buttons?: string[]`, MUTABLE, so a `readonly string[]` cannot be
    // handed to showMessageBox. VersionDialogOptions mirrors that, which
    // means a readonly narrowing is now a compile error in menu-model.ts
    // (the BLOCKING typecheck); it used to fail only in the desktop build,
    // which is allow_failure on a merge request.
    //
    // ★ This test covers what the TYPE cannot: a hoisted shared array cast
    // to `string[]`, or an Object.freeze, both of which typecheck.
    expect(Array.isArray(OPTS.buttons)).toBe(true);
    expect(Object.isFrozen(OPTS.buttons)).toBe(false);
    const second = versionDialogOptions({
      title: "Version",
      version: "0.301.0",
      logPath: "x",
      releasesUrl: RELEASES_URL,
    });
    // A per-call array, so a caller that mutates what Electron handed it
    // cannot corrupt the next dialog.
    expect(second.buttons).not.toBe(OPTS.buttons);
    expect(second.buttons).toEqual(OPTS.buttons);
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
    // ★★★ WHAT THIS DOES NOT CATCH, corrected -- the earlier comment claimed
    // it "reds if an entry is added with no mapping", which is false: a second
    // FileMenuItemId member with no FILE_ACTIONS key is a COMPILE error (the
    // Record is keyed by the union), so this never gets to run. What is left
    // for it is the cast case -- a row widened past the union -- where the
    // lookup returns undefined.
    //
    // ★★★ AND A SURVIVING MUTANT, NAMED RATHER THAN HIDDEN: replacing
    // `return FILE_ACTIONS[id]` with `return "print-window"` passes every test
    // in this file. With a ONE-MEMBER union no runtime assertion can tell a
    // table lookup from a constant -- the two are observationally identical,
    // so it is an equivalent mutant today, not a test gap. It becomes
    // detectable the moment a second member exists, and at that point the
    // Record's compile-time exhaustiveness is what forces the mapping. The
    // alternative -- inventing a second File menu item so a mutant could die
    // -- would be test-driven feature creep, so it was not done.
    const actions = FILE_MENU_ITEMS.map((i) => fileAction(i.id));
    expect(actions.filter((a) => !!a)).toHaveLength(FILE_MENU_ITEMS.length);
    expect(new Set(actions).size).toBe(FILE_MENU_ITEMS.length);
  });
});

describe("isPrintCancellation", () => {
  it("recognises the cancellation string that exists in the Electron binary", () => {
    // ★★★ THE TITLE USED TO SAY "the string Chromium actually sends" and the
    // comment said "MEASURED, NOT ASSUMED". Neither was supportable by the
    // command attached to it. What IS measured:
    //   grep -aoih "print job cancel[a-z]*" \
    //     desktop/node_modules/electron/dist/electron.exe
    // returns one hit, `Print job canceled`. That proves the string is IN THE
    // BINARY -- not that it is the `failureReason` this callback receives on a
    // user cancellation. Nothing runnable here can prove that: the callback
    // needs a real Electron window. STILL UNVERIFIED, and the reason the
    // matcher below is deliberately loose.
    expect(isPrintCancellation("Print job canceled")).toBe(true);
  });

  it("matches the stem, so a reworded reason cannot become an error", () => {
    // ★★ This is the assertion that forbids a `=== "Print job canceled"`
    // mutant, and the argument for it is measured over the same binary:
    // `Printing is already in progress` and `No printers found` -- both
    // plausible from Electron's docs -- have ZERO occurrences, so the reason
    // vocabulary cannot be guessed and today's exact string is not a safe
    // thing to pin. Narrow in practice: no reason-shaped string in the binary
    // except the cancellation one contains "cancel".
    expect(isPrintCancellation("Print job cancelled")).toBe(true);
    expect(isPrintCancellation("cancelled by user")).toBe(true);
    expect(isPrintCancellation("CANCELED")).toBe(true);
  });

  it("does NOT swallow a real failure", () => {
    // The whole point of classifying rather than ignoring every failure: a
    // printer that is not there has to reach the log.
    // ★ `Invalid printer settings` IS in the binary (one hit). `No printers
    // found` is NOT -- it is an illustrative fixture, kept because the
    // matcher must reject unfamiliar wording too, not evidence of a real
    // reason string.
    expect(isPrintCancellation("Invalid printer settings")).toBe(false);
    expect(isPrintCancellation("No printers found")).toBe(false);
    expect(isPrintCancellation("")).toBe(false);
  });
});
