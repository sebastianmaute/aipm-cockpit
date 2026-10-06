import { describe, expect, it } from "vitest";
import { headline, parseReleases, renderReleaseNotes, selectWindow } from "./release-notes-lib.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Fixed",
  "",
  "- **Unreleased fix.** Not shipped yet.",
  "",
  "## [1.2.0] - 2026-10-03 \"Cornwell\"",
  "",
  "### Changed",
  "",
  "- **Word lists are real Word lists (§154).** Bulleted and numbered lists",
  "  now export as lists.",
  "- A plain bullet without a bold lead. It has a second sentence.",
  "",
  "### Development",
  "",
  "- **Internal refactor.** Never user-facing.",
  "",
  "## [1.1.1] - 2026-09-28 \"Deaver\"",
  "",
  "### Fixed",
  "",
  "- **Saving no longer stalls.** Long text.",
  "",
  "### Security",
  "",
  "- `sharp` moves to 0.35.5, closing a high-severity issue.",
  "",
  "## [1.1.1-rc.1] - 2026-09-27 \"Deaver\"",
  "",
  "### Fixed",
  "",
  "- **Release candidate only.** Skipped.",
  "",
  "## [1.0.0] - 2026-08-01 \"Old\"",
  "",
  "### Added",
  "",
  "- **Out of the window.** Too old.",
  "",
].join("\n");

describe("parseReleases (§527)", () => {
  it("reads every dated version with its headings and bullets, and the Unreleased block", () => {
    const releases = parseReleases(CHANGELOG);
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ["Unreleased", null],
      ["1.2.0", "2026-10-03"],
      ["1.1.1", "2026-09-28"],
      ["1.1.1-rc.1", "2026-09-27"],
      ["1.0.0", "2026-08-01"],
    ]);
    const v120 = releases[1];
    expect(Object.keys(v120.sections)).toEqual(["Changed", "Development"]);
    expect(v120.sections.Changed[0]).toBe(
      "**Word lists are real Word lists (§154).** Bulleted and numbered lists now export as lists.",
    );
  });

  it("reads CRLF line endings the same way", () => {
    expect(parseReleases(CHANGELOG.replace(/\n/g, "\r\n"))).toEqual(parseReleases(CHANGELOG));
  });
});

describe("headline", () => {
  it("takes the bold lead when there is one, else the first sentence", () => {
    expect(headline("**Saving no longer stalls.** Long text.")).toBe("Saving no longer stalls.");
    expect(headline("A plain bullet without a bold lead. It has a second sentence.")).toBe(
      "A plain bullet without a bold lead.",
    );
    expect(headline("No full stop at all")).toBe("No full stop at all");
  });

  it("does not cut inside a version number or a backticked name", () => {
    expect(headline("`sharp` moves to 0.35.5, closing a high-severity issue.")).toBe(
      "`sharp` moves to 0.35.5, closing a high-severity issue.",
    );
  });
});

describe("selectWindow", () => {
  it("keeps released versions dated inside the window, inclusive, and drops pre-releases", () => {
    const picked = selectWindow(parseReleases(CHANGELOG), { since: "2026-09-28", until: "2026-10-03" });
    expect(picked.map((r) => r.version)).toEqual(["1.2.0", "1.1.1"]);
  });

  it("adds the Unreleased block only when asked", () => {
    const picked = selectWindow(parseReleases(CHANGELOG), { since: "2026-10-01", until: "2026-10-06", unreleased: true });
    expect(picked.map((r) => r.version)).toEqual(["Unreleased", "1.2.0"]);
  });
});

describe("renderReleaseNotes", () => {
  it("merges the user-facing headings across versions, tags each line with its version, and skips Development", () => {
    const releases = selectWindow(parseReleases(CHANGELOG), { since: "2026-09-28", until: "2026-10-03" });
    expect(renderReleaseNotes(releases, { since: "2026-09-28", until: "2026-10-03" })).toBe(
      [
        "# Release notes, 2026-09-28 to 2026-10-03",
        "",
        "Versions: 1.2.0 (2026-10-03), 1.1.1 (2026-09-28).",
        "",
        "## Changed",
        "",
        "- Word lists are real Word lists (§154). (1.2.0)",
        "- A plain bullet without a bold lead. (1.2.0)",
        "",
        "## Fixed",
        "",
        "- Saving no longer stalls. (1.1.1)",
        "",
        "## Security",
        "",
        "- `sharp` moves to 0.35.5, closing a high-severity issue. (1.1.1)",
        "",
      ].join("\n"),
    );
  });

  it("says so when no version falls in the window", () => {
    expect(renderReleaseNotes([], { since: "2026-01-01", until: "2026-01-07" })).toBe(
      "# Release notes, 2026-01-01 to 2026-01-07\n\nNo release in this window.\n",
    );
  });

  it("names the Unreleased block as not yet released", () => {
    const releases = selectWindow(parseReleases(CHANGELOG), { since: "2026-10-04", until: "2026-10-06", unreleased: true });
    const notes = renderReleaseNotes(releases, { since: "2026-10-04", until: "2026-10-06" });
    expect(notes).toContain("Versions: not yet released.");
    expect(notes).toContain("- Unreleased fix. (not yet released)");
  });
});
