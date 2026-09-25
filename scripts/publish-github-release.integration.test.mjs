// @vitest-environment node
//
// The real CLI against a fake `gh` (a node script that keeps its state in a JSON file).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = join(process.cwd(), "scripts", "publish-github-release.mjs");
const VERSION = /export const APP_VERSION = "([^"]+)"/.exec(readFileSync("src/app/version.ts", "utf8"))[1];
const TAG = `v${VERSION}`;
const EXE = `aipm-cockpit-${VERSION}-setup.exe`;

const FAKE_GH = String.raw`
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const a = process.argv.slice(2);
state.calls.push(a.join(" "));
const save = () => fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
if (state.failOn && a.join(" ").includes(state.failOn)) { save(); process.stderr.write("boom"); process.exit(1); }
if (a[0] === "api" && a[1] === "-X" && a[2] === "DELETE") { state.releases = state.releases.filter((r) => !a[3].endsWith("/" + r.id)); save(); process.exit(0); }
if (a[0] === "api") {
  // Simulates the CONFIRMING re-list (after "release edit" flipped draft:false) throwing — gh or
  // network failure, ENOBUFS, bad JSON — distinct from a pre-publish list failing.
  if (state.failAfterEdit && state.editDone) { save(); process.stderr.write("boom-post-edit"); process.exit(1); }
  save();
  // --slurp: gh wraps each page's own response in an outer array; there's only ever one page here.
  const body = a.includes("--slurp") ? [state.releases] : state.releases;
  process.stdout.write(JSON.stringify(body));
  process.exit(0);
}
if (a[0] === "release" && a[1] === "create") {
  const files = a.slice(3).filter((x, i, all) => !x.startsWith("--") && !(all[i - 1] || "").match(/^--(repo|title|notes-file)$/));
  state.releases.push({ id: 100 + state.releases.length, tag_name: a[2], draft: true, prerelease: a.includes("--prerelease"),
    assets: files.map((f) => ({ name: require("path").basename(f), size: fs.statSync(f).size, digest: state.noDigest ? undefined : "sha256:" + sha(f) })) });
  save(); process.exit(0);
}
if (a[0] === "release" && a[1] === "edit") {
  const rel = state.releases.find((r) => r.tag_name === a[2]);
  rel.draft = false;
  state.editDone = true;
  // Simulates a still-published release drifting from what was just verified as a draft.
  if (state.corruptAfterEdit && rel.assets.length > 0) rel.assets[0].digest = "sha256:corrupted-after-publish";
  save(); process.exit(0);
}
save(); process.exit(3);
`;

function setup(state = {}) {
  const root = mkdtempSync(join(tmpdir(), "pub-"));
  const dir = join(root, "release");
  mkdirSync(dir);
  writeFileSync(join(dir, EXE), "exe-bytes");
  writeFileSync(join(dir, `${EXE}.blockmap`), "map");
  writeFileSync(join(dir, "latest.yml"), "yml");
  const gh = join(root, "gh.cjs");
  writeFileSync(gh, FAKE_GH);
  const stateFile = join(root, "state.json");
  writeFileSync(stateFile, JSON.stringify({ calls: [], releases: [], ...state }));
  const run = (env = {}) => spawnSync(process.execPath, [CLI, dir, TAG], {
    encoding: "utf8",
    env: { ...process.env, VITEST: "1", GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", PUBLISH_RELEASE_TEST_GH: gh, FAKE_GH_STATE: stateFile, ...env },
  });
  const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
  const digest = (name) => "sha256:" + createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
  return { run, read, digest, dir };
}

/** Same shape as setup(), but for a PRERELEASE tag/version this checkout's own version.ts does
 *  not carry — so it spawns the CLI with `cwd` pointed at a throwaway project directory holding
 *  its own src/app/version.ts and CHANGELOG.md for that prerelease version. No production-code
 *  test hook beyond the existing VITEST-gated PUBLISH_RELEASE_TEST_GH. */
function setupPrerelease(state = {}) {
  const root = mkdtempSync(join(tmpdir(), "pub-pre-"));
  const version = `${VERSION}-rc.1`;
  const tag = `v${version}`;
  const exe = `aipm-cockpit-${version}-setup.exe`;
  const dir = join(root, "release");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, exe), "exe-bytes");
  writeFileSync(join(dir, `${exe}.blockmap`), "map");
  writeFileSync(join(dir, "latest.yml"), "yml");

  const projectDir = join(root, "project");
  mkdirSync(join(projectDir, "src", "app"), { recursive: true });
  writeFileSync(
    join(projectDir, "src", "app", "version.ts"),
    `export const APP_VERSION = "${version}";\nexport const APP_MILESTONE = "RC Test";\n`,
  );
  writeFileSync(join(projectDir, "CHANGELOG.md"), `## [${version}] - 2026-01-01 "RC Test"\n\nRelease-candidate notes.\n`);

  const gh = join(root, "gh.cjs");
  writeFileSync(gh, FAKE_GH);
  const stateFile = join(root, "state.json");
  writeFileSync(stateFile, JSON.stringify({ calls: [], releases: [], ...state }));
  const run = (env = {}) => spawnSync(process.execPath, [CLI, dir, tag], {
    encoding: "utf8",
    cwd: projectDir,
    env: { ...process.env, VITEST: "1", GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", PUBLISH_RELEASE_TEST_GH: gh, FAKE_GH_STATE: stateFile, ...env },
  });
  const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
  return { run, read, tag, exe, version };
}

describe("publish-github-release.mjs against a fake gh", () => {
  it("creates a draft with the three files, publishes it, and confirms (exit 0)", () => {
    const t = setup();
    const r = t.run();
    expect(r.status, r.stderr).toBe(0);
    const s = t.read();
    expect(s.releases).toHaveLength(1);
    expect(s.releases[0]).toMatchObject({ tag_name: TAG, draft: false });
    expect(s.releases[0].assets.map((a) => a.name)).toEqual([EXE, `${EXE}.blockmap`, "latest.yml"]);
    expect(s.calls.find((c) => c.startsWith("release create"))).toMatch(/--draft --verify-tag/);
  });

  it("publishes a prerelease tag with --prerelease, and it round-trips as prerelease:true", () => {
    const t = setupPrerelease();
    const r = t.run();
    expect(r.status, r.stderr).toBe(0);
    const s = t.read();
    expect(s.releases).toHaveLength(1);
    expect(s.releases[0]).toMatchObject({ tag_name: t.tag, draft: false, prerelease: true });
    expect(s.calls.find((c) => c.startsWith("release create"))).toMatch(/--prerelease\b/);
  });

  it("deletes a leftover draft and recreates it", () => {
    const t = setup({ releases: [{ id: 5, tag_name: TAG, draft: true, prerelease: false, assets: [] }] });
    expect(t.run().status).toBe(0);
    const s = t.read();
    expect(s.calls).toContain("api -X DELETE repos/o/r/releases/5");
    expect(s.releases.map((x) => x.id)).not.toContain(5);
  });

  it("exits 0 without writing when an identical release is already published", () => {
    const t = setup();
    const files = [EXE, `${EXE}.blockmap`, "latest.yml"];
    const t2 = setup({ releases: [{ id: 9, tag_name: TAG, draft: false, prerelease: VERSION.includes("-"),
      assets: files.map((n) => ({ name: n, size: readFileSync(join(t.dir, n)).length, digest: t.digest(n) })) }] });
    const r = t2.run();
    expect(r.status, r.stderr).toBe(0);
    expect(t2.read().calls.some((c) => c.startsWith("release"))).toBe(false);
  });

  it("refuses (exit 1) a published release with different files", () => {
    const t = setup({ releases: [{ id: 9, tag_name: TAG, draft: false, prerelease: VERSION.includes("-"), assets: [] }] });
    const r = t.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED/);
  });

  it("exits 2 when gh fails outright", () => {
    const r = setup({ failOn: "release create" }).run();
    expect(r.status).toBe(2);
  });

  it("exits 2 when the just-created draft doesn't match, and never publishes it", () => {
    const t = setup({ noDigest: true });
    const r = t.run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/does not match — leaving it unpublished/);
    const s = t.read();
    // Caught at the DRAFT stage: `release edit` (the flip to draft:false) never ran.
    expect(s.calls.some((c) => c.startsWith("release edit"))).toBe(false);
    expect(s.releases[0].draft).toBe(true);
  });

  it("exits 1 when a just-published release cannot be confirmed — already live, needs a human", () => {
    const t = setup({ corruptAfterEdit: true });
    const r = t.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/already live/);
    expect(r.stderr).toMatch(/do not just re-run/);
    const s = t.read();
    // Caught AFTER publish: `release edit` did run and the release is live, mismatched.
    expect(s.calls.some((c) => c.startsWith("release edit"))).toBe(true);
    expect(s.releases[0].draft).toBe(false);
  });

  it("exits 1 when `gh release edit` itself fails — it was attempted, so it may already be live", () => {
    const t = setup({ failOn: "release edit" });
    const r = t.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/may already be live/);
    expect(r.stderr).toMatch(/do not just re-run/);
    expect(t.read().calls.some((c) => c.startsWith("release edit"))).toBe(true);
  });

  it("exits 1 when the confirming re-list after publish throws — the edit itself DID go through", () => {
    const t = setup({ failAfterEdit: true });
    const r = t.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/may already be live/);
    const s = t.read();
    expect(s.calls.some((c) => c.startsWith("release edit"))).toBe(true);
    expect(s.releases[0].draft).toBe(false); // the edit succeeded; only the confirming list blew up
  });

  it("refuses the fake-gh hook outside vitest (exit 2), calling gh not at all", () => {
    const t = setup();
    const r = t.run({ VITEST: "" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/PUBLISH_RELEASE_TEST_GH/);
    expect(t.read().calls).toEqual([]);
  });
});
