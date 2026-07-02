// src/app/action-menus-sweep.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Both consumers MUST source the action cluster from ./action-menus so the
// classic header and the modern top bar never diverge (Phase 4 Workstream C).
// app-header.tsx builds the classic header's cluster; shell-chrome.tsx builds
// the modern top bar's `topBarMenus` slot (the ActionMenus mount moved there
// out of task-manager in the Phase 3 shell-chrome extraction).
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const CONSUMERS = [
  "src/app/app-header.tsx",
  "src/app/shell-chrome.tsx",
] as const;

const FORBIDDEN_DIRECT_IMPORTS = [
  "./export-menu",
  "./help-menu",
  "./version-menu",
] as const;

describe("action menus — single source of truth", () => {
  it("resolves the source directory from the vitest root", () => {
    expect(read("src/app/action-menus.tsx").length).toBeGreaterThan(0);
  });

  for (const file of CONSUMERS) {
    const src = read(file);
    it(`${file} imports the shared ActionMenus`, () => {
      expect(src).toContain("./action-menus");
    });
    for (const dep of FORBIDDEN_DIRECT_IMPORTS) {
      it(`${file} no longer imports ${dep} directly`, () => {
        expect(src).not.toContain(`from "${dep}"`);
      });
    }
  }
});
