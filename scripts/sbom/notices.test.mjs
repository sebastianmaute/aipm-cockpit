import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LICENCE_OVERRIDES } from "./licence-overrides.mjs";
import { isDenied, licenseOf, normaliseLicence, parseLicence } from "./licences.mjs";
import { toNotices } from "./notices.mjs";

let tmp;

/** A package folder under `tmp/node_modules/<rel>`. */
function writePkg(rel, packageJson, files = {}) {
  const dir = join(tmp, "node_modules", ...rel.split("/"));
  mkdirSync(dir, { recursive: true });
  if (packageJson) writeFileSync(join(dir, "package.json"), JSON.stringify(packageJson));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

const fileEntry = (name, version, dir) => ({ name, version, dir });
const vendoredEntry = (name, version, dir, versionKnown = true) => ({ name, version, dir, vendoredIn: "next", versionKnown });

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sbom-notices-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("parseLicence", () => {
  it.each(["MIT", "BlueOak-1.0.0", "Python-2.0", "(MIT OR Apache-2.0)", "(ISC AND CC-BY-3.0)", "GPL-2.0-only WITH Classpath-exception-2.0", "MIT OR (BSD-2-Clause AND ISC)"])(
    "accepts %s",
    (expression) => {
      expect(parseLicence(expression)).not.toBeNull();
    },
  );

  it.each([
    "",
    "SEE LICENSE IN LICENSE.txt",
    "UNLICENSED",
    "unknown",
    "NOASSERTION",
    "NONE",
    "Proprietary",
    "Custom",
    "Public Domain",
    "Apache 2.0",
    "LicenseRef-acme",
    "(MIT",
    "MIT OR",
    "OR MIT",
    "MIT) OR ISC",
    // Shaped like an id, but not one SPDX defines.
    "BSD",
    "MIT-ish-1.0",
    "MIT OR Foo-2.0",
    "GPL-2.0-only WITH Made-up-exception",
  ])("calls %j unknown", (expression) => {
    expect(parseLicence(expression)).toBeNull();
    expect(normaliseLicence(expression)).toBeNull();
  });
});

describe("normaliseLicence", () => {
  it.each([
    ["mit", "MIT"],
    ["(mit or apache-2.0)", "(MIT OR Apache-2.0)"],
    ["isc and cc-by-3.0", "ISC AND CC-BY-3.0"],
    ["gpl-2.0-only with classpath-exception-2.0", "GPL-2.0-only WITH Classpath-exception-2.0"],
    ["MIT OR (BSD-2-Clause AND ISC)", "MIT OR (BSD-2-Clause AND ISC)"],
  ])("%s -> %s", (expression, expected) => {
    expect(normaliseLicence(expression)).toBe(expected);
  });

  it("is what licenseOf reports", () => {
    const dir = writePkg("lower", { license: "mit or apache-2.0" });
    expect(licenseOf(fileEntry("lower", "1.0.0", dir)).spdx).toBe("MIT OR Apache-2.0");
  });
});

describe("isDenied", () => {
  const deny = ["GPL-2.0-only", "GPL-3.0-or-later", "AGPL-3.0-only"];

  it.each([
    ["GPL-3.0-only", true],
    ["GPL-3.0-or-later", true],
    // The deprecated spellings an old package.json still carries.
    ["GPL-3.0", true],
    ["GPL-3.0+", true],
    ["GPL-2.0 WITH Classpath-exception-2.0", true],
    ["GPL-2.0-with-classpath-exception", true],
    ["AGPL-3.0", true],
    // A different licence that merely resembles a denied one.
    ["LGPL-3.0-only", false],
    ["GPL-1.0-only", false],
    ["MIT", false],
    // A choice stays allowed while one branch is; a conjunction binds to every part.
    ["(MIT OR GPL-3.0-only)", false],
    ["(GPL-2.0-only OR GPL-3.0-only)", true],
    ["(MIT AND GPL-3.0-only)", true],
    ["(MIT OR (ISC AND GPL-3.0-only))", false],
  ])("%s -> %s", (expression, expected) => {
    expect(isDenied(parseLicence(expression), deny)).toBe(expected);
  });
});

describe("licenseOf", () => {
  it("reads the SPDX id and the first licence file", () => {
    const dir = writePkg("plain", { license: "MIT" }, { "LICENSE-APACHE": "second", "LICENCE.md": "first" });
    expect(licenseOf(fileEntry("plain", "1.0.0", dir))).toMatchObject({ spdx: "MIT", text: "first", file: "LICENCE.md" });
  });

  it("recognises COPYING and any letter case", () => {
    const dir = writePkg("copying", { license: "ISC" }, { "copying.txt": "the text" });
    expect(licenseOf(fileEntry("copying", "1.0.0", dir))).toMatchObject({ text: "the text", file: "copying.txt" });
  });

  it("does not take a directory for a licence file", () => {
    const dir = writePkg("folder", { license: "MIT" });
    mkdirSync(join(dir, "LICENSES"));
    expect(licenseOf(fileEntry("folder", "1.0.0", dir))).toMatchObject({ spdx: "MIT", text: null, file: null });
  });

  it("reads the legacy object and array forms", () => {
    const single = writePkg("legacy-object", { license: { type: "MIT", url: "x" } });
    const many = writePkg("legacy-array", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    expect(licenseOf(fileEntry("legacy-object", "1.0.0", single)).spdx).toBe("MIT");
    expect(licenseOf(fileEntry("legacy-array", "1.0.0", many)).spdx).toBe("MIT OR Apache-2.0");
  });

  it("has no SPDX id for a declaration that is not one, and keeps what it said", () => {
    const dir = writePkg("see", { license: "SEE LICENSE IN EULA.txt" });
    expect(licenseOf(fileEntry("see", "1.0.0", dir))).toMatchObject({ spdx: null, declared: "SEE LICENSE IN EULA.txt" });
  });

  it("copes with a package folder that is not on disk", () => {
    expect(licenseOf(fileEntry("gone", "1.0.0", join(tmp, "nowhere")))).toMatchObject({ spdx: null, text: null, file: null });
  });

  it("throws on an unreadable package.json rather than calling it unlicensed", () => {
    const dir = writePkg("broken", null, { "package.json": "{nope" });
    expect(() => licenseOf(fileEntry("broken", "1.0.0", dir))).toThrow(/broken/);
  });

  describe("overrides", () => {
    const [overridden, override] = Object.entries(LICENCE_OVERRIDES)[0];

    it("settle a vendored library with no evidence of its own", () => {
      const dir = writePkg("next/dist/compiled/overridden", {});
      expect(licenseOf(vendoredEntry(overridden, "1.0.0", dir))).toMatchObject({ spdx: override.spdx, overrideReason: override.reason });
    });

    it("do not settle a package shipped as files: the evidence was about the vendored copy", () => {
      const dir = writePkg("file-copy", {});
      expect(licenseOf(fileEntry(overridden, "1.0.0", dir)).spdx).toBeNull();
    });

    it("never beat what the library declares", () => {
      const dir = writePkg("next/dist/compiled/declares", { license: "GPL-3.0-only" });
      const result = licenseOf(vendoredEntry(overridden, "1.0.0", dir));
      expect(result.spdx).toBe("GPL-3.0-only");
      expect(result.overrideReason).toBeUndefined();
    });

    it("do not cover a vendored library nobody looked at", () => {
      const dir = writePkg("next/dist/compiled/unreviewed", {});
      expect(licenseOf(vendoredEntry("nobody-looked-at-this", "1.0.0", dir)).spdx).toBeNull();
    });

    it.each(Object.entries(LICENCE_OVERRIDES))("%s is a licence the deny list allows, with a reason", (_name, entry) => {
      const parsed = parseLicence(entry.spdx);
      expect(parsed).not.toBeNull();
      expect(isDenied(parsed, ["GPL-3.0-only", "GPL-2.0-only", "AGPL-3.0-only"])).toBe(false);
      expect(entry.reason.length).toBeGreaterThan(20);
    });

    it.each(Object.entries(LICENCE_OVERRIDES))("%s cites what was read: a licence file in Next's install, or a URL", (_name, entry) => {
      expect(entry.reason).toMatch(/next\/dist\/compiled\/[^\s,;]+\/(LICEN[CS]E|COPYING)[^\s,;]*|https:\/\/\S+/i);
    });

    it.each(Object.entries(LICENCE_OVERRIDES).filter(([, entry]) => entry.textFrom))(
      "%s, whose text comes from another package, cites both the source of that claim and the file the text is read from",
      (_name, entry) => {
        expect(entry.reason).toMatch(/https:\/\/\S+/);
        expect(entry.reason).toContain(`next/dist/compiled/${entry.textFrom}/LICENSE`);
      },
    );

    it("image-detector is image-size's detector, per Next's build script", () => {
      const entry = LICENCE_OVERRIDES["image-detector"];
      expect(entry).toMatchObject({ spdx: "MIT", textFrom: "image-size" });
      expect(entry.reason).toContain("https://github.com/vercel/next.js/blob/canary/packages/next/taskfile.js");
      expect(entry.reason).toContain("ncc_image_detector");
      expect(entry.reason).toContain("image-size/dist/detector.js");
    });

    describe("with textFrom", () => {
      const COPYRIGHT = "Copyright © 2013-Present Aditya Yadav, http://netroy.in";
      let detector;

      beforeAll(() => {
        writePkg("next/dist/compiled/image-size", { name: "image-size", license: "MIT" }, { LICENSE: `The MIT License (MIT)\n\n${COPYRIGHT}\n\nPermission is hereby granted` });
        detector = vendoredEntry("image-detector", "vendored-in-next@16.4.2", writePkg("next/dist/compiled/image-detector", null, { "detector.js": "" }), false);
      });

      it("reads the licence text from the named sibling package", () => {
        expect(licenseOf(detector)).toMatchObject({ spdx: "MIT", file: "LICENSE", derivedFrom: "image-size" });
        expect(licenseOf(detector).text).toContain(COPYRIGHT);
      });

      it("has no text, and says what it looked for, when the sibling is absent", () => {
        const lone = vendoredEntry("image-detector", "x", writePkg("lone/compiled/image-detector", null, { "detector.js": "" }), false);
        expect(licenseOf(lone)).toMatchObject({ spdx: "MIT", text: null, file: null, derivedFrom: "image-size", derivedTextMissing: true });
      });

      it("puts image-size's copyright and the derivation in the notice", () => {
        const notices = toNotices([detector], { electron: fileEntry("electron", "1.0.0", writePkg("electron-for-textfrom", { license: "MIT" })) });
        const section = notices.slice(notices.indexOf("=== image-detector"), notices.indexOf("=== electron"));
        expect(section).toContain(COPYRIGHT);
        expect(section).toContain("Derived from image-size; the licence text below is image-size's.");
      });
    });
  });
});

describe("toNotices", () => {
  let electron;

  beforeAll(() => {
    electron = fileEntry("electron", "44.9.1", writePkg("electron", { license: "MIT" }, { LICENSE: "ELECTRON LICENCE TEXT" }));
  });

  it("carries each package's full licence text", () => {
    const a = fileEntry("a", "1.0.0", writePkg("a", { license: "MIT" }, { LICENSE: "FULL TEXT OF A\nsecond line" }));
    const b = fileEntry("@s/b", "2.0.0", writePkg("@s/b", { license: "ISC" }, { LICENSE: "FULL TEXT OF B" }));
    const notices = toNotices([a, b], { electron });
    expect(notices).toContain("=== a 1.0.0 ===\nLicence: MIT\n");
    expect(notices).toContain("FULL TEXT OF A\nsecond line");
    expect(notices).toContain("=== @s/b 2.0.0 ===\nLicence: ISC\n");
    expect(notices).toContain("FULL TEXT OF B");
  });

  it("writes the SPDX id plus a note for a package with no licence file", () => {
    const pkg = fileEntry("no-file", "1.0.0", writePkg("no-file", { license: "BSD-3-Clause" }));
    expect(toNotices([pkg], { electron })).toContain(
      "=== no-file 1.0.0 ===\nLicence: BSD-3-Clause\nNote: this package ships no licence file; the identifier comes from its package.json.\n",
    );
  });

  it("gives the reviewed reason for an overridden licence", () => {
    const [name, override] = Object.entries(LICENCE_OVERRIDES)[0];
    const pkg = vendoredEntry(name, "1.0.0", writePkg("next/dist/compiled/note", {}));
    expect(toNotices([pkg], { electron })).toContain(`Licence: ${override.spdx}\nNote: licence established by review: ${override.reason}\n`);
  });

  it('says "version unknown (bundled inside Next.js)" instead of the internal marker', () => {
    const pkg = vendoredEntry("zod", "vendored-in-next@16.4.2", writePkg("next/dist/compiled/zod", { license: "MIT" }), false);
    const notices = toNotices([pkg], { electron });
    expect(notices).toContain("=== zod version unknown (bundled inside Next.js) ===");
    expect(notices).not.toContain("vendored-in-next");
  });

  it("says where a vendored library with a known version lives", () => {
    const pkg = vendoredEntry("react", "19.3.0", writePkg("next/dist/compiled/react", { license: "MIT" }));
    expect(toNotices([pkg], { electron })).toContain("=== react 19.3.0 (bundled inside Next.js) ===");
  });

  it("points Electron's Chromium at LICENSES.chromium.html", () => {
    const notices = toNotices([], { electron });
    expect(notices).toContain("=== electron 44.9.1 ===");
    expect(notices).toContain("ELECTRON LICENCE TEXT");
    expect(notices).toContain("LICENSES.chromium.html");
  });

  it("says nothing about the machine it was built on", () => {
    const a = fileEntry("a", "1.0.0", writePkg("a", { license: "MIT" }, { LICENSE: "x" }));
    expect(toNotices([a], { electron })).not.toContain(tmp);
  });

  it("normalises line endings, so the bytes do not depend on the checkout", () => {
    const a = fileEntry("crlf", "1.0.0", writePkg("crlf", { license: "MIT" }, { LICENSE: "one\r\ntwo" }));
    const notices = toNotices([a], { electron });
    expect(notices).toContain("one\ntwo");
    expect(notices).not.toContain("\r");
  });
});
