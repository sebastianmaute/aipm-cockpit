import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yml = readFileSync(join(import.meta.dirname, "../ci/gitlab-sync.yml"), "utf8");
const lines = yml.split(/\r?\n/);

describe("ci/gitlab-sync.yml", () => {
  // §646 — these tests match TEXT and never parsed the file, so a script line that YAML cannot
  // read passed them all and GitLab rejected the whole file ("Invalid YAML syntax"), which also
  // stopped the sync. No YAML parser is a dependency here, so this pins the rule that bit: in an
  // UNQUOTED sequence item, ": " makes YAML read a mapping and " #" starts a comment. An item that
  // needs either must be quoted.
  it("quotes every script item that YAML would otherwise misread (§646)", () => {
    const items = lines
      .map((l, i) => ({ n: i + 1, m: /^\s*- (.*)$/.exec(l) }))
      .filter(({ m }) => m && !/^['"|>]/.test(m[1]) && !/^[A-Za-z_]+:( |$)/.test(m[1]));
    expect(items.length).toBeGreaterThan(3);
    const bad = items.filter(({ m }) => /: |\s#/.test(m[1])).map(({ n }) => n);
    expect(bad).toEqual([]);
  });

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

  it("removes the clone target before cloning, at a fixed known path", () => {
    // GIT_STRATEGY: none can leave the build dir (and github.git inside it) from a prior run, so
    // `git clone --mirror` fails "already exists" on the 2nd run unless the target is cleared first.
    const cloneIdx = lines.findIndex((l) => /git clone --quiet --mirror/.test(l));
    const rmIdx = lines.findIndex((l) => /^\s*- rm -rf /.test(l));
    expect(cloneIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeLessThan(cloneIdx);
    // Fixed and known, not built from a variable `script:` set earlier — after_script cannot see one.
    expect(lines[rmIdx]).not.toMatch(/\$\(/);
  });

  it("removes the same fixed path again in after_script, which runs in a separate shell", () => {
    const afterIdx = lines.findIndex((l) => /^\s*after_script:/.test(l));
    expect(afterIdx).toBeGreaterThan(-1);
    const afterBlock = lines.slice(afterIdx).join("\n");
    const afterRm = afterBlock.match(/^\s*- rm -rf (\S+)/m);
    expect(afterRm).not.toBeNull();
    const scriptRm = lines.find((l) => /^\s*- rm -rf /.test(l)).match(/rm -rf (\S+)/)[1];
    expect(afterRm[1]).toBe(scriptRm);
  });

  it("strips the token from the cloned repo's stored remote URL right after cloning", () => {
    const cloneIdx = lines.findIndex((l) => /git clone --quiet --mirror/.test(l));
    const resetIdx = lines.findIndex((l) => /remote set-url origin/.test(l));
    expect(resetIdx).toBeGreaterThan(cloneIdx);
    const resetLine = lines[resetIdx];
    expect(resetLine).toMatch(/https:\/\/github\.com\/sebastianmaute\/aipm-cockpit\.git/);
    expect(resetLine).not.toMatch(/TOKEN/);
  });

  it("runs under a resource group so a manual run cannot overlap the schedule", () => {
    expect(yml).toMatch(/^\s*resource_group: gitlab-sync\s*$/m);
  });

  it("documents in the header that --prune deletes GitLab tags/branches removed on GitHub", () => {
    const header = lines.slice(0, lines.findIndex((l) => /^sync-from-github:/.test(l))).join("\n");
    expect(header).toMatch(/--prune/);
    expect(header).toMatch(/delete/i);
  });
});

describe("ci/gitlab-sync.yml — mirror-releases (§640)", () => {
  const start = lines.findIndex((l) => /^mirror-releases:/.test(l));
  const job = lines.slice(start).join("\n");

  it("exists as a separate job that runs after the sync pushed the tags", () => {
    expect(start).toBeGreaterThan(lines.findIndex((l) => /^sync-from-github:/.test(l)));
    expect(job).toMatch(/^\s*needs: \[sync-from-github\]\s*$/m);
    expect(job).toMatch(/^\s*resource_group: gitlab-sync\s*$/m);
  });

  it("fails fast when a token is missing, and uses its own release token, not the push token", () => {
    expect(job).toMatch(/test -n "\$GITHUB_SYNC_TOKEN" && test -n "\$GITLAB_RELEASE_TOKEN"/);
    expect(job).toMatch(/exit 2/);
    expect(job).not.toMatch(/GITLAB_SYNC_TOKEN/);
  });

  it("runs the script as it is on GitHub main, fetched through the contents API", () => {
    expect(job).toContain("https://api.github.com/repos/sebastianmaute/aipm-cockpit/contents/scripts/gitlab-release-mirror.mjs?ref=main");
    expect(job).toMatch(/node \/tmp\/gitlab-release-mirror\.mjs/);
    expect(job).toContain('--header "Accept: application/vnd.github.raw"');
    expect(job).toMatch(/^\s*image: node:22-alpine\s*$/m);
  });

  it("pushes nothing and names no GitLab host", () => {
    expect(job).not.toMatch(/git push/);
    const urls = [...job.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => !/^https:\/\/(api\.)?github\.com\//.test(u))).toEqual([]);
  });
});
