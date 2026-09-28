import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_REPO, MissingVariableError, main, nextGithubPage, planReleases, toGitlabRelease } from "./gitlab-release-mirror.mjs";

const gh = (over = {}) => ({
  tag_name: "v1.14.2",
  name: "1.14.2 \"Deaver\"",
  body: "Release notes.",
  draft: false,
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

  it("links every asset (the installer as a package) and the GitHub release page, copying nothing", () => {
    const links = toGitlabRelease(gh()).assets.links;
    expect(links).toEqual([
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

describe("planReleases (§640)", () => {
  it("creates only what GitLab lacks, so a re-run creates nothing", () => {
    const releases = [gh(), gh({ tag_name: "v1.14.1", name: "1.14.1" })];
    expect(planReleases(releases, []).map((r) => r.tag_name)).toEqual(["v1.14.2", "v1.14.1"]);
    expect(planReleases(releases, ["v1.14.1"]).map((r) => r.tag_name)).toEqual(["v1.14.2"]);
    expect(planReleases(releases, ["v1.14.1", "v1.14.2"])).toEqual([]);
  });

  it("never mirrors a draft", () => {
    expect(planReleases([gh({ draft: true })], [])).toEqual([]);
  });

  it("skips a release with no tag rather than posting an invalid one", () => {
    expect(planReleases([gh({ tag_name: "" })], [])).toEqual([]);
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
  const env = { GITHUB_SYNC_TOKEN: "gh-t", GITLAB_SYNC_TOKEN: "gl-t", CI_API_V4_URL: "https://gitlab.invalid/api/v4", CI_PROJECT_ID: "7" };
  const json = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers });

  function stubFetch({ gitlabExisting = [], postStatus = 201 } = {}) {
    const calls = [];
    const fetchMock = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const u = new URL(String(url));
      if (u.hostname === "api.github.com") {
        if (u.searchParams.get("page") === "2") return json([gh({ tag_name: "v1.14.0", name: "1.14.0" })]);
        return json([gh(), gh({ tag_name: "v1.14.1", name: "1.14.1" })], {
          link: '<https://api.github.com/repos/x/releases?per_page=100&page=2>; rel="next"',
        });
      }
      if (init.method === "POST") return new Response("", { status: postStatus });
      // GitLab release list, two pages.
      if (u.searchParams.get("page") === "1") return json(gitlabExisting.slice(0, 1).map((t) => ({ tag_name: t })), { "x-next-page": "2" });
      return json(gitlabExisting.slice(1).map((t) => ({ tag_name: t })), { "x-next-page": "" });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("follows both paginations and creates only the missing releases, with each side's token", async () => {
    const calls = stubFetch({ gitlabExisting: ["v1.14.0", "v1.14.1"] });
    await expect(main(env)).resolves.toEqual(["v1.14.2"]);
    const posts = calls.filter((c) => c.init.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://gitlab.invalid/api/v4/projects/7/releases");
    expect(posts[0].init.headers["PRIVATE-TOKEN"]).toBe("gl-t");
    expect(JSON.parse(posts[0].init.body).tag_name).toBe("v1.14.2");
    const githubCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/"));
    expect(githubCalls).toHaveLength(2);
    expect(githubCalls.every((c) => c.init.headers.Authorization === "Bearer gh-t")).toBe(true);
    expect(calls.filter((c) => c.url.includes("/releases?per_page=100&page=")).length).toBe(3);
  });

  it("creates nothing on a re-run", async () => {
    const calls = stubFetch({ gitlabExisting: ["v1.14.0", "v1.14.1", "v1.14.2"] });
    await expect(main(env)).resolves.toEqual([]);
    expect(calls.filter((c) => c.init.method === "POST")).toEqual([]);
  });

  it("fails loudly when GitLab refuses a release", async () => {
    stubFetch({ gitlabExisting: ["v1.14.0", "v1.14.1"], postStatus: 403 });
    await expect(main(env)).rejects.toThrow("creating the GitLab release v1.14.2 failed: 403");
  });

  it("refuses to run without its variables", async () => {
    await expect(main({ ...env, GITLAB_SYNC_TOKEN: "" })).rejects.toBeInstanceOf(MissingVariableError);
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
