import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_COMPONENTS,
  MIN_WEB_COMPONENTS,
  MUST_INCLUDE,
  checkGuard,
  checkLicences,
  checkUnresolved,
  readDenyList,
  shippedSet,
  toCycloneDx,
  toNotices,
} from "./build-sbom.mjs";
import { checkSbom, sbomName } from "../release-publish-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const CLI = join(HERE, "build-sbom.mjs");
// @electron/asar is a desktop dependency, not a root one.
const asar = createRequire(join(REPO, "desktop", "package.json"))("@electron/asar");

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

let tmp;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sbom-build-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const pkgDir = (name, files) => {
  const dir = join(tmp, "lib", "node_modules", ...name.split("/"));
  writeFiles(dir, files);
  return dir;
};
const file = (name, version, dir = join(tmp, "node_modules", name)) => ({ name, version, dir });
const vendored = (name, version, folder = name, versionKnown = true) => ({
  name,
  version,
  dir: join(tmp, "node_modules", "next", "dist", "compiled", folder),
  vendoredIn: "next",
  versionKnown,
});

describe("shippedSet", () => {
  it("is the union of every input, sorted", () => {
    const set = shippedSet({
      bundled: [file("b", "1.0.0")],
      standalone: [file("c", "1.0.0")],
      desktop: [file("a", "1.0.0")],
      vendored: [vendored("d", "1.0.0")],
    });
    expect(set.map((p) => p.name)).toEqual(["a", "b", "c", "d"]);
  });

  it("merges one name+version shipped twice as files, and the first dir wins", () => {
    const first = file("a", "1.0.0", join(tmp, "first", "a"));
    const set = shippedSet({ bundled: [first], standalone: [file("a", "1.0.0", join(tmp, "second", "a"))], desktop: [], vendored: [] });
    expect(set).toEqual([first]);
  });

  it("keeps two versions of one package apart, scoped ones too", () => {
    const set = shippedSet({
      bundled: [file("@s/a", "2.0.0"), file("@s/a", "1.0.0")],
      standalone: [],
      desktop: [],
      vendored: [],
    });
    expect(set.map((p) => `${p.name}@${p.version}`)).toEqual(["@s/a@1.0.0", "@s/a@2.0.0"]);
  });

  it("does not merge a vendored copy with the same package shipped as files", () => {
    const set = shippedSet({ bundled: [file("react", "19.3.1")], standalone: [], desktop: [], vendored: [vendored("react", "19.3.1")] });
    expect(set).toHaveLength(2);
  });

  it("keeps vendored copies in different folders apart, and merges a repeat of one folder", () => {
    const set = shippedSet({
      bundled: [],
      standalone: [],
      desktop: [],
      vendored: [vendored("react", "19.3.0"), vendored("react", "19.3.0-exp", "react-experimental"), vendored("react", "19.3.0")],
    });
    expect(set.map((p) => p.version)).toEqual(["19.3.0", "19.3.0-exp"]);
  });
});

describe("toCycloneDx", () => {
  let electron;
  let bom;
  let plain;
  let scoped;
  let noLicence;

  beforeAll(() => {
    electron = { name: "electron", version: "44.9.1", dir: pkgDir("electron", { "package.json": json({ license: "MIT" }) }) };
    plain = file("plain", "1.0.0", pkgDir("plain", { "package.json": json({ license: "MIT" }) }));
    scoped = file("@scope/name", "1.0.0", pkgDir("@scope/name", { "package.json": json({ license: "(MIT OR Apache-2.0)" }) }));
    noLicence = file("bare", "1.0.0", pkgDir("bare", { "package.json": json({}) }));
    bom = toCycloneDx([plain, scoped, noLicence], { appVersion: "1.20.1", electron });
  });

  const component = (name) => bom.components.find((c) => c.name === name);

  it("has the CycloneDX envelope", () => {
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.5");
    expect(bom.version).toBe(1);
  });

  it("describes the app as the root component", () => {
    expect(bom.metadata.component).toMatchObject({
      type: "application",
      name: "AI PM Cockpit",
      version: "1.20.1",
      licenses: [{ expression: "EUPL-1.2" }],
    });
  });

  it("gives each component a name, version, licence and purl", () => {
    expect(component("plain")).toMatchObject({
      type: "library",
      name: "plain",
      version: "1.0.0",
      purl: "pkg:npm/plain@1.0.0",
      licenses: [{ expression: "MIT" }],
    });
  });

  it("encodes a scope in the purl", () => {
    expect(component("@scope/name").purl).toBe("pkg:npm/%40scope/name@1.0.0");
    expect(component("@scope/name").licenses).toEqual([{ expression: "(MIT OR Apache-2.0)" }]);
  });

  it("encodes a version the purl spec reserves", () => {
    const built = file("built", "1.0.0+abc", pkgDir("built", { "package.json": json({ license: "MIT" }) }));
    const { components } = toCycloneDx([built], { appVersion: "1", electron });
    expect(components.find((c) => c.name === "built").purl).toBe("pkg:npm/built@1.0.0%2Babc");
  });

  it("leaves licences off a component whose licence is unknown", () => {
    expect(component("bare").licenses).toBeUndefined();
  });

  it("lists Electron", () => {
    expect(component("electron")).toMatchObject({ version: "44.9.1", purl: "pkg:npm/electron@44.9.1", licenses: [{ expression: "MIT" }] });
  });

  describe("a vendored library", () => {
    const dir = () => join(tmp, "lib", "node_modules", "next", "dist", "compiled");
    const entry = (name, folder, version, versionKnown) => {
      const path = join(dir(), folder);
      writeFiles(path, { "package.json": json({ license: "MIT" }) });
      return { name, version, dir: path, vendoredIn: "next", versionKnown };
    };

    it("with no known version leaves it out of the component and the purl, and says so", () => {
      const { components } = toCycloneDx([entry("zod", "zod", "vendored-in-next@16.4.2", false)], { appVersion: "1", electron });
      const zod = components.find((c) => c.name === "zod");
      expect(zod.purl).toBe("pkg:npm/zod");
      expect(Object.hasOwn(zod, "version")).toBe(false);
      expect(JSON.stringify(zod)).not.toContain("vendored-in-next@");
      expect(zod.properties).toEqual(
        expect.arrayContaining([
          { name: "aipm:vendored-in", value: "next" },
          { name: "aipm:version-unknown", value: "true" },
        ]),
      );
    });

    it("with a known version keeps it in the purl and is still marked vendored", () => {
      const { components } = toCycloneDx([entry("react", "react", "19.3.0", true)], { appVersion: "1", electron });
      const react = components.find((c) => c.name === "react");
      expect(react.purl).toBe("pkg:npm/react@19.3.0");
      expect(react.properties).toEqual([{ name: "aipm:vendored-in", value: "next" }]);
    });

    it("has a bom-ref of its own beside a file copy and a sibling folder", () => {
      const a = entry("react", "react", "19.3.0", true);
      const b = entry("react", "react-experimental", "19.3.0", true);
      const asFiles = file("react", "19.3.0", pkgDir("react", { "package.json": json({ license: "MIT" }) }));
      const { components } = toCycloneDx([a, b, asFiles], { appVersion: "1", electron });
      const refs = components.map((c) => c["bom-ref"]);
      expect(new Set(refs).size).toBe(refs.length);
    });

    it("whose licence text comes from another package records that package", () => {
      const path = join(dir(), "image-detector");
      writeFiles(path, { "detector.js": "" });
      const detector = { name: "image-detector", version: "m", dir: path, vendoredIn: "next", versionKnown: false };
      const component = toCycloneDx([detector], { appVersion: "1", electron }).components.find((c) => c.name === "image-detector");
      expect(component.licenses).toEqual([{ expression: "MIT" }]);
      expect(component.properties).toEqual(expect.arrayContaining([{ name: "aipm:derived-from", value: "image-size" }]));
    });

    it("keeps babel-style entries sharing one folder apart", () => {
      const a = entry("@babel/a", "babel-packages", "vendored-in-next@1", false);
      const b = entry("@babel/b", "babel-packages", "vendored-in-next@1", false);
      const refs = toCycloneDx([a, b], { appVersion: "1", electron }).components.map((c) => c["bom-ref"]);
      expect(new Set(refs).size).toBe(refs.length);
    });
  });

  it("two versions of one package in the same relative place still get different bom-refs", () => {
    const one = file("x", "1.0.0", join(tmp, "one", "node_modules", "x"));
    const two = file("x", "2.0.0", join(tmp, "two", "node_modules", "x"));
    const refs = toCycloneDx([one, two], { appVersion: "1", electron }).components.map((c) => c["bom-ref"]);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("says nothing about the machine it was built on", () => {
    expect(json(bom)).not.toContain(tmp.replace(/\\/g, "\\\\"));
    expect(json(bom)).not.toContain(tmp.replace(/\\/g, "/"));
  });

  it("is the same bytes for the same input: no timestamp, no random serial", () => {
    const again = toCycloneDx([plain, scoped, noLicence], { appVersion: "1.20.1", electron });
    expect(json(again)).toBe(json(bom));
    expect(bom.serialNumber).toBeUndefined();
    expect(bom.metadata.timestamp).toBeUndefined();
  });

  it("names the same set as the notices", () => {
    const set = [plain, scoped, noLicence];
    const headers = [...toNotices(set, { electron }).matchAll(/^=== (\S+) \S+ ===$/gm)].map((m) => m[1]).sort();
    expect(headers).toEqual(bom.components.map((c) => c.name).sort());
  });
});

describe("checkLicences", () => {
  const deny = ["GPL-3.0-only", "GPL-3.0-or-later"];

  it("passes an allowed licence", () => {
    const pkg = file("ok", "1.0.0", pkgDir("ok", { "package.json": json({ license: "MIT" }) }));
    expect(checkLicences([pkg], deny)).toEqual([]);
  });

  it("reports a GPL-3.0 package by name", () => {
    const pkg = file("gpl", "1.0.0", pkgDir("gpl", { "package.json": json({ license: "GPL-3.0" }) }));
    const problems = checkLicences([pkg], deny);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("gpl@1.0.0");
    expect(problems[0]).toContain("GPL-3.0");
  });

  it("reports an unknown licence by name, with what the package said", () => {
    const none = file("none", "1.0.0", pkgDir("none", { "package.json": json({}) }));
    const odd = file("odd", "1.0.0", pkgDir("odd", { "package.json": json({ license: "SEE LICENSE IN EULA" }) }));
    const problems = checkLicences([none, odd], deny);
    expect(problems[0]).toMatch(/none@1\.0\.0.*unknown/);
    expect(problems[1]).toMatch(/odd@1\.0\.0.*unknown.*SEE LICENSE IN EULA/);
  });

  it("reports an override whose licence text should come from a package that is not there", () => {
    const dir = pkgDir("lone/compiled/image-detector", { "detector.js": "" });
    const problems = checkLicences([{ name: "image-detector", version: "m", dir, vendoredIn: "next", versionKnown: false }], deny);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/image-detector.*image-size/);
  });

  it("calls an id SPDX does not define unknown, however well it is shaped", () => {
    const pkg = file("bsd", "1.0.0", pkgDir("bsd", { "package.json": json({ license: "BSD" }) }));
    expect(checkLicences([pkg], deny)[0]).toMatch(/bsd@1\.0\.0.*unknown.*"BSD"/);
  });

  it("names the folder of a vendored library nobody has looked at", () => {
    const dir = pkgDir("next/dist/compiled/mystery-folder", { "package.json": json({}) });
    const problems = checkLicences([{ name: "mystery", version: "m", dir, vendoredIn: "next", versionKnown: false }], deny);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("mystery");
    expect(problems[0]).toContain("vendored");
    expect(problems[0]).toContain("mystery-folder");
  });

  it("a LICENSE file alone is not a licence id", () => {
    const pkg = file("file-only", "1.0.0", pkgDir("file-only", { "package.json": json({}), LICENSE: "words" }));
    expect(checkLicences([pkg], deny)[0]).toMatch(/unknown/);
  });
});

describe("checkGuard", () => {
  let set;
  beforeAll(() => {
    set = [file("react", "1"), vendored("react", "1"), file("zod", "1"), vendored("only-vendored", "1")];
  });

  it("passes when everything is there", () => {
    expect(checkGuard(set, ["react", "vendored:react", "zod"], 4)).toEqual([]);
  });

  it("reports a missing must-include", () => {
    const problems = checkGuard(set, ["dompurify"], 0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("dompurify");
  });

  it("a plain name wants a copy shipped as files; a vendored copy does not satisfy it", () => {
    expect(checkGuard(set, ["only-vendored"], 0)[0]).toContain("only-vendored");
  });

  it("a vendored: name wants the vendored copy; a file copy does not satisfy it", () => {
    expect(checkGuard(set, ["vendored:zod"], 0)[0]).toContain("zod");
  });

  it("reports a count below the floor, with both numbers", () => {
    const problems = checkGuard(set, [], 5);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("4");
    expect(problems[0]).toContain("5");
  });

  it("the floor itself passes", () => {
    expect(checkGuard(set, [], 4)).toEqual([]);
  });

  it("the shipping list demands React by both paths, so a Next that stops publishing its maps fails", () => {
    expect(MUST_INCLUDE).toEqual(expect.arrayContaining(["react", "react-dom", "vendored:react", "vendored:react-dom"]));
  });
});

describe("checkUnresolved", () => {
  it("allows lucide-react's monorepo artefact", () => {
    expect(checkUnresolved([{ name: "shared", source: "../node_modules/shared/src/x.ts" }])).toEqual([]);
  });

  it("names anything else, with the source that named it", () => {
    const problems = checkUnresolved([{ name: "ghost", source: "../node_modules/ghost/index.js" }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ghost");
    expect(problems[0]).toContain("../node_modules/ghost/index.js");
  });
});

describe("readDenyList", () => {
  it("reads the one list in security.yml, comment lines aside", () => {
    expect(readDenyList(REPO)).toEqual(expect.arrayContaining(["GPL-3.0-only", "AGPL-3.0-or-later"]));
    expect(readDenyList(REPO).every((id) => /^[A-Za-z0-9.-]+$/.test(id))).toBe(true);
  });

  it("throws when the list has gone, rather than denying nothing", () => {
    const dir = join(tmp, "no-deny");
    writeFiles(dir, { ".github/workflows/security.yml": "# deny-licenses: MIT\njobs: {}\n" });
    expect(() => readDenyList(dir)).toThrow(/deny-licenses/);
  });
});

/**
 * A miniature repo holding everything the CLI reads: enough real-shaped packages
 * to clear the guard, a `.next` with both map roots, a standalone tree whose
 * copies carry no licence file (as a traced copy does not) and a desktop folder.
 */
function writeRepo(name, tweak = {}) {
  const repo = join(tmp, name);
  const filler = Array.from({ length: MIN_COMPONENTS }, (_, i) => `filler-${i}`);
  const direct = MUST_INCLUDE.filter((m) => !m.startsWith("vendored:") && !["react", "react-dom"].includes(m));
  const license = (extra = {}) => json({ license: "MIT", ...extra });
  const installed = {};
  for (const pkg of [...filler, ...direct]) installed[`node_modules/${pkg}/package.json`] = json({ name: pkg, version: "1.0.0", license: "MIT" });
  writeFiles(repo, {
    "src/app/version.ts": 'export const APP_VERSION = "9.8.7";\nexport const APP_MILESTONE = "Test";\n',
    ".github/workflows/security.yml": "jobs:\n  a:\n    steps:\n      - with:\n          deny-licenses: GPL-3.0-only, GPL-3.0-or-later\n",
    ...installed,
    "node_modules/next/package.json": json({ name: "next", version: "16.4.2", license: "MIT" }),
    "node_modules/next/LICENSE": "NEXT LICENCE TEXT",
    "node_modules/next/dist/compiled/react/package.json": json({ name: "react-builtin" }),
    "node_modules/next/dist/compiled/react/LICENSE": "VENDORED REACT TEXT",
    "node_modules/next/dist/compiled/react/cjs/react.production.js": 'exports.version = "19.3.0-canary";',
    "node_modules/next/dist/compiled/react-dom/package.json": json({ name: "react-dom-builtin" }),
    "node_modules/next/dist/compiled/react-dom/cjs/react-dom.production.js": 'exports.version = "19.3.0-canary";',
    "node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js.map": map([
      "../../node_modules/next/dist/compiled/react/cjs/react.production.js",
      "../../node_modules/next/dist/compiled/react-dom/cjs/react-dom.production.js",
    ]),
    "node_modules/react/package.json": json({ name: "react", version: "19.3.1", license: "MIT" }),
    "node_modules/react/LICENSE": "ROOT REACT TEXT",
    "node_modules/react-dom/package.json": json({ name: "react-dom", version: "19.3.1", license: "MIT" }),
    "node_modules/react-dom/LICENSE": "ROOT REACT DOM TEXT",
    ".next/server/page.js.map": map([...filler, ...direct].map((pkg) => `../../node_modules/${pkg}/index.js`)),
    ".next/static/chunks/client.js.map": map(["../../src/app/page.tsx", "../../node_modules/shared/src/lucide.ts"]),
    ".next/standalone/node_modules/next/package.json": json({ name: "next", version: "16.4.2", license: "MIT" }),
    ".next/standalone/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js": "",
    ".next/standalone/node_modules/react/package.json": license({ name: "react", version: "19.3.1" }),
    ".next/standalone/node_modules/react-dom/package.json": license({ name: "react-dom", version: "19.3.1" }),
    ".next/standalone/node_modules/traced-only/package.json": license({ name: "traced-only", version: "1.0.0" }),
    // Not in the install, but carrying its own licence file: no problem.
    ".next/standalone/node_modules/traced-only/LICENSE": "TRACED ONLY TEXT",
    "desktop/electron-builder.yml": "extraResources:\n  - from: ../.next/standalone/node_modules\n    to: standalone/node_modules\n",
    "desktop/package-lock.json": json({
      lockfileVersion: 3,
      packages: {
        "": { name: "shell" },
        "node_modules/shell-dep": { version: "3.0.0" },
        "node_modules/electron": { version: "44.9.1", dev: true },
      },
    }),
    "desktop/node_modules/electron/package.json": json({ name: "electron", version: "44.9.1", license: "MIT" }),
    "desktop/node_modules/electron/LICENSE": "ELECTRON TEXT",
    "desktop/node_modules/shell-dep/package.json": json({ name: "shell-dep", version: "3.0.0", license: "ISC" }),
    ...tweak,
  });
  return repo;
}

const ARGS = ["--build", ".next", "--standalone", ".next/standalone", "--desktop", "desktop", "--out", "out"];

/** @returns {Promise<{ code: number; stdout: string; stderr: string }>} */
function runCli(cwd, args = ARGS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

// The name the release workflow uploads and release:verify expects.
const SBOM_NAME = sbomName("9.8.7");

describe("the CLI", () => {
  describe("on a good tree", () => {
    let repo;
    let result;
    let bom;
    let notices;

    beforeAll(async () => {
      repo = writeRepo("good");
      result = await runCli(repo);
      bom = JSON.parse(readFileSync(join(repo, "out", SBOM_NAME), "utf8"));
      notices = readFileSync(join(repo, "out", "THIRD-PARTY-NOTICES.txt"), "utf8");
    });

    it("exits 0 and writes both files, named for APP_VERSION", () => {
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(bom.metadata.component.version).toBe("9.8.7");
    });

    it("writes an SBOM that release:verify accepts", () => {
      expect(checkSbom(readFileSync(join(repo, "out", SBOM_NAME), "utf8"), "9.8.7")).toEqual([]);
    });

    it("lists what comes from each source", () => {
      const names = bom.components.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["filler-0", "traced-only", "next", "shell-dep", "electron"]));
    });

    it("lists React by both paths as separate components", () => {
      const react = bom.components.filter((c) => c.name === "react");
      expect(react.map((c) => c.version).sort()).toEqual(["19.3.0-canary", "19.3.1"]);
      expect(react.find((c) => c.version === "19.3.0-canary").licenses).toEqual([{ expression: "MIT" }]);
    });

    it("finds a standalone copy's licence text in the install, since a traced copy has none", () => {
      expect(notices).toContain("ROOT REACT TEXT");
      expect(notices).toContain("NEXT LICENCE TEXT");
    });

    it("carries the vendored library's own licence text", () => {
      expect(notices).toContain("VENDORED REACT TEXT");
    });

    it("keeps a build path out of both files", () => {
      expect(notices).not.toContain(repo);
      const text = readFileSync(join(repo, "out", SBOM_NAME), "utf8");
      expect(text).not.toContain(repo.replace(/\\/g, "\\\\"));
      expect(text).not.toContain(repo.replace(/\\/g, "/"));
    });
  });

  describe("exits 1, naming each problem and writing nothing,", () => {
    it.each([
      [
        "a denied licence",
        { "node_modules/filler-0/package.json": json({ name: "filler-0", version: "1.0.0", license: "GPL-3.0-only" }) },
        /filler-0@1\.0\.0.*GPL-3\.0-only/,
      ],
      [
        "an unknown licence",
        { "node_modules/filler-1/package.json": json({ name: "filler-1", version: "1.0.0" }) },
        /filler-1@1\.0\.0.*unknown/,
      ],
      [
        "a bundled path with no installed package",
        { ".next/static/chunks/client.js.map": map(["../../node_modules/ghost/index.js"]) },
        /ghost/,
      ],
      [
        "a shipped next-server bundle with no map beside it",
        { ".next/standalone/node_modules/next/dist/compiled/next-server/pages.runtime.prod.js": "" },
        /pages\.runtime\.prod\.js/,
      ],
      [
        "a shipped image-detector whose licence text source, image-size, is not installed",
        {
          "node_modules/next/dist/compiled/image-detector/detector.js": "",
          ".next/standalone/node_modules/next/dist/compiled/image-detector/detector.js": "",
        },
        /image-detector.*image-size/,
      ],
      [
        "a standalone copy with no licence file whose version the install does not hold",
        { "node_modules/react-dom/package.json": json({ name: "react-dom", version: "19.3.2", license: "MIT" }) },
        /react-dom@19\.3\.1.*no licence (file|text)/,
      ],
      [
        "a must-include the set lacks",
        { "node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js.map": map([]) },
        /vendored:?\s*react/,
      ],
    ])("for %s", async (name, tweak, expected) => {
      const repo = writeRepo(`bad-${name.replace(/\W+/g, "-")}`, tweak);
      const { code, stderr } = await runCli(repo);
      expect(stderr).toMatch(expected);
      expect(code).toBe(1);
      expect(existsSync(join(repo, "out"))).toBe(false);
    });

    it("for several problems at once, every one of them", async () => {
      const repo = writeRepo("bad-many", {
        "node_modules/filler-0/package.json": json({ name: "filler-0", version: "1.0.0", license: "GPL-3.0-only" }),
        "node_modules/filler-1/package.json": json({ name: "filler-1", version: "1.0.0" }),
      });
      const { code, stderr } = await runCli(repo);
      expect(code).toBe(1);
      expect(stderr).toContain("filler-0");
      expect(stderr).toContain("filler-1");
    });
  });

  describe("--asar", () => {
    async function packAsar(name, packages) {
      const app = join(tmp, name);
      writeFiles(app, { "package.json": json({ name: "shell", version: "1.0.0" }), ...packages });
      const out = join(tmp, `${name}.asar`);
      await asar.createPackage(app, out);
      return out;
    }

    it("exits 0 when the asar holds the desktop set", async () => {
      const repo = writeRepo("asar-good");
      const asarPath = await packAsar("asar-good-app", {
        "node_modules/shell-dep/package.json": json({ name: "shell-dep", version: "3.0.0" }),
      });
      const { code, stderr } = await runCli(repo, [...ARGS, "--asar", asarPath]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
    });

    it("exits 1 naming both directions when they differ", async () => {
      const repo = writeRepo("asar-bad");
      const asarPath = await packAsar("asar-bad-app", {
        "node_modules/stowaway/package.json": json({ name: "stowaway", version: "1.0.0" }),
      });
      const { code, stderr } = await runCli(repo, [...ARGS, "--asar", asarPath]);
      expect(code).toBe(1);
      expect(stderr).toContain("stowaway@1.0.0");
      expect(stderr).toContain("shell-dep@3.0.0");
    });

    it("exits 2 when the asar cannot be read", async () => {
      const repo = writeRepo("asar-missing");
      const { code } = await runCli(repo, [...ARGS, "--asar", join(tmp, "no-such.asar")]);
      expect(code).toBe(2);
    });
  });

  describe("--web-only", () => {
    const WEB_ARGS = ["--build", ".next", "--standalone", ".next/standalone", "--desktop", "desktop", "--web-only"];

    it("checks the build, standalone and vendored sets with no desktop install, and writes nothing (exit 0)", async () => {
      const repo = writeRepo("web-only");
      // Neither Electron nor the shell's packages are installed: the web-only check must not need them.
      rmSync(join(repo, "desktop", "node_modules"), { recursive: true });
      const { code, stdout, stderr } = await runCli(repo, WEB_ARGS);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toMatch(/^release:sbom: \d+ components pass \(web only, nothing written\)$/m);
      expect(existsSync(join(repo, "out"))).toBe(false);
    });

    it("still fails on a licence problem in the web set (exit 1)", async () => {
      const repo = writeRepo("web-only-bad", {
        "node_modules/filler-0/package.json": json({ name: "filler-0", version: "1.0.0", license: "GPL-3.0-only" }),
      });
      const { code, stderr } = await runCli(repo, WEB_ARGS);
      expect(code).toBe(1);
      expect(stderr).toContain("filler-0@1.0.0: licence GPL-3.0-only is on the deny list");
    });

    it("refuses --out and --asar, which belong to a release build (exit 2)", async () => {
      const repo = writeRepo("web-only-args");
      expect((await runCli(repo, [...WEB_ARGS, "--out", "out"])).code).toBe(2);
      const withAsar = await runCli(repo, [...WEB_ARGS, "--asar", "x.asar"]);
      expect(withAsar.code).toBe(2);
      expect(withAsar.stderr).toMatch(/--asar belongs to a release build and cannot be combined with --web-only/);
    });

    it("with --desktop-licences, also passes the desktop set and Electron when their licences are allowed (exit 0)", async () => {
      const repo = writeRepo("web-desktop-ok");
      const { code, stdout, stderr } = await runCli(repo, [...WEB_ARGS, "--desktop-licences"]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      // shell-dep and Electron: the lockfile's one shipped package plus Electron.
      expect(stdout).toMatch(/^release:sbom: \d+ components pass \(web only, nothing written\), and the 2 desktop packages' licences pass$/m);
      expect(existsSync(join(repo, "out"))).toBe(false);
    });

    it("with --desktop-licences, fails on a desktop package whose licence is unknown, naming it (exit 1)", async () => {
      const repo = writeRepo("web-desktop-unknown", {
        "desktop/node_modules/shell-dep/package.json": json({ name: "shell-dep", version: "3.0.0" }),
      });
      const { code, stderr } = await runCli(repo, [...WEB_ARGS, "--desktop-licences"]);
      expect(code).toBe(1);
      expect(stderr).toContain("release:sbom: desktop/package-lock.json: shell-dep@3.0.0: unknown licence");
      // Without the flag the same tree passes: the check is the flag's.
      expect((await runCli(repo, WEB_ARGS)).code).toBe(0);
    });

    it("with --desktop-licences, fails on a desktop package whose licence is denied (exit 1)", async () => {
      const repo = writeRepo("web-desktop-denied", {
        "desktop/node_modules/shell-dep/package.json": json({ name: "shell-dep", version: "3.0.0", license: "GPL-3.0-or-later" }),
      });
      const { code, stderr } = await runCli(repo, [...WEB_ARGS, "--desktop-licences"]);
      expect(code).toBe(1);
      expect(stderr).toContain("desktop/package-lock.json: shell-dep@3.0.0: licence GPL-3.0-or-later is on the deny list");
    });

    it("refuses --desktop-licences without --web-only, and runs it only over an installed desktop set (exit 2)", async () => {
      const repo = writeRepo("web-desktop-args");
      const alone = await runCli(repo, [...ARGS, "--desktop-licences"]);
      expect(alone.code).toBe(2);
      expect(alone.stderr).toMatch(/--desktop-licences adds the desktop set's licence check to --web-only/);
      rmSync(join(repo, "desktop", "node_modules", "electron"), { recursive: true });
      const noElectron = await runCli(repo, [...WEB_ARGS, "--desktop-licences"]);
      expect(noElectron.code).toBe(2);
      expect(noElectron.stderr).toMatch(/electron is not installed/);
    });

    it("has a lower floor than a release, since the desktop set is left out", () => {
      expect(MIN_WEB_COMPONENTS).toBeGreaterThan(0);
      expect(MIN_WEB_COMPONENTS).toBeLessThan(MIN_COMPONENTS);
    });
  });

  describe("exits 2 when it could not run", () => {
    it("on a missing argument", async () => {
      const { code, stderr } = await runCli(writeRepo("no-arg"), ["--build", ".next"]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--standalone/);
    });

    it("on an unknown argument", async () => {
      expect((await runCli(writeRepo("odd-arg"), [...ARGS, "--nope", "x"])).code).toBe(2);
    });

    it("on a build with no source maps", async () => {
      const repo = writeRepo("no-maps");
      rmSync(join(repo, ".next", "static"), { recursive: true });
      const { code, stderr } = await runCli(repo);
      expect(code).toBe(2);
      expect(stderr).toMatch(/SBOM_SOURCE_MAPS/);
    });

    it("on an installed Electron that is not the pinned one", async () => {
      const repo = writeRepo("stale-electron", {
        "desktop/node_modules/electron/package.json": json({ name: "electron", version: "44.3.0", license: "MIT" }),
      });
      const { code, stderr } = await runCli(repo);
      expect(code).toBe(2);
      expect(stderr).toMatch(/44\.3\.0/);
    });

    it("on a shipped copy of a folder treated as Next's own", async () => {
      const repo = writeRepo("own-ships", {
        ".next/standalone/node_modules/next/dist/compiled/next-devtools/index.js": "",
      });
      const { code, stderr } = await runCli(repo);
      expect(code).toBe(2);
      expect(stderr).toMatch(/next-devtools/);
    });

    it("on a security.yml with no deny list", async () => {
      const repo = writeRepo("no-deny-list", { ".github/workflows/security.yml": "jobs: {}\n" });
      const { code, stderr } = await runCli(repo);
      expect(code).toBe(2);
      expect(stderr).toMatch(/deny-licenses/);
    });
  });
});
