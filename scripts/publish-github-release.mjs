#!/usr/bin/env node
// Creates and publishes the GitHub Release for a tag from a verified release directory.
// Usage: node scripts/publish-github-release.mjs <dir> <tag>   (env GITHUB_REPOSITORY, GH_TOKEN)
// Exit: 0 published, or an identical release already was.
// 1 REFUSED — a human must act: a published release for the tag differs (immutable releases
//   cannot be fixed in place: publish a new version instead), or ANYTHING goes wrong at or after
//   `gh release edit --draft=false` — a failed confirmation, or `release edit` itself throwing, or
//   the confirming re-list throwing (gh/network failure, ENOBUFS, bad JSON). Once that edit call
//   has been made, GitHub may already have applied it even if this process never sees a clean
//   response, so every such failure is treated as "may already be live" and routed here rather
//   than to exit 2 — a `publishAttempted` flag set immediately before the call decides this,
//   including from inside the top-level catch.
// 2 could not run, or the still-unpublished draft this run just created does not match what
//   was expected — safe to delete-and-retry, since nothing has gone live yet.
// ★ Draft first, files, then publish: with immutable releases the files lock at publish, so the
// draft is checked against `expected` one more time right before that happens.
// ★ `--slurp` (the release-list call below) needs gh >= 2.48.0 (released 2024-04-17, per
// `gh api repos/cli/cli/releases/tags/v2.48.0`'s own "Added support for `--slurp`ing JSON
// responses in `gh api`"); verified present against gh 2.101.0 here.
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
    // ★ The default 1 MiB maxBuffer truncates `gh api .../releases` once the project has ~90-100
    // releases (full notes bodies, assets, uploaders) — ENOBUFS, forever, on every future publish.
    maxBuffer: 256 * 1024 * 1024,
  });

// ★ Declared OUTSIDE the try so the catch below can read it: a `let` inside a try block is not
// visible in that try's own catch (block scope). Set true immediately before the one call that
// makes the release live — everything after that point, including a throw, is "may already be
// live" (exit 1), never "nothing happened" (exit 2).
let publishAttempted = false;
try {
  if (!dir || !tag || !tag.startsWith("v") || !repo) throw new Error("usage: publish-github-release.mjs <dir> <tag v…> with GITHUB_REPOSITORY set");
  const lib = await import("./release-publish-lib.mjs");
  const { readSourceFrom, SOURCE_FILE } = await import("./version-sync-lib.mjs");
  const version = tag.slice(1);
  const { milestone } = readSourceFrom(readFileSync(SOURCE_FILE, "utf8"));
  const assetNames = lib.expectedAssets(version);
  const files = assetNames.map((n) => join(dir, n));
  const expected = {
    tag,
    prerelease: version.includes("-"),
    assets: files.map((f, i) => ({
      name: assetNames[i],
      size: statSync(f).size,
      sha256: createHash("sha256").update(readFileSync(f)).digest("hex"),
    })),
  };
  // ★ --slurp + .flat(): `--paginate` alone concatenates pages into one array only on newer gh
  // versions; wrapping each page and flattening here doesn't depend on which is installed.
  // per_page=100 keeps a realistic release count to one page.
  const list = () =>
    JSON.parse(gh(["api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"]) || "[]").flat();

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

  // ★ Check the still-draft release before flipping it live: a mismatch here (gh dropped an
  // asset, a digest didn't come back, ...) is still cheap to fix — delete the draft and retry —
  // where the same mismatch found AFTER --draft=false would mean an already-published, immutable
  // release that only a human can act on.
  const draftCheck = lib.verifyDraft(list(), expected);
  if (!draftCheck.ok) {
    fail(2, `created the draft for ${tag}, but it does not match — leaving it unpublished: ${draftCheck.detail}`);
  }

  publishAttempted = true;
  gh(["release", "edit", tag, "--repo", repo, "--draft=false"]);

  verdict = lib.classifyRelease(list(), expected);
  if (verdict.state !== "identical") {
    fail(
      1,
      `PUBLISHED ${tag}, but could not confirm it matches (${verdict.state}${verdict.detail ? ": " + verdict.detail : ""}) — the release is already live; inspect it by hand, do not just re-run.`,
    );
  }
  say(`ok — published ${tag} with ${expected.assets.map((a) => a.name).join(", ")}`);
  process.exit(0);
} catch (err) {
  const detail = err && typeof err === "object" && "stderr" in err ? String(err.stderr).trim() : "";
  const msg = `${err instanceof Error ? err.message : String(err)}${detail ? ` — ${detail}` : ""}`;
  if (publishAttempted) {
    fail(1, `CANNOT CONFIRM ${tag}: ${msg} — the release may already be live (the publish step was attempted); inspect it by hand, do not just re-run.`);
  }
  fail(2, `CANNOT PUBLISH: ${msg}`);
}
