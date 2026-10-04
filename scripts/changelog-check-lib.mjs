// Pure half of the CHANGELOG gate (open-followups §527): which changed paths count as app code,
// and whether a change set needs a CHANGELOG entry. No I/O; `check-changelog.mjs` owns git, the
// GitHub API and the exit codes. ★ No shebang: a `#!` on an imported .mjs makes vitest throw.

/** The PR label that exempts a change from the gate (refactors, test-only or tooling work). */
export const OPT_OUT_LABEL = "no-changelog";

const APP_ROOTS = ["src/", "desktop/src/"];
const NOT_APP = [
  /\.(test|spec|property)\.[cm]?[jt]sx?$/, // tests, wherever they sit
  /^src\/test\//, // shared test helpers
  /\/__fixtures__\//, // test fixtures
  /\.md$/, // prose
];

/** True for a path whose change can reach a user: app source, not tests or fixtures. */
export function isAppCode(path) {
  const p = path.replace(/\\/g, "/");
  return APP_ROOTS.some((r) => p.startsWith(r)) && !NOT_APP.some((re) => re.test(p));
}

/**
 * @param {{ files: string[], optedOut: boolean }} input
 * @returns {{ ok: boolean, appFiles: string[], reason: string }}
 */
export function evaluateChangelog({ files, optedOut }) {
  const appFiles = files.filter(isAppCode);
  if (appFiles.length === 0) return { ok: true, appFiles, reason: "no app code changed" };
  if (files.some((f) => f.replace(/\\/g, "/") === "CHANGELOG.md")) {
    return { ok: true, appFiles, reason: "CHANGELOG.md is part of the change" };
  }
  if (optedOut) return { ok: true, appFiles, reason: `opted out (${OPT_OUT_LABEL})` };
  return { ok: false, appFiles, reason: "app code changed without a CHANGELOG.md entry" };
}

/**
 * Runs the gate with its I/O injected, so it is testable without git or the network.
 * Exit codes: 0 = pass, 1 = app code changed without an entry, 2 = could not scan.
 *
 * ★ The change set is `git diff <merge-base with origin/main> HEAD`. On a pull request CI checks
 * out the merge commit, whose merge-base with origin/main is main's tip, so the diff is exactly the
 * PR's change; on a push to main it is empty. Locally it is the branch's change.
 * ★ The label is read LIVE from the GitHub API, never from the event payload: a re-run reuses the
 * original payload, so "add the label, then re-run the failed job" only works with a live read.
 * It is only asked for when the change would otherwise fail.
 *
 * @param {{
 *   git: (args: string[]) => string,
 *   fetchLabels: (q: { repo: string, number: number, token: string }) => Promise<string[]>,
 *   readEvent: (path: string) => any,
 *   env: Record<string, string | undefined>,
 * }} io
 * @returns {Promise<{ code: 0 | 1 | 2, message: string }>}
 */
export async function runChangelogCheck({ git, fetchLabels, readEvent, env }) {
  const baseRef = env.CHANGELOG_BASE_REF || "origin/main";
  let files;
  try {
    const base = git(["merge-base", "HEAD", baseRef]).trim();
    files = git(["diff", "--name-only", base, "HEAD"]).split(/\r?\n/).filter(Boolean);
  } catch (err) {
    return { code: 2, message: `changelog:check could not scan: git failed against ${baseRef} (${String(err)})` };
  }

  const first = evaluateChangelog({ files, optedOut: env.CHANGELOG_OPT_OUT === "1" });
  if (first.ok) return { code: 0, message: `changelog:check ok — ${first.reason}` };

  if (env.GITHUB_EVENT_NAME === "pull_request") {
    let labels;
    try {
      const number = readEvent(env.GITHUB_EVENT_PATH ?? "").pull_request.number;
      if (!env.GH_TOKEN) throw new Error("GH_TOKEN is not set");
      labels = await fetchLabels({ repo: env.GITHUB_REPOSITORY ?? "", number, token: env.GH_TOKEN });
    } catch (err) {
      return { code: 2, message: `changelog:check could not read the PR's labels (${String(err)})` };
    }
    const second = evaluateChangelog({ files, optedOut: labels.includes(OPT_OUT_LABEL) });
    if (second.ok) return { code: 0, message: `changelog:check ok — ${second.reason}` };
  }

  return {
    code: 1,
    message:
      `changelog:check FAILED — ${first.reason}:\n` +
      first.appFiles.map((f) => `  ${f}`).join("\n") +
      `\nAdd a line under [Unreleased] in CHANGELOG.md. If the change cannot reach a user (a refactor, ` +
      `tooling), add the "${OPT_OUT_LABEL}" label to the pull request and re-run the failed job; ` +
      `locally, set CHANGELOG_OPT_OUT=1.`,
  };
}
