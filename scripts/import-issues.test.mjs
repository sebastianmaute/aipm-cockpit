// @vitest-environment node
//
// The CLI spawns node against a throwaway git repository in the OS temp dir, so it needs
// node's fs/child_process rather than jsdom (see check-commit-message-leaks.test.mjs's header
// for the same shape). Every register, GitLab issue and leak-list fixture here is synthetic —
// the register text mirrors issue-import-lib.test.mjs's REG, and the leak word/class are
// fictional stand-ins. Never the real leak list, never `glab`, never the network: every case
// passes --gitlab-json.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./import-issues.mjs", import.meta.url));
const SECRET = "zorblax-secret-token";
const CLASS = "synthetic-class";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

// Same shape as issue-import-lib.test.mjs's REG: §3 open, §4 closed. GitLab numbers below are
// deliberately NOT equal to the § numbers they name (GitLab #4 -> §3, GitLab #2 -> §9), so the
// counts/pointer assertions cannot pass by a GitLab-number/§-number coincidence.
const REG_BASE = [
  "# Open follow-ups",
  "",
  "<!-- INDEX:BEGIN -->",
  "| [§3](#3-three--open) | three — open | x | S | open |",
  "| [§4](#4-four--closed-2026-09-01) | four — CLOSED 2026-09-01 | x | S | closed |",
  "<!-- INDEX:END -->",
  "",
  "## 3. Three — open",
  "",
  "**Status:** open 2026-09-20 — measured once.",
  "",
  "**Work item:** #3",
  "",
  "First paragraph of three.",
  "",
  "Second paragraph.",
  "",
  "## 4. Four — CLOSED 2026-09-01",
  "",
  "**Status:** CLOSED 2026-09-01.",
  "",
].join("\n");

function withLeak(word) {
  return REG_BASE.replace("First paragraph of three.", `First paragraph of three ${word}.`);
}

let dir;

function seedRepo(registerText) {
  dir = mkdtempSync(path.join(tmpdir(), "import-issues-"));
  mkdirSync(path.join(dir, "docs"));
  writeFileSync(path.join(dir, "docs", "open-followups.md"), registerText);
  const env = { ...process.env, ...GIT_ENV };
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "add", "docs/open-followups.md"], { cwd: dir, env });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "chore: seed register"], { cwd: dir, env });
  return dir;
}

function writeJson(name, value) {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

function writeLeakList(text) {
  const p = path.join(dir, "leak-list.txt");
  writeFileSync(p, text);
  return p;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function run(args, env = {}) {
  const childEnv = { ...process.env, ...env };
  if (!("LEAK_LIST_FILE" in env)) delete childEnv.LEAK_LIST_FILE;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: childEnv, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

describe("import-issues --plan", () => {
  it("plans a clean import: exit 0, correct counts/maxNumber/leak/registerSha and the summary line", () => {
    seedRepo(REG_BASE);
    const gitlabJson = writeJson("gitlab.json", [
      { iid: 4, state: "opened", title: "§3: old gitlab title", labels: ["source::register"] },
      { iid: 2, state: "closed", title: "§9: closed thing", labels: [] },
    ]);
    const leakList = writeLeakList(`# fictional\n@${CLASS} ${SECRET}\n`);
    const outPath = path.join(dir, "plan.json");

    const r = run(
      ["--plan", "--out", outPath, "--repo", "o/r", "--pointer", "anchor", "--gitlab-json", gitlabJson],
      { LEAK_LIST_FILE: leakList },
    );

    expect(r.code, r.all).toBe(0);
    expect(r.out).toContain("open 1 · stub 1 · placeholder 2 · total 4");

    const plan = JSON.parse(readFileSync(outPath, "utf8"));
    expect(plan.counts).toEqual({ open: 1, stub: 1, placeholder: 2 });
    expect(plan.maxNumber).toBe(4);
    expect(plan.leak).toEqual({ hitLines: 0, classes: {}, actionsHit: [] });
    expect(plan.registerSha).toMatch(/^[0-9a-f]{40}$/);
    expect(plan.version).toBe(1);
    expect(plan.pointerStyle).toBe("anchor");
    expect(plan.repoUrl).toBe("https://github.com/o/r");
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plan.actions).toHaveLength(4);
  });

  it("refuses to write a plan that leaks an identifier: exit 1, names the action and class, never the word", () => {
    seedRepo(withLeak(SECRET));
    const gitlabJson = writeJson("gitlab.json", [
      { iid: 3, state: "opened", title: "§3: old gitlab title", labels: [] },
    ]);
    const leakList = writeLeakList(`# fictional\n@${CLASS} ${SECRET}\n`);
    const outPath = path.join(dir, "plan.json");

    const r = run(
      ["--plan", "--out", outPath, "--repo", "o/r", "--pointer", "anchor", "--gitlab-json", gitlabJson],
      { LEAK_LIST_FILE: leakList },
    );

    expect(r.code, r.all).toBe(1);
    expect(r.out).toContain("#3");
    expect(r.out).toContain(CLASS);
    expect(r.all.toLowerCase()).not.toContain(SECRET.toLowerCase());
    expect(existsSync(outPath)).toBe(false);
  });

  it("exits 2 when LEAK_LIST_FILE is unset", () => {
    seedRepo(REG_BASE);
    const gitlabJson = writeJson("gitlab.json", [
      { iid: 3, state: "opened", title: "§3: old gitlab title", labels: [] },
    ]);
    const outPath = path.join(dir, "plan.json");

    const r = run(["--plan", "--out", outPath, "--repo", "o/r", "--pointer", "anchor", "--gitlab-json", gitlabJson], {});

    expect(r.code, r.all).toBe(2);
    expect(r.err).toMatch(/CANNOT RUN/);
    expect(existsSync(outPath)).toBe(false);
  });

  it("exits 2 on an unknown flag", () => {
    seedRepo(REG_BASE);
    const leakList = writeLeakList(`# fictional\n@${CLASS} ${SECRET}\n`);

    const r = run(["--plan", "--bogus"], { LEAK_LIST_FILE: leakList });

    expect(r.code, r.all).toBe(2);
    expect(r.err).toMatch(/CANNOT RUN/);
  });

});

describe("import-issues --apply guards (no network — pass GH_TOKEN=dummy so gh is never called)", () => {
  const validPlanBase = {
    version: 1,
    createdAt: "2026-09-23",
    maxNumber: 1,
    pointerStyle: "anchor",
    repoUrl: "https://github.com/o/r",
    counts: { open: 0, stub: 0, placeholder: 1 },
    actions: [{ n: 1, kind: "placeholder", title: "placeholder (deleted after import)", body: "", labels: [] }],
  };

  it("refuses (exit 1) a plan that leaks an identifier, before any client is built or glab/gh is called", () => {
    seedRepo(REG_BASE);
    const planPath = writeJson("plan.json", {
      ...validPlanBase,
      registerSha: "0".repeat(40), // deliberately wrong too — the leak check must still win, since it runs first
      leak: { hitLines: 1, classes: { [CLASS]: 1 }, actionsHit: [1] },
    });

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], { GH_TOKEN: "dummy" });

    expect(r.code, r.all).toBe(1);
    expect(r.err.toLowerCase()).toContain("leak");
  });

  it("refuses (exit 1) a plan whose registerSha no longer matches the register, before any client is built", () => {
    seedRepo(REG_BASE);
    const planPath = writeJson("plan.json", {
      ...validPlanBase,
      registerSha: "0".repeat(40),
      leak: { hitLines: 0, classes: {}, actionsHit: [] },
    });

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], { GH_TOKEN: "dummy" });

    expect(r.code, r.all).toBe(1);
    expect(r.err.toLowerCase()).toContain("register");
  });

  it("exits 2 when --resume is given without --apply", () => {
    seedRepo(REG_BASE);
    const planPath = writeJson("plan.json", { ...validPlanBase, registerSha: "0".repeat(40), leak: { hitLines: 0, classes: {}, actionsHit: [] } });

    const r = run(["--close-gitlab", "--plan", planPath, "--repo", "o/r", "--resume"], { GH_TOKEN: "dummy" });

    expect(r.code, r.all).toBe(2);
    expect(r.err).toMatch(/CANNOT RUN/);
    expect(r.err).toMatch(/--resume/);
  });
});

describe("import-issues --plan (more)", () => {
  it("exits 2 when an open GitLab issue names a register entry that is not OPEN, with the planner's message", () => {
    seedRepo(REG_BASE);
    const gitlabJson = writeJson("gitlab.json", [{ iid: 4, state: "opened", title: "§4: x", labels: [] }]);
    const leakList = writeLeakList(`# fictional\n@${CLASS} ${SECRET}\n`);
    const outPath = path.join(dir, "plan.json");

    const r = run(
      ["--plan", "--out", outPath, "--repo", "o/r", "--pointer", "anchor", "--gitlab-json", gitlabJson],
      { LEAK_LIST_FILE: leakList },
    );

    expect(r.code, r.all).toBe(2);
    expect(r.err).toContain("#4");
    expect(r.err).toContain("§4");
    expect(existsSync(outPath)).toBe(false);
  });
});
