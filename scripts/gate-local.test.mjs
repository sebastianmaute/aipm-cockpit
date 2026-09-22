// @vitest-environment node
//
// The suite's global environment is jsdom (vitest.config.ts); jsdom's URL
// implementation does not resolve/accept a file: URL the way node:fs expects,
// so `readFileSync(new URL(...))` below throws "The URL must be of scheme
// file" under the default environment. scripts/check-followup-gitlab.integration.test.mjs
// and scripts/publish-release.integration.test.mjs carry the same pragma; their
// headers do not record why.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  GATE_STEPS, runGates, VITEST_WORKERS, resolveWorkers,
  checkDirtyTree, formatStartLine, formatFinalLine, buildSpawnInvocation,
} from "./gate-local.mjs";

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

  it("caps vitest workers on both vitest steps with a positive integer", () => {
    const vitestSteps = GATE_STEPS.filter((s) => s[2] === "test:coverage" || s[2] === "test:shuffle");
    expect(vitestSteps).toHaveLength(2);
    for (const s of vitestSteps) expect(s.slice(3)).toEqual(["--", `--maxWorkers=${VITEST_WORKERS}`]);
    expect(Number.isInteger(VITEST_WORKERS) && VITEST_WORKERS >= 1).toBe(true);
  });

  it("carries no whitespace inside any single argv element", () => {
    // buildSpawnInvocation joins a whole step into ONE string with argv.join(" ") on win32 — an
    // element that itself contained a space or shell metacharacter would need quoting the join
    // does not provide.
    for (const step of GATE_STEPS) {
      for (const part of step) expect(part).not.toMatch(/[\s"'`|&;<>]/);
    }
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
