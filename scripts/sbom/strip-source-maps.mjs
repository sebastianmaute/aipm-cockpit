// Takes a release build's source maps out of everything that ships.
// No shebang: vitest spawns this file (scripts/sbom/strip-source-maps.test.mjs).
//
//   node scripts/sbom/strip-source-maps.mjs --build .next --keep <dir>
//
// A release build runs with SBOM_SOURCE_MAPS=1 so release:sbom can read what it
// compiled in, but the maps must never ship: browser maps would be served to
// anyone who asks, and the standalone copy of `.next/server` carries server maps
// into the installer. So, after the release:sbom pre-pass:
//   - every `*.map` under `<build>/server` and `<build>/static` MOVES to the same
//     relative path under `<keep>` (release:sbom's final pass reads them there:
//     `--build <keep>`, since it reads only those two roots);
//   - every `*.map` under `<build>/standalone` is DELETED (it is a copy).
// Exit 0 = done, counts printed; 1 = a map root held no map (the build was not
// made with SBOM_SOURCE_MAPS=1, so the SBOM would be short); 2 = could not run.
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MAP_ROOTS, mapFiles } from "./bundled-packages.mjs";

/**
 * @param {{ build: string; keep: string }} dirs absolute paths
 * @returns {Promise<{ moved: Record<string, number>; deleted: number }>}
 */
export async function stripSourceMaps({ build, keep }) {
  const moved = {};
  for (const root of MAP_ROOTS) {
    const from = join(build, root);
    const files = await mapFiles(from);
    for (const file of files) {
      const to = join(keep, root, relative(from, file));
      mkdirSync(dirname(to), { recursive: true });
      renameSync(file, to);
    }
    moved[root] = files.length;
  }
  const copies = await mapFiles(join(build, "standalone"));
  for (const file of copies) rmSync(file);
  return { moved, deleted: copies.length };
}

async function main(argv, cwd) {
  const { values } = parseArgs({ args: argv, options: { build: { type: "string" }, keep: { type: "string" } } });
  if (!values.build || !values.keep) throw new Error("usage: strip-source-maps.mjs --build <dir> --keep <dir>");
  const { moved, deleted } = await stripSourceMaps({ build: resolve(cwd, values.build), keep: resolve(cwd, values.keep) });
  const empty = MAP_ROOTS.filter((root) => moved[root] === 0);
  for (const root of empty) console.error(`strip-source-maps: no source map under ${join(values.build, root)} — build with SBOM_SOURCE_MAPS=1`);
  if (empty.length > 0) return 1;
  const counts = MAP_ROOTS.map((root) => `${moved[root]} from ${root}/`).join(", ");
  console.log(`strip-source-maps: moved ${counts} to ${values.keep}; deleted ${deleted} under standalone/`);
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
