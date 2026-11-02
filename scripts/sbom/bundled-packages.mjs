// The npm packages whose code a Next production build compiled in, read from
// the build's own source maps.
// No shebang: vitest imports this module (scripts/sbom/bundled-packages.test.mjs).
//
// ★★ The maps must exist. Turbopack writes server maps (.next/server/**) by
// default, but browser maps (.next/static/**) only with
// `productionBrowserSourceMaps`, which next.config.ts turns on when
// SBOM_SOURCE_MAPS=1. Without them every client-only package would be missing,
// so a build with no map under either root throws rather than returning a
// silently short list.
//
// ★ Only `server/` and `static/` are read. `cache/` holds stale output from
// earlier builds, and `standalone/` is a copy of the other two.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const MAP_ROOTS = ["server", "static"];

/** Every `*.map` file under `dir`, or [] when `dir` does not exist. */
async function mapFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".map")).map((e) => join(e.parentPath, e.name));
}

/** The `sources` of a plain map, or of every section of an index map. */
function mapSources(map, file) {
  if (!Array.isArray(map.sections)) return map.sources ?? [];
  return map.sections.flatMap((section) => {
    if (!section.map) throw new Error(`${file}: index map section with a url is not supported`);
    return mapSources(section.map, file);
  });
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The innermost installed package a source path belongs to, as path segments
 * below the root node_modules (`["a", "node_modules", "@s", "b"]`), or null for
 * a path with no node_modules segment (the app's own code).
 */
export function packagePathOf(source) {
  const segments = source.replace(/\\/g, "/").split("/").map(decodeSegment);
  const first = segments.indexOf("node_modules");
  if (first === -1) return null;
  const parts = [];
  for (let i = first; i < segments.length; i++) {
    if (segments[i] !== "node_modules") continue;
    const name = segments[i + 1];
    if (!name || name.startsWith(".")) break;
    const width = name.startsWith("@") ? 2 : 1;
    // A package folder with no file below it is not a source.
    if (!segments[i + 1 + width]) break;
    if (parts.length > 0) parts.push("node_modules");
    parts.push(...segments.slice(i + 1, i + 1 + width));
    i += width;
  }
  return parts.length > 0 ? parts : null;
}

async function readPackageJson(dir) {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * @param {string} buildDir the Next build output (`.next`)
 * @param {string} nodeModulesDir the root node_modules the build compiled from
 * @returns {Promise<{
 *   packages: Array<{ name: string; version: string; dir: string }>;
 *   unresolved: Array<{ name: string; source: string }>;
 * }>} `unresolved` holds node_modules paths with no installed package — in
 *   practice a package's own map pointing at its pre-publish monorepo layout
 *   (lucide-react's `node_modules/shared/...`), which belongs to that package.
 */
export async function scanBundledSources(buildDir, nodeModulesDir) {
  const sourcesByDir = new Map();
  for (const root of MAP_ROOTS) {
    const files = await mapFiles(join(buildDir, root));
    if (files.length === 0) {
      throw new Error(`No source map under ${join(buildDir, root)} — build with SBOM_SOURCE_MAPS=1`);
    }
    for (const file of files) {
      for (const source of mapSources(JSON.parse(await readFile(file, "utf8")), file)) {
        const parts = typeof source === "string" ? packagePathOf(source) : null;
        if (!parts) continue;
        const rel = parts.join("/");
        if (!sourcesByDir.has(rel)) sourcesByDir.set(rel, { parts, source });
      }
    }
  }

  const byKey = new Map();
  const unresolved = [];
  for (const [rel, { parts, source }] of [...sourcesByDir].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const dir = join(nodeModulesDir, ...parts);
    const pkg = await readPackageJson(dir);
    if (!pkg) {
      unresolved.push({ name: rel, source });
      continue;
    }
    if (typeof pkg.version !== "string") throw new Error(`${join(dir, "package.json")} has no version`);
    // package.json's name, not the folder: an npm alias installs under another one.
    const name = typeof pkg.name === "string" ? pkg.name : rel.split("/node_modules/").at(-1);
    const key = `${name}@${pkg.version}`;
    if (!byKey.has(key)) byKey.set(key, { name, version: pkg.version, dir });
  }

  const packages = [...byKey.values()].sort((a, b) =>
    a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
  );
  return { packages, unresolved };
}

/**
 * Every npm package whose code the production build compiled in (server and
 * client), resolved to its installed directory. Sorted by name, then version;
 * one entry per name+version.
 *
 * @param {string} buildDir the Next build output (`.next`)
 * @param {string} nodeModulesDir the root node_modules the build compiled from
 * @returns {Promise<Array<{ name: string; version: string; dir: string }>>}
 */
export async function bundledPackages(buildDir, nodeModulesDir) {
  return (await scanBundledSources(buildDir, nodeModulesDir)).packages;
}
