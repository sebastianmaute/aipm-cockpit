#!/usr/bin/env node
// Checks a release directory before anything is published.
// Usage: node scripts/verify-release-assets.mjs <dir> <tag>
// Exit: 0 the files are exactly right; 1 they are wrong (named); 2 could not check.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, tag] = process.argv.slice(2);
try {
  const { expectedAssets, installerName, checkLatestYml, LATEST_YML } = await import("./release-publish-lib.mjs");
  if (!dir || !tag || !tag.startsWith("v")) throw new Error("usage: verify-release-assets.mjs <dir> <tag v…>");
  const version = tag.slice(1);
  const want = expectedAssets(version);
  const have = readdirSync(dir).sort();
  const problems = [];
  for (const f of want) if (!have.includes(f)) problems.push(`missing ${f}`);
  for (const f of have) if (!want.includes(f)) problems.push(`unexpected ${f}`);
  if (problems.length === 0) {
    const exe = installerName(version);
    const bytes = readFileSync(join(dir, exe));
    const installer = { name: exe, sha512: createHash("sha512").update(bytes).digest("base64"), size: statSync(join(dir, exe)).size };
    problems.push(...checkLatestYml(readFileSync(join(dir, LATEST_YML), "utf8"), version, installer));
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`[release:verify] ${p}`);
    process.exit(1);
  }
  console.log(`[release:verify] ok — ${want.join(", ")} for ${tag}`);
  process.exit(0);
} catch (err) {
  console.error(`[release:verify] CANNOT CHECK: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
