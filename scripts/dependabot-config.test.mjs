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
  it("groups minor and patch only", () => {
    for (const d of ["/", "/desktop"]) expect(entry(d)).toMatch(/update-types: \[minor, patch\]/);
  });
  it("excludes every exactly pinned package from the group", () => {
    expect(excluded(entry("/"))).toEqual(expect.arrayContaining(pinned("package.json")));
    expect(excluded(entry("/desktop"))).toEqual(expect.arrayContaining(pinned("desktop/package.json")));
    expect(pinned("desktop/package.json")).toContain("electron-updater");
  });
});
