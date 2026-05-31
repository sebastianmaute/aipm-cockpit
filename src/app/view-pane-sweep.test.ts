import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "app");

// Primary views that fill the viewport with their own internal scroll region.
// They must source the full-height pane card from VIEW_PANE_FILL_CLASS so every
// view reads identically to the Open Points (tasks) pane.
// NOTE: tasks-section.tsx is omitted here — it uses VIEW_PANE_RESIZABLE_CLASS
// in the modern (fillHeight) branch to restore drag-resize capability.
const FILL_FILES = [
  "chat-panel.tsx",
  "raid-panel.tsx",
  "resources-panel.tsx",
  "activity-log-panel.tsx",
  "gantt.tsx",
];

// Content-flow views that scroll as a whole. They keep VIEW_PANE_CLASS but must
// add min-h-full so the card fills the viewport when content is short (no void).
// NOTE: reports.tsx was removed here — it now wraps content in ReportCard from
// report-table.tsx which carries VIEW_PANE_RESIZABLE_CLASS instead.
const CONTENT_FILES = ["budget-panel.tsx"];

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
    expect(src).toContain("VIEW_PANE_FILL_CLASS");
    expect(src).toContain("INNER_TABLE_CLASS");
  });

  for (const f of FILL_FILES) {
    it(`${f} uses VIEW_PANE_FILL_CLASS`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("VIEW_PANE_FILL_CLASS");
    });
  }

  for (const f of CONTENT_FILES) {
    it(`${f} fills via VIEW_PANE_CLASS + min-h-full`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("VIEW_PANE_CLASS");
      expect(src).toContain("min-h-full");
    });
  }

  for (const f of INNER_FILES) {
    it(`${f} uses INNER_TABLE_CLASS (no divergent rounded-md inset card)`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("INNER_TABLE_CLASS");
    });
  }

  it("view-styles exports VIEW_PANE_RESIZABLE_CLASS with resize + min bounds", () => {
    const src = readFileSync(join(ROOT, "view-styles.ts"), "utf8");
    expect(src).toMatch(/export const VIEW_PANE_RESIZABLE_CLASS\b/);
    expect(src).toMatch(/VIEW_PANE_FILL_CLASS \+ " resize min-h-\[300px\] min-w-\[480px\]"/);
  });

  it("report files import the shared report-table kit", () => {
    for (const f of ["reports.tsx"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).toMatch(/from "\.\/report-table"/);
    }
  });

  it("tasks-section modern (fillHeight) branch is resizable", () => {
    const src = readFileSync(join(__dirname, "tasks-section.tsx"), "utf8");
    expect(src).toMatch(/fillHeight\s*\?\s*VIEW_PANE_RESIZABLE_CLASS/);
  });
});
