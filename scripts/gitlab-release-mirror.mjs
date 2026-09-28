// scripts/gitlab-release-mirror.mjs — §640: mirror GitHub releases into the read-only GitLab copy.
//
// Run by the `mirror-releases` job in ci/gitlab-sync.yml, AFTER `sync-from-github` has pushed the
// tags. For every GitHub release (drafts excluded; prereleases are mirrored as ordinary releases)
// whose tag has no GitLab release yet, it creates one with the same name, notes and release date,
// and ASSET LINKS pointing at the GitHub downloads. No binary is copied; while the GitHub
// repository is private those links need GitHub access to open.
//
// ★★ CREATE-ONLY, and therefore idempotent: an existing GitLab release is never updated or
//  deleted, so a re-run (the schedule, or a manual Run pipeline) is always safe.
// ★★ `released_at` is GitHub's publication date. Without it GitLab stamps the time of the POST, and a
//  first run that backfills several releases would make the OLDEST one "Latest" (GitLab orders
//  releases and its latest-release link by `released_at`), with every release showing the mirror date.
// ★★ A tag GitLab does not have yet (a release published after this run's sync cloned GitHub) is
//  SKIPPED and logged, not posted: GitLab rejects a release for a missing tag, and the next run
//  picks it up. Any other failed release is collected, the rest still run, and the job fails once
//  at the end, so one bad release never blocks the others.
// ★★ GitLab is addressed ONLY through the job's own CI variables ($CI_API_V4_URL, $CI_PROJECT_ID).
//  This file lives in the GitHub repository, which must never name the internal GitLab host.
// ★ The GitLab token is GITLAB_RELEASE_TOKEN, a separate PROJECT access token with the `api` scope,
//  so the sync's push token keeps its narrower rights. A missing variable exits 2, like the sync job.
//
// The logic is exported for scripts/gitlab-release-mirror.test.mjs; `main` runs only when this file
// is executed directly.

import { pathToFileURL } from "node:url";

export const GITHUB_REPO = "sebastianmaute/aipm-cockpit";

/** GitHub's "#123" becomes an absolute link: on GitLab a bare "#123" would link to GitLab's OWN
 *  issue 123, which is a different thing. */
export function absolutiseGithubRefs(text) {
  return text.replace(/(^|[\s(])#(\d+)\b/g, (_m, pre, n) => `${pre}[#${n}](https://github.com/${GITHUB_REPO}/issues/${n})`);
}

/** The GitLab release payload for one GitHub release (the REST API's release shape in, the
 *  `POST /projects/:id/releases` body out). */
export function toGitlabRelease(gh) {
  const notes = absolutiseGithubRefs((gh.body ?? "").trim());
  const footer = `Mirrored from the GitHub release: ${gh.html_url}`;
  const links = (gh.assets ?? []).map((a) => ({
    name: a.name,
    url: a.browser_download_url,
    link_type: /\.(exe|dmg|appimage|zip)$/i.test(a.name) ? "package" : "other",
  }));
  links.push({ name: "GitHub release page", url: gh.html_url, link_type: "other" });
  const releasedAt = gh.published_at ?? gh.created_at;
  return {
    tag_name: gh.tag_name,
    name: gh.name || gh.tag_name,
    description: notes ? `${notes}\n\n---\n\n${footer}` : footer,
    ...(releasedAt ? { released_at: releasedAt } : {}),
    assets: { links },
  };
}

/** Which GitHub releases to create on GitLab: not drafts, no GitLab release for the tag yet, and the
 *  tag already on GitLab. Returns the payloads to post and the tags still waiting for the sync. */
export function planReleases(githubReleases, existingReleaseTags, gitlabRepoTags) {
  const existing = new Set(existingReleaseTags);
  const onGitlab = new Set(gitlabRepoTags);
  const due = githubReleases
    .filter((r) => !r.draft && typeof r.tag_name === "string" && r.tag_name !== "")
    .filter((r) => !existing.has(r.tag_name));
  return {
    create: due.filter((r) => onGitlab.has(r.tag_name)).map(toGitlabRelease),
    waiting: due.filter((r) => !onGitlab.has(r.tag_name)).map((r) => r.tag_name),
  };
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

/** Every `field` of a paginated GitLab list endpoint (`x-next-page` is empty on the last page). */
async function gitlabList(api, projectId, path, field, token) {
  const headers = { "PRIVATE-TOKEN": token };
  const out = [];
  let page = "1";
  while (page) {
    const { json, res } = await getJson(`${api}/projects/${projectId}/${path}?per_page=100&page=${page}`, headers);
    out.push(...json.map((r) => r[field]));
    page = res.headers.get("x-next-page") || "";
  }
  return out;
}

/** Thrown when a required CI variable is absent; the CLI maps it to exit 2, like the sync job. */
export class MissingVariableError extends Error {}

/** Creates the missing GitLab releases and returns their tags. `env` defaults to the process's. */
export async function main(env = process.env) {
  const { GITHUB_SYNC_TOKEN, GITLAB_RELEASE_TOKEN, CI_API_V4_URL, CI_PROJECT_ID } = env;
  if (!GITHUB_SYNC_TOKEN || !GITLAB_RELEASE_TOKEN || !CI_API_V4_URL || !CI_PROJECT_ID) {
    throw new MissingVariableError("a required variable is missing");
  }
  const { create, waiting } = planReleases(
    await githubReleases(GITHUB_SYNC_TOKEN),
    await gitlabList(CI_API_V4_URL, CI_PROJECT_ID, "releases", "tag_name", GITLAB_RELEASE_TOKEN),
    await gitlabList(CI_API_V4_URL, CI_PROJECT_ID, "repository/tags", "name", GITLAB_RELEASE_TOKEN),
  );
  for (const tag of waiting) console.log(`mirror-releases: ${tag} is not on GitLab yet; the next run creates it`);
  if (create.length === 0) {
    console.log("mirror-releases: nothing to create");
    return [];
  }
  const created = [];
  const failed = [];
  for (const release of create) {
    const res = await fetch(`${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/releases`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": GITLAB_RELEASE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(release),
    });
    if (res.ok) {
      created.push(release.tag_name);
      console.log(`mirror-releases: created ${release.tag_name}`);
    } else {
      failed.push(`${release.tag_name} (${res.status})`);
    }
  }
  if (failed.length > 0) throw new Error(`creating these GitLab releases failed: ${failed.join(", ")}`);
  return created;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`mirror-releases: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(err instanceof MissingVariableError ? 2 : 1);
  });
}
