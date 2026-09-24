// @vitest-environment node
//
// The suite's global environment is jsdom (vitest.config.ts); jsdom's URL
// implementation does not resolve/accept a file: URL the way node:fs expects,
// so `readFileSync(new URL(...))` below throws "The URL must be of scheme
// file" under the default environment. scripts/check-followup-github.integration.test.mjs
// and scripts/publish-github-release.integration.test.mjs carry the same pragma; their
// headers do not record why.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  GATE_GROUPS, GATE_STEPS, runGates, VITEST_WORKERS, resolveWorkers, parseCliArgs, selectSteps,
  checkDirtyTree, formatStartLine, formatFinalLine, formatSummaryTable, buildSpawnInvocation,
} from "./gate-local.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const step = (name, extra = {}) => ({ group: "static", argv: [name], ...extra });

describe("runGates", () => {
  it("runs every step in order when all pass", () => {
    const seen = [];
    const r = runGates([step("a"), step("b"), step("c")], (argv) => (seen.push(argv[0]), 0));
    expect(seen).toEqual(["a", "b", "c"]);
    expect(r).toMatchObject({ ok: true, failed: null, code: 0 });
    expect(r.results.map((x) => x.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("stops at the first failure and returns its exit code", () => {
    const seen = [];
    const r = runGates([step("a"), step("b"), step("c")], (argv) => (seen.push(argv[0]), argv[0] === "b" ? 3 : 0));
    expect(seen).toEqual(["a", "b"]);
    expect(r).toMatchObject({ ok: false, failed: "b", code: 3 });
  });

  it("treats a step killed by a signal (null status) as a failure with code 1", () => {
    expect(runGates([step("a")], () => null)).toMatchObject({ ok: false, failed: "a", code: 1 });
  });

  it("with keepGoing runs every step, lists every failure, and exits 1", () => {
    const seen = [];
    const r = runGates([step("a"), step("b"), step("c"), step("d")],
      (argv) => (seen.push(argv[0]), argv[0] === "b" ? 3 : argv[0] === "d" ? 2 : 0), { keepGoing: true });
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(r).toMatchObject({ ok: false, failed: "b", code: 1 });
    expect(r.results.filter((x) => x.status === "fail").map((x) => [x.label, x.code])).toEqual([["b", 3], ["d", 2]]);
  });

  it("with keepGoing and no failure exits 0", () => {
    expect(runGates([step("a"), step("b")], () => 0, { keepGoing: true })).toMatchObject({ ok: true, code: 0 });
  });

  it("skips a step whose required env var is unset outside CI, visibly and without running it", () => {
    const seen = [];
    const lines = [];
    const r = runGates([step("a"), step("leaks", { requiresEnv: "LEAK_LIST_FILE" })],
      (argv) => (seen.push(argv[0]), 0), { env: {}, log: (l) => lines.push(l) });
    expect(seen).toEqual(["a"]);
    expect(r).toMatchObject({ ok: true, code: 0 });
    expect(r.results[1]).toEqual({ label: "leaks", status: "skipped", code: 0, note: "LEAK_LIST_FILE unset" });
    expect(lines).toContain("SKIPPED leaks (LEAK_LIST_FILE unset)");
  });

  it("treats a blank or whitespace-only required env var as unset", () => {
    for (const v of ["", "   "]) {
      const r = runGates([step("leaks", { requiresEnv: "LEAK_LIST_FILE" })], () => 0, { env: { LEAK_LIST_FILE: v } });
      expect(r.results[0].status).toBe("skipped");
    }
  });

  it("under CI, an unset required env var FAILS with code 2 instead of skipping", () => {
    const seen = [];
    const r = runGates([step("leaks", { requiresEnv: "LEAK_LIST_FILE" }), step("b")],
      (argv) => (seen.push(argv[0]), 0), { env: { CI: "true" }, keepGoing: true });
    expect(seen).toEqual(["b"]);
    expect(r).toMatchObject({ ok: false, failed: "leaks", code: 1 });
    expect(r.results[0]).toEqual({ label: "leaks", status: "fail", code: 2, note: "LEAK_LIST_FILE unset under CI" });
  });

  it("runs a step whose required env var is set", () => {
    const seen = [];
    runGates([step("leaks", { requiresEnv: "LEAK_LIST_FILE" })], (argv) => (seen.push(argv[0]), 0),
      { env: { LEAK_LIST_FILE: "/tmp/x" } });
    expect(seen).toEqual(["leaks"]);
  });
});

describe("GATE_STEPS", () => {
  it("every npm step names a real script", () => {
    const missing = GATE_STEPS.filter((s) => s.argv[0] === "npm").map((s) => s.argv[2]).filter((n) => !(n in pkg.scripts));
    expect(missing).toEqual([]);
  });

  it("typechecks and builds, first lint and last build", () => {
    expect(GATE_STEPS[0].argv).toEqual(["npm", "run", "lint"]);
    expect(GATE_STEPS.map((s) => s.argv)).toContainEqual(["npx", "tsc", "--noEmit"]);
    expect(GATE_STEPS.at(-1).argv).toEqual(["npm", "run", "build"]);
  });

  it("keeps the pre-existing steps in their pre-existing order", () => {
    expect(GATE_STEPS.filter((s) => !s.requiresEnv).map((s) => s.argv.slice(0, 3).join(" "))).toEqual([
      "npm run lint", "npx tsc --noEmit", "npm run desktop:typecheck", "npm run test:coverage", "npm run test:shuffle", "npm run dup:check",
      "npm run size:check", "npm run docs:symbols:check", "npm run docs:claims:check", "npm run docs:scripts:check",
      "npm run followups:status:check", "npm run followups:index:check", "npm run followups:workitems:check",
      "npm run version:check", "npm run build",
    ]);
  });

  it("puts every step in exactly one known group, and every group has a step", () => {
    for (const s of GATE_STEPS) expect(GATE_GROUPS).toContain(s.group);
    for (const g of GATE_GROUPS) expect(GATE_STEPS.some((s) => s.group === g)).toBe(true);
  });

  it("groups the steps by the CI job that owns them", () => {
    const byGroup = (g) => GATE_STEPS.filter((s) => s.group === g).map((s) => s.argv[2]);
    expect(byGroup("unit")).toEqual(["test:coverage"]);
    expect(byGroup("unit-shuffled")).toEqual(["test:shuffle"]);
    expect(byGroup("build")).toEqual(["build"]);
    expect(byGroup("static")).toContain("leaks:check");
  });

  it("gates leaks:check on LEAK_LIST_FILE, and nothing else on any env var", () => {
    expect(GATE_STEPS.filter((s) => s.requiresEnv).map((s) => [s.argv[2], s.requiresEnv]))
      .toEqual([["leaks:check", "LEAK_LIST_FILE"]]);
  });

  it("is wired as npm run gate:local with a description", () => {
    expect(pkg.scripts["gate:local"]).toBe("node scripts/gate-local.mjs");
    expect(pkg.scriptsDescriptions["gate:local"]).toBeTruthy();
  });

  it("caps vitest workers on both vitest steps with a positive integer", () => {
    const vitestSteps = GATE_STEPS.filter((s) => s.argv[2] === "test:coverage" || s.argv[2] === "test:shuffle");
    expect(vitestSteps).toHaveLength(2);
    for (const s of vitestSteps) expect(s.argv.slice(3)).toEqual(["--", `--maxWorkers=${VITEST_WORKERS}`]);
    expect(Number.isInteger(VITEST_WORKERS) && VITEST_WORKERS >= 1).toBe(true);
  });

  it("carries no whitespace inside any single argv element", () => {
    // buildSpawnInvocation joins a whole step into ONE string with argv.join(" ") on win32 — an
    // element that itself contained a space or shell metacharacter would need quoting the join
    // does not provide.
    for (const s of GATE_STEPS) {
      for (const part of s.argv) expect(part).not.toMatch(/[\s"'`|&;<>]/);
    }
  });
});

describe("parseCliArgs", () => {
  it("defaults to every group, stop at first failure, clean tree required", () => {
    expect(parseCliArgs([])).toEqual({ group: null, keepGoing: false, allowDirty: false, error: null });
  });

  it("reads --group, --keep-going and --allow-dirty", () => {
    expect(parseCliArgs(["--group", "static", "--keep-going", "--allow-dirty"]))
      .toEqual({ group: "static", keepGoing: true, allowDirty: true, error: null });
  });

  it("rejects an unknown group, and a --group with no value", () => {
    expect(parseCliArgs(["--group", "nope"]).error).toMatch(/unknown group "nope"/);
    expect(parseCliArgs(["--group"]).error).toMatch(/--group needs a value/);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(parseCliArgs(["--keepgoing"]).error).toMatch(/unknown argument "--keepgoing"/);
  });
});

describe("selectSteps", () => {
  it("returns every step for a null group", () => {
    expect(selectSteps(GATE_STEPS, null)).toBe(GATE_STEPS);
  });

  it("returns only the named group's steps, in order", () => {
    const s = selectSteps(GATE_STEPS, "static");
    expect(s.length).toBeGreaterThan(5);
    expect(s.every((x) => x.group === "static")).toBe(true);
    expect(s[0].argv).toEqual(["npm", "run", "lint"]);
  });
});

describe("formatSummaryTable", () => {
  it("renders one Markdown row per step with its result", () => {
    const table = formatSummaryTable([
      { label: "npm run lint", status: "pass", code: 0, note: null },
      { label: "npm run dup:check", status: "fail", code: 1, note: null },
      { label: "npm run leaks:check", status: "skipped", code: 0, note: "LEAK_LIST_FILE unset" },
    ]);
    expect(table.split("\n")).toEqual([
      "| Step | Result |",
      "|---|---|",
      "| `npm run lint` | PASS |",
      "| `npm run dup:check` | FAIL (exit 1) |",
      "| `npm run leaks:check` | SKIPPED (LEAK_LIST_FILE unset) |",
    ]);
  });

  it("carries a failing step's note, so an unset env under CI reads apart from the gate's own exit 2", () => {
    const table = formatSummaryTable([
      { label: "npm run leaks:check", status: "fail", code: 2, note: "LEAK_LIST_FILE unset under CI" },
      { label: "npm run followups:index:check", status: "fail", code: 2, note: null },
    ]);
    expect(table.split("\n").slice(2)).toEqual([
      "| `npm run leaks:check` | FAIL (exit 2; LEAK_LIST_FILE unset under CI) |",
      "| `npm run followups:index:check` | FAIL (exit 2) |",
    ]);
  });
});

describe("resolveWorkers", () => {
  it("defaults to half the logical CPUs, never below 1", () => {
    expect(resolveWorkers({}, 20)).toBe(10);
    expect(resolveWorkers({}, 7)).toBe(3);
    expect(resolveWorkers({}, 1)).toBe(1);
  });

  it("takes GATE_LOCAL_WORKERS when it is a positive integer", () => {
    expect(resolveWorkers({ GATE_LOCAL_WORKERS: "2" }, 20)).toBe(2);
    expect(resolveWorkers({ GATE_LOCAL_WORKERS: "16" }, 2)).toBe(16);
  });

  it("ignores a blank GATE_LOCAL_WORKERS", () => {
    expect(resolveWorkers({ GATE_LOCAL_WORKERS: "" }, 20)).toBe(10);
  });

  it("refuses any other GATE_LOCAL_WORKERS value rather than guessing", () => {
    for (const bad of ["0", "-1", "2.5", "abc", "4x", " 4"]) {
      expect(() => resolveWorkers({ GATE_LOCAL_WORKERS: bad }, 20)).toThrow(/GATE_LOCAL_WORKERS/);
    }
  });

  it("is what VITEST_WORKERS was built from, with this process's environment", async () => {
    vi.stubEnv("GATE_LOCAL_WORKERS", "3");
    try {
      vi.resetModules();
      const fresh = await import("./gate-local.mjs");
      expect(fresh.VITEST_WORKERS).toBe(3);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("checkDirtyTree", () => {
  it("blocks when the porcelain output is non-empty and --allow-dirty is absent", () => {
    const r = checkDirtyTree(" M src/app/foo.ts\n", []);
    expect(r.blocked).toBe(true);
    expect(r.message).toMatch(/uncommitted/i);
    expect(r.message).toMatch(/--allow-dirty/);
  });

  it("does not block an empty porcelain output", () => {
    expect(checkDirtyTree("", [])).toEqual({ blocked: false, message: null });
  });

  it("does not block a whitespace-only porcelain output", () => {
    expect(checkDirtyTree("\n  \n", [])).toEqual({ blocked: false, message: null });
  });

  it("does not block a dirty tree when --allow-dirty is passed", () => {
    expect(checkDirtyTree(" M src/app/foo.ts\n", ["--allow-dirty"])).toEqual({ blocked: false, message: null });
  });
});

describe("formatStartLine", () => {
  it("names the commit being gated", () => {
    expect(formatStartLine("abc1234")).toMatch(/abc1234/);
  });
});

describe("formatFinalLine", () => {
  it("reports PASS with the gated commit sha", () => {
    expect(formatFinalLine({ ok: true, failed: null, code: 0 }, "abc1234")).toBe("gate:local PASS at abc1234");
  });

  it("reports FAIL with the failing step, its exit code, and the gated sha", () => {
    expect(formatFinalLine({ ok: false, failed: "npm run lint", code: 1 }, "abc1234"))
      .toBe("gate:local FAIL at: npm run lint (exit 1) — abc1234");
  });
});

describe("buildSpawnInvocation", () => {
  it("joins the whole argv into one command string under a shell on win32 (DEP0190)", () => {
    expect(buildSpawnInvocation(["npm", "run", "lint"], "win32"))
      .toEqual({ command: "npm run lint", args: [], shell: true });
  });

  it("keeps the argv array with no shell on non-win32", () => {
    expect(buildSpawnInvocation(["npm", "run", "lint"], "linux"))
      .toEqual({ command: "npm", args: ["run", "lint"], shell: false });
  });
});
