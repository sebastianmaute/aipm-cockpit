import { describe, expect, it } from "vitest";
import { sanitizeInlinePatch, type InlinePatchContext } from "./task-inline-patch";
import type { Task } from "./types";

function ctx(overrides: Partial<InlinePatchContext> = {}): InlinePatchContext {
  return {
    hasResource: (id) => id === 7, // only resource #7 is "live"
    knownTaskIds: new Set([1, 2, 3]),
    ownTaskId: 1,
    ...overrides,
  };
}

describe("sanitizeInlinePatch", () => {
  it("emits ONLY the keys present in the patch (spread-safe)", () => {
    expect(Object.keys(sanitizeInlinePatch({ notes: "hi" }, ctx()))).toEqual(["notes"]);
    expect(sanitizeInlinePatch({}, ctx())).toEqual({});
  });

  it("keeps a resourceId that points at a live resource", () => {
    expect(sanitizeInlinePatch({ resourceId: 7 }, ctx()).resourceId).toBe(7);
  });

  it("unlinks (→ undefined) a stale/hallucinated resourceId", () => {
    expect(sanitizeInlinePatch({ resourceId: 999 }, ctx())).toHaveProperty("resourceId", undefined);
  });

  it("unlinks when resourceId is explicitly undefined (cleared selection)", () => {
    expect(sanitizeInlinePatch({ resourceId: undefined }, ctx())).toHaveProperty("resourceId", undefined);
  });

  it("drops a self-dependency", () => {
    const out = sanitizeInlinePatch(
      { dependencies: [{ taskId: 1, type: "FS" }] }, // ownTaskId === 1
      ctx(),
    );
    expect(out.dependencies).toEqual([]);
  });

  it("drops a dependency on a task that no longer exists", () => {
    const out = sanitizeInlinePatch({ dependencies: [{ taskId: 42, type: "FS" }] }, ctx());
    expect(out.dependencies).toEqual([]);
  });

  it("keeps a valid dependency on a live, non-self task", () => {
    const out = sanitizeInlinePatch({ dependencies: [{ taskId: 2, type: "SS" }] }, ctx());
    expect(out.dependencies).toEqual([{ taskId: 2, type: "SS" }]);
  });

  it("drops taskName when it sanitizes to empty (identity is never blanked)", () => {
    expect(sanitizeInlinePatch({ taskName: "   " }, ctx())).not.toHaveProperty("taskName");
    expect(sanitizeInlinePatch({ taskName: "Real name" }, ctx()).taskName).toBe("Real name");
  });

  it("routes assignee/email/notes/blockers through their sanitizers (trim/cap)", () => {
    const out = sanitizeInlinePatch(
      { assignee: "  Bob  ", assigneeEmail: "  b@x.io  ", notes: "note", blockers: "blk" },
      ctx(),
    );
    expect(out.assignee).toBe("Bob");
    expect(out.assigneeEmail).toBe("b@x.io");
    expect(out.notes).toBe("note");
    expect(out.blockers).toBe("blk");
  });

  it("coerces non-string free text safely", () => {
    const patch = { assignee: 123 } as unknown as Partial<Task>;
    expect(sanitizeInlinePatch(patch, ctx()).assignee).toBe("");
  });
});
