import { describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, WorkspaceParseError } from "./workspace";

describe("jsonToWorkspace sanitizes noteLog + description on load (stored XSS)", () => {
  it("neutralizes malicious task/raid noteLog html and task description", () => {
    const malicious = {
      tasks: [
        {
          id: 1,
          taskName: "T",
          status: "To Do",
          description: "<img src=x onerror=alert(1)><script>alert(2)</script><p>ok</p>",
          noteLog: [
            {
              id: 1,
              timestamp: "2026-01-01T00:00:00Z",
              html: "<img src=x onerror=alert(1)><script>alert(2)</script><p>note</p>",
              text: "note",
            },
          ],
        },
      ],
      raid: [
        {
          id: 1,
          noteLog: [
            {
              id: 1,
              timestamp: "2026-01-01T00:00:00Z",
              html: "<a href=\"javascript:alert(1)\">x</a><img src=x onerror=alert(1)>",
              text: "raidnote",
            },
          ],
        },
      ],
    };
    const ws = jsonToWorkspace(JSON.stringify(malicious));

    const taskNoteHtml = ws.tasks[0].noteLog?.[0].html ?? "";
    expect(taskNoteHtml).not.toContain("onerror");
    expect(taskNoteHtml).not.toContain("<script");
    expect(taskNoteHtml).toContain("note");

    const desc = ws.tasks[0].description ?? "";
    expect(desc).not.toContain("onerror");
    expect(desc).not.toContain("<img");
    expect(desc).not.toContain("<script");

    const raidNoteHtml = ws.raid[0].noteLog?.[0].html ?? "";
    expect(raidNoteHtml).not.toContain("onerror");
    expect(raidNoteHtml).not.toContain("javascript:");
  });

  it("leaves already-clean noteLog/description byte-identical (idempotent round-trip)", () => {
    const clean = {
      tasks: [
        {
          id: 1,
          taskName: "T",
          status: "To Do",
          description: "<p>All <strong>good</strong></p>",
          noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00Z", html: "<p>clean</p>", text: "clean" }],
        },
      ],
      raid: [],
    };
    const ws = jsonToWorkspace(JSON.stringify(clean));
    expect(ws.tasks[0].description).toBe("<p>All <strong>good</strong></p>");
    expect(ws.tasks[0].noteLog?.[0].html).toBe("<p>clean</p>");
  });
});

describe("jsonToWorkspace strict mode", () => {
  it("throws WorkspaceParseError on truncated JSON in strict mode", () => {
    expect(() => jsonToWorkspace('{"tasks":[', { strict: true })).toThrow(WorkspaceParseError);
  });
  it("throws on wrong shape (missing tasks/raid) in strict mode", () => {
    expect(() => jsonToWorkspace('{"foo":1}', { strict: true })).toThrow(WorkspaceParseError);
    expect(() => jsonToWorkspace("[]", { strict: true })).toThrow(WorkspaceParseError);
  });
  it("forgiving default still returns empty on garbage (back-compat)", () => {
    expect(jsonToWorkspace('{"tasks":[').tasks).toEqual([]);
    expect(jsonToWorkspace('{"foo":1}').tasks).toEqual([]);
  });
  it("valid workspace round-trips identically in strict mode", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(jsonToWorkspace(json, { strict: true }).tasks).toEqual([]);
    expect(jsonToWorkspace(json, { strict: true }).raid).toEqual([]);
  });
});

describe("workspace fieldVisibility envelope", () => {
  it("omits fieldVisibility from JSON when undefined (byte-stability)", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(JSON.parse(json)).not.toHaveProperty("fieldVisibility");
  });
  it("round-trips a fieldVisibility config", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { milestone: { fields: ["name", "targetDate"] } } };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.fieldVisibility?.milestone.fields).toEqual(["name", "targetDate"]);
  });
  it("sanitizes junk fieldVisibility on read to undefined", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), fieldVisibility: "bad" });
    expect(jsonToWorkspace(raw).fieldVisibility).toBeUndefined();
  });
});

describe("workspace features (per-project)", () => {
  it("omits features from JSON when undefined (byte-stability)", () => {
    expect(JSON.parse(workspaceToJson(emptyWorkspace()))).not.toHaveProperty("features");
  });
  it("round-trips a features array including explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "budget"] as const };
    // sanitizeFeatures returns ids in registry order (budget precedes raid).
    expect(jsonToWorkspace(workspaceToJson(ws)).features).toEqual(["budget", "raid"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(jsonToWorkspace(workspaceToJson(simple)).features).toEqual([]); // empty preserved, NOT all
  });
  it("legacy JSON with no features key stays undefined (not all-modules)", () => {
    const json = JSON.stringify(JSON.parse(workspaceToJson(emptyWorkspace()))); // no features key
    expect(jsonToWorkspace(json).features).toBeUndefined();
  });
  it("sanitizes junk feature ids on read", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), features: ["raid", "nope"] });
    expect(jsonToWorkspace(raw).features).toEqual(["raid"]);
  });
});
