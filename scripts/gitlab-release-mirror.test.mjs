import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GITHUB_REPO,
  MissingVariableError,
  absolutiseGithubRefs,
  main,
  nextGithubPage,
  planReleases,
  toGitlabRelease,
} from "./gitlab-release-mirror.mjs";

const gh = (over = {}) => ({
  tag_name: "v1.14.2",
  name: "1.14.2 \"Deaver\"",
  body: "Release notes.",
  draft: false,
  published_at: "2026-09-28T12:00:00Z",
  html_url: `https://github.com/${GITHUB_REPO}/releases/tag/v1.14.2`,
  assets: [
    { name: "aipm-cockpit-1.14.2-setup.exe", browser_download_url: "https://example.test/setup.exe" },
    { name: "latest.yml", browser_download_url: "https://example.test/latest.yml" },
  ],
  ...over,
});

describe("toGitlabRelease (§640)", () => {
  it("keeps the tag, the name and the notes, and says where it was mirrored from", () => {
    const r = toGitlabRelease(gh());
    expect(r.tag_name).toBe("v1.14.2");
    expect(r.name).toBe("1.14.2 \"Deaver\"");
    expect(r.description.startsWith("Release notes.")).toBe(true);
    expect(r.description).toContain(`Mirrored from the GitHub release: https://github.com/${GITHUB_REPO}/releases/tag/v1.14.2`);
  });

  // Without it GitLab stamps the POST time, and a backfill makes the OLDEST release "Latest".
  it("carries GitHub's publication date as released_at, falling back to the creation date", () => {
    expect(toGitlabRelease(gh()).released_at).toBe("2026-09-28T12:00:00Z");
    expect(toGitlabRelease(gh({ published_at: null, created_at: "2026-09-27T08:00:00Z" })).released_at).toBe("2026-09-27T08:00:00Z");
  });

  it("links every asset (the installer as a package) and the GitHub release page, copying nothing", () => {
    expect(toGitlabRelease(gh()).assets.links).toEqual([
      { name: "aipm-cockpit-1.14.2-setup.exe", url: "https://example.test/setup.exe", link_type: "package" },
      { name: "latest.yml", url: "https://example.test/latest.yml", link_type: "other" },
      { name: "GitHub release page", url: `https://github.com/${GITHUB_REPO}/releases/tag/v1.14.2`, link_type: "other" },
    ]);
  });

  it("falls back to the tag for a nameless release, and to the footer alone for empty notes", () => {
    const r = toGitlabRelease(gh({ name: "", body: null, assets: [] }));
    expect(r.name).toBe("v1.14.2");
    expect(r.description).toBe(`Mirrored from the GitHub release: https://github.com/${GITHUB_REPO}/releases/tag/v1.14.2`);
    expect(r.assets.links).toHaveLength(1);
  });
});

describe("absolutiseGithubRefs (§640)", () => {
  // On GitLab a bare "#473" links to GitLab's own issue 473.
  it("turns #N references into GitHub links and leaves headings and other text alone", () => {
    expect(absolutiseGithubRefs("Fixed in #473 (see #12).")).toBe(
      `Fixed in [#473](https://github.com/${GITHUB_REPO}/issues/473) (see [#12](https://github.com/${GITHUB_REPO}/issues/12)).`,
    );
    expect(absolutiseGithubRefs("## Fixed\nsection §633, C#9 stays")).toBe("## Fixed\nsection §633, C#9 stays");
  });

  it("is applied to the release notes GitLab receives", () => {
    expect(toGitlabRelease(gh({ body: "See #473." })).description).toContain(
      `See [#473](https://github.com/${GITHUB_REPO}/issues/473).`,
    );
  });
});

describe("planReleases (§640)", () => {
  const releases = [gh(), gh({ tag_name: "v1.14.1", name: "1.14.1" })];
  const allTags = ["v1.14.1", "v1.14.2"];

  it("creates only what GitLab lacks, so a re-run creates nothing", () => {
    expect(planReleases(releases, [], allTags).create.map((r) => r.tag_name)).toEqual(["v1.14.2", "v1.14.1"]);
    expect(planReleases(releases, ["v1.14.1"], allTags).create.map((r) => r.tag_name)).toEqual(["v1.14.2"]);
    expect(planReleases(releases, allTags, allTags)).toEqual({ create: [], waiting: [] });
  });

  it("holds back a release whose tag GitLab does not have yet, and names it as waiting", () => {
    const { create, waiting } = planReleases(releases, [], ["v1.14.1"]);
    expect(create.map((r) => r.tag_name)).toEqual(["v1.14.1"]);
    expect(waiting).toEqual(["v1.14.2"]);
  });

  it("never mirrors a draft, and skips a release with no tag", () => {
    expect(planReleases([gh({ draft: true }), gh({ tag_name: "" })], [], allTags)).toEqual({ create: [], waiting: [] });
  });
});

describe("nextGithubPage (§640)", () => {
  it("follows rel=next and stops on the last page", () => {
    const link =
      '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/releases?per_page=100&page=3>; rel="last"';
    expect(nextGithubPage(link)).toBe("https://api.github.com/repositories/1/releases?per_page=100&page=2");
    expect(nextGithubPage('<https://x.test/p1>; rel="first", <https://x.test/p2>; rel="prev"')).toBeNull();
    expect(nextGithubPage(null)).toBeNull();
  });
});

describe("main (§640)", () => {
  // `.invalid` is a reserved TLD: this names no real host.
  const env = { GITHUB_SYNC_TOKEN: "gh-t", GITLAB_RELEASE_TOKEN: "gl-t", CI_API_V4_URL: "https://gitlab.invalid/api/v4", CI_PROJECT_ID: "7" };
  const json = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers });

  function stubFetch({ releaseTags = [], repoTags = ["v1.14.0", "v1.14.1", "v1.14.2"], postStatus = () => 201, githubStatus = 200 } = {}) {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const u = new URL(String(url));
      if (u.hostname === "api.github.com") {
        if (githubStatus !== 200) return new Response("", { status: githubStatus });
        if (u.searchParams.get("page") === "2") return json([gh({ tag_name: "v1.14.0", name: "1.14.0" })]);
        return json([gh(), gh({ tag_name: "v1.14.1", name: "1.14.1" })], {
          link: '<https://api.github.com/repos/x/releases?per_page=100&page=2>; rel="next"',
        });
      }
      if (init.method === "POST") return new Response("", { status: postStatus(JSON.parse(init.body).tag_name) });
      const list = u.pathname.endsWith("/repository/tags") ? repoTags.map((name) => ({ name })) : releaseTags.map((tag_name) => ({ tag_name }));
      // Two pages each, to prove the x-next-page loop.
      if (u.searchParams.get("page") === "1") return json(list.slice(0, 1), { "x-next-page": "2" });
      return json(list.slice(1), { "x-next-page": "" });
    }));
    return calls;
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("follows every pagination and creates only the missing releases, with each side's token", async () => {
    const calls = stubFetch({ releaseTags: ["v1.14.0", "v1.14.1"] });
    await expect(main(env)).resolves.toEqual(["v1.14.2"]);
    const posts = calls.filter((c) => c.init.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://gitlab.invalid/api/v4/projects/7/releases");
    expect(posts[0].init.headers["PRIVATE-TOKEN"]).toBe("gl-t");
    expect(JSON.parse(posts[0].init.body)).toMatchObject({ tag_name: "v1.14.2", released_at: "2026-09-28T12:00:00Z" });
    const githubCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/"));
    expect(githubCalls).toHaveLength(2);
    expect(githubCalls.every((c) => c.init.headers.Authorization === "Bearer gh-t")).toBe(true);
    expect(calls.filter((c) => /\/releases\?per_page=100&page=/.test(c.url) && c.url.includes("gitlab.invalid"))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes("/repository/tags?"))).toHaveLength(2);
  });

  it("creates nothing on a re-run", async () => {
    const calls = stubFetch({ releaseTags: ["v1.14.0", "v1.14.1", "v1.14.2"] });
    await expect(main(env)).resolves.toEqual([]);
    expect(calls.filter((c) => c.init.method === "POST")).toEqual([]);
  });

  it("skips a tag GitLab does not have yet instead of failing on it", async () => {
    const calls = stubFetch({ releaseTags: ["v1.14.0"], repoTags: ["v1.14.0", "v1.14.1"] });
    await expect(main(env)).resolves.toEqual(["v1.14.1"]);
    expect(calls.filter((c) => c.init.method === "POST").map((c) => JSON.parse(c.init.body).tag_name)).toEqual(["v1.14.1"]);
  });

  it("still creates the others when one release is refused, then fails once naming it", async () => {
    const calls = stubFetch({ releaseTags: [], postStatus: (tag) => (tag === "v1.14.2" ? 403 : 201) });
    await expect(main(env)).rejects.toThrow("creating these GitLab releases failed: v1.14.2 (403)");
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(3);
  });

  it("fails loudly when GitHub refuses the release list", async () => {
    stubFetch({ githubStatus: 401 });
    await expect(main(env)).rejects.toThrow("failed: 401");
  });

  it("refuses to run without its variables", async () => {
    await expect(main({ ...env, GITLAB_RELEASE_TOKEN: "" })).rejects.toBeInstanceOf(MissingVariableError);
  });

  it("exits 2 from the command line when a variable is missing", () => {
    const script = join(import.meta.dirname, "gitlab-release-mirror.mjs");
    const r = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("a required variable is missing");
  });
});

describe("the script names no GitLab host (§640)", () => {
  // The GitHub repository must never carry the internal GitLab address; the script reaches GitLab
  // only through the job's CI variables.
  it("addresses GitLab only through $CI_API_V4_URL and $CI_PROJECT_ID", () => {
    const src = readFileSync(join(import.meta.dirname, "gitlab-release-mirror.mjs"), "utf8");
    expect(src).toContain("CI_API_V4_URL");
    expect(src).toContain("CI_PROJECT_ID");
    const urls = [...src.matchAll(/https?:\/\/[^\s`"')]+/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => !/^https:\/\/(api\.)?github\.com\//.test(u))).toEqual([]);
  });
});
