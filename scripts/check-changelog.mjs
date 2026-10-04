// Gate: a change to app code must carry a CHANGELOG.md entry, unless the pull request has the
// `no-changelog` label (open-followups §527). Logic and exit codes: `runChangelogCheck` in
// changelog-check-lib.mjs. Run from the static group of scripts/gate-local.mjs.
// Exit: 0 pass · 1 app code changed without an entry · 2 could not scan.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runChangelogCheck } from "./changelog-check-lib.mjs";

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The pull request itself, not the issues labels endpoint: GET /pulls/{n} is covered by the
// `pull-requests: read` scope the static job grants, and its body carries every label.
async function fetchLabels({ repo, number, token }) {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return ((await res.json()).labels ?? []).map((l) => l.name);
}

const readEvent = (path) => JSON.parse(readFileSync(path, "utf8"));

const { code, message } = await runChangelogCheck({ git, fetchLabels, readEvent, env: process.env });
(code === 0 ? console.log : console.error)(message);
process.exit(code);
