import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The bespoke header strings swept files used before adopting TABLE_HEAD_CLASS.
// A swept file must contain NONE of these.
const FORBIDDEN_HEADS = [
  // Phase 3 muted header.
  "bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground",
  // reports.tsx variant — text-foreground instead of text-muted-foreground.
  "bg-surface-muted text-foreground uppercase tracking-wide",
];

// Files swept so far. Grown in Tasks 5 and 6.
const SWEPT_FILES = [
  "tasks-section.tsx",
  // The RAID table markup (with TABLE_HEAD_CLASS) moved to raid-panel-rows.tsx
  // in the Phase 3 split; raid-panel.tsx is now the header-less orchestrator.
  "raid-panel-rows.tsx",
  "raid-report-panel.tsx",
  "activity-log-panel.tsx",
  "resource-directory.tsx",
  "resource-workload.tsx",
  "resources-panel.tsx",
  "resources-report.tsx",
  "jira-conflicts-modal.tsx",
  "roles-editor.tsx",
  "budget-panel.tsx",
  "reports.tsx",
  "resource-calendar.tsx",
];

describe("table header sweep", () => {
  // Fail loudly (not with an opaque ENOENT) if the cwd-based path assumption
  // ever breaks — e.g. vitest invoked from a subdirectory.
  it("resolves the source directory from the vitest root", () => {
    expect(existsSync(join(process.cwd(), "src/app"))).toBe(true);
  });

  for (const file of SWEPT_FILES) {
    it(`${file} uses TABLE_HEAD_CLASS, not a bespoke header`, () => {
      // Resolve from the vitest root (process.cwd()). Using import.meta.url
      // here is unreliable on Windows when this file runs alongside others —
      // its base collapses to the drive root and readFileSync throws ENOENT.
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      for (const forbidden of FORBIDDEN_HEADS) {
        expect(src).not.toContain(forbidden);
      }
      expect(src).toContain("TABLE_HEAD_CLASS");
    });
  }
});
