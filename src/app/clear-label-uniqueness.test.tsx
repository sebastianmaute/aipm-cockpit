import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// axe reports a MISSING accessible name and is BLIND to a duplicate one. Slice
// C shipped two buttons both announcing "Clear" on one scanned view through a
// full 5/5 axe pass, so the only thing that can catch the next one is a test.
//
// ★ A SOURCE scan, deliberately. Rendering every panel with enough props to
//   surface all its clears is a large fixture per view, and the failure mode is
//   a label that is not qualified AT ALL — visible in the source. The per-panel
//   render tests assert the runtime name of each individual button.
const BARE = /clearLabel=\{t\(lang,\s*"clear"\)\}/;

function callSites(): string[] {
  return readdirSync(__dirname)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    // The primitive DEFINES the prop; it does not pass one.
    .filter((f) => f !== "clearable-search-input.tsx")
    .filter((f) => readFileSync(join(__dirname, f), "utf8").includes("clearLabel"));
}

describe("clear-button labels", () => {
  it("are never the bare `clear` key — every one is qualified", () => {
    const offenders = callSites().filter((f) => BARE.test(readFileSync(join(__dirname, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("finds every call site by scanning the directory, so a new one cannot slip past", () => {
    // Discovery, not a hand-maintained list: a hardcoded array goes stale the
    // first time someone adds a clear without reading this file.
    const found = callSites();
    expect(found.length).toBeGreaterThanOrEqual(15);
    // The three SHARED controls, each covering several panels — if one of these
    // stops appearing, a whole family of fields lost its clear.
    expect(found).toContain("pane-toolbar.tsx");
    expect(found).toContain("entity-link-picker.tsx");
    expect(found).toContain("report-table.tsx");
  });
});
