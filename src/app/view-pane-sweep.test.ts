import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "app");

// Files that must source their primary pane from VIEW_PANE_CLASS.
const PANE_FILES = [
  "reports.tsx",
  "raid-panel.tsx",
  "budget-panel.tsx",
  "chat-panel.tsx",
];

// Forbidden: a divergent rounded-md inset card on the resources inner tables.
const INNER_FILES = [
  "resources-panel.tsx",
  "resource-directory.tsx",
  "resource-workload.tsx",
];

describe("view-pane sweep", () => {
  it("view-styles.ts exports the shared classes", () => {
    const src = readFileSync(join(ROOT, "view-styles.ts"), "utf8");
    expect(src).toContain("VIEW_PANE_CLASS");
    expect(src).toContain("INNER_TABLE_CLASS");
  });
  for (const f of PANE_FILES) {
    it(`${f} uses VIEW_PANE_CLASS`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("VIEW_PANE_CLASS");
    });
  }
  for (const f of INNER_FILES) {
    it(`${f} uses INNER_TABLE_CLASS (no divergent rounded-md inset card)`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("INNER_TABLE_CLASS");
    });
  }
});
