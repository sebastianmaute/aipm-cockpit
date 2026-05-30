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
const HEX_IN_CLASS = /(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/;
const SHADOW_OR_GRADIENT = /\b(?:shadow(?:-[a-z0-9]+)?|bg-gradient-)/;

describe("shell palette guard", () => {
  it("resolves shell sources from the project cwd", () => {
    expect(existsSync(join(process.cwd(), "src/app", "modern-shell.tsx"))).toBe(true);
  });

  for (const file of SHELL_FILES) {
    it(`${file} uses palette tokens (no raw hex, no shadow/gradient)`, () => {
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      expect(HEX_IN_CLASS.test(src)).toBe(false);
      expect(SHADOW_OR_GRADIENT.test(src)).toBe(false);
    });
  }
});
