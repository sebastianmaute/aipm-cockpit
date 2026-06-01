import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src", "app");

// Every primary view now fills the viewport AND is drag-resizable: it sources the
// shared VIEW_PANE_RESIZABLE_CLASS (= VIEW_PANE_FILL_CLASS + resize) so each view
// reads identically to the Open Points (tasks) pane.
// NOTE: tasks-section.tsx (fillHeight ternary) and activity-log-panel.tsx have
// their own dedicated assertions below. reports.tsx / raid-report / resources-
// report wrap content in ReportCard (report-table.tsx), which carries the class.
// chat-panel.tsx is the one exception — it uses a bespoke centered half-size
// card (CHAT_PANE_CLASS) that is still drag-resizable; asserted separately below.
const RESIZABLE_FILES = [
  "raid-panel.tsx",
  "resources-panel.tsx",
  "gantt.tsx",
  "budget-panel.tsx",
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
    expect(src).toContain("VIEW_PANE_FILL_CLASS");
    expect(src).toContain("INNER_TABLE_CLASS");
  });

  for (const f of RESIZABLE_FILES) {
    it(`${f} uses VIEW_PANE_RESIZABLE_CLASS`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("VIEW_PANE_RESIZABLE_CLASS");
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
    for (const f of ["reports.tsx", "raid-report-panel.tsx", "resources-report.tsx"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).toMatch(/from "\.\/report-table"/);
    }
  });

  it("tasks-section modern (fillHeight) branch is resizable", () => {
    const src = readFileSync(join(__dirname, "tasks-section.tsx"), "utf8");
    expect(src).toMatch(/fillHeight\s*\?\s*VIEW_PANE_RESIZABLE_CLASS/);
  });

  it("activity-log-panel is resizable", () => {
    const src = readFileSync(join(__dirname, "activity-log-panel.tsx"), "utf8");
    expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
  });

  it("chat-panel is a bespoke centered half-size resizable card", () => {
    const src = readFileSync(join(__dirname, "chat-panel.tsx"), "utf8");
    expect(src).toContain("CHAT_PANE_CLASS");
    expect(src).toMatch(/\bresize\b/);
  });

  it("resource-directory is resizable", () => {
    const src = readFileSync(join(__dirname, "resource-directory.tsx"), "utf8");
    expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
    expect(src).toMatch(/lop-app:directory-size/);
  });
});
