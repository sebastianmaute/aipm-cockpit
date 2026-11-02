// A release's CycloneDX SBOM and its licence notices, built from one package set.
// No shebang: vitest imports this module (scripts/sbom/build-sbom.test.mjs).
//
//   npm run release:sbom -- --build .next --standalone <dir> --desktop desktop --out <dir> [--asar <path>]
//
// `--standalone` is the folder holding the traced node_modules (`.next/standalone`).
// `node_modules` and the files named below are read relative to the working
// directory. Exit 0 = both files written; 1 = problems, each named on stderr and
// nothing written; 2 = could not run.
//
// ★★ What gets published carries no absolute path: bom-refs start at the first
// node_modules segment, and the notices print names and licence text only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { scanBundledSources } from "./bundled-packages.mjs";
import { isDenied, licenseOf, parseLicence } from "./licences.mjs";
import { scanNextVendored } from "./next-vendored-packages.mjs";
import { toNotices } from "./notices.mjs";
import {
  asarPackages,
  desktopPackages,
  electronComponent,
  standaloneExcludeFromBuilderConfig,
  standalonePackages,
} from "./shipped-packages.mjs";
import { SOURCE_FILE, readSourceFrom } from "../version-sync-lib.mjs";

export { licenseOf, toNotices };

const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt";
const SECURITY_WORKFLOW = ".github/workflows/security.yml";
const ROOT_LICENCE = "EUPL-1.2";
const VENDORED_PREFIX = "vendored:";

/**
 * Packages the app imports directly. A plain name wants a copy shipped as files;
 * `vendored:<name>` wants Next's vendored copy, so a Next that stops publishing
 * its next-server maps fails here instead of quietly losing React from the list.
 * `@tiptap/react` is the client-only witness: it is imported only by browser code
 * and is absent from the server maps, so it proves the browser maps were read.
 */
export const MUST_INCLUDE = [
  "react",
  "react-dom",
  `${VENDORED_PREFIX}react`,
  `${VENDORED_PREFIX}react-dom`,
  "dompurify",
  "zod",
  "lucide-react",
  "@tanstack/react-virtual",
  "@tiptap/react",
];

/**
 * 80% of 105, the components counted on 2026-11-02, which is a LOWER BOUND of the
 * real number: no build runs locally, so the measure was an older local `.next`
 * of this app (Next 16.3.8) with no browser maps. 20 packages from its server maps
 * + 9 from its standalone tree + 16 from desktop/package-lock.json + 61 vendored,
 * one of them shared. The first CI build has browser maps; tighten this from its count.
 */
export const MIN_COMPONENTS = 84;

/**
 * node_modules paths in source maps that belong to no installed package, each
 * with the reason it is safe. Exact names, and anything else fails.
 */
const UNRESOLVED_ALLOWED = {
  shared: "lucide-react's own map points at its pre-publish monorepo layout; the code is inside lucide-react",
};

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Everything the release ships. A name+version shipped more than once as files is
 * one entry (the first dir wins, so pass the copies with licence files first). A
 * vendored library stays its own entry: it is a different copy from a same-named
 * package, so only a repeat of the same folder and name collapses.
 *
 * @param {{ bundled: object[]; standalone: object[]; desktop: object[]; vendored: object[] }} inputs
 * @returns {object[]} sorted by name, version, dir
 */
export function shippedSet({ bundled, standalone, desktop, vendored }) {
  const byKey = new Map();
  for (const pkg of [...bundled, ...standalone, ...desktop]) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!byKey.has(key)) byKey.set(key, pkg);
  }
  for (const pkg of vendored) {
    const key = `vendored\0${pkg.dir}\0${pkg.name}`;
    if (!byKey.has(key)) byKey.set(key, pkg);
  }
  return [...byKey.values()].sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version) || compare(a.dir, b.dir));
}

/** `dir` from its first node_modules segment on: the same on every machine. */
function portableDir(dir) {
  const segments = dir.replace(/\\/g, "/").split("/");
  const first = segments.indexOf("node_modules");
  return segments.slice(first === -1 ? -1 : first + 1).join("/");
}

function purlOf(pkg) {
  const name = pkg.name.split("/").map(encodeURIComponent).join("/");
  return pkg.versionKnown === false ? `pkg:npm/${name}` : `pkg:npm/${name}@${encodeURIComponent(pkg.version)}`;
}

/** Any SPDX expression, one id included: `license.id` would need the schema's enum to know the id. */
function licensesField(spdx) {
  return [{ expression: spdx }];
}

function toComponent(pkg, type = "library") {
  const { spdx } = licenseOf(pkg);
  const properties = [];
  if (pkg.vendoredIn) properties.push({ name: "aipm:vendored-in", value: pkg.vendoredIn });
  if (pkg.versionKnown === false) properties.push({ name: "aipm:version-unknown", value: "true" });
  // An unknown version is left out (the field is optional): the marker the
  // vendored scan uses must never be read as an upstream version.
  const versionKnown = pkg.versionKnown !== false;
  return {
    type,
    "bom-ref": `${portableDir(pkg.dir)}#${pkg.name}${versionKnown ? `@${pkg.version}` : ""}`,
    name: pkg.name,
    ...(versionKnown ? { version: pkg.version } : {}),
    purl: purlOf(pkg),
    ...(spdx ? { licenses: licensesField(spdx) } : {}),
    ...(properties.length > 0 ? { properties } : {}),
  };
}

/**
 * No timestamp and no serial number: the same input gives the same bytes.
 *
 * @param {object[]} set from shippedSet
 * @param {{ appVersion: string; electron: { name: string; version: string; dir: string } }} options
 * @returns {object}
 */
export function toCycloneDx(set, { appVersion, electron }) {
  const components = [...set.map((pkg) => toComponent(pkg)), toComponent(electron, "framework")];
  const refs = new Set(components.map((c) => c["bom-ref"]));
  if (refs.size !== components.length) throw new Error("Two SBOM components share a bom-ref");
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": "aipm-cockpit",
        name: "AI PM Cockpit",
        version: appVersion,
        licenses: licensesField(ROOT_LICENCE),
      },
    },
    components,
  };
}

function describePkg(pkg) {
  if (!pkg.vendoredIn) return `${pkg.name}@${pkg.version}`;
  return `${pkg.name} (vendored in ${pkg.vendoredIn}, folder ${portableDir(pkg.dir)})`;
}

/**
 * @param {object[]} set
 * @param {string[]} deny SPDX ids, from readDenyList
 * @returns {string[]} problems: a denied licence, or one not known
 */
export function checkLicences(set, deny) {
  const problems = [];
  for (const pkg of set) {
    const { spdx, declared } = licenseOf(pkg);
    if (!spdx) {
      problems.push(`${describePkg(pkg)}: unknown licence${declared ? ` (its package.json says "${declared}")` : ""}`);
    } else if (isDenied(parseLicence(spdx), deny)) {
      problems.push(`${describePkg(pkg)}: licence ${spdx} is on the deny list in ${SECURITY_WORKFLOW}`);
    }
  }
  return problems;
}

/**
 * @param {object[]} set
 * @param {string[]} mustInclude names as MUST_INCLUDE writes them
 * @param {number} floor the fewest components a real build can have
 * @returns {string[]} problems
 */
export function checkGuard(set, mustInclude, floor) {
  const problems = [];
  for (const entry of mustInclude) {
    const wantsVendored = entry.startsWith(VENDORED_PREFIX);
    const name = wantsVendored ? entry.slice(VENDORED_PREFIX.length) : entry;
    if (!set.some((pkg) => pkg.name === name && Boolean(pkg.vendoredIn) === wantsVendored)) {
      problems.push(`${entry} must be in the set and is not (the build's source maps or the shipped tree may have changed)`);
    }
  }
  if (set.length < floor) problems.push(`Only ${set.length} components, below the floor of ${floor}: the scan is probably missing a source`);
  return problems;
}

/**
 * @param {Array<{ name: string; source: string }>} unresolved from scanBundledSources
 * @returns {string[]} problems
 */
export function checkUnresolved(unresolved) {
  return unresolved
    .filter(({ name }) => !Object.hasOwn(UNRESOLVED_ALLOWED, name))
    .map(({ name, source }) => `A source map names a package that is not installed: ${name} (from ${source})`);
}

/** @returns {string[]} problems: what one side holds and the other does not */
function checkAsar(inAsar, inLockfile) {
  const key = (pkg) => `${pkg.name}@${pkg.version}`;
  const asarKeys = new Set(inAsar.map(key));
  const lockKeys = new Set(inLockfile.map(key));
  return [
    ...[...asarKeys].filter((k) => !lockKeys.has(k)).map((k) => `app.asar holds ${k}, which desktop/package-lock.json does not list`),
    ...[...lockKeys].filter((k) => !asarKeys.has(k)).map((k) => `desktop/package-lock.json lists ${k}, which app.asar does not hold`),
  ];
}

/**
 * The one deny list, `deny-licenses` in the security workflow. Throws when it is
 * gone: a moved list must not read as an empty one.
 *
 * @param {string} repoDir
 * @returns {string[]}
 */
export function readDenyList(repoDir) {
  const file = join(repoDir, ...SECURITY_WORKFLOW.split("/"));
  const line = /^\s*deny-licenses:\s*(\S.*)$/m.exec(readFileSync(file, "utf8"));
  if (!line) throw new Error(`${SECURITY_WORKFLOW} has no deny-licenses list`);
  return line[1].split(",").map((id) => id.trim()).filter(Boolean);
}

/**
 * A traced standalone copy has package.json but no licence file, so each entry
 * points at the same package in the install when it is that version.
 *
 * @returns {Promise<{ pkgs: object[]; problems: string[] }>} `problems` names each
 *   copy the install cannot stand in for and that has no licence text of its own:
 *   its notice would carry an id and no text, which the licence does not allow.
 */
async function withInstalledDirs(pkgs, standaloneNodeModules, nodeModules) {
  const problems = [];
  const relocated = await Promise.all(
    pkgs.map(async (pkg) => {
      const installed = join(nodeModules, relative(standaloneNodeModules, pkg.dir));
      let version = null;
      try {
        ({ version } = JSON.parse(await readFile(join(installed, "package.json"), "utf8")));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      if (version === pkg.version) return { ...pkg, dir: installed };
      if (!licenseOf(pkg).text) {
        const held = version ? `holds ${version}` : "has no copy";
        problems.push(`The standalone copy ${pkg.name}@${pkg.version} has no licence file, and the install ${held} to read one from`);
      }
      return pkg;
    }),
  );
  return { pkgs: relocated, problems };
}

async function collect({ build, standalone, desktop, asar, cwd }) {
  const nodeModules = join(cwd, "node_modules");
  const standaloneNodeModules = join(standalone, "node_modules");
  const bundledScan = await scanBundledSources(build, nodeModules);
  const exclude = await standaloneExcludeFromBuilderConfig(join(desktop, "electron-builder.yml"));
  const standaloneScan = await withInstalledDirs(await standalonePackages(standaloneNodeModules, exclude), standaloneNodeModules, nodeModules);
  const standalonePkgs = standaloneScan.pkgs;
  const desktopPkgs = await desktopPackages(desktop);
  const vendoredScan = await scanNextVendored(join(nodeModules, "next"), {
    shippedNextDir: join(standaloneNodeModules, "next"),
    buildDir: build,
  });
  const set = shippedSet({
    bundled: bundledScan.packages,
    standalone: standalonePkgs,
    desktop: desktopPkgs,
    vendored: vendoredScan.packages,
  });
  return {
    set,
    electron: electronComponent(desktop),
    deny: readDenyList(cwd),
    problems: [
      ...checkUnresolved(bundledScan.unresolved),
      ...vendoredScan.problems,
      ...standaloneScan.problems,
      ...(asar ? checkAsar(await asarPackages(asar), desktopPkgs) : []),
    ],
  };
}

function parseCli(argv, cwd) {
  const { values } = parseArgs({
    args: argv,
    options: {
      build: { type: "string" },
      standalone: { type: "string" },
      desktop: { type: "string" },
      out: { type: "string" },
      asar: { type: "string" },
    },
  });
  for (const required of ["build", "standalone", "desktop", "out"]) {
    if (!values[required]) throw new Error(`--${required} is required (--build <dir> --standalone <dir> --desktop <dir> --out <dir> [--asar <path>])`);
  }
  const { build, standalone, desktop, out, asar } = values;
  return {
    cwd,
    build: resolve(cwd, build),
    standalone: resolve(cwd, standalone),
    desktop: resolve(cwd, desktop),
    out: resolve(cwd, out),
    asar: asar ? resolve(cwd, asar) : null,
  };
}

async function main(argv, cwd) {
  const options = parseCli(argv, cwd);
  const { version } = readSourceFrom(readFileSync(join(cwd, ...SOURCE_FILE.split("/")), "utf8"));
  const { set, electron, deny, problems } = await collect(options);
  const all = [...problems, ...checkLicences([...set, electron], deny), ...checkGuard(set, MUST_INCLUDE, MIN_COMPONENTS)];
  if (all.length > 0) {
    for (const problem of all) console.error(`release:sbom: ${problem}`);
    return 1;
  }
  mkdirSync(options.out, { recursive: true });
  const sbomFile = `aipm-cockpit-${version}-sbom.cdx.json`;
  writeFileSync(join(options.out, sbomFile), `${JSON.stringify(toCycloneDx(set, { appVersion: version, electron }), null, 2)}\n`);
  writeFileSync(join(options.out, NOTICES_FILE), toNotices(set, { electron }));
  console.log(`release:sbom: ${set.length + 1} components in ${sbomFile} and ${NOTICES_FILE}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.cwd()).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`release:sbom could not run: ${err.message}`);
      process.exitCode = 2;
    },
  );
}
