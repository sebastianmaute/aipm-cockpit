// @vitest-environment node
// Every exactly pinned (framework-coupled) package stays out of Dependabot's grouped PRs, so each
// arrives alone for a human decision (CONTRIBUTING "Dependencies"). The pinned set is DERIVED from
// each package.json, so a newly pinned package fails here until it is excluded too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A Windows checkout (core.autocrlf=true) has CRLF endings; the patterns below match "\n".
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pinned = (pkgPath) => {
  const p = JSON.parse(read(pkgPath));
  return Object.entries({ ...p.dependencies, ...p.devDependencies }).filter(([, v]) => /^\d/.test(v)).map(([k]) => k).sort();
};
const YML = read(".github/dependabot.yml");
const entry = (dir) => {
  const blocks = YML.split(/\n  - package-ecosystem: /).slice(1);
  return blocks.find((b) => b.startsWith("npm") && new RegExp(`\\n    directory: ${dir.replace("/", "\\/")}\\n`).test(b));
};
const excluded = (block) => [...block.matchAll(/exclude-patterns: \[([^\]]*)\]/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/"/g, ""))).sort();

describe("dependabot.yml", () => {
  it("covers github-actions, root npm and desktop npm, weekly", () => {
    expect(YML).toMatch(/- package-ecosystem: github-actions\n    directory: \//);
    expect(entry("/")).toBeTruthy();
    expect(entry("/desktop")).toBeTruthy();
    expect(YML.match(/interval: weekly/g)).toHaveLength(3);
  });
  // A cooldown holds VERSION updates back until a release has been public N days; it does not
  // delay security updates. Every entry carries it, so each block must match on its own.
  it("gives every update entry a cooldown (5 days, 14 for majors)", () => {
    const blocks = YML.split(/\n  - package-ecosystem: /).slice(1);
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b).toMatch(/\n    cooldown:\n(?:\s*#.*\n)*      default-days: 5\n      semver-major-days: 14(?:\n|$)/);
    }
  });
  it("has a minor-and-patch group in each npm directory", () => {
    for (const d of ["/", "/desktop"]) expect(entry(d)).toMatch(/update-types: \[minor, patch\]/);
  });
  // Each @vitest/* package peers on the exact vitest version, so the family must arrive as one PR
  // (Dependabot PR #415). Dependabot takes the FIRST group that matches, so the vitest group must
  // precede npm-minor-patch or vitest minors would land in that group without their plugins.
  it("moves the vitest family as one group, ahead of the minor-and-patch group", () => {
    const root = entry("/");
    expect(root).toMatch(/\n      vitest:\n        patterns: \[vitest, "@vitest\/\*"\]\n/);
    expect(root.indexOf("\n      vitest:")).toBeLessThan(root.indexOf("\n      npm-minor-patch:"));
  });
  // TypeScript 7 drops the compiler API the repo's parsers use (PR #413).
  it("ignores TypeScript majors in the root directory", () => {
    expect(entry("/")).toMatch(
      /\n    ignore:\n(?:\s*#.*\n)*      - dependency-name: typescript\n        update-types: \["version-update:semver-major"\](?:\n|$)/,
    );
  });
  it("excludes every exactly pinned package from the group", () => {
    expect(excluded(entry("/"))).toEqual(expect.arrayContaining(pinned("package.json")));
    expect(excluded(entry("/desktop"))).toEqual(expect.arrayContaining(pinned("desktop/package.json")));
    expect(pinned("desktop/package.json")).toContain("electron-updater");
  });
});
