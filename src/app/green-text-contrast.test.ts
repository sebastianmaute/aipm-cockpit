import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// `text-AIPM-green` (#84BD00) fails WCAG AA as text. Use `text-AIPM-green-strong`
// (#4D7000 light / #84BD00 dark) for any foreground text/icon. Fills/borders/
// rings (`bg-/border-/ring-/hover:bg-AIPM-green`) are fine — not a contrast issue.
// The (?!-) excludes the legitimate `text-AIPM-green-strong`.
const FORBIDDEN = /\btext-AIPM-green(?!-)/;

const SRC = join(process.cwd(), "src/app");
const tsxFiles = readdirSync(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

describe("green-text contrast guard", () => {
  describe("detection regex", () => {
    it.each(["text-AIPM-green", "hover:text-AIPM-green", "dark:text-AIPM-green"])(
      "flags bare green text %s",
      (c) => expect(FORBIDDEN.test(c)).toBe(true),
    );
    it.each(["text-AIPM-green-strong", "bg-AIPM-green", "border-AIPM-green", "ring-AIPM-green"])(
      "allows %s",
      (c) => expect(FORBIDDEN.test(c)).toBe(false),
    );
  });
  for (const file of tsxFiles) {
    it(`${file} has no AA-failing text-AIPM-green`, () => {
      // a11y-allow-green: opt a decorative aria-hidden line out (keep this tiny)
      const src = readFileSync(join(SRC, file), "utf8")
        .split(/\r?\n/)
        .filter((l) => !l.includes("a11y-allow-green:"))
        .join("\n");
      expect(FORBIDDEN.test(src)).toBe(false);
    });
  }
});
