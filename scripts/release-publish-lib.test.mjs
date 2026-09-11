import { describe, expect, it } from "vitest";
import { ARTIFACT_JOB, buildAssetUrl, buildReleasePayload, installerName } from "./release-publish-lib.mjs";

const ENV = {
  CI_PROJECT_URL: "https://gitlab.example.com/group/aipm-cockpit",
  CI_COMMIT_TAG: "v0.301.0",
  CI_JOB_TOKEN: "super-secret-token",
};

// Reads of any env key outside this set throw, so a test built on this proves
// the lib never TOUCHES a secret -- not merely that it never stringifies one
// verbatim into the payload. A mutant that base64-encodes CI_JOB_TOKEN into
// the body, or reads CI_REGISTRY_PASSWORD into an unused field, survives a
// plain "does the serialised payload contain the token" test but not this
// one, because the read itself throws before the value can go anywhere.
const READABLE_ENV_KEYS = new Set(["CI_PROJECT_URL", "CI_COMMIT_TAG"]);
const envThatThrowsOnSecretReads = (env) =>
  new Proxy(env, {
    get(target, key) {
      if (typeof key === "string" && !READABLE_ENV_KEYS.has(key)) {
        throw new Error(`lib read env.${key}`);
      }
      return target[key];
    },
  });

// The Releases API's link_type enum -- docs.gitlab.com/api/releases/ "Create
// a release". "installer" is not a member; only these four are.
const RELEASE_LINK_TYPES = ["other", "runbook", "image", "package"];

describe("buildAssetUrl", () => {
  // ★★★ PER-TAG, NEVER PER-JOB-ID. A /-/jobs/<id>/artifacts/ URL dies the
  // moment the job is re-run; the per-tag form keeps resolving.
  it("builds a per-tag artifact URL naming the producing job", () => {
    expect(buildAssetUrl(ENV, "0.301.0")).toBe(
      "https://gitlab.example.com/group/aipm-cockpit/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag",
    );
  });

  it("names the job the artifact actually comes from", () => {
    expect(ARTIFACT_JOB).toBe("desktop-package-tag");
    expect(buildAssetUrl(ENV, "0.301.0")).toContain(`?job=${ARTIFACT_JOB}`);
  });

  it("refuses when the tag is missing", () => {
    expect(() => buildAssetUrl({ ...ENV, CI_COMMIT_TAG: "" }, "0.301.0")).toThrow(/CI_COMMIT_TAG/);
  });

  it("refuses when the project URL is missing", () => {
    expect(() => buildAssetUrl({ ...ENV, CI_PROJECT_URL: "" }, "0.301.0")).toThrow(/CI_PROJECT_URL/);
  });

  // required()'s emptiness check trims before comparing -- a blank-but-not-
  // literally-empty CI_COMMIT_TAG (e.g. a stray space from a malformed rules:
  // match) must refuse exactly like a truly empty one.
  it("refuses a whitespace-only tag", () => {
    expect(() => buildAssetUrl({ ...ENV, CI_COMMIT_TAG: "  " }, "0.301.0")).toThrow(/CI_COMMIT_TAG/);
  });

  it("refuses an empty or whitespace version", () => {
    expect(() => buildAssetUrl(ENV, "")).toThrow(/version/);
    expect(() => buildAssetUrl(ENV, "   ")).toThrow(/version/);
  });
});

describe("installerName", () => {
  // ★★★ FAILS CLOSED on anything that is not a plain semver, rather than
  // trying to URL-encode it. "#" is a legal character in a git ref and starts
  // a URL FRAGMENT -- left unescaped it would silently truncate the asset URL
  // instead of surfacing as an error.
  it("refuses a version that is not a plain semver string", () => {
    expect(() => installerName("0.301.0#x")).toThrow(/version/);
    expect(() => installerName("")).toThrow(/version/);
  });

  it("accepts a plain semver version, with or without a pre-release tag", () => {
    expect(installerName("0.301.0")).toBe("aipm-cockpit-0.301.0-setup.exe");
    expect(installerName("0.301.0-rc.1")).toBe("aipm-cockpit-0.301.0-rc.1-setup.exe");
  });
});

describe("buildReleasePayload", () => {
  it("names the release with the version and milestone", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(p.tag_name).toBe("v0.301.0");
    expect(p.name).toBe('AI PM Cockpit 0.301.0 "Arnason"');
  });

  it("attaches exactly one asset link, pointing at the installer", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(p.assets.links).toHaveLength(1);
    expect(p.assets.links[0].url).toBe(buildAssetUrl(ENV, "0.301.0"));
    expect(p.assets.links[0].name).toContain("aipm-cockpit-0.301.0-setup.exe");
  });

  // The Releases API's link_type enum is other|runbook|image|package --
  // "installer" is not a member, and pinning it to "package" (rather than any
  // accepted-but-unintended member such as "other") keeps the semantics
  // right, not merely the request valid.
  it("uses link_type package, a value the Releases API accepts", () => {
    const [link] = buildReleasePayload(ENV, "0.301.0", "Arnason").assets.links;
    expect(RELEASE_LINK_TYPES).toContain(link.link_type);
    expect(link.link_type).toBe("package");
  });

  it("gives the description real content", () => {
    expect(buildReleasePayload(ENV, "0.301.0", "Arnason").description).toMatch(/SmartScreen/);
  });

  // ★ A real markdown link, not a code span naming the file -- the reader
  // should be able to click through to the tag's CHANGELOG.md directly.
  it("links CHANGELOG.md at the tag as a real markdown link, not a code span", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(p.description).toContain(
      "[CHANGELOG.md](https://gitlab.example.com/group/aipm-cockpit/-/blob/v0.301.0/CHANGELOG.md)",
    );
  });

  // ★★★ THE ONE ASSERTION THAT IS ABOUT SECRETS. The token authenticates the
  // request via a header; it must never reach the request BODY, which GitLab
  // renders publicly on the Releases page.
  it("never puts the job token in the payload", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(JSON.stringify(p)).not.toContain(ENV.CI_JOB_TOKEN);
  });

  // ★★★ THE KEY ONE. Proves the lib never so much as READS CI_JOB_TOKEN,
  // CI_REGISTRY_PASSWORD, or any other secret-shaped env var -- not merely
  // that none of them end up verbatim in the serialised payload, which the
  // test above this one already covers and a mutant that base64-encodes or
  // otherwise transforms a secret before writing it would survive.
  it("reads no env key but the two it needs", () => {
    expect(() => buildReleasePayload(envThatThrowsOnSecretReads(ENV), "0.301.0", "Arnason")).not.toThrow();
  });

  it("refuses when the milestone is missing", () => {
    expect(() => buildReleasePayload(ENV, "0.301.0", "")).toThrow(/milestone/i);
  });
});
