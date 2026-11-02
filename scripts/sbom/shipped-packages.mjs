// The npm packages the desktop installer ships as files, and the Electron it
// ships them in.
// No shebang: vitest imports this module (scripts/sbom/shipped-packages.test.mjs).
//
// Two trees carry package files into the installer:
//   - resources/standalone/node_modules — Next's traced standalone server
//     dependencies, copied by desktop/electron-builder.yml `extraResources`
//     minus its sharp filter;
//   - resources/app.asar — the desktop shell's own production dependencies.
// `desktopPackages` reads the second from desktop/package-lock.json (no npm
// subprocess, so the answer depends on the lockfile alone); `asarPackages` reads
// it back out of a packed app.asar so a release can check the two agree.
import { readFile, readdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagePathOf } from "./bundled-packages.mjs";

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "desktop");
// js-yaml and @electron/asar are desktop dependencies, not root ones.
const desktopRequire = createRequire(join(DESKTOP_DIR, "package.json"));

const STANDALONE_RESOURCE = "standalone/node_modules";

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted by name, then version, then dir; one entry per name+version (the first dir wins). */
function sortedUnique(pkgs) {
  const sorted = [...pkgs].sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version) || compare(a.dir, b.dir));
  const seen = new Set();
  return sorted.filter(({ name, version }) => {
    const key = `${name}@${version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requireVersion(pkg, where) {
  if (!pkg || typeof pkg.version !== "string") throw new Error(`${where} has no version`);
  return pkg.version;
}

/**
 * The `exclude` predicate the builder config's sharp filter amounts to, read
 * from the `extraResources` entry whose `to` is `standalone/node_modules`.
 * Only `**` + `/*` and `!<folder>/**` patterns are understood; anything else
 * throws, because a predicate that half-mirrors the filter would list packages
 * the installer does not ship (or miss ones it does).
 *
 * @param {string} builderConfigPath desktop/electron-builder.yml
 * @returns {Promise<(name: string) => boolean>} true for a top-level folder the filter drops
 */
export async function standaloneExcludeFromBuilderConfig(builderConfigPath) {
  const yaml = desktopRequire("js-yaml");
  const config = yaml.load(await readFile(builderConfigPath, "utf8"));
  const entry = (config?.extraResources ?? []).find((r) => r && r.to === STANDALONE_RESOURCE);
  if (!entry) throw new Error(`${builderConfigPath}: no extraResources entry with to: ${STANDALONE_RESOURCE}`);
  const dropped = [];
  for (const pattern of entry.filter ?? []) {
    if (pattern === "**/*") continue;
    const match = /^!([^*?[\]{}!]+)\/\*\*$/.exec(pattern);
    if (!match) throw new Error(`${builderConfigPath}: cannot mirror the filter pattern ${pattern}`);
    dropped.push(match[1]);
  }
  return (name) => dropped.some((folder) => name === folder || name.startsWith(`${folder}/`));
}

async function isDir(path, dirent) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  return (await stat(path)).isDirectory();
}

/** The package folders directly in `nodeModules`, as names relative to it (`a`, `@s/b`). */
async function packageFolders(nodeModules) {
  let entries;
  try {
    entries = await readdir(nodeModules, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const folders = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !(await isDir(join(nodeModules, entry.name), entry))) continue;
    if (!entry.name.startsWith("@")) {
      folders.push(entry.name);
      continue;
    }
    for (const child of await readdir(join(nodeModules, entry.name), { withFileTypes: true })) {
      if (await isDir(join(nodeModules, entry.name, child.name), child)) folders.push(`${entry.name}/${child.name}`);
    }
  }
  return folders;
}

async function walkInstalled(nodeModules, exclude, out) {
  for (const folder of await packageFolders(nodeModules)) {
    if (exclude(folder)) continue;
    const dir = join(nodeModules, ...folder.split("/"));
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`${dir} is a package folder with no package.json`);
      throw err;
    }
    // package.json's name, not the folder: an npm alias installs under another one.
    out.push({ name: typeof pkg.name === "string" ? pkg.name : folder, version: requireVersion(pkg, join(dir, "package.json")), dir });
    await walkInstalled(join(dir, "node_modules"), () => false, out);
  }
}

/**
 * Every package in the standalone server's node_modules that the installer
 * ships, nested ones included. `exclude` is applied to TOP-LEVEL folders only,
 * exactly as electron-builder applies the filter (its patterns are relative to
 * node_modules itself).
 *
 * @param {string} standaloneNodeModules `.next/standalone/node_modules`
 * @param {(name: string) => boolean} exclude see standaloneExcludeFromBuilderConfig
 * @returns {Promise<Array<{ name: string; version: string; dir: string }>>}
 */
export async function standalonePackages(standaloneNodeModules, exclude) {
  const out = [];
  await walkInstalled(standaloneNodeModules, exclude, out);
  return sortedUnique(out);
}

/**
 * The desktop shell's production dependency set: every non-dev entry of
 * desktop/package-lock.json (lockfile v2/v3 `packages`).
 *
 * @param {string} desktopDir
 * @returns {Promise<Array<{ name: string; version: string; dir: string }>>}
 */
export async function desktopPackages(desktopDir) {
  const lockPath = join(desktopDir, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (!lock.packages) throw new Error(`${lockPath}: no "packages" map (lockfile v1 is not supported)`);
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/") || entry.dev) continue;
    if (entry.link) throw new Error(`${lockPath}: ${key} is a link, which electron-builder does not pack as a copy`);
    const name = typeof entry.name === "string" ? entry.name : key.split("node_modules/").at(-1);
    out.push({ name, version: requireVersion(entry, `${lockPath} ${key}`), dir: join(desktopDir, ...key.split("/")) });
  }
  return sortedUnique(out);
}

/**
 * The packages inside a packed `app.asar`, read with @electron/asar. `dir` is
 * the package's path inside the archive (`<asar>/node_modules/<name>`), which
 * only Electron's patched fs can open.
 *
 * @param {string} asarPath
 * @returns {Promise<Array<{ name: string; version: string; dir: string }>>}
 */
export async function asarPackages(asarPath) {
  const asar = desktopRequire("@electron/asar");
  const roots = new Map();
  for (const file of asar.listPackage(asarPath)) {
    const parts = packagePathOf(file.replace(/^[\\/]+/, ""));
    if (parts) roots.set(parts.join("/"), parts);
  }
  const out = [];
  for (const parts of roots.values()) {
    const rel = join("node_modules", ...parts);
    let pkg;
    try {
      pkg = JSON.parse(asar.extractFile(asarPath, join(rel, "package.json")).toString("utf8"));
    } catch (err) {
      throw new Error(`${asarPath}: cannot read ${join(rel, "package.json")} (${err.message})`);
    }
    out.push({
      name: typeof pkg.name === "string" ? pkg.name : parts.at(-1),
      version: requireVersion(pkg, `${asarPath} ${rel}`),
      dir: join(asarPath, rel),
    });
  }
  return sortedUnique(out);
}

/**
 * The installed Electron — the runtime electron-builder wraps the app in.
 *
 * @param {string} desktopDir
 * @returns {{ name: string; version: string; dir: string }}
 */
export function electronComponent(desktopDir) {
  const dir = join(desktopDir, "node_modules", "electron");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch (err) {
    throw new Error(`electron is not installed under ${desktopDir} (${err.message})`);
  }
  return { name: "electron", version: requireVersion(pkg, join(dir, "package.json")), dir };
}
