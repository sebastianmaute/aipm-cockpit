import { describe, expect, it } from "vitest";
import {
  INSTALLER_DIR, LATEST_YML, installerName, expectedAssets, releaseTitle, changelogSection,
  releaseNotes, unwrapMarkdown, parseLatestYml, checkLatestYml, classifyRelease, verifyDraft,
} from "./release-publish-lib.mjs";

const SHA512 = "A".repeat(86) + "==";
const LATEST = (over = {}) => {
  const o = { version: "1.14.0", url: "aipm-cockpit-1.14.0-setup.exe", sha512: SHA512, size: 137285908, path: "aipm-cockpit-1.14.0-setup.exe", ...over };
  return [
    `version: ${o.version}`,
    "files:",
    `  - url: ${o.url}`,
    `    sha512: ${o.sha512}`,
    `    size: ${o.size}`,
    `path: ${o.path}`,
    `sha512: ${o.sha512}`,
    "releaseDate: '2026-09-30T10:00:00.000Z'",
    "",
  ].join("\n");
};
const INSTALLER = { name: "aipm-cockpit-1.14.0-setup.exe", sha512: SHA512, size: 137285908 };

describe("names", () => {
  it("builds the installer name and rejects anything that is not semver", () => {
    expect(installerName("1.14.0")).toBe("aipm-cockpit-1.14.0-setup.exe");
    expect(installerName("1.14.0-rc.1")).toBe("aipm-cockpit-1.14.0-rc.1-setup.exe");
    expect(() => installerName("v1.14.0")).toThrow();
    expect(() => installerName("1.14")).toThrow();
  });
  it("expects exactly the installer, its blockmap and latest.yml", () => {
    expect(expectedAssets("1.14.0")).toEqual([
      "aipm-cockpit-1.14.0-setup.exe", "aipm-cockpit-1.14.0-setup.exe.blockmap", LATEST_YML,
    ]);
    expect(INSTALLER_DIR).toBe("desktop/release");
  });
  it("titles a release like the GitLab ones did", () => {
    expect(releaseTitle("1.14.0", "Le Guin")).toBe('AI PM Cockpit 1.14.0 "Le Guin"');
    expect(() => releaseTitle("1.14.0", " ")).toThrow(/milestone/);
  });
});

const CHANGELOG = [
  "# Changelog", "", "Intro.", "",
  '## [1.14.0] - 2026-09-30 "Le Guin"', "", "Auto-update arrives.", "", "### Added", "", "- Updates.", "",
  '## [1.13.2] - 2026-09-22 "Connelly"', "", "Older.", "",
].join("\n");

describe("release notes", () => {
  it("takes exactly the version's CHANGELOG section, without its heading", () => {
    expect(changelogSection(CHANGELOG, "1.14.0")).toBe("Auto-update arrives.\n\n### Added\n\n- Updates.");
    expect(changelogSection(CHANGELOG, "1.13.2")).toBe("Older.");
    expect(changelogSection(CHANGELOG, "1.14")).toBeNull();
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });
  it("appends the unsigned-installer notice and refuses a missing section", () => {
    const notes = releaseNotes(CHANGELOG, "1.14.0");
    expect(notes.startsWith("Auto-update arrives.")).toBe(true);
    expect(notes).toMatch(/not code-signed/);
    expect(notes).toMatch(/SmartScreen/);
    expect(() => releaseNotes(CHANGELOG, "9.9.9")).toThrow(/CHANGELOG\.md has no section/);
  });
  // GitHub renders every newline in a release body as <br>, so a CHANGELOG hard-wrapped at ~100
  // columns showed as broken lines on the release page and in the desktop update dialog (1.14.0).
  it("unwraps hard-wrapped paragraphs and list items, keeping block structure", () => {
    const wrapped = [
      "A paragraph that", "wraps twice", "here.", "",
      "### Added", "",
      "- **Item one** that", "  wraps.", "- Item two.", "  1. nested", "     wrap", "",
      "```", "code line", "second code line", "```", "",
      "| a | b |", "| - | - |", "",
      "---", "",
      "Last.",
    ].join("\n");
    expect(unwrapMarkdown(wrapped)).toBe([
      "A paragraph that wraps twice here.", "",
      "### Added", "",
      "- **Item one** that wraps.", "- Item two.", "  1. nested wrap", "",
      "```", "code line", "second code line", "```", "",
      "| a | b |", "| - | - |", "",
      "---", "",
      "Last.",
    ].join("\n"));
  });
  it("publishes notes with no line that continues the one before it", () => {
    const cl = ['## [2.0.0] - 2026-10-01 "X"', "", "First line of a", "wrapped paragraph.", "", "- An item", "  wrapped.", ""].join("\n");
    const notes = releaseNotes(cl, "2.0.0");
    expect(notes).toMatch(/^First line of a wrapped paragraph\.\n\n- An item wrapped\.\n/);
    expect(notes).toMatch(/on first run: \*\*More info → Run anyway\*\*\. It installs/);
  });
});

describe("latest.yml", () => {
  it("parses electron-builder's layout", () => {
    expect(parseLatestYml(LATEST())).toEqual({
      version: "1.14.0", path: INSTALLER.name, sha512: SHA512, size: 137285908,
      files: [{ url: INSTALLER.name, sha512: SHA512, size: 137285908 }],
    });
  });
  it("throws on a shape it cannot read", () => {
    expect(() => parseLatestYml("nonsense: true\n")).toThrow(/latest\.yml/);
  });
  it("accepts a file that describes this installer", () => {
    expect(checkLatestYml(LATEST(), "1.14.0", INSTALLER)).toEqual([]);
  });
  it("names every mismatch", () => {
    expect(checkLatestYml(LATEST({ version: "1.13.2" }), "1.14.0", INSTALLER)).toEqual([
      "latest.yml version is 1.13.2, expected 1.14.0",
    ]);
    const stale = checkLatestYml(LATEST({ sha512: "B".repeat(86) + "==" }), "1.14.0", INSTALLER);
    expect(stale).toContain("latest.yml sha512 does not match the installer");
    expect(stale).toContain("latest.yml files[0].sha512 does not match the installer");
    expect(checkLatestYml(LATEST({ size: 1 }), "1.14.0", INSTALLER)).toContain(
      "latest.yml files[0].size is 1, the installer is 137285908 bytes",
    );
    expect(checkLatestYml(LATEST({ path: "other.exe" }), "1.14.0", INSTALLER)).toContain(
      "latest.yml path is other.exe, expected aipm-cockpit-1.14.0-setup.exe",
    );
    expect(checkLatestYml("junk", "1.14.0", INSTALLER)[0]).toMatch(/cannot read latest\.yml/);
  });
});

const EXPECTED = {
  tag: "v1.14.0", prerelease: false,
  assets: [{ name: "a.exe", size: 3, sha256: "aa" }, { name: "latest.yml", size: 2, sha256: "bb" }],
};
const rel = (over = {}) => ({
  id: 7, tag_name: "v1.14.0", draft: false, prerelease: false,
  assets: [{ name: "a.exe", size: 3, digest: "sha256:aa" }, { name: "latest.yml", size: 2, digest: "sha256:bb" }],
  ...over,
});

describe("classifyRelease", () => {
  it("absent when no release carries the tag", () => {
    expect(classifyRelease([rel({ tag_name: "v1.13.2" })], EXPECTED).state).toBe("absent");
    expect(classifyRelease([], EXPECTED).state).toBe("absent");
  });
  it("draft when an unpublished release carries the tag, whatever its files", () => {
    expect(classifyRelease([rel({ draft: true, assets: [] })], EXPECTED)).toEqual({ state: "draft", id: 7 });
  });
  it("identical when published with exactly these files", () => {
    expect(classifyRelease([rel()], EXPECTED).state).toBe("identical");
  });
  it("conflict on any difference, naming it", () => {
    expect(classifyRelease([rel({ prerelease: true })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/prerelease/) });
    expect(classifyRelease([rel({ assets: [rel().assets[0]] })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/latest\.yml/) });
    expect(classifyRelease([rel({ assets: [{ ...rel().assets[0], digest: "sha256:zz" }, rel().assets[1]] })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/a\.exe/) });
    expect(classifyRelease([rel({ assets: [...rel().assets, { name: "x", size: 1, digest: "sha256:x" }] })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/unexpected file x/) });
  });
  it("treats a missing digest as a conflict, never as a match", () => {
    expect(classifyRelease([rel({ assets: [{ name: "a.exe", size: 3 }, rel().assets[1]] })], EXPECTED).state).toBe("conflict");
  });
  it("refuses two releases for one tag", () => {
    expect(classifyRelease([rel(), rel({ id: 8 })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/2 releases/) });
  });
});

describe("verifyDraft", () => {
  it("ok when the still-draft release already carries exactly the expected files and flag", () => {
    expect(verifyDraft([rel({ draft: true })], EXPECTED)).toEqual({ ok: true });
  });
  it("flags the same mismatches classifyRelease would, while the release is still a draft", () => {
    expect(verifyDraft([rel({ draft: true, assets: [rel().assets[0]] })], EXPECTED)).toMatchObject({
      ok: false, detail: expect.stringMatching(/latest\.yml/),
    });
    expect(verifyDraft([rel({ draft: true, prerelease: true })], EXPECTED)).toMatchObject({
      ok: false, detail: expect.stringMatching(/prerelease/),
    });
  });
  it("treats a missing digest as a mismatch, never as a match", () => {
    expect(verifyDraft([rel({ draft: true, assets: [{ name: "a.exe", size: 3 }, rel().assets[1]] })], EXPECTED).ok).toBe(false);
  });
  it("refuses when the tag is missing or ambiguous right after create", () => {
    expect(verifyDraft([], EXPECTED)).toMatchObject({ ok: false, detail: expect.stringMatching(/no release/) });
    expect(verifyDraft([rel({ draft: true }), rel({ draft: true, id: 8 })], EXPECTED)).toMatchObject({
      ok: false, detail: expect.stringMatching(/2 releases/),
    });
  });
});
