import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attributeUnresolved, bundledPackages, embeddedPaths, packagePathOf, scanBundledSources } from "./bundled-packages.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "bundle");
const BUILD = join(FIXTURE, "build");

// The installed tree is written at test time from installed.json: a directory
// called node_modules cannot be committed (the repo ignores every one), and the
// nested `a/node_modules/b` case needs exactly that name.
let tmp;
let nodeModules;

/** @param {string} root @param {Record<string, object>} tree relative package dir -> package.json */
function writeInstalled(root, tree) {
  for (const [rel, pkg] of Object.entries(tree)) {
    const dir = join(root, ...rel.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  }
}

/** @param {string} root @param {Record<string, object>} maps relative path -> source map */
function writeMaps(root, maps) {
  for (const [rel, map] of Object.entries(maps)) {
    const file = join(root, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(map));
  }
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sbom-bundle-"));
  nodeModules = join(tmp, "node_modules");
  writeInstalled(nodeModules, JSON.parse(readFileSync(join(FIXTURE, "installed.json"), "utf8")));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const pkg = (name, version, rel) => ({ name, version, dir: join(nodeModules, ...rel.split("/")) });

describe("bundledPackages", () => {
  it("lists every package the server and client maps compiled in, sorted and de-duplicated", async () => {
    expect(await bundledPackages(BUILD, nodeModules)).toEqual([
      pkg("@scope/name", "0.3.0", "@scope/name"),
      pkg("a", "2.0.0", "a"),
      pkg("b", "1.0.0", "b"),
      pkg("b", "1.5.0", "a/node_modules/b"),
      pkg("client-only-pkg", "2.1.0", "client-only-pkg"),
      pkg("real-name", "4.0.0", "aliased"),
      pkg("server-only-pkg", "1.0.0", "server-only-pkg"),
    ]);
  });

  it("finds a package only the client compiled in", async () => {
    const names = (await bundledPackages(BUILD, nodeModules)).map((p) => p.name);
    expect(names).toContain("client-only-pkg");
  });

  it("finds a package only the server compiled in, including inside an index map's sections", async () => {
    const names = (await bundledPackages(BUILD, nodeModules)).map((p) => p.name);
    expect(names).toContain("server-only-pkg");
    expect(names).toContain("real-name");
  });

  it("resolves a percent-encoded or backslashed @scope/name to the scoped package", async () => {
    const scoped = (await bundledPackages(BUILD, nodeModules)).filter((p) => p.name === "@scope/name");
    expect(scoped).toEqual([pkg("@scope/name", "0.3.0", "@scope/name")]);
  });

  it("gives a nested package its own version and does not credit the package it is nested in", async () => {
    const out = await bundledPackages(BUILD, nodeModules);
    expect(out.filter((p) => p.name === "b").map((p) => p.version)).toEqual(["1.0.0", "1.5.0"]);
    expect(out.map((p) => p.name)).toContain("a");
    // host/node_modules/b is in a map; host's own code is not.
    expect(out.map((p) => p.name)).not.toContain("host");
  });

  it("names a package by its package.json, not by the folder it is installed under", async () => {
    const out = await bundledPackages(BUILD, nodeModules);
    expect(out.map((p) => p.name)).not.toContain("aliased");
  });

  it("ignores app sources and maps outside server/ and static/", async () => {
    const names = (await bundledPackages(BUILD, nodeModules)).map((p) => p.name);
    expect(names).not.toContain("cache-only-pkg");
    expect(names).not.toContain("standalone-only-pkg");
    expect(names.some((n) => n.includes("src"))).toBe(false);
  });
});

describe("packagePathOf", () => {
  it.each([
    ["../../../../node_modules/%40azure/msal-browser/dist/x.mjs", ["@azure", "msal-browser"]],
    ["..\\..\\node_modules\\@scope\\name\\dist\\x.js", ["@scope", "name"]],
    ["turbopack:///[project]/node_modules/a/node_modules/@s/b/x.js", ["a", "node_modules", "@s", "b"]],
    ["[project]/node_modules/next/dist/compiled/react/index.js", ["next"]],
    ["../../../../src/app/page.tsx", null],
    ["../node_modules/.pnpm/x.js", null],
    ["../node_modules/b", null],
  ])("%s", (source, expected) => {
    expect(packagePathOf(source)).toEqual(expected);
  });
});

describe("embeddedPaths", () => {
  it.each([
    // Both shapes as a real Turbopack build's maps wrote them.
    [
      "../../../../node_modules/lucide-react/dist/esm/Icon.mjs/__nextjs-internal-proxy.mjs%20%7B%20server%20%3D%3E%20%22%5Bproject%5D/node_modules/lucide-react/dist/esm/Icon.mjs%22%20%7D",
      [["lucide-react"], ["lucide-react"]],
    ],
    [
      "../../../../node_modules/moment-timezone/data/packed/latest.json.%5Bjson%5D.cjs/turbopack%3A///node_modules/moment-timezone/data/packed/latest.json",
      [["moment-timezone"], ["moment-timezone"]],
    ],
    ["turbopack:///[project]/node_modules/a/node_modules/@s/b/x.js", [["a", "node_modules", "@s", "b"]]],
    ["../../../../node_modules/%40azure/msal-browser/dist/x.mjs", [["@azure", "msal-browser"]]],
  ])("%s", (source, expected) => {
    expect(embeddedPaths(source).map(packagePathOf).filter(Boolean)).toEqual(expected);
  });
});

describe("scanBundledSources", () => {
  it("reports a node_modules path with no installed package instead of inventing one", async () => {
    const { packages, unresolved } = await scanBundledSources(BUILD, nodeModules);
    expect(packages.map((p) => p.name)).not.toContain("shared");
    // Exactly one: the fixture's proxy and JSON-module sources resolve to their own packages.
    expect(unresolved).toEqual([{ name: "shared", source: "../../../../node_modules/shared/src/utils/x.ts" }]);
  });
});

describe("attributeUnresolved", () => {
  let owned;
  beforeAll(() => {
    owned = join(tmp, "owned", "node_modules");
    writeInstalled(owned, { climber: { name: "climber", version: "5.4.0" }, plain: { name: "plain", version: "1.0.0" } });
    writeMaps(owned, {
      "climber/dist/cjs/index.cjs.map": { version: 3, sources: ["../../../src/utils.ts"], names: [], mappings: "" },
      "plain/dist/index.js.map": { version: 3, sources: ["../src/index.ts"], names: [], mappings: "" },
    });
  });
  const src = { name: "src", source: "turbopack:///[project]/node_modules/src/utils.ts" };

  it("credits a path to the owner whose own maps climb out to it, once", async () => {
    const out = await attributeUnresolved([src, { ...src, source: "x" }], owned, { src: { owner: "climber" } });
    expect(out).toEqual({ packages: [{ name: "climber", version: "5.4.0", dir: join(owned, "climber") }], problems: [] });
  });

  it("names a path no owner is listed for, with the source that named it", async () => {
    const out = await attributeUnresolved([src], owned, {});
    expect(out.packages).toEqual([]);
    expect(out.problems).toEqual([`A source map names a package that is not installed: src (from ${src.source})`]);
  });

  it("refuses an owner that is not installed", async () => {
    const out = await attributeUnresolved([src], owned, { src: { owner: "ghost" } });
    expect(out.packages).toEqual([]);
    expect(out.problems).toEqual([expect.stringMatching(/credited to ghost, which is not installed/)]);
  });

  it("refuses an owner whose maps do not point there", async () => {
    const out = await attributeUnresolved([src], owned, { src: { owner: "plain" } });
    expect(out.packages).toEqual([]);
    expect(out.problems).toEqual([expect.stringMatching(/credited to plain, but no map inside plain points there/)]);
  });
});

describe("a build without the maps it needs fails loudly", () => {
  const plain = { version: 3, sources: ["../node_modules/b/index.js"], names: [], mappings: "" };

  it("throws when static/ holds no source map (browser maps were not switched on)", async () => {
    const build = join(tmp, "no-client");
    writeMaps(build, { "server/page.js.map": plain });
    await expect(bundledPackages(build, nodeModules)).rejects.toThrow(/static/);
  });

  it("throws when server/ holds no source map", async () => {
    const build = join(tmp, "no-server");
    writeMaps(build, { "static/chunks/x.js.map": plain });
    await expect(bundledPackages(build, nodeModules)).rejects.toThrow(/server/);
  });

  it("throws on an index map section that points at a separate file", async () => {
    const build = join(tmp, "section-url");
    writeMaps(build, {
      "server/page.js.map": { version: 3, sections: [{ offset: { line: 0, column: 0 }, url: "other.map" }] },
      "static/chunks/x.js.map": plain,
    });
    await expect(bundledPackages(build, nodeModules)).rejects.toThrow(/url/);
  });
});
