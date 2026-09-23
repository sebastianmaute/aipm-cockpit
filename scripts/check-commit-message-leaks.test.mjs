// @vitest-environment node
//
// The CLI half spawns node and git against a throwaway repository in the OS temp dir, so it needs
// node's fs and child_process rather than jsdom (see gate-local.test.mjs's header for the URL case).
//
// Fictional stand-ins only — never a real identifier in tracked text. The token below exists so the
// test can assert it NEVER reaches stdout or stderr: every hit is an identifier.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPatterns, scanMessage, TRAILER_RE } from "./identifier-leak-lib.mjs";

const TOKEN = "zorblaxcorp.example";
const CLASS = "fictional-employer";
const TRAILER = "Claude-Session: https://example.invalid/s";
const CLI = fileURLToPath(new URL("./check-commit-message-leaks.mjs", import.meta.url));

describe("scanMessage", () => {
  const patterns = buildPatterns([`@${CLASS} ${TOKEN}`, "@fictional-word word:Zorb"]);

  it("counts nothing in a clean message", () => {
    expect(scanMessage("feat: a thing\n\nbody text\n", patterns)).toEqual({
      hitLines: 0, trailerLines: 0, classes: {},
    });
  });

  it("counts a pattern hit per LINE, under its class", () => {
    const r = scanMessage(`fix: x\n\nsee ${TOKEN} and ${TOKEN}\nagain ZORB here\n`, patterns);
    expect(r.hitLines).toBe(2);
    expect(r.classes).toEqual({ [CLASS]: 1, "fictional-word": 1 });
    expect(r.trailerLines).toBe(0);
  });

  it("counts a trailer line by KEY, case-insensitively, CRLF or LF", () => {
    expect(scanMessage(`feat: x\r\n\r\n${TRAILER}\r\n`, patterns).trailerLines).toBe(1);
    expect(scanMessage("feat: x\n\nclaude-SESSION: whatever\n", patterns).trailerLines).toBe(1);
    expect(scanMessage("feat: x\n\nCo-Authored-By: Claude Opus 5 <a@b.c>\n", patterns).trailerLines).toBe(1);
  });

  it("does not count a message that merely names the assistant, or a human co-author", () => {
    const r = scanMessage("feat: the Claude panel\n\nCo-Authored-By: Jane <j@example.com>\n", patterns);
    expect(r.trailerLines).toBe(0);
  });

  it("shares its trailer rule with verify-rewrite's countTrailerLines", async () => {
    const vr = await import("./verify-rewrite.mjs");
    expect(vr.countTrailerLines(TRAILER)).toBe(1);
    expect(TRAILER_RE.test(TRAILER)).toBe(true);
  });
});

// ---- CLI against a throwaway repository ----------------------------------------------------------

let base;
let repo;
let listFile;
const shas = {};

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(...args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
    cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: "utf8",
  }).trim();
}

function commit(name, message) {
  const f = path.join(base, `${name}.msg`);
  writeFileSync(f, message);
  git("commit", "--allow-empty", "--no-verify", "-F", f);
  shas[name] = git("rev-parse", "HEAD");
}

function run(range, env = { LEAK_LIST_FILE: listFile }) {
  const childEnv = { ...process.env, ...env };
  if (!("LEAK_LIST_FILE" in env)) delete childEnv.LEAK_LIST_FILE;
  const args = range === undefined ? [CLI] : [CLI, range];
  const r = spawnSync(process.execPath, args, { cwd: repo, env: childEnv, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "msgscan-"));
  repo = path.join(base, "repo");
  execFileSync("git", ["init", "-q", repo]);
  listFile = path.join(base, "list.txt");
  writeFileSync(listFile, `# fictional\n@${CLASS} ${TOKEN}\n`);
  commit("root", "chore: root\n");
  commit("a", "feat: clean one\n\nbody\n");
  commit("b", "fix: clean two\n");
  commit("c", `feat: trailer\n\n${TRAILER}\n`);
  commit("d", `fix: mentions ${TOKEN} in the subject\n`);
  commit("e", "docs: clean, but tagged\n");
  const tagMsg = path.join(base, "tag.msg");
  writeFileSync(tagMsg, `release notes naming ${TOKEN}\n`);
  git("tag", "-a", "t1", "-F", tagMsg);
  commit("f", "docs: clean after the tag\n");
  // git refuses only NUL in a message; any other control byte must not split a record.
  commit("g", `fix: before a control byte\x01 and after it ${TOKEN}\n`);
  commit("h", "docs: clean, tagged with a control byte\n");
  const tagCtl = path.join(base, "tag-ctl.msg");
  writeFileSync(tagCtl, `notes\x01 then ${TOKEN}\n`);
  git("tag", "-a", "t2", "-F", tagCtl);
}, 60_000);

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("check-commit-message-leaks CLI", () => {
  it("exits 0 on a clean range and says how many commits it read", () => {
    const r = run(`${shas.root}..${shas.b}`);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/\b2 commits scanned/);
  });

  it("exits 1 on a trailer, naming the short SHA and the trailer class", () => {
    const r = run(`${shas.b}..${shas.c}`);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain(shas.c.slice(0, 12));
    expect(r.err).toMatch(/class=trailer/);
    expect(r.err).toMatch(/1 trailer line/);
  });

  it("exits 1 on a pattern hit, naming the class and never the matched text", () => {
    const r = run(`${shas.c}..${shas.d}`);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain(shas.d.slice(0, 12));
    expect(r.err).toContain(`class=${CLASS}`);
    expect(r.all.toLowerCase()).not.toContain(TOKEN);
  });

  it("scans an annotated tag message whose commit is in range", () => {
    const r = run(`${shas.d}..${shas.f}`);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(new RegExp(`LEAK tag ${shas.e.slice(0, 12)}\\b`));
    expect(r.out + r.err).toMatch(/1 tag message/);
    expect(r.all.toLowerCase()).not.toContain(TOKEN);
  });

  it("never prints the token across the whole history", () => {
    const r = run(`${shas.root}..${shas.f}`);
    expect(r.code, r.all).toBe(1);
    // Positive observable first: without it a crashing CLI (node's own exit 1) passes this test.
    expect(r.err).toContain(`LEAK commit ${shas.d.slice(0, 12)}`);
    expect(r.out).toMatch(/^$/);
    expect(r.err).toMatch(/\b6 commits scanned, 1 tag message/);
    expect(r.all.toLowerCase()).not.toContain(TOKEN);
  });

  it("scans the whole message past a control byte: no phantom record, no unscanned tail", () => {
    const r = run(`${shas.g}^!`);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain(`LEAK commit ${shas.g.slice(0, 12)}  class=${CLASS}`);
    expect(r.err).toMatch(/\b1 commits scanned/);
    expect(r.all.toLowerCase()).not.toContain(TOKEN);
  });

  it("scans the whole tag message past a control byte", () => {
    const r = run(`${shas.h}^!`);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toContain(`LEAK tag ${shas.h.slice(0, 12)}  class=${CLASS}`);
    expect(r.err).toMatch(/\b1 commits scanned, 1 tag message/);
  });

  it("scans one commit with the <sha>^! form", () => {
    expect(run(`${shas.c}^!`).code).toBe(1);
    const r = run(`${shas.b}^!`);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/\b1 commits scanned/);
  });

  it("exits 0 on an empty range and says 0 commits were scanned", () => {
    const r = run(`${shas.f}..${shas.f}`);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/\b0 commits scanned/);
  });

  it("exits 2 on a bad or unresolvable range", () => {
    expect(run("nope..HEAD").code).toBe(2);
    expect(run(`${"0".repeat(40)}..${shas.f}`).code).toBe(2);
  });

  it("exits 2 with no range, or one that looks like an option", () => {
    expect(run(undefined).code).toBe(2);
    expect(run("--output=x").code).toBe(2);
  });

  it("exits 2 on a missing, unset or empty list", () => {
    const range = `${shas.root}..${shas.b}`;
    expect(run(range, { LEAK_LIST_FILE: path.join(base, "absent.txt") }).code).toBe(2);
    expect(run(range, {}).code).toBe(2);
    const empty = path.join(base, "empty.txt");
    writeFileSync(empty, "# comments only\n\n");
    expect(run(range, { LEAK_LIST_FILE: empty }).code).toBe(2);
  });

  it("exits 2 outside a git repository", () => {
    const r = spawnSync(process.execPath, [CLI, "a..b"], {
      cwd: base, env: { ...process.env, LEAK_LIST_FILE: listFile, GIT_CEILING_DIRECTORIES: base },
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});
