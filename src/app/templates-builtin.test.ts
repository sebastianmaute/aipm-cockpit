import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import { sanitizeTemplate } from "./templates";
import { ALL_MODULE_IDS } from "./feature-modules";

describe("BUILT_IN_TEMPLATES", () => {
  it("has three starters, all builtIn, with unique ids", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(3);
    for (const t of BUILT_IN_TEMPLATES) expect(t.builtIn).toBe(true);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(3);
  });
  it("each built-in survives sanitizeTemplate WITHOUT losing seed items", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const s = sanitizeTemplate(t);
      expect(s, t.id).not.toBeNull();
      // seed item counts must be preserved (malformed seed items would be dropped)
      expect(s!.seed?.tasks?.length ?? 0, `${t.id} tasks`).toBe(t.seed?.tasks?.length ?? 0);
      expect(s!.seed?.milestones?.length ?? 0, `${t.id} milestones`).toBe(t.seed?.milestones?.length ?? 0);
      expect(s!.seed?.raid?.length ?? 0, `${t.id} raid`).toBe(t.seed?.raid?.length ?? 0);
      expect(s!.seed?.stakeholders?.length ?? 0, `${t.id} stakeholders`).toBe(t.seed?.stakeholders?.length ?? 0);
    }
  });
  it("Full enables all modules; Minimal enables none; Standard is a subset", () => {
    const full = BUILT_IN_TEMPLATES.find((t) => t.id === "builtin-full")!;
    const min = BUILT_IN_TEMPLATES.find((t) => t.id === "builtin-minimal")!;
    const std = BUILT_IN_TEMPLATES.find((t) => t.id === "builtin-standard")!;
    expect([...full.features].sort()).toEqual([...ALL_MODULE_IDS].sort());
    expect(min.features).toEqual([]);
    expect(std.features.length).toBeGreaterThan(0);
    expect(std.features.length).toBeLessThan(ALL_MODULE_IDS.length);
  });
});
