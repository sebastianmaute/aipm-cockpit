// CLI for importing the register's open GitLab issues into a fresh GitHub repository with
// their numbers preserved (sub-project 4 spec,
// docs/superpowers/specs/2026-09-23-issues-migration-design.md). This file implements ONLY
// `--plan`: read GitLab's issue list and the register, plan with the pure lib
// (issue-import-lib.mjs), leak-scan the plan (identifier-leak-lib.mjs), write the plan JSON.
// `--apply`, `--resume` and `--close-gitlab` are recognised here as mutually exclusive modes,
// but wiring them to issue-import-apply.mjs is a later task. No shebang: this file is a CLI
// run by node, never imported.
//
// Usage:
//   node scripts/import-issues.mjs --plan --out <file> --repo <owner/name> \
//     --pointer anchor|search [--gitlab-json <file>]
//
// `--gitlab-json <file>` reads the GitLab issue list from that file instead of paging
// `glab api`. Tests use it; so does a dry run against a saved snapshot.
//
// LEAK_LIST_FILE must name the identifier list (kept outside the repo) or the command exits 2.
//
// EXIT CODES:
//   0  the plan was written
//   1  the plan would leak an identifier — nothing was written; stdout names the hit
//      action numbers and classes, never the matched text
//   2  CANNOT RUN: bad, missing or unknown arguments, an unimplemented mode, an unreadable
//      register or leak list, a malformed GitLab issue list, or a planner failure (e.g. an
//      open issue naming an entry that is not OPEN) — including any structural failure such
//      as a renamed lib export, since the libs are imported dynamically inside the try below
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REGISTER = "docs/open-followups.md";
const PER_PAGE = 100;
const MODE_FLAGS = ["plan", "apply", "resume", "close-gitlab"];
const VALUE_FLAGS = { "--out": "out", "--repo": "repo", "--pointer": "pointer", "--gitlab-json": "gitlabJson" };
const REPO_RE = /^[^\s/]+\/[^\s/]+$/;

class CannotRun extends Error {}

function parseArgs(argv) {
  const modes = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--") && MODE_FLAGS.includes(arg.slice(2))) {
      modes.push(arg.slice(2));
      continue;
    }
    if (arg in VALUE_FLAGS) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CannotRun(`${arg} needs a value.`);
      }
      opts[VALUE_FLAGS[arg]] = value;
      i += 1;
      continue;
    }
    throw new CannotRun(`unknown flag ${arg}.`);
  }
  if (modes.length !== 1) {
    throw new CannotRun("exactly one of --plan, --apply, --resume, --close-gitlab is required.");
  }
  return { mode: modes[0], ...opts };
}

async function loadPatterns() {
  const { parseList, buildPatterns } = await import("./identifier-leak-lib.mjs");
  const listPath = process.env.LEAK_LIST_FILE;
  if (!listPath || listPath.trim() === "") {
    throw new CannotRun("LEAK_LIST_FILE is unset — point it at the identifier list (kept outside the repo).");
  }
  let text;
  try {
    text = readFileSync(listPath, "utf8");
  } catch (err) {
    throw new CannotRun(`the list named by LEAK_LIST_FILE is unreadable (${err.code ?? err.message}).`);
  }
  const entries = parseList(text);
  if (entries.length === 0) throw new CannotRun("the list named by LEAK_LIST_FILE holds no entries.");
  try {
    return buildPatterns(entries);
  } catch (err) {
    throw new CannotRun(`the list named by LEAK_LIST_FILE is malformed: ${err.message}.`);
  }
}

function toGitlabIssue(raw) {
  const ok =
    raw &&
    Number.isInteger(raw.iid) &&
    typeof raw.state === "string" &&
    typeof raw.title === "string" &&
    Array.isArray(raw.labels);
  if (!ok) {
    throw new CannotRun("a GitLab issue in the list lacks an integer iid, a state, a title or a labels array.");
  }
  return { iid: raw.iid, state: raw.state, title: raw.title, labels: raw.labels.map(String) };
}

function fetchGitlabIssuesFromApi() {
  const issues = [];
  let page = 1;
  for (;;) {
    let out;
    try {
      out = execFileSync("glab", ["api", `projects/:id/issues?state=all&per_page=${PER_PAGE}&page=${page}`], {
        encoding: "utf8",
      });
    } catch (err) {
      throw new CannotRun(`glab api page ${page} failed (${err.message.split("\n")[0]}).`);
    }
    let batch;
    try {
      batch = JSON.parse(out);
    } catch {
      throw new CannotRun(`glab api page ${page} did not return JSON.`);
    }
    if (!Array.isArray(batch)) throw new CannotRun(`glab api page ${page} did not return a JSON array.`);
    if (batch.length === 0) break;
    issues.push(...batch);
    page += 1;
  }
  return issues;
}

function readGitlabIssues(gitlabJsonPath) {
  let raw;
  if (gitlabJsonPath) {
    let text;
    try {
      text = readFileSync(gitlabJsonPath, "utf8");
    } catch (err) {
      throw new CannotRun(`--gitlab-json file is unreadable (${err.code ?? err.message}).`);
    }
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new CannotRun(`--gitlab-json file is not valid JSON (${err.message}).`);
    }
  } else {
    raw = fetchGitlabIssuesFromApi();
  }
  if (!Array.isArray(raw)) throw new CannotRun("the GitLab issue list is not a JSON array.");
  return raw.map(toGitlabIssue);
}

function readRegisterText() {
  try {
    return readFileSync(REGISTER, "utf8");
  } catch (err) {
    throw new CannotRun(`${REGISTER} is unreadable (${err.code ?? err.message}).`);
  }
}

function registerSha() {
  try {
    return execFileSync("git", ["hash-object", REGISTER], { encoding: "utf8" }).trim();
  } catch (err) {
    throw new CannotRun(`git hash-object ${REGISTER} failed (${err.message.split("\n")[0]}).`);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tally(actions) {
  const counts = { open: 0, stub: 0, placeholder: 0 };
  for (const a of actions) counts[a.kind] += 1;
  return counts;
}

async function planMode(opts) {
  if (!opts.out) throw new CannotRun("--out is required.");
  if (!opts.repo || !REPO_RE.test(opts.repo)) throw new CannotRun("--repo must be owner/name.");
  if (opts.pointer !== "anchor" && opts.pointer !== "search") {
    throw new CannotRun("--pointer must be anchor or search.");
  }

  const { planImport, leakCheckPlan } = await import("./issue-import-lib.mjs");
  const patterns = await loadPatterns();
  const gitlabIssues = readGitlabIssues(opts.gitlabJson);
  const registerText = readRegisterText();
  const sha = registerSha();
  const repoUrl = `https://github.com/${opts.repo}`;
  const date = today();

  const actions = planImport(gitlabIssues, registerText, { repoUrl, pointerStyle: opts.pointer, date });
  const leak = leakCheckPlan(actions, patterns);

  if (leak.hitLines > 0) {
    for (const [cls, count] of Object.entries(leak.classes)) {
      console.log(`LEAK class=${cls} count=${count}`);
    }
    console.log(`LEAK actions ${leak.actionsHit.map((n) => `#${n}`).join(", ")}`);
    return 1;
  }

  const counts = tally(actions);
  const maxNumber = Math.max(0, ...actions.map((a) => a.n));
  const plan = {
    version: 1,
    createdAt: date,
    registerSha: sha,
    maxNumber,
    pointerStyle: opts.pointer,
    repoUrl,
    counts,
    leak,
    actions,
  };
  writeFileSync(opts.out, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`open ${counts.open} · stub ${counts.stub} · placeholder ${counts.placeholder} · total ${actions.length}`);
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode !== "plan") throw new CannotRun(`--${opts.mode} is not implemented yet.`);
  return planMode(opts);
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`CANNOT RUN: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
