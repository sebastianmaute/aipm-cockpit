import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asarPackages,
  desktopPackages,
  electronComponent,
  standaloneExcludeFromBuilderConfig,
  standalonePackages,
} from "./shipped-packages.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILDER_CONFIG = join(REPO, "desktop", "electron-builder.yml");
// @electron/asar is a desktop dependency, not a root one.
const asar = createRequire(join(REPO, "desktop", "package.json"))("@electron/asar");

// Every tree is written at test time: a directory called node_modules cannot be
// committed (the repo ignores every one).
let tmp;

/** @param {string} root @param {Record<string, object>} tree relative package dir -> package.json */
function writePackages(root, tree) {
  for (const [rel, pkg] of Object.entries(tree)) {
    const dir = join(root, ...rel.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
  }
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sbom-shipped-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const pkg = (name, version, root, rel) => ({ name, version, dir: join(root, ...rel.split("/")) });
const nameVersion = (list) => list.map(({ name, version }) => `${name}@${version}`);

describe("standaloneExcludeFromBuilderConfig", () => {
  it("reads the sharp filter from desktop/electron-builder.yml", async () => {
    const exclude = await standaloneExcludeFromBuilderConfig(BUILDER_CONFIG);
    expect(exclude("sharp")).toBe(true);
    expect(exclude("@img/sharp-win32-x64")).toBe(true);
    expect(exclude("@img/colour")).toBe(true);
    expect(exclude("next")).toBe(false);
    expect(exclude("sharpie")).toBe(false);
    expect(exclude("@imgix/x")).toBe(false);
  });

  it("reads a source-map exclusion as dropping files, never a package", async () => {
    const file = join(tmp, "maps.yml");
    writeFileSync(
      file,
      [
        "extraResources:",
        "  - from: ../.next/standalone/node_modules",
        "    to: standalone/node_modules",
        "    filter:",
        '      - "**/*"',
        '      - "!sharp/**"',
        '      - "!**/*.map"',
        "",
      ].join("\n"),
    );
    const exclude = await standaloneExcludeFromBuilderConfig(file);
    expect(exclude("sharp")).toBe(true);
    expect(exclude("next")).toBe(false);
    expect(exclude("source-map")).toBe(false);
  });

  it("refuses a filter pattern it cannot mirror exactly", async () => {
    const file = join(tmp, "unsupported.yml");
    writeFileSync(
      file,
      [
        "extraResources:",
        "  - from: ../.next/standalone/node_modules",
        "    to: standalone/node_modules",
        "    filter:",
        '      - "**/*"',
        '      - "!**/*.d.ts"',
        "",
      ].join("\n"),
    );
    await expect(standaloneExcludeFromBuilderConfig(file)).rejects.toThrow(/!\*\*\/\*\.d\.ts/);
  });

  it("refuses a config with no standalone/node_modules resource", async () => {
    const file = join(tmp, "missing.yml");
    writeFileSync(file, "extraResources:\n  - from: a\n    to: b\n");
    await expect(standaloneExcludeFromBuilderConfig(file)).rejects.toThrow(/standalone\/node_modules/);
  });
});

describe("standalonePackages", () => {
  let nm;
  beforeAll(() => {
    nm = join(tmp, "standalone", "node_modules");
    writePackages(nm, {
      next: { name: "next", version: "16.4.0" },
      sharp: { name: "sharp", version: "0.34.5" },
      "@img/sharp-win32-x64": { name: "@img/sharp-win32-x64", version: "0.34.5" },
      "@img/colour": { name: "@img/colour", version: "1.0.0" },
      "@swc/helpers": { name: "@swc/helpers", version: "0.5.15" },
      a: { name: "a", version: "1.0.0" },
      "a/node_modules/b": { name: "b", version: "2.0.0" },
      "a/node_modules/sharp": { name: "sharp", version: "0.30.0" },
      aliased: { name: "real-name", version: "3.0.0" },
    });
    mkdirSync(join(nm, ".bin"), { recursive: true });
    writeFileSync(join(nm, ".package-lock.json"), "{}");
    // A package's own nested package.json (an ESM marker) is not a package.
    mkdirSync(join(nm, "a", "esm"), { recursive: true });
    writeFileSync(join(nm, "a", "esm", "package.json"), JSON.stringify({ type: "module" }));
  });

  it("lists every package left after the builder filter, sorted, nested ones included", async () => {
    const exclude = await standaloneExcludeFromBuilderConfig(BUILDER_CONFIG);
    expect(await standalonePackages(nm, exclude)).toEqual([
      pkg("@swc/helpers", "0.5.15", nm, "@swc/helpers"),
      pkg("a", "1.0.0", nm, "a"),
      pkg("b", "2.0.0", nm, "a/node_modules/b"),
      pkg("next", "16.4.0", nm, "next"),
      pkg("real-name", "3.0.0", nm, "aliased"),
      // The builder filter drops only TOP-LEVEL packages, so a nested sharp ships.
      pkg("sharp", "0.30.0", nm, "a/node_modules/sharp"),
    ]);
  });

  it("throws on a package folder with no package.json rather than skipping it", async () => {
    const broken = join(tmp, "broken", "node_modules");
    mkdirSync(join(broken, "ghost"), { recursive: true });
    await expect(standalonePackages(broken, () => false)).rejects.toThrow(/ghost/);
  });
});

describe("desktopPackages and asarPackages", () => {
  let desktopDir;
  let appAsar;
  const prodTree = {
    "electron-updater": { name: "electron-updater", version: "6.8.9" },
    "electron-updater/node_modules/semver": { name: "semver", version: "7.7.4" },
    "builder-util-runtime": { name: "builder-util-runtime", version: "9.7.0" },
    "@scope/lib": { name: "@scope/lib", version: "1.2.3" },
    aliased: { name: "real-name", version: "3.0.0" },
    "win-only": { name: "win-only", version: "1.0.0" },
  };

  beforeAll(async () => {
    desktopDir = join(tmp, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(
      join(desktopDir, "package-lock.json"),
      JSON.stringify({
        name: "desktop",
        lockfileVersion: 3,
        packages: {
          "": { name: "desktop", dependencies: { "electron-updater": "6.8.9" }, devDependencies: { electron: "44.9.1" } },
          "node_modules/electron-updater": { version: "6.8.9" },
          "node_modules/electron-updater/node_modules/semver": { version: "7.7.4" },
          "node_modules/builder-util-runtime": { version: "9.7.0" },
          "node_modules/@scope/lib": { version: "1.2.3" },
          "node_modules/aliased": { name: "real-name", version: "3.0.0" },
          // Optional entries: installed, and so packed, only when the platform fits.
          "node_modules/win-only": { version: "1.0.0", optional: true, os: ["win32"], cpu: ["x64", "arm64"] },
          "node_modules/fsevents": { version: "2.3.3", optional: true, os: ["darwin"] },
          "node_modules/arm-only": { version: "1.0.0", optional: true, os: ["win32"], cpu: ["arm64"] },
          "node_modules/not-windows": { version: "1.0.0", optional: true, os: ["!win32"] },
          "node_modules/electron": { version: "44.9.1", dev: true },
          "node_modules/semver": { version: "6.3.1", dev: true },
        },
      }),
    );
    writePackages(join(desktopDir, "node_modules"), { ...prodTree, electron: { name: "electron", version: "44.9.1" } });

    // What electron-builder packs: the app files plus the production node_modules.
    const app = join(tmp, "app");
    mkdirSync(join(app, "dist"), { recursive: true });
    writeFileSync(join(app, "dist", "main.js"), "");
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "desktop", version: "1.0.0" }));
    writePackages(join(app, "node_modules"), prodTree);
    appAsar = join(tmp, "app.asar");
    await asar.createPackage(app, appAsar);
  });

  it("desktopPackages lists the lockfile's production entries only", async () => {
    const nm = join(desktopDir, "node_modules");
    expect(await desktopPackages(desktopDir)).toEqual([
      pkg("@scope/lib", "1.2.3", nm, "@scope/lib"),
      pkg("builder-util-runtime", "9.7.0", nm, "builder-util-runtime"),
      pkg("electron-updater", "6.8.9", nm, "electron-updater"),
      pkg("real-name", "3.0.0", nm, "aliased"),
      pkg("semver", "7.7.4", nm, "electron-updater/node_modules/semver"),
      pkg("win-only", "1.0.0", nm, "win-only"),
    ]);
  });

  it("asarPackages lists the packages inside a packed app.asar", async () => {
    expect(await asarPackages(appAsar)).toEqual([
      pkg("@scope/lib", "1.2.3", appAsar, "node_modules/@scope/lib"),
      pkg("builder-util-runtime", "9.7.0", appAsar, "node_modules/builder-util-runtime"),
      pkg("electron-updater", "6.8.9", appAsar, "node_modules/electron-updater"),
      pkg("real-name", "3.0.0", appAsar, "node_modules/aliased"),
      pkg("semver", "7.7.4", appAsar, "node_modules/electron-updater/node_modules/semver"),
      pkg("win-only", "1.0.0", appAsar, "node_modules/win-only"),
    ]);
  });

  it("the desktop production set equals what the asar ships", async () => {
    expect(nameVersion(await asarPackages(appAsar))).toEqual(nameVersion(await desktopPackages(desktopDir)));
  });

  it("electronComponent reads the installed Electron", () => {
    expect(electronComponent(desktopDir)).toEqual(pkg("electron", "44.9.1", desktopDir, "node_modules/electron"));
  });

  it("electronComponent throws when the installed Electron is not the one the lockfile pins", () => {
    const stale = join(tmp, "stale-desktop");
    mkdirSync(stale, { recursive: true });
    writeFileSync(
      join(stale, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/electron": { version: "44.9.1", dev: true } } }),
    );
    writePackages(join(stale, "node_modules"), { electron: { name: "electron", version: "44.3.0" } });
    expect(() => electronComponent(stale)).toThrow(/44.3.0.*44.9.1/);
  });

  it("electronComponent throws when the lockfile pins no Electron", () => {
    const unpinned = join(tmp, "unpinned-desktop");
    mkdirSync(unpinned, { recursive: true });
    writeFileSync(join(unpinned, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
    writePackages(join(unpinned, "node_modules"), { electron: { name: "electron", version: "44.9.1" } });
    expect(() => electronComponent(unpinned)).toThrow(/pins no electron/);
  });

  it("electronComponent throws when Electron is not installed", () => {
    expect(() => electronComponent(join(tmp, "nowhere"))).toThrow(/electron/);
  });
});
