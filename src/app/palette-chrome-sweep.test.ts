import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Chrome-only grey utilities with ZERO legitimate uses after the 0.79.1 sweep.
// (ui-medium-grey is intentionally NOT forbidden — it has category uses: the
// monitor tier dot, the storage-not-ready dot, the calendar "other" absence
// cell, and the RACI "Informed" chip.)
const FORBIDDEN = /\b(?:bg|border|divide)-ui-light-grey\b|\btext-ui-dark-grey\b/;

const SRC = join(process.cwd(), "src/app");
const tsxFiles = readdirSync(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

describe("palette chrome sweep", () => {
  describe("detection regex", () => {
    it.each(["bg-ui-light-grey", "hover:bg-ui-light-grey", "border-ui-light-grey", "divide-ui-light-grey", "text-ui-dark-grey", "dark:text-ui-dark-grey"])(
      "flags chrome grey utility %s",
      (cls) => expect(FORBIDDEN.test(cls)).toBe(true),
    );
    it.each(["bg-surface-muted", "text-muted-foreground", "bg-ui-medium-grey", "text-ui-light-grey", "border-line"])(
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
