import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { csvToWorkspace, markdownToWorkspace } from "./storage";
import { quadrantFor, accountableCountByMilestone, raciWarningFor } from "./stakeholders";

const root = join(import.meta.dirname, "..", "..");
const csv = csvToWorkspace(readFileSync(join(root, "sample-workspace-small.csv"), "utf8"));
const md = markdownToWorkspace(readFileSync(join(root, "sample-workspace-small.md"), "utf8"));

for (const [name, ws] of [["csv", csv], ["md", md]] as const) {
  describe(`sample-workspace ${name}: milestones + stakeholders`, () => {
    test("has the three seeded milestones", () => {
      expect((ws.milestones ?? []).map((m) => m.name).sort())
        .toEqual(["Design Sign-off", "Go-Live", "Hypercare Exit"]);
    });
    test("has seven stakeholders covering all four quadrants", () => {
      const sh = ws.stakeholders ?? [];
      expect(sh).toHaveLength(7);
      const quads = new Set(sh.map(quadrantFor));
      expect(quads).toEqual(new Set(["manage-closely", "keep-satisfied", "keep-informed", "monitor"]));
    });
    test("RACI coverage drives both warnings", () => {
      const sh = ws.stakeholders ?? [];
      const idOf = (n: string) => (ws.milestones ?? []).find((m) => m.name === n)!.id;
      expect(raciWarningFor(accountableCountByMilestone(sh, idOf("Design Sign-off")))).toBe("none");
      expect(raciWarningFor(accountableCountByMilestone(sh, idOf("Go-Live")))).toBe("multiple");
      expect(raciWarningFor(accountableCountByMilestone(sh, idOf("Hypercare Exit")))).toBe("missing");
    });
  });
}
