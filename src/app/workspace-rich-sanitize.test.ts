import { describe, expect, it } from "vitest";
import { sanitizeDecodedRichFields } from "./workspace-rich-sanitize";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ChangeItem, Milestone, RaidItem, Task } from "./types";

const BAD = '<p>ok</p><img src=x onerror="alert(1)">';

describe("sanitizeDecodedRichFields (§28)", () => {
  it("sanitizes every rich field on all four entities", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      tasks: [{ id: 1, taskName: "T", description: BAD } as Task],
      raid: [{ id: 2, title: "R", description: BAD, mitigation: BAD } as unknown as RaidItem],
      milestones: [{ id: 3, name: "M", date: "2026-01-01", linkedTaskIds: [], description: BAD } as Milestone],
      changes: [
        { id: 4, title: "C", description: BAD, impactDescription: BAD, resolutionNotes: BAD } as unknown as ChangeItem,
      ],
    };
    const out = sanitizeDecodedRichFields(ws);
    const values = [
      out.tasks[0]!.description,
      out.raid[0]!.description,
      out.raid[0]!.mitigation,
      out.milestones![0]!.description,
      out.changes![0]!.description,
      out.changes![0]!.impactDescription,
      out.changes![0]!.resolutionNotes,
    ];
    for (const v of values) {
      expect(v).toContain("<p>ok</p>");
      expect(v).not.toContain("onerror");
    }
  });

  it("leaves the app's own clean output byte-identical", () => {
    const clean = "<p>one <strong>two</strong></p><ul><li><p>three</p></li></ul>";
    const ws: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "T", description: clean } as Task] };
    expect(sanitizeDecodedRichFields(ws).tasks[0]!.description).toBe(clean);
  });
});
