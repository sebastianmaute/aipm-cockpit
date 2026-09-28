// scripts/gitlab-release-mirror.mjs — §640: mirror GitHub releases into the read-only GitLab copy.
//
// Run by the `mirror-releases` job in ci/gitlab-sync.yml, AFTER `sync-from-github` has pushed the
// tags. For every GitHub release (drafts excluded) whose tag has no GitLab release yet, it creates
// one with the same name and notes, and ASSET LINKS pointing at the GitHub downloads. No binary is
// copied; while the GitHub repository is private those links need GitHub access to open.
//
// ★★ CREATE-ONLY, and therefore idempotent: an existing GitLab release is never updated or
//  deleted, so a re-run (the schedule, or a manual Run pipeline) is always safe.
// ★★ GitLab is addressed ONLY through the job's own CI variables ($CI_API_V4_URL, $CI_PROJECT_ID).
//  This file lives in the GitHub repository, which must never name the internal GitLab host.
// ★ Any failed API call throws, so the job fails and GitLab's failure mail is the alarm, the same
//  principle as the sync job above it. A missing variable exits 2, like the sync job.
//
// The decision logic is pure and exported for scripts/gitlab-release-mirror.test.mjs; `main` runs
// only when this file is executed directly.

import { pathToFileURL } from "node:url";

export const GITHUB_REPO = "sebastianmaute/aipm-cockpit";

/** The GitLab release payload for one GitHub release (the REST API's release shape in, the
 *  `POST /projects/:id/releases` body out). */
export function toGitlabRelease(gh) {
  const notes = (gh.body ?? "").trim();
  const footer = `Mirrored from the GitHub release: ${gh.html_url}`;
  const links = (gh.assets ?? []).map((a) => ({
    name: a.name,
    url: a.browser_download_url,
    link_type: /\.(exe|dmg|appimage|zip)$/i.test(a.name) ? "package" : "other",
  }));
  links.push({ name: "GitHub release page", url: gh.html_url, link_type: "other" });
  return {
    tag_name: gh.tag_name,
    name: gh.name || gh.tag_name,
    description: notes ? `${notes}\n\n---\n\n${footer}` : footer,
    assets: { links },
  };
}

/** Which GitHub releases need a GitLab release: not drafts, and no GitLab release for the tag yet. */
export function planReleases(githubReleases, existingGitlabTags) {
  const existing = new Set(existingGitlabTags);
  return githubReleases
    .filter((r) => !r.draft && typeof r.tag_name === "string" && r.tag_name !== "")
    .filter((r) => !existing.has(r.tag_name))
    .map(toGitlabRelease);
}

/** The next page URL from a GitHub `Link` header, or null on the last page. */
export function nextGithubPage(linkHeader) {
  if (!linkHeader) return null;
  const m = linkHeader.split(",").map((p) => p.trim()).find((p) => /rel="next"/.test(p));
  const url = m?.match(/^<([^>]+)>/)?.[1];
  return url ?? null;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${new URL(url).pathname} failed: ${res.status}`);
  return { json: await res.json(), res };
}

async function githubReleases(token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const all = [];
  let url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`;
  while (url) {
    const { json, res } = await getJson(url, headers);
    all.push(...json);
    url = nextGithubPage(res.headers.get("link"));
  }
  return all;
}

async function gitlabReleaseTags(api, projectId, token) {
  const headers = { "PRIVATE-TOKEN": token };
  const tags = [];
  let page = "1";
  while (page) {
    const { json, res } = await getJson(`${api}/projects/${projectId}/releases?per_page=100&page=${page}`, headers);
    tags.push(...json.map((r) => r.tag_name));
    page = res.headers.get("x-next-page") || "";
  }
  return tags;
}

/** Thrown when a required CI variable is absent; the CLI maps it to exit 2, like the sync job. */
export class MissingVariableError extends Error {}

/** Creates the missing GitLab releases and returns their tags. `env` defaults to the process's. */
export async function main(env = process.env) {
  const { GITHUB_SYNC_TOKEN, GITLAB_SYNC_TOKEN, CI_API_V4_URL, CI_PROJECT_ID } = env;
  if (!GITHUB_SYNC_TOKEN || !GITLAB_SYNC_TOKEN || !CI_API_V4_URL || !CI_PROJECT_ID) {
    throw new MissingVariableError("a required variable is missing");
  }
  const plan = planReleases(
    await githubReleases(GITHUB_SYNC_TOKEN),
    await gitlabReleaseTags(CI_API_V4_URL, CI_PROJECT_ID, GITLAB_SYNC_TOKEN),
  );
  if (plan.length === 0) {
    console.log("mirror-releases: every GitHub release already has a GitLab release");
    return [];
  }
  for (const release of plan) {
    const res = await fetch(`${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/releases`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": GITLAB_SYNC_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(release),
    });
    if (!res.ok) throw new Error(`creating the GitLab release ${release.tag_name} failed: ${res.status}`);
    console.log(`mirror-releases: created ${release.tag_name}`);
  }
  return plan.map((r) => r.tag_name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`mirror-releases: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(err instanceof MissingVariableError ? 2 : 1);
  });
}
