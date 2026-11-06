// The third-party libraries Next.js carries inside its own package, under
// `node_modules/next/dist/compiled/*` (React, react-dom, scheduler, zod, ...).
// npm never sees them — they are not in any lockfile or node_modules tree — so
// they are listed separately, each with the folder that holds its LICENSE.
// No shebang: vitest imports this module (scripts/sbom/next-vendored-packages.test.mjs).
//
// ★★ Which folders count: ALL of them, except NEXT_OWN_FOLDERS. The list fails
// closed — a folder a future Next adds is listed, whatever it looks like, until
// someone has read it and put it on that list. No licence is judged here.
//
// A library is the shallowest folder below `compiled/<folder>` that holds a
// package.json (`hash.js/sha256`, `@mswjs/interceptors/ClientRequest`), or
// `compiled/<folder>` itself when none does. A scope folder counts per child.
//
// ★ Names. package.json `name`, else the folder path. Next writes the upstream
// name there for nearly every folder, with two exceptions:
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
//
// ★★ `babel-packages` is one folder holding many packages, so it yields one
// entry per package it can name — see babelBundlePackages. All share its `dir`.
//
// ★★ Installed is not shipped. With no options the list covers the whole
// installed Next. `shippedNextDir` narrows it to the libraries that ship, by
// three kinds of evidence (a build's own traced copy leaves most folders out):
//   1. a file on disk under `<shippedNextDir>/dist/compiled/<same path>`;
//   2. a source of the map beside a shipped compiled bundle: `next-server` embeds
//      React, react-dom, busboy and others, and `compiled/react` itself is absent
//      from the standalone tree. Maps do not ship, so they come from the install;
//   3. with `buildDir`, a source of the build's own maps: browser-only libraries
//      (`scheduler`) reach the installer only through `.next/static`. ALWAYS pass
//      `buildDir` with `shippedNextDir` for a release; without it those are lost.
// Version and `dir` still come from the install, which has the LICENSE files.
//
// ★★ The two ways the evidence could go quiet are not left silent. A shipped
// bundle of `next-server` with no map beside it is a `problems` entry (what it
// embeds would go unseen), and a file of any other NEXT_OWN_FOLDERS folder in the
// shipped tree throws (the folder was allowed as "does not reach users", and
// that has stopped being true).
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { MAP_ROOTS, mapFiles, mapSources } from "./bundled-packages.mjs";

/**
 * Next's own code, read one by one on Next 16.4.0. Exact paths, so that nothing
 * new can slip in by resembling them.
 */
export const NEXT_OWN_FOLDERS = {
  "@next/font": "Next's own package, published from its repository",
  "@next/react-refresh-utils": "Next's own package, published from its repository",
  "next-devtools": "Next's dev overlay, built from its src/next-devtools; development only",
  "next-server": "Next's runtime bundles; the libraries they embed are listed from their source maps",
  "postcss-plugin-stub-for-cssnano-simple": "a stub plugin named postcss-plugin-stub that does nothing",
};

// The one own folder that ships by design: its maps say what it embeds.
const NEXT_RUNTIME_FOLDER = "next-server";

const NEXT_RENAMES = { "source-map08": "source-map" };
const CJS_VERSION = /exports\.version\s*=\s*"([^"]+)"/g;

const BABEL_BUNDLE_FOLDER = "babel-packages";
const BABEL_BUNDLE_FILE = "packages-bundle.js";
// Export names of the bundle's entry module that do not follow the @babel naming.
const BABEL_EXPORT_NAMES = {
  pluginTransformDefine: "babel-plugin-transform-define",
  pluginTransformReactRemovePropTypes: "babel-plugin-transform-react-remove-prop-types",
};
// Plugin names that @babel/preset-modules declares, not packages of their own.
const PRESET_MODULES_PLUGINS = new Set([
  "transform-async-arrows-in-class",
  "transform-edge-default-parameters",
  "transform-edge-function-name",
  "transform-jsx-spread",
  "transform-safari-block-shadowing",
  "transform-safari-for-shadowing",
  "transform-tagged-template-caching",
]);
const BABEL_DECLARED_NAME = /\bname:"((?:plugin-)?bugfix-[a-z0-9-]+|(?:transform|syntax|proposal)-[a-z0-9-]+(?:\/development)?)"/g;
// `name:"@babel/x",version:"1"` and `name:`${"@babel/x"}/lazy`,version:"1"`.
const BABEL_DECLARED_VERSION = /\bname:(?:"|`\$\{")(@babel\/[a-z0-9-]+)(?:"|"\}\/[a-z]+`),version:"([^"]+)"/g;

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

/** Every file below `dir`, or [] when `dir` does not exist. */
async function filesUnder(dir) {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** The shallowest folders at or below `dir` that hold a package.json. */
async function packageJsonDirs(dir) {
  const entries = await entriesOf(dir);
  if (entries.some((e) => e.isFile() && e.name === "package.json")) return [dir];
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory()) found.push(...(await packageJsonDirs(join(dir, entry.name))));
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

/** The npm package behind one export of the bundle's entry module (`pluginSyntaxJsx`). */
function babelExportToPackage(key) {
  return BABEL_EXPORT_NAMES[key] ?? `@babel/${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** The export names of the bundle's entry module, or [] when its shape is not the known one. */
function babelEntryExports(bundle) {
  const entryId = /__nccwpck_require__\((\d+)\);module\.exports=\w+\}\)\(\);?\s*$/.exec(bundle)?.[1];
  if (!entryId) return [];
  const start = new RegExp(`[{,]${entryId}:\\(`).exec(bundle);
  if (!start) return [];
  const exportsMap = /\b\w\.exports=\{([^{}]*)\}/.exec(bundle.slice(start.index));
  return exportsMap ? exportsMap[1].split(",").map((pair) => pair.split(":")[0]) : [];
}

/** The npm package a plugin's declared `name` belongs to. */
function babelDeclaredToPackage(declared) {
  if (PRESET_MODULES_PLUGINS.has(declared)) return "@babel/preset-modules";
  if (declared.endsWith("/development")) return `@babel/plugin-${declared.replace("/", "-")}`;
  return `@babel/plugin-${declared.replace(/^plugin-/, "")}`;
}

/**
 * The packages `babel-packages/packages-bundle.js` holds, from what the minified
 * code still says out loud: the export map of its entry module (camelCase of the
 * package name; those packages are its direct inputs) and the `name` each Babel
 * plugin declares. Versions exist for the two packages that declare one beside
 * their name. ★ `@babel/helper-*`, core-js-compat and other code with no declared
 * name cannot be told apart in a minified bundle, so they are not named here. Text
 * mentions of `@babel/...` are not evidence either: `@babel/polyfill` appears only
 * in a warning, and most plugins never appear under their package name.
 *
 * @returns {Promise<Array<[string, string | null]>>} name and version, [] when unreadable
 */
async function babelBundlePackages(dir) {
  let bundle;
  try {
    bundle = await readFile(join(dir, BABEL_BUNDLE_FILE), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const names = new Set(babelEntryExports(bundle).map(babelExportToPackage));
  for (const match of bundle.matchAll(BABEL_DECLARED_NAME)) names.add(babelDeclaredToPackage(match[1]));
  const versions = new Map();
  for (const match of bundle.matchAll(BABEL_DECLARED_VERSION)) versions.set(match[1], match[2]);
  return [...names].map((name) => [name, versions.get(name) ?? null]);
}

/** One library folder as listed entries; more than one only for the bundle. */
async function describeFolder(compiled, dir, unknownVersion) {
  const folder = relFolder(compiled, dir);
  const toEntry = (name, version) => ({
    name,
    version: version ?? unknownVersion,
    dir,
    vendoredIn: "next",
    versionKnown: version !== null,
  });
  if (folder === BABEL_BUNDLE_FOLDER) {
    const bundled = await babelBundlePackages(dir);
    if (bundled.length > 0) return bundled.map(([name, version]) => toEntry(name, version));
  }
  const pkg = await readJson(join(dir, "package.json"));
  const pkgName = typeof pkg?.name === "string" ? pkg.name : folder;
  const version = typeof pkg?.version === "string" ? pkg.version : await cjsVersion(dir);
  return [toEntry(upstreamName(pkgName, folder.split("/").at(-1)), version)];
}

/** Paths below `compiled/` that a list of source-map sources names. */
function compiledPathsIn(sources) {
  const paths = [];
  for (const source of sources) {
    if (typeof source !== "string") continue;
    const match = /(?:^|\/)dist\/compiled\/(.+)$/.exec(source.replace(/\\/g, "/").replace(/%40/g, "@"));
    if (match) paths.push(match[1]);
  }
  return paths;
}

/**
 * Sources of the maps beside each shipped bundle; the maps themselves stay in the
 * install. `problems` names each next-server bundle with no map to read.
 */
async function pathsEmbeddedInShipped(compiled, shippedCompiled, shippedFiles) {
  const paths = [];
  const problems = [];
  for (const file of shippedFiles) {
    if (!file.endsWith(".js")) continue;
    const map = await readJson(join(compiled, `${relative(shippedCompiled, file)}.map`));
    if (map) {
      paths.push(...compiledPathsIn(mapSources(map, file)));
      continue;
    }
    const rel = relFolder(shippedCompiled, file);
    if (rel.startsWith(`${NEXT_RUNTIME_FOLDER}/`)) {
      problems.push(`The shipped Next bundle ${rel} has no source map in the install, so the libraries it embeds cannot be listed`);
    }
  }
  return { paths, problems };
}

/** Throws when a folder allowed as Next's own has a file in the shipped tree. */
function refuseShippedOwnFolders(shippedPaths) {
  for (const folder of Object.keys(NEXT_OWN_FOLDERS)) {
    if (folder === NEXT_RUNTIME_FOLDER) continue;
    const shipped = shippedPaths.find((path) => path.startsWith(`${folder}/`));
    if (shipped) throw new Error(`${folder} is allowed as Next's own code that does not ship, yet ${shipped} ships — read it and list it`);
  }
}

/** Sources of a build's own maps below `dist/compiled`. Throws when a map root is empty, as bundled-packages does. */
async function pathsCompiledIntoBuild(buildDir) {
  const paths = [];
  for (const root of MAP_ROOTS) {
    const files = await mapFiles(join(buildDir, root));
    if (files.length === 0) throw new Error(`No source map under ${join(buildDir, root)} — build with SBOM_SOURCE_MAPS=1`);
    for (const file of files) {
      paths.push(...compiledPathsIn(mapSources(JSON.parse(await readFile(file, "utf8")), file)));
    }
  }
  return paths;
}

/** Whether a library folder (path below `compiled/`) ships, per the header's three kinds of evidence. */
async function shippedEvidence(compiled, { shippedNextDir, buildDir }) {
  const shippedCompiled = join(shippedNextDir, "dist", "compiled");
  const shippedFiles = await filesUnder(shippedCompiled);
  if (shippedFiles.length === 0) throw new Error(`No file under ${shippedCompiled} — not a shipped Next`);
  const paths = shippedFiles.map((file) => relFolder(shippedCompiled, file));
  refuseShippedOwnFolders(paths);
  const embedded = await pathsEmbeddedInShipped(compiled, shippedCompiled, shippedFiles);
  paths.push(...embedded.paths);
  if (buildDir) paths.push(...(await pathsCompiledIntoBuild(buildDir)));
  return { ships: (folder) => paths.some((path) => path.startsWith(`${folder}/`)), problems: embedded.problems };
}

/**
 * @param {string} nextDir the installed `next` package (`node_modules/next`)
 * @param {{ shippedNextDir?: string; buildDir?: string }} [options] see the header
 * @returns {Promise<{
 *   packages: Array<{ name: string; version: string; dir: string; vendoredIn: "next"; versionKnown: boolean }>;
 *   skipped: Array<{ folder: string; reason: string }>;
 *   problems: string[];
 * }>} `skipped` only ever holds NEXT_OWN_FOLDERS entries. `problems` is empty with no `shippedNextDir`.
 */
export async function scanNextVendored(nextDir, options = {}) {
  const nextPkg = await readJson(join(nextDir, "package.json"));
  if (typeof nextPkg?.version !== "string") throw new Error(`${join(nextDir, "package.json")} is missing or has no version`);
  const unknownVersion = `vendored-in-next@${nextPkg.version}`;
  const compiled = join(nextDir, "dist", "compiled");
  const roots = await rootFolders(compiled);
  if (roots.length === 0) throw new Error(`No library folder under ${compiled} — not a Next install`);
  const { ships, problems } = options.shippedNextDir ? await shippedEvidence(compiled, options) : { ships: () => true, problems: [] };
  const packages = [];
  const skipped = [];
  for (const root of roots) {
    const rootRel = relFolder(compiled, root);
    if (Object.hasOwn(NEXT_OWN_FOLDERS, rootRel)) {
      skipped.push({ folder: rootRel, reason: NEXT_OWN_FOLDERS[rootRel] });
      continue;
    }
    const dirs = await packageJsonDirs(root);
    for (const dir of dirs.length > 0 ? dirs : [root]) {
      if (ships(relFolder(compiled, dir))) packages.push(...(await describeFolder(compiled, dir, unknownVersion)));
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  packages.sort((a, b) => cmp(a.name, b.name) || cmp(a.dir, b.dir));
  skipped.sort((a, b) => cmp(a.folder, b.folder));
  return { packages, skipped, problems };
}

/**
 * Every third-party library vendored under `next/dist/compiled`, sorted by name
 * then folder. Two entries can share a name and even an (unknown) version —
 * `loader-utils2` and `loader-utils3` — so `dir` is what tells folders apart, and
 * the `babel-packages` entries share one `dir`.
 *
 * @param {string} nextDir the installed `next` package (`node_modules/next`)
 * @param {{ shippedNextDir?: string; buildDir?: string }} [options] with none, this is what is INSTALLED, not what ships
 */
export async function nextVendoredPackages(nextDir, options) {
  return (await scanNextVendored(nextDir, options)).packages;
}
