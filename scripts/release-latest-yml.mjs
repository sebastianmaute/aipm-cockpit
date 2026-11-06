#!/usr/bin/env node
// Rewrites a release directory's update feed over its installer: latest.yml (sha512, size, path,
// version, releaseDate) and the installer's .blockmap. Signing changes the installer's bytes after
// electron-builder wrote both, so the release workflow's `finalize` job runs this over the signed
// installer; `release:verify` then checks latest.yml against those bytes.
// The blockmap comes from electron-builder's own buildBlockMap (app-builder-lib, installed under
// desktop/), the function its NSIS target calls, so an updater's differential download reads it
// exactly as it reads one the build wrote.
// Usage: node scripts/release-latest-yml.mjs <dir> <version>
// Exit: 0 written; 2 could not write (bad arguments, missing installer, missing app-builder-lib).
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installerName, LATEST_YML } from "./release-publish-lib.mjs";

const BLOCKMAP_MODULE = "app-builder-lib/out/targets/blockmap/blockmap.js";

/** latest.yml in the layout electron-builder writes for one NSIS installer. */
export function latestYmlText({ version, name, sha512, size, releaseDate }) {
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
}

function loadBuildBlockMap() {
  const desktop = createRequire(new URL("../desktop/package.json", import.meta.url));
  const { buildBlockMap } = desktop(BLOCKMAP_MODULE);
  if (typeof buildBlockMap !== "function") throw new Error(`${BLOCKMAP_MODULE} no longer exports buildBlockMap`);
  return buildBlockMap;
}

/** Writes `<installer>.blockmap` and latest.yml in `dir` over the installer for `version`, and
 *  returns the installer's { name, sha512, size }. */
export async function writeUpdateFeed(dir, version, { now = () => new Date(), buildBlockMap } = {}) {
  const name = installerName(version);
  const exe = join(dir, name);
  if (!existsSync(exe)) throw new Error(`no installer ${name} in ${dir}`);
  const build = buildBlockMap ?? loadBuildBlockMap();
  // gzip + an out file: what electron-builder's createBlockmap passes for the NSIS installer.
  // The sha512 it returns is the whole file's, base64 — latest.yml's encoding.
  const { sha512, size } = await build(exe, "gzip", `${exe}.blockmap`);
  writeFileSync(join(dir, LATEST_YML), latestYmlText({ version, name, sha512, size, releaseDate: now().toISOString() }));
  return { name, sha512, size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, version] = process.argv.slice(2);
  try {
    if (!dir || !version) throw new Error("usage: release-latest-yml.mjs <dir> <version>");
    const r = await writeUpdateFeed(dir, version);
    console.log(`[release-latest-yml] ${LATEST_YML} and ${r.name}.blockmap written: ${r.size} bytes, sha512 ${r.sha512}`);
    process.exit(0);
  } catch (err) {
    console.error(`[release-latest-yml] CANNOT WRITE: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
