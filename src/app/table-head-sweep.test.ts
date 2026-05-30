import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The exact legacy header string every swept <thead> used before Phase 3.
const LEGACY_HEAD =
  "bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground";

// Files swept so far. Grown in Tasks 5 and 6.
const SWEPT_FILES = ["tasks-section.tsx"];

describe("table header sweep", () => {
  for (const file of SWEPT_FILES) {
    it(`${file} uses TABLE_HEAD_CLASS, not the legacy muted header`, () => {
      // Resolve from the vitest root (process.cwd()). Using import.meta.url
      // here is unreliable on Windows when this file runs alongside others —
      // its base collapses to the drive root and readFileSync throws ENOENT.
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      expect(src).not.toContain(LEGACY_HEAD);
      expect(src).toContain("TABLE_HEAD_CLASS");
    });
  }
});
