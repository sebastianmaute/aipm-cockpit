// @vitest-environment node
//
// The CLI spawns node against a throwaway git repository in the OS temp dir, so it needs
// node's fs/child_process rather than jsdom (see check-commit-message-leaks.test.mjs's header
// for the same shape). Every register, GitLab issue and leak-list fixture here is synthetic —
// the register text mirrors issue-import-lib.test.mjs's REG, and the leak word/class are
// fictional stand-ins. Never the real leak list, never `glab`, never the network: every case
// passes --gitlab-json.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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

// A stand-in `glab` a test can point the CLI at via IMPORT_ISSUES_TEST_FAKE_GLAB, so a guard
// test cannot silently pass by falling through to a real `glab`/network call — see
// import-issues.mjs's own comment on that env var for why a PATH-shadowed `.cmd`/`.bat`
// binary isn't used instead (it can't be exec'd without a shell on Windows).
const FAKE_GLAB_MARKER = "FAKE-GLAB-CALLED";

function writeFakeGlab() {
  const p = path.join(dir, "fake-glab.mjs");
  writeFileSync(p, `console.error(${JSON.stringify(FAKE_GLAB_MARKER)});\nprocess.exit(2);\n`);
  return p;
}

function currentRegisterSha() {
  return execFileSync("git", ["hash-object", "docs/open-followups.md"], { cwd: dir, encoding: "utf8" }).trim();
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const DEAD_GITHUB_API = "http://127.0.0.1:9";

function run(args, env = {}) {
  const childEnv = { ...process.env, ...env };
  if (!("LEAK_LIST_FILE" in env)) delete childEnv.LEAK_LIST_FILE;
  // `VITEST` is inherited from this worker process by default (vitest sets it to "true"),
  // which is what lets IMPORT_ISSUES_TEST_FAKE_GLAB work in the guard tests above. A test
  // that needs to simulate running OUTSIDE vitest passes `VITEST: null` to strip it.
  if (env.VITEST === null) delete childEnv.VITEST;
  // Every GitHub call a spawned CLI makes goes to a dead local port unless the test names a
  // fake server: a guard deleted by a mutant must fail here, never reach api.github.com.
  else if (!("IMPORT_ISSUES_TEST_GITHUB_API" in env)) childEnv.IMPORT_ISSUES_TEST_GITHUB_API = DEAD_GITHUB_API;
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
    const fakeGlab = writeFakeGlab();
    const planPath = writeJson("plan.json", {
      ...validPlanBase,
      registerSha: "0".repeat(40),
      leak: { hitLines: 0, classes: {}, actionsHit: [] },
    });

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_FAKE_GLAB: fakeGlab,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err.toLowerCase()).toContain("register");
    // Hardens the test against a mutation that deletes the registerSha guard: this
    // fixture's repoUrl matches --repo, so execution would otherwise fall through to the
    // maxNumber-vs-GitLab glab call. The fake glab's marker being absent proves that never
    // happened — under the real (unmutated) code the sha guard fires first.
    expect(r.all).not.toContain(FAKE_GLAB_MARKER);
  });

  it("refuses (exit 1) a plan whose repoUrl does not match --repo, before any client is built", () => {
    seedRepo(REG_BASE);
    const fakeGlab = writeFakeGlab();
    const planPath = writeJson("plan.json", {
      ...validPlanBase,
      registerSha: currentRegisterSha(),
      repoUrl: "https://github.com/o/other",
      leak: { hitLines: 0, classes: {}, actionsHit: [] },
    });

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_FAKE_GLAB: fakeGlab,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain("o/r");
    expect(r.err).toContain("o/other");
    expect(r.all).not.toContain(FAKE_GLAB_MARKER);
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

describe("import-issues --apply re-scans the plan's own actions for a leak", () => {
  const validPlanBase = {
    version: 1,
    createdAt: "2026-09-23",
    maxNumber: 1,
    pointerStyle: "anchor",
    repoUrl: "https://github.com/o/r",
    counts: { open: 0, stub: 0, placeholder: 1 },
    actions: [{ n: 1, kind: "placeholder", title: "placeholder (deleted after import)", body: "", labels: [] }],
  };

  it("exits 2 when LEAK_LIST_FILE is unset, after the recorded-leak/sha/repo guards pass", () => {
    seedRepo(REG_BASE);
    const planPath = writeJson("plan.json", {
      ...validPlanBase,
      registerSha: currentRegisterSha(),
      leak: { hitLines: 0, classes: {}, actionsHit: [] },
    });

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], { GH_TOKEN: "dummy" });

    expect(r.code, r.all).toBe(2);
    expect(r.err).toMatch(/CANNOT RUN/);
    expect(r.err).toMatch(/LEAK_LIST_FILE/);
  });

  it("refuses (exit 1) when a live re-scan finds a leak the plan's recorded leak.hitLines missed", () => {
    seedRepo(REG_BASE);
    const leakList = writeLeakList(`# fictional\n@${CLASS} ${SECRET}\n`);
    const planPath = writeJson("plan.json", {
      ...validPlanBase,
      registerSha: currentRegisterSha(),
      leak: { hitLines: 0, classes: {}, actionsHit: [] }, // stale: recorded as clean
      actions: [{ n: 1, kind: "open", title: `§3: ${SECRET} leaked`, body: "clean body", labels: [] }],
    });

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], { GH_TOKEN: "dummy", LEAK_LIST_FILE: leakList });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain("#1");
    expect(r.all.toLowerCase()).not.toContain(SECRET.toLowerCase());
  });
});

describe("import-issues --close-gitlab guards (no network — pass GH_TOKEN=dummy so gh is never called)", () => {
  it("refuses (exit 1) a plan whose repoUrl does not match --repo, before any glab call", () => {
    seedRepo(REG_BASE);
    const fakeGlab = writeFakeGlab();
    const planPath = writeJson("plan.json", {
      version: 1,
      createdAt: "2026-09-23",
      registerSha: "0".repeat(40),
      maxNumber: 2,
      pointerStyle: "anchor",
      repoUrl: "https://github.com/o/other",
      counts: { open: 1, stub: 0, placeholder: 0 },
      leak: { hitLines: 0, classes: {}, actionsHit: [] },
      // An "open" action so a guard-deletion mutation would actually reach `gitlab.get()`
      // (closeOnGitLab skips every non-"open" action), making the fake-glab check meaningful.
      actions: [{ n: 2, kind: "open", title: "§3: three", body: "b", labels: [] }],
    });

    const r = run(["--close-gitlab", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_FAKE_GLAB: fakeGlab,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain("o/r");
    expect(r.err).toContain("o/other");
    expect(r.all).not.toContain(FAKE_GLAB_MARKER);
  });
});

describe("import-issues refuses a plan whose version is not 1 (exit 1, before any glab call)", () => {
  const plan2 = () => ({
    version: 2,
    createdAt: "2026-09-24",
    registerSha: currentRegisterSha(),
    maxNumber: 2,
    pointerStyle: "anchor",
    repoUrl: "https://github.com/o/r",
    counts: { open: 1, stub: 0, placeholder: 1 },
    leak: { hitLines: 0, classes: {}, actionsHit: [] },
    actions: [
      { n: 1, kind: "placeholder", title: "placeholder (deleted after import)", body: "", labels: [] },
      { n: 2, kind: "open", title: "§3: three", body: "b", labels: [] },
    ],
  });

  it("--apply", () => {
    seedRepo(REG_BASE);
    const fakeGlab = writeFakeGlab();
    const leakList = writeLeakList(`# fictional\n@${CLASS} ${SECRET}\n`);
    const planPath = writeJson("plan.json", plan2());

    const r = run(["--apply", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      LEAK_LIST_FILE: leakList,
      IMPORT_ISSUES_TEST_FAKE_GLAB: fakeGlab,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(/REFUSED: the plan's version is 2; this tool reads version 1 only/);
    expect(r.all).not.toContain(FAKE_GLAB_MARKER);
  });

  it("--close-gitlab", () => {
    seedRepo(REG_BASE);
    const fakeGlab = writeFakeGlab();
    const planPath = writeJson("plan.json", plan2());

    const r = run(["--close-gitlab", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_FAKE_GLAB: fakeGlab,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(/REFUSED: the plan's version is 2/);
    expect(r.all).not.toContain(FAKE_GLAB_MARKER);
  });
});

// `--close-gitlab` against a local fake GitHub (IMPORT_ISSUES_TEST_GITHUB_API) and a scripted
// fake glab. The CLI must be spawned ASYNCHRONOUSLY here: spawnSync would block this worker's
// event loop, and the fake server lives in it.
function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err, all: out + err }));
  });
}

async function startFakeGitHub(issues) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url.startsWith("/repos/o/r/issues?")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(issues));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

// A scripted glab: answers the issue GET with `state`, the notes GETs from `notesPages`
// (page N -> notesPages[N-1], [] past the end), and records every call in calls.log. Any
// write (`-X POST`/`-X PUT`) is recorded as WRITE.
function writeScriptedGlab({ state, notesPages }) {
  const p = path.join(dir, "scripted-glab.mjs");
  const logPath = path.join(dir, "calls.log");
  writeFileSync(
    p,
    [
      'import { appendFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      `const notesPages = ${JSON.stringify(notesPages)};`,
      `appendFileSync(${JSON.stringify(logPath)}, (args.includes("-X") ? "WRITE " : "") + args.join(" ") + "\\n");`,
      'if (args.includes("-X")) { process.stdout.write("{}"); process.exit(0); }',
      "const url = args[1];",
      "const m = /notes\\?.*page=(\\d+)/.exec(url);",
      "if (m) { process.stdout.write(JSON.stringify(notesPages[Number(m[1]) - 1] ?? [])); process.exit(0); }",
      `process.stdout.write(JSON.stringify({ state: ${JSON.stringify(state)} }));`,
    ].join("\n"),
  );
  return { path: p, calls: () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "") };
}

describe("import-issues --close-gitlab checks the GitHub side before any GitLab write", () => {
  const closePlan = () => ({
    version: 1,
    createdAt: "2026-09-24",
    registerSha: "0".repeat(40),
    maxNumber: 2,
    pointerStyle: "anchor",
    repoUrl: "https://github.com/o/r",
    counts: { open: 1, stub: 0, placeholder: 1 },
    leak: { hitLines: 0, classes: {}, actionsHit: [] },
    actions: [
      { n: 1, kind: "placeholder", title: "placeholder (deleted after import)", body: "", labels: [] },
      { n: 2, kind: "open", title: "§3: three", body: "b", labels: [] },
    ],
  });
  const POINTER = "Moved to GitHub #2: https://github.com/o/r/issues/2";
  let gh;

  afterEach(async () => {
    if (gh) await gh.close();
    gh = undefined;
  });

  it("refuses (exit 1) when an imported issue is missing on GitHub, and never runs glab", async () => {
    seedRepo(REG_BASE);
    gh = await startFakeGitHub([]);
    const glab = writeScriptedGlab({ state: "opened", notesPages: [] });
    const planPath = writeJson("plan.json", closePlan());

    const r = await runAsync(["--close-gitlab", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_GITHUB_API: gh.url,
      IMPORT_ISSUES_TEST_FAKE_GLAB: glab.path,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain("REFUSED: GitHub #2 does not exist");
    expect(gh.requests.some((q) => q.startsWith("GET /repos/o/r/issues?"))).toBe(true);
    expect(glab.calls()).toBe("");
  });

  it("refuses (exit 1) when the imported issue on GitHub carries another title", async () => {
    seedRepo(REG_BASE);
    gh = await startFakeGitHub([{ number: 2, title: "§3: someone else's", state: "open", node_id: "N2", labels: [] }]);
    const glab = writeScriptedGlab({ state: "opened", notesPages: [] });
    const planPath = writeJson("plan.json", closePlan());

    const r = await runAsync(["--close-gitlab", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_GITHUB_API: gh.url,
      IMPORT_ISSUES_TEST_FAKE_GLAB: glab.path,
    });

    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain("GitHub #2 is titled");
    expect(glab.calls()).toBe("");
  });

  it("pages past the first 100 notes: a pointer on page 2 is seen, so nothing is written twice", async () => {
    seedRepo(REG_BASE);
    gh = await startFakeGitHub([{ number: 2, title: "§3: three", state: "open", node_id: "N2", labels: [] }]);
    const page1 = Array.from({ length: 100 }, (_, i) => ({ body: `note ${i}` }));
    const glab = writeScriptedGlab({ state: "closed", notesPages: [page1, [{ body: POINTER }]] });
    const planPath = writeJson("plan.json", closePlan());

    const r = await runAsync(["--close-gitlab", "--plan", planPath, "--repo", "o/r"], {
      GH_TOKEN: "dummy",
      IMPORT_ISSUES_TEST_GITHUB_API: gh.url,
      IMPORT_ISSUES_TEST_FAKE_GLAB: glab.path,
    });

    expect(r.code, r.all).toBe(0);
    expect(r.out).toContain("verified 1 imported issue(s) on GitHub");
    expect(r.out).toContain("closed 0 · skipped 1");
    const calls = glab.calls();
    expect(calls).toContain("notes?per_page=100&page=2");
    expect(calls).not.toContain("WRITE");
  });
});

describe("import-issues IMPORT_ISSUES_TEST_GITHUB_API is refused outside vitest", () => {
  it("exits 2 with the exact refusal message when the hook is set and VITEST is not", () => {
    seedRepo(REG_BASE);

    const r = run([], { GH_TOKEN: "dummy", IMPORT_ISSUES_TEST_GITHUB_API: DEAD_GITHUB_API, VITEST: null });

    expect(r.code, r.all).toBe(2);
    expect(r.err).toContain("IMPORT_ISSUES_TEST_GITHUB_API is a test-only hook and is refused outside vitest");
  });
});

describe("import-issues IMPORT_ISSUES_TEST_FAKE_GLAB is refused outside vitest", () => {
  it("exits 2 with the exact refusal message when the hook is set and VITEST is not, before any argument parsing or glab call", () => {
    seedRepo(REG_BASE);
    const fakeGlab = writeFakeGlab();

    const r = run([], { GH_TOKEN: "dummy", IMPORT_ISSUES_TEST_FAKE_GLAB: fakeGlab, VITEST: null });

    expect(r.code, r.all).toBe(2);
    expect(r.err).toContain("IMPORT_ISSUES_TEST_FAKE_GLAB is a test-only hook and is refused outside vitest");
    // The fake glab must never even run — this check precedes argument parsing entirely, so
    // it fires regardless of mode, and its absence here proves no fallback to a real `glab`
    // (which isn't on this test machine's PATH either — see the module header) was attempted.
    expect(r.all).not.toContain(FAKE_GLAB_MARKER);
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
