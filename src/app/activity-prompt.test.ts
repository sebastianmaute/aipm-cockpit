import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KIND_TO_KEY,
  type ActivityEntry,
  type ActivityKind,
} from "./activity-log";
import { renderActivityEntry } from "./activity-prompt";

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: "dev-1-1",
  timestamp: "2026-08-10T09:00:00.000Z",
  kind: "task.created",
  args: [7, "Fix login"],
  ...over,
});

describe("renderActivityEntry", () => {
  it("renders the English message with args interpolated", () => {
    const r = renderActivityEntry(entry());
    expect(r.summary).toBe("Task #7 created: Fix login");
    expect(r.at).toBe("2026-08-10T09:00:00.000Z");
    expect(r.detail).toBeUndefined();
  });

  it("renders a field-diff suffix when the entry carries changes", () => {
    const r = renderActivityEntry(
      entry({
        kind: "task.updated",
        changes: [{ field: "status", from: "To Do", to: "Done" }],
      }),
    );
    expect(r.detail).toBe("status: To Do → Done");
  });

  it("renders a blank before/after value as an em dash", () => {
    const r = renderActivityEntry(
      entry({
        kind: "task.updated",
        changes: [{ field: "assignee", from: "", to: "Ada" }],
      }),
    );
    expect(r.detail).toBe("assignee: — → Ada");
  });

  it("caps the diff suffix at MAX_FIELD_CHANGES", () => {
    const changes = Array.from({ length: 20 }, (_, i) => ({
      field: `f${i}`,
      from: "a",
      to: "b",
    }));
    const r = renderActivityEntry(entry({ kind: "task.updated", changes }));
    expect(r.detail?.split("; ")).toHaveLength(12);
  });

  // ★ The prototype-lookup crash: a bare ACTIVITY_KIND_TO_KEY[kind] resolves
  //   "toString" to a Function.prototype method, after which t() throws on
  //   undefined.replace. activityMessageKey's hasOwnProperty check is the guard.
  it("falls back for an unknown kind without crashing, including 'toString'", () => {
    for (const bogus of ["totally.bogus", "toString", "constructor"]) {
      const r = renderActivityEntry(entry({ kind: bogus as ActivityKind }));
      expect(r.summary).toBe(`Unrecognized activity (${bogus})`);
    }
  });

  // ★ Table-driven over the WHOLE union: proves the render path resolves for
  //   every kind and leaves no unfilled {N} placeholder. It deliberately does
  //   NOT assert wording — the i18n string IS the wording.
  it("renders every ActivityKind with no placeholder left unfilled", () => {
    const kinds = Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[];
    expect(kinds).toHaveLength(55);
    for (const kind of kinds) {
      const r = renderActivityEntry(entry({ kind, args: ["A", "B", "C", "D"] }));
      expect(r.summary, kind).not.toBe("");
      expect(r.summary, kind).not.toMatch(/\{\d\}/);
    }
  });
});
