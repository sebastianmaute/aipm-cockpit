// Tests for the version-sync gate's shared layer.
//
// ★★ Every case here runs against FIXTURE STRINGS, never the real repo files.
// A test that reads package.json passes or fails depending on whether someone
// happens to be mid-release, which makes it a clock rather than a test.
import { describe, expect, it } from "vitest";

import { SATELLITES, applyValue, readSourceFrom, readValue } from "./version-sync-lib.mjs";

const sat = (file) => {
  const s = SATELLITES.find((x) => x.file === file);
  if (!s) throw new Error(`no satellite descriptor for ${file}`);
  return s;
};

const PKG = '{\r\n  "name": "aipm-cockpit",\r\n  "version": "0.260.1",\r\n  "private": true\r\n}\r\n';
const LOCK_ROOT = '{\r\n  "name": "aipm-cockpit",\r\n  "version": "0.260.1",\r\n  "lockfileVersion": 3,\r\n';
const LOCK_PKGS =
  '  "packages": {\r\n    "": {\r\n      "name": "aipm-cockpit",\r\n      "version": "0.260.1",\r\n' +
  '      "dependencies": {\r\n        "left-pad": {\r\n          "version": "1.1.1"\r\n';
const LOCK = LOCK_ROOT + LOCK_PKGS;
const BADGE =
  "[![version](https://img.shields.io/badge/version-v0.260.1_%22Cho%22-2e7d32)](./CHANGELOG.md)\n";
const CODEMAP = '<!-- Generated: 2026-07-30 | App 0.260.1 "Cho" | Files scanned: 1808 -->\n';

describe("readSourceFrom", () => {
  it("reads the version and the codename", () => {
    const src = 'export const APP_VERSION = "1.2.3";\nexport const APP_MILESTONE = "Zelazny";\n';
    expect(readSourceFrom(src)).toEqual({ version: "1.2.3", milestone: "Zelazny" });
  });

  it("throws rather than returning a partial reading when a declaration is gone", () => {
    // A probe that silently reports IN SYNC because its regex stopped matching
    // is the failure mode this register keeps recording.
    expect(() => readSourceFrom('export const APP_MILESTONE = "Zelazny";\n')).toThrow(/APP_VERSION/);
    expect(() => readSourceFrom('export const APP_VERSION = "1.2.3";\n')).toThrow(/APP_MILESTONE/);
  });
});

describe("readValue", () => {
  it("reads package.json's version", () => {
    expect(readValue(sat("package.json"), PKG)).toEqual({ version: "0.260.1" });
  });

  it("reads BOTH of package-lock.json's versions", () => {
    expect(readValue(sat("package-lock.json"), LOCK)).toEqual({
      version: "0.260.1",
      version2: "0.260.1",
    });
  });

  it("reads the README badge's version AND codename", () => {
    expect(readValue(sat("README.md"), BADGE)).toEqual({ version: "0.260.1", milestone: "Cho" });
  });

  it("reads a codemap header's version AND codename", () => {
    expect(readValue(sat("docs/CODEMAPS/*.md"), CODEMAP)).toEqual({
      version: "0.260.1",
      milestone: "Cho",
    });
  });

  it("throws when the shape it depends on has moved", () => {
    expect(() => readValue(sat("README.md"), "[![version](no-badge-here)]\n")).toThrow(/README\.md/);
  });
});

describe("applyValue", () => {
  it("rewrites package.json's version and nothing else", () => {
    const out = applyValue(sat("package.json"), PKG, "9.9.9", "Zelazny");
    expect(out).toContain('"version": "9.9.9"');
    expect(out).toContain('"private": true');
    expect(readValue(sat("package.json"), out)).toEqual({ version: "9.9.9" });
  });

  it("rewrites BOTH lock versions and leaves dependency pins untouched", () => {
    // The whole reason both regexes anchor on the "name" line above them:
    // package-lock.json carries 681 "version" keys in the real repo.
    const out = applyValue(sat("package-lock.json"), LOCK, "9.9.9", "Zelazny");
    expect(readValue(sat("package-lock.json"), out)).toEqual({
      version: "9.9.9",
      version2: "9.9.9",
    });
    expect(out).toContain('"version": "9.9.9"');
    // The dependency pin is a DIFFERENT version on purpose: if it shared the
    // target version, a writer that rewrote every "version" key would still
    // satisfy this assertion.
    expect(out).toContain('"left-pad": {\r\n          "version": "1.1.1"');
  });

  it("rewrites the README badge's version and codename together", () => {
    const out = applyValue(sat("README.md"), BADGE, "9.9.9", "Zelazny");
    expect(readValue(sat("README.md"), out)).toEqual({ version: "9.9.9", milestone: "Zelazny" });
    expect(out).toContain("-2e7d32)](./CHANGELOG.md)");
  });

  it("rewrites a codemap header and leaves the rest of the comment alone", () => {
    const out = applyValue(sat("docs/CODEMAPS/*.md"), CODEMAP, "9.9.9", "Zelazny");
    expect(readValue(sat("docs/CODEMAPS/*.md"), out)).toEqual({
      version: "9.9.9",
      milestone: "Zelazny",
    });
    expect(out).toContain("Files scanned: 1808");
    expect(out).toContain("Generated: 2026-07-30");
  });

  it("preserves CRLF in a CRLF fixture and LF in an LF fixture", () => {
    // package.json and package-lock.json are CRLF in the working tree under
    // core.autocrlf; *.md is pinned LF by .gitattributes. A writer that
    // normalises either one re-lines the file invisibly to `git diff`.
    const crlf = applyValue(sat("package.json"), PKG, "9.9.9", "Zelazny");
    expect(crlf.includes("\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(crlf)).toBe(false);

    const lf = applyValue(sat("README.md"), BADGE, "9.9.9", "Zelazny");
    expect(lf.includes("\r")).toBe(false);
  });

  it("is a no-op when the value already matches", () => {
    expect(applyValue(sat("package.json"), PKG, "0.260.1", "Cho")).toBe(PKG);
  });
});
