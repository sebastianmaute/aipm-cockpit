import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SHELL_FILES = [
  "sidebar.tsx",
  "sidebar-nav.tsx",
  "sidebar-footer.tsx",
  "top-bar.tsx",
  "modern-shell.tsx",
  "nav-icons.tsx",
];

// Raw hex like bg-[#fff] in a className is off-palette; tokens must be used.
// `from/to/via` cover Tailwind gradient color-stop utilities (e.g. from-[#fff]).
const HEX_IN_CLASS = /(?:bg|text|border|ring|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/;
const SHADOW_OR_GRADIENT = /\b(?:shadow(?:-[a-z0-9]+)?|bg-gradient-)/;

describe("shell palette guard", () => {
  it("resolves shell sources from the project cwd", () => {
    expect(existsSync(join(process.cwd(), "src/app", "modern-shell.tsx"))).toBe(true);
  });

  // Guard the guard: the patterns must catch off-palette utilities without
  // false-positiving on legitimate palette-token classes.
  describe("detection patterns", () => {
    it.each([
      "bg-[#ffffff]",
      "text-[#84BD00]",
      "from-[#004159]",
      "via-[#fff]",
      "to-[#60c0dd]",
    ])("flags raw hex utility %s", (cls) => {
      expect(HEX_IN_CLASS.test(cls)).toBe(true);
    });

    it.each(["bg-AIPM-green", "text-white", "from-AIPM-dark-blue", "border-line"])(
      "allows palette token %s",
      (cls) => {
        expect(HEX_IN_CLASS.test(cls)).toBe(false);
      },
    );

    it.each(["shadow", "shadow-md", "bg-gradient-to-r"])(
      "flags shadow/gradient utility %s",
      (cls) => {
        expect(SHADOW_OR_GRADIENT.test(cls)).toBe(true);
      },
    );
  });

  for (const file of SHELL_FILES) {
    it(`${file} uses palette tokens (no raw hex, no shadow/gradient)`, () => {
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      expect(HEX_IN_CLASS.test(src)).toBe(false);
      expect(SHADOW_OR_GRADIENT.test(src)).toBe(false);
    });
  }
});
