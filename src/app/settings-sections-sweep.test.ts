// src/app/settings-sections-sweep.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Sections that MUST be sourced from ./settings-sections/ by the popover, so
// the classic popover and the modern full-page view never diverge.
const SHARED_SECTIONS = [
  "appearance-section",
  "localization-section",
  "general-section",
  "notifications-section",
  "ai-section",
  "integrations-section",
];

describe("settings sections — single source of truth", () => {
  it("resolves the source directory from the vitest root", () => {
    expect(existsSync(join(process.cwd(), "src/app"))).toBe(true);
  });

  const menuSrc = readFileSync(join(process.cwd(), "src/app/settings-menu.tsx"), "utf8");

  for (const name of SHARED_SECTIONS) {
    it(`settings-menu.tsx imports ${name} from ./settings-sections/`, () => {
      expect(menuSrc).toContain(`./settings-sections/${name}`);
    });
    it(`${name}.tsx exists`, () => {
      expect(existsSync(join(process.cwd(), "src/app/settings-sections", `${name}.tsx`))).toBe(true);
    });
  }
});
