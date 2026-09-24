#!/usr/bin/env node
// Creates and publishes the GitHub Release for a tag from a verified release directory.
// Usage: node scripts/publish-github-release.mjs <dir> <tag>   (env GITHUB_REPOSITORY, GH_TOKEN)
// Exit: 0 published, or an identical release already was; 1 REFUSED — a published
// release for the tag differs (immutable releases cannot be fixed in place: publish
// a new version); 2 could not run or could not confirm — safe to re-run.
// ★ Draft first, files, then publish: with immutable releases the files lock at publish.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [dir, tag] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY;
const say = (m) => console.log(`[release:publish] ${m}`);
const fail = (code, m) => {
  console.error(`[release:publish] ${m}`);
  process.exit(code);
};

let ghBin = "gh";
if (process.env.PUBLISH_RELEASE_TEST_GH) {
  if (!process.env.VITEST) fail(2, "PUBLISH_RELEASE_TEST_GH is a test hook and is refused outside vitest");
  ghBin = process.execPath;
}
const gh = (args) =>
  execFileSync(ghBin, process.env.PUBLISH_RELEASE_TEST_GH ? [process.env.PUBLISH_RELEASE_TEST_GH, ...args] : args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

try {
  if (!dir || !tag || !tag.startsWith("v") || !repo) throw new Error("usage: publish-github-release.mjs <dir> <tag v…> with GITHUB_REPOSITORY set");
  const lib = await import("./release-publish-lib.mjs");
  const { readSourceFrom, SOURCE_FILE } = await import("./version-sync-lib.mjs");
  const version = tag.slice(1);
  const { milestone } = readSourceFrom(readFileSync(SOURCE_FILE, "utf8"));
  const files = lib.expectedAssets(version).map((n) => join(dir, n));
  const expected = {
    tag,
    prerelease: version.includes("-"),
    assets: files.map((f, i) => ({
      name: lib.expectedAssets(version)[i],
      size: statSync(f).size,
      sha256: createHash("sha256").update(readFileSync(f)).digest("hex"),
    })),
  };
  const list = () => JSON.parse(gh(["api", `repos/${repo}/releases`, "--paginate"]) || "[]");

  let verdict = lib.classifyRelease(list(), expected);
  if (verdict.state === "identical") {
    say(`ok — ${tag} is already published with exactly these files`);
    process.exit(0);
  }
  if (verdict.state === "conflict") fail(1, `REFUSED: ${verdict.detail}. Publish a new version instead.`);
  if (verdict.state === "draft") {
    say(`deleting leftover draft ${verdict.id} for ${tag}`);
    gh(["api", "-X", "DELETE", `repos/${repo}/releases/${verdict.id}`]);
  }

  const notesFile = join(mkdtempSync(join(tmpdir(), "notes-")), "notes.md");
  writeFileSync(notesFile, lib.releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version));
  gh([
    "release", "create", tag, ...files, "--repo", repo, "--draft", "--verify-tag",
    "--title", lib.releaseTitle(version, milestone), "--notes-file", notesFile,
    ...(expected.prerelease ? ["--prerelease"] : []),
  ]);
  gh(["release", "edit", tag, "--repo", repo, "--draft=false"]);

  verdict = lib.classifyRelease(list(), expected);
  if (verdict.state !== "identical") fail(2, `published, but could not confirm it (${verdict.state}${verdict.detail ? ": " + verdict.detail : ""})`);
  say(`ok — published ${tag} with ${expected.assets.map((a) => a.name).join(", ")}`);
  process.exit(0);
} catch (err) {
  const detail = err && typeof err === "object" && "stderr" in err ? String(err.stderr).trim() : "";
  fail(2, `CANNOT PUBLISH: ${err instanceof Error ? err.message : String(err)}${detail ? ` — ${detail}` : ""}`);
}
