import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_JOB,
  INSTALLER_DIR,
  buildAssetUrl,
  buildReleasePayload,
  classifyCreateResponse,
  classifyExistingRelease,
  expectedFromPayload,
  installerName,
} from "./release-publish-lib.mjs";

const ENV = {
  CI_PROJECT_URL: "https://gitlab.acme-corp.example/group/aipm-cockpit",
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
      "https://gitlab.acme-corp.example/group/aipm-cockpit/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag",
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
      "[CHANGELOG.md](https://gitlab.acme-corp.example/group/aipm-cockpit/-/blob/v0.301.0/CHANGELOG.md)",
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

// The (status, json) shapes publish-release.mjs classifies. EXPECTED is what
// expectedFromPayload() returns for ENV's payload -- the first
// expectedFromPayload test pins that, so these literals cannot drift from the
// real builder.
const EXPECTED = {
  tagName: "v0.301.0",
  assetUrl:
    "https://gitlab.acme-corp.example/group/aipm-cockpit/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag",
};
const OTHER_URL = "https://example.com/other-file.exe";
const OUR_LINK = () => ({ url: EXPECTED.assetUrl });
const withLinks = (...links) => ({ tag_name: EXPECTED.tagName, assets: { links } });
const withOurLink = () => withLinks(OUR_LINK());

// Every non-success message is a real sentence with a known prefix, never ""
// -- a blank message reaches the job log as a bare "[release:publish] " line.
const CANNOT_CONFIRM = /^CANNOT CONFIRM: \S/;
const REFUSED = /^API refused: HTTP 4\d\d/;

// Each row is an `expected` the classifiers must refuse, paired with the body
// that would VACUOUSLY confirm it if they did not -- `undefined === undefined`
// on both comparisons once made `C(201, {assets:{links:[{}]}}, {})` "created".
const BAD_EXPECTED = [
  ["undefined", undefined, { assets: { links: [{}] } }],
  ["null", null, { assets: { links: [{}] } }],
  ["{}", {}, { assets: { links: [{}] } }],
  ["a string", "v0.301.0", { assets: { links: [{}] } }],
  ["tagName only", { tagName: EXPECTED.tagName }, withLinks({})],
  ["assetUrl only", { assetUrl: EXPECTED.assetUrl }, { assets: { links: [OUR_LINK()] } }],
  ["whitespace values", { tagName: "  ", assetUrl: "  " }, { tag_name: "  ", assets: { links: [{ url: "  " }] } }],
];

describe("expectedFromPayload", () => {
  it("reads the tag and the one asset URL out of the payload being sent", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(expectedFromPayload(p)).toEqual(EXPECTED);
    expect(EXPECTED.assetUrl).toBe(buildAssetUrl(ENV, "0.301.0"));
  });

  // The round trip the CLI makes: the server echoing our own payload back
  // is the one body that must confirm.
  it("confirms the payload's own echo as created", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(classifyCreateResponse(201, p, expectedFromPayload(p))).toEqual({ kind: "created" });
  });

  it("refuses a payload with no usable tag_name", () => {
    expect(() => expectedFromPayload({ assets: { links: [OUR_LINK()] } })).toThrow(/tag_name is missing/);
    expect(() => expectedFromPayload({ tag_name: "  ", assets: { links: [OUR_LINK()] } })).toThrow(/tag_name/);
  });

  it("refuses a payload whose one link has no usable url", () => {
    expect(() => expectedFromPayload(withLinks({}))).toThrow(/assets\.links\[0\]\.url is missing/);
    expect(() => expectedFromPayload(withLinks(null))).toThrow(/assets\.links\[0\]\.url/);
  });

  // The classifiers confirm ONE url; taking the first of several would
  // report a Release with some of its links missing as done.
  it("refuses a payload with zero asset links, or more than one", () => {
    expect(() => expectedFromPayload(withLinks())).toThrow(/exactly one asset link \(found 0\)/);
    expect(() => expectedFromPayload(withLinks(OUR_LINK(), { url: OTHER_URL }))).toThrow(/exactly one asset link \(found 2\)/);
    expect(() => expectedFromPayload({ tag_name: EXPECTED.tagName })).toThrow(/exactly one asset link \(found none\)/);
    expect(() => expectedFromPayload(undefined)).toThrow(/exactly one asset link/);
  });
});

describe("classifyCreateResponse", () => {
  // ★★★ THE CRITICAL DEFECT THIS CLASSIFIER EXISTS TO CLOSE. The plan's
  // original inline code accepted res.ok (any 2xx) as success; a fake-API
  // sandbox run measured a 200 HTML proxy page AND a POST answered 302 that
  // fetch silently re-followed as a GET (200 []) both exiting 0 "created".
  it("confirms creation ONLY on 201 with a matching tag and our asset link", () => {
    expect(classifyCreateResponse(201, withOurLink(), EXPECTED)).toEqual({ kind: "created" });
  });

  it("finds our link when it is not the first entry, past a null one", () => {
    expect(classifyCreateResponse(201, withLinks(null, { url: OTHER_URL }, OUR_LINK()), EXPECTED)).toEqual({
      kind: "created",
    });
  });

  it.each([
    ["another tag's body", { tag_name: "v0.999.0", assets: { links: [OUR_LINK()] } }],
    ["no tag_name", { assets: { links: [OUR_LINK()] } }],
    ["an empty link list", withLinks()],
    ["only another link", withLinks({ url: OTHER_URL })],
    ["a link with no url", withLinks({})],
    ["a link list that is not an array", { tag_name: EXPECTED.tagName, assets: { links: OUR_LINK() } }],
    ["no assets at all", { tag_name: EXPECTED.tagName }],
    ["a null body (unparsed)", null],
    ["an undefined body", undefined],
    ["an array body", []],
    ["an array carrying our tag and link", Object.assign([], withOurLink())],
  ])("refuses to confirm a 201 with %s, code 2", (_label, json) => {
    const r = classifyCreateResponse(201, json, EXPECTED);
    expect(r.kind).toBe("fail");
    expect(r.code).toBe(2);
    expect(r.message).toMatch(CANNOT_CONFIRM);
    expect(r.message).toMatch(/201 but the body lacks/);
  });

  // GitLab's Releases::CreateService answers 409 "Release already exists"
  // both for a real prior release AND for a create that actually SUCCEEDED
  // whose response was lost to a timeout/reset -- 409 must route to a
  // check, never a plain refusal that a retry would then fail FOREVER.
  it("routes a 409 to check-existing, never a plain refusal", () => {
    expect(classifyCreateResponse(409, { message: "Release already exists" }, EXPECTED)).toEqual({
      kind: "check-existing",
    });
  });

  // Every row sends OUR body, so the STATUS is the only thing that can make
  // it anything but "created" -- a mutant widening the 201 check to a range
  // turns the neighbouring rows into "created" and fails here.
  it.each([
    [0, 2, /unexpected HTTP status 0$/],
    [Number.NaN, 2, /unexpected HTTP status NaN$/],
    [100, 2, /unexpected HTTP status 100$/],
    [199, 2, /unexpected HTTP status 199$/],
    [200, 2, /HTTP 200 is not 201 Created/],
    [204, 2, /HTTP 204 is not 201 Created/],
    [299, 2, /HTTP 299 is not 201 Created/],
    [300, 2, /HTTP 300 redirect/],
    [302, 2, /HTTP 302 redirect/],
    [399, 2, /HTTP 399 redirect/],
    [400, 1, /^API refused: HTTP 400$/],
    [403, 1, /^API refused: HTTP 403 /],
    [404, 1, /^API refused: HTTP 404$/],
    [408, 2, /HTTP 408 is transient/],
    [429, 2, /HTTP 429 is transient/],
    [499, 1, /^API refused: HTTP 499$/],
    [500, 2, /HTTP 500 — the API, or a proxy in front of it, is erroring/],
    [502, 2, /HTTP 502 — the API/],
    [599, 2, /HTTP 599 — the API/],
    [600, 2, /unexpected HTTP status 600$/],
  ])("classifies HTTP %s as fail, code %s", (status, code, message) => {
    const r = classifyCreateResponse(status, withOurLink(), EXPECTED);
    expect(r.kind).toBe("fail");
    expect(r.code).toBe(code);
    expect(r.message).toMatch(code === 1 ? REFUSED : CANNOT_CONFIRM);
    expect(r.message).toMatch(message);
  });

  it("names the Developer+ and protected-tag requirement on a 403", () => {
    const { message } = classifyCreateResponse(403, {}, EXPECTED);
    expect(message).toMatch(/Developer\+/);
    expect(message).toMatch(/protected tags/);
  });

  it("gives no 403 advice on any other 4xx", () => {
    for (const status of [400, 401, 404, 422, 499]) {
      expect(classifyCreateResponse(status, {}, EXPECTED).message).not.toMatch(/Developer/);
    }
  });

  // ★★ DECIDED: 408 and 429 are TRANSIENT, not refusals. Retrying is safe
  // because of the 409 branch -- a create that did land answers 409 next
  // time, and classifyExistingRelease confirms it.
  it("treats 408 and 429 as transient and retry-safe, never the refusal code", () => {
    for (const status of [408, 429]) {
      const r = classifyCreateResponse(status, null, EXPECTED);
      expect(r.code).toBe(2);
      expect(r.message).toMatch(/safe to retry/);
    }
  });

  // fetch always reports a number, so a string is a caller bug. A string
  // "201" once coerced through the range checks and read "HTTP 201 is not
  // 201 Created".
  it.each([["201"], [undefined], [null]])("refuses a non-numeric status (%s), code 2", (status) => {
    const r = classifyCreateResponse(status, withOurLink(), EXPECTED);
    expect(r).toEqual({ kind: "fail", code: 2, message: expect.stringMatching(/non-numeric HTTP status/) });
    expect(r.message).not.toMatch(/201 Created/);
  });

  it.each(BAD_EXPECTED)("refuses to classify without a usable expected (%s), even a 201 or a 409", (_label, expected, json) => {
    for (const status of [201, 409]) {
      const r = classifyCreateResponse(status, json, expected);
      expect(r.kind).toBe("fail");
      expect(r.code).toBe(2);
      expect(r.message).toMatch(/no expected tagName and assetUrl/);
    }
  });
});

describe("classifyExistingRelease", () => {
  it("confirms an existing Release for our tag that already carries our link, code 0", () => {
    expect(classifyExistingRelease(200, withOurLink(), EXPECTED)).toEqual({
      code: 0,
      message: "release for v0.301.0 already exists with this asset link",
    });
  });

  it("finds our link when it is not the first entry, past a null one", () => {
    expect(classifyExistingRelease(200, withLinks(null, { url: OTHER_URL }, OUR_LINK()), EXPECTED).code).toBe(0);
  });

  it.each([
    ["only another link", withLinks({ url: OTHER_URL })],
    ["an empty link list", withLinks()],
  ])("flags a real conflict, code 1, when our tag's Release has %s", (_label, json) => {
    const r = classifyExistingRelease(200, json, EXPECTED);
    expect(r.code).toBe(1);
    expect(r.message).toMatch(/^a Release for v0\.301\.0 exists WITHOUT /);
    expect(r.message).toMatch(/Release links API/);
    expect(r.message).toMatch(/delete that Release/);
  });

  // "delete that Release" is advice to destroy something -- it may only be
  // given about a body that IS our tag's Release, with a link list we read.
  it.each([
    ["null (unparsed)", null],
    ["undefined", undefined],
    ["a string", "x"],
    ["an array", []],
    ["an array carrying our tag and link", Object.assign([], withOurLink())],
    ["{}", {}],
    ["another tag's Release carrying our link", { tag_name: "v0.999.0", assets: { links: [OUR_LINK()] } }],
    ["no tag_name", { assets: { links: [OUR_LINK()] } }],
    ["our tag with no assets", { tag_name: EXPECTED.tagName }],
    ["our tag with a link list that is not an array", { tag_name: EXPECTED.tagName, assets: { links: OUR_LINK() } }],
  ])("cannot confirm, code 2, a 200 whose body is %s", (_label, json) => {
    const r = classifyExistingRelease(200, json, EXPECTED);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(CANNOT_CONFIRM);
    expect(r.message).toMatch(/HTTP 200, but the body is not a Release for v0\.301\.0/);
  });

  // Every row sends OUR Release, so the status check alone is what makes it
  // code 2 -- a mutant widening `=== 200` to a range or to `<= 200` fails a row.
  it.each([[100], [199], [201], [204], [301], [404], [503]])(
    "cannot confirm, code 2, when reading the Release returns HTTP %s",
    (status) => {
      const r = classifyExistingRelease(status, withOurLink(), EXPECTED);
      expect(r.code).toBe(2);
      expect(r.message).toMatch(CANNOT_CONFIRM);
      expect(r.message).toMatch(new RegExp(`returned HTTP ${status}, not 200`));
    },
  );

  it.each([["200"], [undefined]])("refuses a non-numeric status (%s), code 2", (status) => {
    const r = classifyExistingRelease(status, withOurLink(), EXPECTED);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(/non-numeric HTTP status/);
  });

  it.each(BAD_EXPECTED)("refuses to classify without a usable expected (%s)", (_label, expected, json) => {
    const r = classifyExistingRelease(200, json, expected);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(/no expected tagName and assetUrl/);
  });
});

// ★★ The asset URL carries the tag UNENCODED (the CHANGELOG link encodes it),
// which is safe only while the tag is exactly "v" + a version installerName()
// has accepted. Each row below would otherwise put something else in the path.
describe("the tag must name the version", () => {
  it("refuses a tag that is not v + the version, in the URL and so in the payload", () => {
    for (const tag of ["v0.302.0", "0.301.0", "v0.301.0#x", "v0.301.0?job=other", "v0.301.0-rc.1"]) {
      const env = { ...ENV, CI_COMMIT_TAG: tag };
      expect(() => buildAssetUrl(env, "0.301.0"), tag).toThrow(/is not "v0\.301\.0"/);
      expect(() => buildReleasePayload(env, "0.301.0", "Arnason"), tag).toThrow(/is not "v0\.301\.0"/);
    }
  });

  it("accepts a pre-release tag that names its pre-release version", () => {
    const env = { ...ENV, CI_COMMIT_TAG: "v0.301.0-rc.1" };
    expect(buildAssetUrl(env, "0.301.0-rc.1")).toContain("/-/jobs/artifacts/v0.301.0-rc.1/raw/");
  });
});

// ★★★ THREE COUPLINGS NOTHING ELSE COMPARES, and each breaks the same way: a
// green pipeline over a Release whose download 404s. ARTIFACT_JOB must name a
// top-level job in .gitlab-ci.yml; INSTALLER_DIR and installerName() must be
// where desktop/electron-builder.yml writes the installer; and that job's
// artifact paths must upload it. A changed artifactName still passes the
// job's own `ls -l` guard and uploads -- only the LINK breaks.
// ★ The YAML is read as TEXT with anchored line regexes, so no YAML
// dependency. Paths resolve from process.cwd(), like the sibling script
// tests: import.meta.url is not a file: URL under vitest.
const CI_FILE = ".gitlab-ci.yml";
const EB_FILE = "desktop/electron-builder.yml";
const LIB_FILE = "scripts/release-publish-lib.mjs";
const readRepoFile = (file) => readFileSync(path.join(process.cwd(), file), "utf8");
const readLines = (file) => readRepoFile(file).split(/\r?\n/);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const indentOf = (line) => /^\s*/.exec(line)[0].length;
const isNoise = (line) => /^\s*(#.*)?$/.test(line);

/** The indented lines under a top-level `name:` key, up to the next column-0 line. */
function topLevelBlock(lines, name) {
  const key = new RegExp(`^${escapeRe(name)}:\\s*(#.*)?$`);
  const start = lines.findIndex((l) => key.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

/** The lines nested under the first `key:` line of `block`. */
function subBlock(block, key) {
  const re = new RegExp(`^\\s+${escapeRe(key)}:\\s*(#.*)?$`);
  const start = block.findIndex((l) => re.test(l));
  if (start < 0) return null;
  const indent = indentOf(block[start]);
  const end = block.findIndex((l, i) => i > start && !isNoise(l) && indentOf(l) <= indent);
  return block.slice(start + 1, end < 0 ? block.length : end);
}

/** The `artifacts: paths:` a job uploads -- its own, else its `extends:` base's. */
function artifactPaths(lines, job) {
  const block = topLevelBlock(lines, job);
  if (block === null) return null;
  const artifacts = subBlock(block, "artifacts") ?? [];
  const at = artifacts.findIndex((l) => /^\s+paths:/.test(l));
  if (at >= 0) {
    const inline = /^\s+paths:\s*\[(.*)\]\s*$/.exec(artifacts[at]);
    if (inline) return inline[1].split(",").map((p) => p.trim()).filter(Boolean);
    const items = [];
    for (const l of artifacts.slice(at + 1)) {
      if (isNoise(l)) continue;
      const item = /^\s+-\s+(\S+)\s*$/.exec(l);
      if (!item || indentOf(l) <= indentOf(artifacts[at])) break;
      items.push(item[1]);
    }
    return items;
  }
  // ★ `extends:` deep-merges hashes, so a job that sets only `expire_in`
  // still uploads its base's `paths` (the .desktop-package comment says so).
  const base = block.map((l) => /^\s+extends:\s*(\S+)\s*$/.exec(l)).find(Boolean);
  return base ? artifactPaths(lines, base[1]) : null;
}

/** A GitLab artifact glob as a RegExp -- `*` only; anything richer throws. */
function globToRe(glob) {
  if (/\*\*|[?[\]{}]/.test(glob)) throw new Error(`artifact glob "${glob}" uses syntax this test does not model`);
  return new RegExp(`^${glob.split("*").map(escapeRe).join("[^/]*")}$`);
}

describe("the lib's constants agree with the files they describe", () => {
  it("names a real job, the builder's real output, and a path that job uploads", () => {
    const version = "0.301.0";
    const ci = readLines(CI_FILE);
    const eb = readLines(EB_FILE);

    expect(topLevelBlock(ci, ARTIFACT_JOB), `${CI_FILE} has no top-level "${ARTIFACT_JOB}:" job, but ARTIFACT_JOB in ${LIB_FILE} names it`).not.toBeNull();

    const name = eb.map((l) => /^artifactName:\s*["']?([^"'\s]+)["']?\s*(#.*)?$/.exec(l)).find(Boolean)?.[1];
    expect(name?.replace(/\$\{version\}/g, version), `${EB_FILE} artifactName, with its version macro = ${version}, is not installerName() in ${LIB_FILE}`).toBe(installerName(version));

    // electron-builder lets a TARGET block (nsis:/win:) set its own artifactName,
    // which overrides the top-level one this test just checked -- so a nested
    // artifactName can drift from installerName() while the assertion above
    // stays green, and the published Release link 404s.
    expect(eb.some((l) => /^\s+artifactName:/.test(l)), `${EB_FILE}: a nested artifactName (under nsis:/win:) overrides the top-level one that installerName() in ${LIB_FILE} mirrors`).toBe(false);

    // electron-builder resolves directories.output against its PROJECT dir
    // (app-builder-lib packager.js), which desktop:package sets with --project.
    const projectDir = /--project\s+(\S+)/.exec(JSON.parse(readRepoFile("package.json")).scripts["desktop:package"] ?? "")?.[1];
    const output = (topLevelBlock(eb, "directories") ?? []).map((l) => /^\s+output:\s*["']?([^"'\s]+)["']?\s*(#.*)?$/.exec(l)).find(Boolean)?.[1];
    expect(projectDir && output && path.posix.join(projectDir, output), `${EB_FILE} directories.output, under package.json's --project dir, is not INSTALLER_DIR in ${LIB_FILE}`).toBe(INSTALLER_DIR);

    const target = `${INSTALLER_DIR}/${installerName(version)}`;
    const globs = artifactPaths(ci, ARTIFACT_JOB) ?? [];
    expect(globs.some((g) => globToRe(g).test(target)), `no artifacts path of ${ARTIFACT_JOB} in ${CI_FILE} (its own, or via extends:) matches ${target} from ${LIB_FILE}; found ${JSON.stringify(globs)}`).toBe(true);
  });
});
