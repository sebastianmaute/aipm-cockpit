// @vitest-environment node
//
// The suite's global environment is jsdom (vitest.config.ts); jsdom's URL
// implementation does not resolve/accept a file: URL the way node:fs expects,
// so `readFileSync(new URL(...))` below throws "The URL must be of scheme
// file" under the default environment. scripts/check-followup-gitlab.integration.test.mjs
// and scripts/publish-release.integration.test.mjs carry the same pragma for
// the same reason.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_STEPS, runGates } from "./gate-local.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("runGates", () => {
  it("runs every step in order when all pass", () => {
    const seen = [];
    const r = runGates([["a"], ["b"], ["c"]], (argv) => (seen.push(argv[0]), 0));
    expect(seen).toEqual(["a", "b", "c"]);
    expect(r).toEqual({ ok: true, failed: null, code: 0 });
  });

  it("stops at the first failure and returns its exit code", () => {
    const seen = [];
    const r = runGates([["a"], ["b"], ["c"]], (argv) => (seen.push(argv[0]), argv[0] === "b" ? 3 : 0));
    expect(seen).toEqual(["a", "b"]);
    expect(r).toEqual({ ok: false, failed: "b", code: 3 });
  });

  it("treats a step killed by a signal (null status) as a failure with code 1", () => {
    expect(runGates([["a"]], () => null)).toEqual({ ok: false, failed: "a", code: 1 });
  });
});

describe("GATE_STEPS", () => {
  it("every npm step names a real script", () => {
    const missing = GATE_STEPS.filter((s) => s[0] === "npm").map((s) => s[2]).filter((n) => !(n in pkg.scripts));
    expect(missing).toEqual([]);
  });

  it("typechecks and builds, first lint and last build", () => {
    expect(GATE_STEPS[0]).toEqual(["npm", "run", "lint"]);
    expect(GATE_STEPS).toContainEqual(["npx", "tsc", "--noEmit"]);
    expect(GATE_STEPS.at(-1)).toEqual(["npm", "run", "build"]);
  });

  it("is wired as npm run gate:local with a description", () => {
    expect(pkg.scripts["gate:local"]).toBe("node scripts/gate-local.mjs");
    expect(pkg.scriptsDescriptions["gate:local"]).toBeTruthy();
  });
});
