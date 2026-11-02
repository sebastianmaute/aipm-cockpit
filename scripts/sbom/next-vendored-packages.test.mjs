import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextVendoredPackages, scanNextVendored } from "./next-vendored-packages.mjs";

// A miniature `node_modules/next`, written at test time like the other trees.
let tmp;
let nextDir;
let compiled;

/** @param {Record<string, string>} files path below `compiled/` -> contents */
function writeCompiled(files) {
  for (const [rel, contents] of Object.entries(files)) {
    const file = join(compiled, ...rel.split("/"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, contents);
  }
}

const json = (value) => JSON.stringify(value);

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sbom-next-vendored-"));
  nextDir = join(tmp, "next");
  compiled = join(nextDir, "dist", "compiled");
  mkdirSync(compiled, { recursive: true });
  writeFileSync(join(nextDir, "package.json"), json({ name: "next", version: "16.4.0" }));
  writeCompiled({
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
    // Not third-party libraries: skipped.
    "next-server/app-page.runtime.prod.js": 'exports.version = "19.3.0-canary-abc";',
    "babel-packages/package.json": json({ name: "babel-packages", main: "./packages-bundle.js" }),
    "@next/font/package.json": json({ name: "@next/font", license: "MIT" }),
    "stray-file.js": "",
  });
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

describe("nextVendoredPackages", () => {
  it("lists every vendored third-party library with its upstream name and version", async () => {
    expect(await nextVendoredPackages(nextDir)).toEqual([
      entry("@vercel/og", "1.0.1", "@vercel/og"),
      entry("hash.js", UNKNOWN, "hash.js/sha256", false),
      entry("loader-utils", UNKNOWN, "loader-utils2", false),
      entry("react", "19.3.0-canary-abc", "react"),
      entry("react", "19.3.0-experimental-abc", "react-experimental"),
      entry("react-dom", UNKNOWN, "react-dom", false),
      entry("react-is", "19.3.0-canary-abc", "react-is"),
      entry("scheduler", UNKNOWN, "scheduler", false),
      entry("source-map", UNKNOWN, "source-map08", false),
      entry("zod", UNKNOWN, "zod", false),
    ]);
  });

  it("reports what it skipped and why", async () => {
    const { skipped } = await scanNextVendored(nextDir);
    expect(skipped).toEqual([
      { folder: "@next/font", reason: "first-party" },
      { folder: "babel-packages", reason: "no-licence" },
      { folder: "next-server", reason: "no-package-json" },
    ]);
  });

  it("throws when the folder is not a Next install", async () => {
    await expect(nextVendoredPackages(join(tmp, "nowhere"))).rejects.toThrow(/package\.json/);
  });
});
