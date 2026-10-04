import { describe, expect, it } from "vitest";
import { evaluateChangelog, isAppCode, OPT_OUT_LABEL, runChangelogCheck } from "./changelog-check-lib.mjs";

/** A fake git: merge-base → "base", diff → the given files. */
function fakeGit(files) {
  return (args) => {
    if (args[0] === "merge-base") return "base\n";
    if (args[0] === "diff") return files.join("\n") + "\n";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}
const PR_ENV = { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "ev.json", GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t" };
const readEvent = () => ({ pull_request: { number: 7 } });

describe("runChangelogCheck", () => {
  it("passes without asking for labels when the change carries an entry", async () => {
    const fetchLabels = async () => { throw new Error("must not be called"); };
    const r = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx", "CHANGELOG.md"]), fetchLabels, readEvent, env: PR_ENV });
    expect(r.code).toBe(0);
  });

  it("fails with exit 1 outside a pull request, naming the file and the opt-outs", async () => {
    const r = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx"]), fetchLabels: async () => [], readEvent, env: {} });
    expect(r.code).toBe(1);
    expect(r.message).toContain("src/app/a.tsx");
    expect(r.message).toContain(OPT_OUT_LABEL);
    expect(r.message).toContain("CHANGELOG_OPT_OUT=1");
  });

  it("honours CHANGELOG_OPT_OUT=1 locally", async () => {
    const r = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx"]), fetchLabels: async () => [], readEvent, env: { CHANGELOG_OPT_OUT: "1" } });
    expect(r.code).toBe(0);
  });

  it("reads the label live on a pull request, for the right PR", async () => {
    const asked = [];
    const fetchLabels = async (q) => { asked.push(q); return ["bug", OPT_OUT_LABEL]; };
    const r = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx"]), fetchLabels, readEvent, env: PR_ENV });
    expect(r.code).toBe(0);
    expect(asked).toEqual([{ repo: "o/r", number: 7, token: "t" }]);
  });

  it("still fails on a pull request without the label", async () => {
    const r = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx"]), fetchLabels: async () => ["bug"], readEvent, env: PR_ENV });
    expect(r.code).toBe(1);
  });

  it("exits 2 rather than passing when the labels cannot be read", async () => {
    const fetchLabels = async () => { throw new Error("GitHub API 403"); };
    const r = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx"]), fetchLabels, readEvent, env: PR_ENV });
    expect(r.code).toBe(2);
    const noToken = await runChangelogCheck({ git: fakeGit(["src/app/a.tsx"]), fetchLabels: async () => [OPT_OUT_LABEL], readEvent, env: { ...PR_ENV, GH_TOKEN: "" } });
    expect(noToken.code).toBe(2);
  });

  it("exits 2 when git cannot find the base", async () => {
    const git = () => { throw new Error("fatal: Not a valid object name origin/main"); };
    const r = await runChangelogCheck({ git, fetchLabels: async () => [], readEvent, env: {} });
    expect(r.code).toBe(2);
  });
});

describe("isAppCode", () => {
  it("counts app source under src/ and desktop/src/", () => {
    for (const p of ["src/app/task-manager.tsx", "src/app/globals.css", "src/proxy.ts", "desktop/src/main.ts"]) {
      expect(isAppCode(p), p).toBe(true);
    }
  });

  it("does not count tests, test helpers, fixtures, prose or anything outside the app roots", () => {
    for (const p of [
      "src/app/task-manager.test.tsx",
      "src/app/gantt.property.test.ts",
      "src/app/foo.spec.ts",
      "src/test/toolbar-order.ts",
      "src/app/__fixtures__/golden-tasks.csv",
      "src/app/README.md",
      "scripts/gate-local.mjs",
      "docs/AGENTS/ci.md",
      "package.json",
      "e2e/a11y.spec.ts",
      "desktop/package.json",
    ]) {
      expect(isAppCode(p), p).toBe(false);
    }
  });

  it("accepts Windows separators", () => {
    expect(isAppCode("src\\app\\gantt.tsx")).toBe(true);
  });
});

describe("evaluateChangelog", () => {
  it("passes when no app code changed", () => {
    expect(evaluateChangelog({ files: ["docs/x.md", "src/app/a.test.ts"], optedOut: false }).ok).toBe(true);
  });

  it("fails when app code changed without CHANGELOG.md, and names the files", () => {
    const r = evaluateChangelog({ files: ["src/app/a.tsx", "docs/x.md"], optedOut: false });
    expect(r.ok).toBe(false);
    expect(r.appFiles).toEqual(["src/app/a.tsx"]);
  });

  it("passes when CHANGELOG.md is part of the change", () => {
    expect(evaluateChangelog({ files: ["src/app/a.tsx", "CHANGELOG.md"], optedOut: false }).ok).toBe(true);
  });

  it("passes on the opt-out label", () => {
    const r = evaluateChangelog({ files: ["src/app/a.tsx"], optedOut: true });
    expect(r.ok).toBe(true);
    expect(r.reason).toContain(OPT_OUT_LABEL);
  });

  it("does not take a CHANGELOG.md in a sub-folder as the entry", () => {
    expect(evaluateChangelog({ files: ["src/app/a.tsx", "desktop/CHANGELOG.md"], optedOut: false }).ok).toBe(false);
  });
});
