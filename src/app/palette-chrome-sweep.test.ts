import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Chrome-only grey utilities with ZERO legitimate uses after the 0.79.1 sweep.
// (AIPM-medium-grey is intentionally NOT forbidden — it has category uses: the
// monitor tier dot, the storage-not-ready dot, the calendar "other" absence
// cell, and the RACI "Informed" chip.)
const FORBIDDEN = /\b(?:bg|border|divide)-AIPM-light-grey\b|\btext-AIPM-dark-grey\b/;

const SRC = join(process.cwd(), "src/app");
const tsxFiles = readdirSync(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

describe("palette chrome sweep", () => {
  describe("detection regex", () => {
    it.each(["bg-AIPM-light-grey", "hover:bg-AIPM-light-grey", "border-AIPM-light-grey", "divide-AIPM-light-grey", "text-AIPM-dark-grey", "dark:text-AIPM-dark-grey"])(
      "flags chrome grey utility %s",
      (cls) => expect(FORBIDDEN.test(cls)).toBe(true),
    );
    it.each(["bg-surface-muted", "text-muted-foreground", "bg-AIPM-medium-grey", "text-AIPM-light-grey", "border-line"])(
      "allows token / category utility %s",
      (cls) => expect(FORBIDDEN.test(cls)).toBe(false),
    );
  });

  for (const file of tsxFiles) {
    it(`${file} uses semantic tokens, not chrome greys`, () => {
      const src = readFileSync(join(SRC, file), "utf8");
      expect(FORBIDDEN.test(src)).toBe(false);
    });
  }
});
