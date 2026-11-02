// Takes a release build's source maps out of everything that ships.
// No shebang: vitest spawns this file (scripts/sbom/strip-source-maps.test.mjs).
//
//   node scripts/sbom/strip-source-maps.mjs --delete .next/standalone
//   node scripts/sbom/strip-source-maps.mjs --build .next --keep <dir>
//
// A release build runs with SBOM_SOURCE_MAPS=1 so release:sbom can read what it
// compiled in, but the maps must never ship: browser maps would be served to
// anyone who asks, and the standalone copy of `.next/server` carries server maps
// into the installer. The release workflow runs this twice:
//   - `--delete <dir>` BEFORE the release:sbom pre-pass deletes every `*.map`
//     under the standalone tree, so both SBOM passes read exactly the tree that
//     ships;
//   - `--build <dir> --keep <dir>` AFTER the pre-pass MOVES every `*.map` under
//     `<build>/server` and `<build>/static` to the same relative path under
//     `<keep>`. release:sbom's final pass reads them there (`--build <keep>`),
//     since it reads only those two roots. Both roots are checked before anything
//     moves, so a refused run leaves the tree as it was.
// Exit 0 = done, counts printed; 1 = a map root held no map (the build was not
// made with SBOM_SOURCE_MAPS=1, so the SBOM would be short); 2 = could not run.
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MAP_ROOTS, mapFiles } from "./bundled-packages.mjs";

const USAGE = "usage: strip-source-maps.mjs --delete <dir> | --build <dir> --keep <dir>";

/**
 * Deletes every `*.map` under `dir`.
 *
 * @param {string} dir absolute path
 * @returns {Promise<number>} how many were deleted
 */
export async function deleteSourceMaps(dir) {
  const files = await mapFiles(dir);
  for (const file of files) rmSync(file);
  return files.length;
}

/**
 * Moves every `*.map` under `<build>/server` and `<build>/static` to `<keep>`.
 * Moves nothing unless both roots hold at least one.
 *
 * @param {{ build: string; keep: string }} dirs absolute paths
 * @returns {Promise<{ moved: Record<string, number>; empty: string[] }>} `empty` names the roots with no map
 */
export async function moveBuildMaps({ build, keep }) {
  const filesByRoot = {};
  for (const root of MAP_ROOTS) filesByRoot[root] = await mapFiles(join(build, root));
  const empty = MAP_ROOTS.filter((root) => filesByRoot[root].length === 0);
  if (empty.length > 0) return { moved: {}, empty };
  const moved = {};
  for (const root of MAP_ROOTS) {
    const from = join(build, root);
    for (const file of filesByRoot[root]) {
      const to = join(keep, root, relative(from, file));
      mkdirSync(dirname(to), { recursive: true });
      renameSync(file, to);
    }
    moved[root] = filesByRoot[root].length;
  }
  return { moved, empty };
}

async function main(argv, cwd) {
  const { values } = parseArgs({
    args: argv,
    options: { build: { type: "string" }, keep: { type: "string" }, delete: { type: "string" } },
  });
  if (values.delete) {
    if (values.build || values.keep) throw new Error(USAGE);
    const deleted = await deleteSourceMaps(resolve(cwd, values.delete));
    console.log(`strip-source-maps: deleted ${deleted} under ${values.delete}`);
    return 0;
  }
  if (!values.build || !values.keep) throw new Error(USAGE);
  const { moved, empty } = await moveBuildMaps({ build: resolve(cwd, values.build), keep: resolve(cwd, values.keep) });
  for (const root of empty) console.error(`strip-source-maps: no source map under ${join(values.build, root)} — build with SBOM_SOURCE_MAPS=1`);
  if (empty.length > 0) return 1;
  const counts = MAP_ROOTS.map((root) => `${moved[root]} from ${root}/`).join(", ");
  console.log(`strip-source-maps: moved ${counts} to ${values.keep}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.cwd()).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`strip-source-maps could not run: ${err.message}`);
      process.exitCode = 2;
    },
  );
}
