// The third-party libraries Next.js carries inside its own package, under
// `node_modules/next/dist/compiled/*` (React, react-dom, scheduler, zod, ...).
// npm never sees them — they are not in any lockfile or node_modules tree — so
// they are listed separately, each with the folder that holds its LICENSE.
// No shebang: vitest imports this module (scripts/sbom/next-vendored-packages.test.mjs).
//
// ★ Which folders count. A library is the shallowest folder below `compiled/`
// that holds a package.json (usually `compiled/<name>`; for `hash.js` and
// `@mswjs/interceptors` it is one level further down). It is skipped when:
//   - no package.json exists anywhere below it ("no-package-json") — Next's own
//     runtime bundles (`next-server`, `next-devtools`) and a few loose bundles;
//   - its package.json is in the `@next/` scope ("first-party") — Next's own
//     packages, already covered by the `next` component itself;
//   - it carries no licence evidence at all, neither a `license` field nor a
//     LICENSE/COPYING file ("no-licence") — Next's glue such as `babel-packages`.
// `scanNextVendored` returns the skipped folders with their reason, so nothing
// drops out silently.
//
// ★ Names. Next writes the upstream name into package.json for nearly every
// folder, with two exceptions:
//   - the React family is renamed `<folder>-builtin` (`react` holds
//     `react-builtin`, `react-dom-experimental` holds
//     `react-dom-experimental-builtin`, while `react-dom-builtin` itself
//     depends on `scheduler` and peers on `react` by their upstream names). The
//     `-builtin` suffix is stripped, and so is the `-experimental` folder
//     suffix: the experimental channel is published under the same npm name
//     with an `-experimental-` version;
//   - `source-map08` keeps the folder name; NEXT_RENAMES maps it.
//
// ★ Versions. package.json `version` when present; otherwise the single
// distinct `exports.version = "..."` in the folder's `cjs/*.js` (React's
// CommonJS builds declare it; two different values count as none); otherwise
// unknown, written `vendored-in-next@<next version>` so it can never be read as
// an upstream version, with `versionKnown: false`.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const NEXT_RENAMES = { "source-map08": "source-map" };
const LICENCE_FILE = /^(licen[cs]e|copying)(\.|$)/i;
const CJS_VERSION = /exports\.version\s*=\s*"([^"]+)"/g;

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function entriesOf(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** The shallowest folders at or below `dir` that hold a package.json. */
async function libraryDirs(dir) {
  const entries = await entriesOf(dir);
  if (entries.some((e) => e.isFile() && e.name === "package.json")) return [dir];
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory()) found.push(...(await libraryDirs(join(dir, entry.name))));
  }
  return found;
}

/** `compiled/<folder>`, or `compiled/@scope/<folder>` for a scope folder. */
async function rootFolders(compiled) {
  const roots = [];
  for (const entry of await entriesOf(compiled)) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("@")) {
      roots.push(join(compiled, entry.name));
      continue;
    }
    for (const child of await entriesOf(join(compiled, entry.name))) {
      if (child.isDirectory()) roots.push(join(compiled, entry.name, child.name));
    }
  }
  return roots;
}

function upstreamName(pkgName, folder) {
  let name = pkgName;
  if (name.endsWith("-builtin")) {
    name = name.slice(0, -"-builtin".length);
    if (folder.endsWith("-experimental") && name === folder) name = name.slice(0, -"-experimental".length);
  }
  return NEXT_RENAMES[name] ?? name;
}

async function cjsVersion(dir) {
  const versions = new Set();
  for (const entry of await entriesOf(join(dir, "cjs"))) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    for (const match of (await readFile(join(dir, "cjs", entry.name), "utf8")).matchAll(CJS_VERSION)) versions.add(match[1]);
  }
  return versions.size === 1 ? [...versions][0] : null;
}

function relFolder(compiled, dir) {
  return relative(compiled, dir).replace(/\\/g, "/");
}

async function describeLibrary(compiled, dir, unknownVersion) {
  const folder = relFolder(compiled, dir);
  const pkg = await readJson(join(dir, "package.json"));
  const pkgName = typeof pkg?.name === "string" ? pkg.name : folder;
  if (pkgName.startsWith("@next/")) return { skipped: { folder, reason: "first-party" } };
  const entries = await entriesOf(dir);
  const hasLicence = pkg?.license !== undefined || entries.some((e) => e.isFile() && LICENCE_FILE.test(e.name));
  if (!hasLicence) return { skipped: { folder, reason: "no-licence" } };
  const version = typeof pkg.version === "string" ? pkg.version : await cjsVersion(dir);
  return {
    pkg: {
      name: upstreamName(pkgName, folder.split("/").at(-1)),
      version: version ?? unknownVersion,
      dir,
      vendoredIn: "next",
      versionKnown: version !== null,
    },
  };
}

/**
 * @param {string} nextDir the installed `next` package (`node_modules/next`)
 * @returns {Promise<{
 *   packages: Array<{ name: string; version: string; dir: string; vendoredIn: "next"; versionKnown: boolean }>;
 *   skipped: Array<{ folder: string; reason: "no-package-json" | "first-party" | "no-licence" }>;
 * }>}
 */
export async function scanNextVendored(nextDir) {
  const nextPkg = await readJson(join(nextDir, "package.json"));
  if (typeof nextPkg?.version !== "string") throw new Error(`${join(nextDir, "package.json")} is missing or has no version`);
  const unknownVersion = `vendored-in-next@${nextPkg.version}`;
  const compiled = join(nextDir, "dist", "compiled");
  const packages = [];
  const skipped = [];
  for (const root of await rootFolders(compiled)) {
    const dirs = await libraryDirs(root);
    if (dirs.length === 0) skipped.push({ folder: relFolder(compiled, root), reason: "no-package-json" });
    for (const dir of dirs) {
      const result = await describeLibrary(compiled, dir, unknownVersion);
      if (result.pkg) packages.push(result.pkg);
      else skipped.push(result.skipped);
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  packages.sort((a, b) => cmp(a.name, b.name) || cmp(a.dir, b.dir));
  skipped.sort((a, b) => cmp(a.folder, b.folder));
  return { packages, skipped };
}

/**
 * Every third-party library vendored under `next/dist/compiled`, one entry per
 * folder, sorted by name then folder. Two folders can share a name and even an
 * (unknown) version — `loader-utils2` and `loader-utils3` — so `dir` is what
 * tells them apart.
 *
 * @param {string} nextDir the installed `next` package (`node_modules/next`)
 */
export async function nextVendoredPackages(nextDir) {
  return (await scanNextVendored(nextDir)).packages;
}
