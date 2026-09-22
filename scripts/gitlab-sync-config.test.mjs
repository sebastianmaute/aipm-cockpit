import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yml = readFileSync(join(import.meta.dirname, "../ci/gitlab-sync.yml"), "utf8");
const lines = yml.split(/\r?\n/);

describe("ci/gitlab-sync.yml", () => {
  it("runs only on a schedule or the manual Run pipeline button", () => {
    const ifs = lines.filter((l) => /^\s*- if:/.test(l));
    expect(ifs).toHaveLength(2);
    expect(ifs.join("\n")).toContain('$CI_PIPELINE_SOURCE == "schedule"');
    expect(ifs.join("\n")).toContain('$CI_PIPELINE_SOURCE == "web"');
    expect(yml).toMatch(/^\s*- when: never\s*$/m);
  });

  it("force-updates branches, keeps tags unforced, prunes, and skips CI on GitLab", () => {
    const push = lines.find((l) => /git push/.test(l)) ?? "";
    expect(push).toContain("--prune");
    expect(push).toContain("-o ci.skip");
    expect(push).toContain("'+refs/heads/*:refs/heads/*'");
    expect(push).toContain("'refs/tags/*:refs/tags/*'");
    expect(push).not.toContain("'+refs/tags/");
  });

  it("never pushes every ref (a mirror clone of GitHub carries refs/pull/*)", () => {
    expect(yml).not.toMatch(/push[^\n]*--mirror/);
    expect(yml).not.toMatch(/refs\/\*:/);
  });

  it("fails fast when a token is missing", () => {
    expect(yml).toMatch(/test -n "\$GITHUB_SYNC_TOKEN"/);
    expect(yml).toMatch(/test -n "\$GITLAB_SYNC_TOKEN"/);
    expect(yml).toMatch(/exit 2/);
  });

  it("clears the image's git ENTRYPOINT so the script runs at all", () => {
    expect(yml).toMatch(/entrypoint: \[""\]/);
  });

  it("never echoes a token", () => {
    // An echo's arguments run to the next ; or } — none may expand a *TOKEN variable.
    const echoed = [...yml.matchAll(/echo([^;}\n]*)/g)].map((m) => m[1]);
    expect(echoed.length).toBeGreaterThan(0);
    expect(echoed.filter((a) => /\$\{?\w*TOKEN/.test(a))).toEqual([]);
  });
});
