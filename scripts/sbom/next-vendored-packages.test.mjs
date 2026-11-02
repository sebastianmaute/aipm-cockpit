import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NEXT_OWN_FOLDERS, nextVendoredPackages, scanNextVendored } from "./next-vendored-packages.mjs";

// Miniature `node_modules/next` trees, written at test time like the other trees.
let tmp;
let nextDir;
let compiled;

const json = (value) => JSON.stringify(value);
const map = (sources) => json({ version: 3, sources, mappings: "" });

/** @param {string} root @param {Record<string, string>} files relative path -> contents */
function writeFiles(root, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const file = join(root, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}

/** A Next install under `tmp/<name>`, holding only `files` below dist/compiled. */
function writeNext(name, files) {
  const dir = join(tmp, name);
  writeFiles(dir, { "package.json": json({ name: "next", version: "16.4.0" }) });
  writeFiles(join(dir, "dist", "compiled"), files);
  return dir;
}

// The shapes the real bundle has: the entry module's export map, a Babel plugin's
// declared `name`, and the two version declarations it carries.
const BABEL_BUNDLE = [
  '(()=>{var e={11:(e,r,t)=>{const l=r.meta={name:"@babel/eslint-parser",version:"7.24.6"}},',
  '22:(e,r,t)=>{a=({name:"transform-classes",visitor:{}});b=({name:"transform-react-jsx/development"});',
  'c=({name:"transform-tagged-template-caching"});d={name:"bugfix-firefox-class-in-computed-class-key"};',
  'f={name:"plugin-bugfix-safari-class-field-initializer-scope"};g={name:"preset-env/remove-regenerator"};',
  'h={name:"test"};i=e=>({name:`${"@babel/plugin-transform-modules-commonjs"}/lazy`,version:"7.26.3"});',
  'j={name:"transform-modules-commonjs"};k={name:"syntax-import-attributes"}},',
  "7684:(e,r,t)=>{function eslintParser(){return t(11)}e.exports={eslintParser:eslintParser,",
  "pluginSyntaxJsx:pluginSyntaxJsx,pluginTransformDefine:pluginTransformDefine,presetEnv:presetEnv}}};",
  "var r={};function __nccwpck_require__(t){}var t=__nccwpck_require__(7684);module.exports=t})();",
].join("");

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sbom-next-vendored-"));
  nextDir = writeNext("next", {
    // A version in package.json.
    "react-is/package.json": json({ name: "react-is", version: "19.3.0-canary-abc", license: "MIT" }),
    "react-is/LICENSE": "MIT",
    "@vercel/og/package.json": json({ name: "@vercel/og", version: "1.0.1", license: "MPL-2.0" }),
    // No version anywhere.
    "zod/package.json": json({ name: "zod", main: "index.js", license: "MIT" }),
    "zod/index.js": "module.exports={};",
    // A `-builtin` name whose version React's CommonJS build declares.
    "react/package.json": json({ name: "react-builtin", main: "index.js" }),
    "react/LICENSE": "MIT",
    "react/cjs/react.production.js": 'exports.version = "19.3.0-canary-abc";',
    "react/cjs/react.development.js": 'exports.version = "19.3.0-canary-abc";',
    "react-experimental/package.json": json({ name: "react-experimental-builtin" }),
    "react-experimental/LICENSE": "MIT",
    "react-experimental/cjs/react.production.js": 'exports.version = "19.3.0-experimental-abc";',
    // A `-builtin` name with no version anywhere.
    "scheduler/package.json": json({ name: "scheduler-builtin" }),
    "scheduler/LICENSE": "MIT",
    "scheduler/cjs/scheduler.production.js": "",
    // Two different declared versions: not reliable, so unknown.
    "react-dom/package.json": json({ name: "react-dom-builtin" }),
    "react-dom/LICENSE": "MIT",
    "react-dom/cjs/a.js": 'exports.version = "1.0.0";',
    "react-dom/cjs/b.js": 'exports.version = "2.0.0";',
    // Next's numbered folders: the upstream name is in package.json...
    "loader-utils2/package.json": json({ name: "loader-utils", license: "MIT" }),
    // ...except this one, where Next copied the folder name.
    "source-map08/package.json": json({ name: "source-map08", license: "BSD-3-Clause" }),
    // The package.json sits one level down.
    "hash.js/sha256/package.json": json({ name: "hash.js", license: "MIT" }),
    "hash.js/sha256/256.js": "",
    // A package.json with no licence evidence is still a library.
    "constants-browserify/package.json": json({ name: "constants-browserify", main: "./constants.json" }),
    // Nothing recognisable at all: listed under the folder name, top-level and scoped.
    "brand-new-lib/index.js": "",
    "@scope/sdk/server/mcp.js": "",
    // A bundle of many packages.
    "babel-packages/package.json": json({ name: "babel-packages", main: "./packages-bundle.js" }),
    "babel-packages/packages-bundle.js": BABEL_BUNDLE,
    // Next's own code.
    "next-server/app-page.runtime.prod.js": 'exports.version = "19.3.0-canary-abc";',
    "next-server/app-page.runtime.prod.js.map": map([
      "webpack://next/webpack/runtime/x",
      "webpack://next/./dist/compiled/react/cjs/react.production.js",
    ]),
    "next-devtools/index.js": "",
    "postcss-plugin-stub-for-cssnano-simple/index.js": "",
    "@next/font/package.json": json({ name: "@next/font", license: "MIT" }),
    "@next/react-refresh-utils/dist/helpers.js": "",
    "stray-file.js": "",
  });
  compiled = join(nextDir, "dist", "compiled");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const entry = (name, version, rel, versionKnown = true) => ({
  name,
  version,
  dir: join(compiled, ...rel.split("/")),
  vendoredIn: "next",
  versionKnown,
});
const UNKNOWN = "vendored-in-next@16.4.0";
const babel = (name, version = UNKNOWN) => entry(name, version, "babel-packages", version !== UNKNOWN);

const allEntries = () => [
  babel("@babel/eslint-parser", "7.24.6"),
  babel("@babel/plugin-bugfix-firefox-class-in-computed-class-key"),
  babel("@babel/plugin-bugfix-safari-class-field-initializer-scope"),
  babel("@babel/plugin-syntax-import-attributes"),
  babel("@babel/plugin-syntax-jsx"),
  babel("@babel/plugin-transform-classes"),
  babel("@babel/plugin-transform-modules-commonjs", "7.26.3"),
  babel("@babel/plugin-transform-react-jsx-development"),
  babel("@babel/preset-env"),
  babel("@babel/preset-modules"),
  entry("@scope/sdk", UNKNOWN, "@scope/sdk", false),
  entry("@vercel/og", "1.0.1", "@vercel/og"),
  babel("babel-plugin-transform-define"),
  entry("brand-new-lib", UNKNOWN, "brand-new-lib", false),
  entry("constants-browserify", UNKNOWN, "constants-browserify", false),
  entry("hash.js", UNKNOWN, "hash.js/sha256", false),
  entry("loader-utils", UNKNOWN, "loader-utils2", false),
  entry("react", "19.3.0-canary-abc", "react"),
  entry("react", "19.3.0-experimental-abc", "react-experimental"),
  entry("react-dom", UNKNOWN, "react-dom", false),
  entry("react-is", "19.3.0-canary-abc", "react-is"),
  entry("scheduler", UNKNOWN, "scheduler", false),
  entry("source-map", UNKNOWN, "source-map08", false),
  entry("zod", UNKNOWN, "zod", false),
];

describe("nextVendoredPackages (installed, not shipped)", () => {
  it("lists every vendored third-party library with its upstream name and version", async () => {
    expect(await nextVendoredPackages(nextDir)).toEqual(allEntries());
  });

  it("lists an unrecognised folder with no package.json and no licence, rather than dropping it", async () => {
    const names = (await nextVendoredPackages(nextDir)).map((p) => p.name);
    expect(names).toContain("brand-new-lib");
    expect(names).toContain("@scope/sdk");
    expect(names).toContain("constants-browserify");
  });

  it("skips only the allowlisted folders of Next's own code", async () => {
    const { skipped } = await scanNextVendored(nextDir);
    expect(skipped.map((s) => s.folder)).toEqual([
      "@next/font",
      "@next/react-refresh-utils",
      "next-devtools",
      "next-server",
      "postcss-plugin-stub-for-cssnano-simple",
    ]);
    for (const { folder, reason } of skipped) expect(reason).toBe(NEXT_OWN_FOLDERS[folder]);
  });

  it("lists a bundle it cannot read under its folder name, not nothing", async () => {
    const dir = writeNext("next-opaque-bundle", {
      "babel-packages/package.json": json({ name: "babel-packages" }),
      "babel-packages/packages-bundle.js": "(()=>{})();",
    });
    expect((await nextVendoredPackages(dir)).map((p) => p.name)).toEqual(["babel-packages"]);
  });

  it("throws when the folder is not a Next install", async () => {
    await expect(nextVendoredPackages(join(tmp, "nowhere"))).rejects.toThrow(/package\.json/);
  });

  it("throws when the install has no dist/compiled", async () => {
    const dir = join(tmp, "next-without-compiled");
    writeFiles(dir, { "package.json": json({ name: "next", version: "16.4.0" }) });
    await expect(nextVendoredPackages(dir)).rejects.toThrow(/dist.compiled/);
  });
});

describe("nextVendoredPackages with a shipped tree", () => {
  let shippedNextDir;
  let buildDir;

  beforeAll(() => {
    shippedNextDir = join(tmp, "standalone", "next");
    writeFiles(join(shippedNextDir, "dist", "compiled"), {
      // Present, in a different shape from the install: any one file is enough.
      "zod/index.js": "",
      "hash.js/sha256/256.js": "",
      // No map ships, so the map beside the installed copy says what it embeds.
      "next-server/app-page.runtime.prod.js": "",
    });
    // A folder with no file in it does not ship.
    mkdirSync(join(shippedNextDir, "dist", "compiled", "loader-utils2"), { recursive: true });
    buildDir = join(tmp, "dot-next");
    writeFiles(buildDir, {
      "server/page.js.map": map(["../../node_modules/next/dist/compiled/%40vercel/og/index.js"]),
      "static/chunks/client.js.map": map([
        "../../node_modules/next/dist/compiled/scheduler/cjs/scheduler.production.js",
        "../../src/app/page.tsx",
      ]),
    });
  });

  const names = (list) => list.map((p) => `${p.name}@${p.version}`);

  it("keeps what is on disk or embedded in a shipped bundle, and drops build-only folders", async () => {
    expect(await nextVendoredPackages(nextDir, { shippedNextDir })).toEqual([
      entry("hash.js", UNKNOWN, "hash.js/sha256", false),
      entry("react", "19.3.0-canary-abc", "react"),
      entry("zod", UNKNOWN, "zod", false),
    ]);
  });

  it("also keeps what the build compiled into its own chunks", async () => {
    expect(names(await nextVendoredPackages(nextDir, { shippedNextDir, buildDir }))).toEqual([
      "@vercel/og@1.0.1",
      `hash.js@${UNKNOWN}`,
      "react@19.3.0-canary-abc",
      `scheduler@${UNKNOWN}`,
      `zod@${UNKNOWN}`,
    ]);
  });

  it("does not change what is skipped", async () => {
    const { skipped } = await scanNextVendored(nextDir, { shippedNextDir });
    expect(skipped).toEqual((await scanNextVendored(nextDir)).skipped);
  });

  it("throws when a folder treated as Next's own has a file in the shipped tree: it would go unlisted", async () => {
    const dir = join(tmp, "standalone-own");
    writeFiles(join(dir, "dist", "compiled"), { "zod/index.js": "", "next-devtools/index.js": "" });
    await expect(nextVendoredPackages(nextDir, { shippedNextDir: dir })).rejects.toThrow(/next-devtools/);
  });

  it("throws for a scoped own folder too", async () => {
    const dir = join(tmp, "standalone-own-scoped");
    writeFiles(join(dir, "dist", "compiled"), { "zod/index.js": "", "@next/font/index.js": "" });
    await expect(nextVendoredPackages(nextDir, { shippedNextDir: dir })).rejects.toThrow(/@next\/font/);
  });

  it("does not take next-server's own bundles for that: they ship, and their maps list what they embed", async () => {
    await expect(nextVendoredPackages(nextDir, { shippedNextDir })).resolves.toBeDefined();
  });

  it("has no problem when every shipped next-server bundle has its map", async () => {
    expect((await scanNextVendored(nextDir, { shippedNextDir })).problems).toEqual([]);
    expect((await scanNextVendored(nextDir)).problems).toEqual([]);
  });

  it("reports a shipped next-server bundle with no map beside it, since what it embeds goes unseen", async () => {
    const dir = join(tmp, "standalone-unmapped");
    writeFiles(join(dir, "dist", "compiled"), { "next-server/mapless.runtime.prod.js": "", "zod/index.js": "" });
    const { problems } = await scanNextVendored(nextDir, { shippedNextDir: dir });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("next-server/mapless.runtime.prod.js");
  });

  it("does not ask for a map beside any other shipped bundle", async () => {
    const dir = join(tmp, "standalone-other");
    writeFiles(join(dir, "dist", "compiled"), { "zod/index.js": "" });
    expect((await scanNextVendored(nextDir, { shippedNextDir: dir })).problems).toEqual([]);
  });

  it("throws on a shipped tree with no compiled file, rather than dropping everything", async () => {
    await expect(nextVendoredPackages(nextDir, { shippedNextDir: join(tmp, "empty") })).rejects.toThrow(/dist.compiled/);
  });

  it("throws on a build with no source maps, rather than dropping browser-only libraries", async () => {
    const noMaps = join(tmp, "no-maps");
    mkdirSync(noMaps, { recursive: true });
    await expect(nextVendoredPackages(nextDir, { shippedNextDir, buildDir: noMaps })).rejects.toThrow(/SBOM_SOURCE_MAPS/);
  });
});
