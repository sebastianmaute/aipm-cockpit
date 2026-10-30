// AI people protection, Task 6 (spec P4, R4): with protection on, no AI write sets, changes or clears a
// person. Every write tool is classified; a classified field is stripped, the rest applies.
import { describe, it, expect } from "vitest";
import {
  PERSON_FIELDS_BY_TOOL, PERSON_FIELDS_REMOVED_NOTE, PERSON_FIELDS_NOTE_KEY,
  stripPersonFields, stripPersonFieldsFromCalls, withPersonFieldsNote,
} from "./ai-person-fields";
import { TOOL_DEFS, NON_PEOPLE_TOOLS, PEOPLE_TOOLS } from "./chat-tool-defs";
import { isPureReadTool } from "./chat-send-record";

type Schema = { properties?: Record<string, Schema>; items?: Schema };
const DEFS = TOOL_DEFS as unknown as readonly { name: string; input_schema: Schema }[];
const WRITE_TOOLS = [...NON_PEOPLE_TOOLS].filter((n) => !isPureReadTool(n));

/** Ids a handler derives from a person field. No schema offers them; they are listed so a model that sends
 *  one anyway is stripped too. */
const DERIVED_LINKS = new Set([
  "resourceId", "ownerResourceId",
  // `who` is an untyped object in the schema; its description names `{resourceId, hoursPerWeek}`.
  "changes[].who.resourceId",
]);

/** Every property path of a schema, `[]` marking an array's items (the same notation the map uses). */
function paths(s: Schema | undefined, prefix = ""): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const here = prefix + k;
    out.push(here);
    if (v.items) out.push(...paths(v.items, `${here}[].`));
    out.push(...paths({ properties: v.properties }, `${here}.`));
  }
  return out;
}

/** A property name that LOOKS like a person. Every match must be classified or exempted with a reason. */
const PERSON_LIKE = /assignee|owner|requested|decision|attendee|sponsor|manager|stakeholder|email|^to[A-Z]|invitation|who/i;
const NOT_A_PERSON: Readonly<Record<string, string>> = {
  "update_project:stakeholderCount": "a number, not a person",
  "create_forecast_scenario:changes[].who": "its placeholder half names nobody; the person half is `who.resourceId`",
  "update_forecast_scenario:changes[].who": "its placeholder half names nobody; the person half is `who.resourceId`",
};

describe("PERSON_FIELDS_BY_TOOL classification", () => {
  it("classifies every write tool, and nothing else", () => {
    expect(WRITE_TOOLS.length).toBeGreaterThan(30);
    expect(WRITE_TOOLS.filter((n) => !Object.hasOwn(PERSON_FIELDS_BY_TOOL, n))).toEqual([]);
    const keys = Object.keys(PERSON_FIELDS_BY_TOOL);
    // No people tool (refused whole by the executor) and no stale name.
    expect(keys.filter((n) => PEOPLE_TOOLS.has(n) || !WRITE_TOOLS.includes(n))).toEqual([]);
  });

  it("names only fields the tool's own schema offers (or a link derived from them)", () => {
    const bad: string[] = [];
    for (const [tool, fields] of Object.entries(PERSON_FIELDS_BY_TOOL)) {
      const offered = new Set(paths(DEFS.find((d) => d.name === tool)?.input_schema));
      for (const f of fields) if (!offered.has(f) && !DERIVED_LINKS.has(f)) bad.push(`${tool}:${f}`);
    }
    expect(bad).toEqual([]);
  });

  it("leaves no person-like property of a write tool unclassified", () => {
    const missed: string[] = [];
    for (const tool of WRITE_TOOLS) {
      const listed = PERSON_FIELDS_BY_TOOL[tool] ?? [];
      for (const p of paths(DEFS.find((d) => d.name === tool)?.input_schema)) {
        const leaf = p.split(".").pop()!.replace("[]", "");
        if (!PERSON_LIKE.test(leaf) || listed.includes(p) || NOT_A_PERSON[`${tool}:${p}`]) continue;
        missed.push(`${tool}:${p}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it("has the person fields the spec names", () => {
    expect(PERSON_FIELDS_BY_TOOL.create_task).toEqual(expect.arrayContaining(["assignee", "assigneeEmail", "resourceId"]));
    expect(PERSON_FIELDS_BY_TOOL.update_raid_item).toEqual(expect.arrayContaining(["owner", "ownerEmail", "ownerResourceId"]));
    expect(PERSON_FIELDS_BY_TOOL.update_change).toEqual(expect.arrayContaining(["requestedBy"]));
    expect(PERSON_FIELDS_BY_TOOL.create_calendar_event).toEqual(expect.arrayContaining(["attendeeResourceIds", "sendInvitations"]));
    expect(PERSON_FIELDS_BY_TOOL.escalate_raid_item).toEqual(expect.arrayContaining(["toEmail", "toName"]));
    expect(PERSON_FIELDS_BY_TOOL.update_settings).toEqual([]);
  });
});

describe("stripPersonFields", () => {
  it("removes the person fields, keeps the rest, and names what it removed", () => {
    const input = { taskName: "Write spec", assignee: "Marco", assigneeEmail: "m@x.io", dueDate: "2026-11-01" };
    const r = stripPersonFields("create_task", input);
    expect(r.input).toEqual({ taskName: "Write spec", dueDate: "2026-11-01" });
    expect(r.removed).toEqual(["assignee", "assigneeEmail"]);
    expect(input.assignee).toBe("Marco"); // never mutated
  });

  it("treats clearing as acting: an empty string and null are removed too (R4)", () => {
    expect(stripPersonFields("update_task", { id: 3, assignee: "" })).toEqual({ input: { id: 3 }, removed: ["assignee"] });
    expect(stripPersonFields("update_raid_item", { id: 3, owner: null }).removed).toEqual(["owner"]);
  });

  it("walks an array path and keeps the rows' other keys", () => {
    const input = {
      name: "Hire",
      changes: [
        { kind: "addPeople", who: { resourceId: 4, hoursPerWeek: 40 }, from: "2026-11-01" },
        { kind: "addPeople", who: { label: "Dev", count: 1, rate: 1, currency: "EUR", hoursPerWeek: 40 }, from: "2026-11-01" },
      ],
    };
    const r = stripPersonFields("create_forecast_scenario", input);
    expect(r.removed).toEqual(["changes[].who.resourceId"]);
    expect((r.input.changes as { who: object }[])[0]!.who).toEqual({ hoursPerWeek: 40 });
    expect((r.input.changes as { who: object }[])[1]).toEqual(input.changes[1]);
    expect(input.changes[0]!.who).toEqual({ resourceId: 4, hoursPerWeek: 40 });
  });

  it("returns the input unchanged for a tool without person fields or an unknown tool", () => {
    expect(stripPersonFields("update_milestone", { id: 1, name: "M" })).toEqual({ input: { id: 1, name: "M" }, removed: [] });
    expect(stripPersonFields("no_such_tool", { assignee: "x" })).toEqual({ input: { assignee: "x" }, removed: [] });
  });
});

describe("stripPersonFieldsFromCalls", () => {
  const calls = [{ name: "create_task", input: { taskName: "A", assignee: "Bo", dueDate: "2026-11-01" } }];

  it("strips every call when protected", () => {
    const r = stripPersonFieldsFromCalls(calls, true);
    expect(r.calls[0]!.input).toEqual({ taskName: "A", dueDate: "2026-11-01" });
    expect(r.removed).toEqual(["assignee"]);
  });

  it("protection off: the calls are unchanged (positive control)", () => {
    const r = stripPersonFieldsFromCalls(calls, false);
    expect(r.calls[0]!.input).toEqual(calls[0]!.input);
    expect(r.removed).toEqual([]);
  });
});

describe("the note to the model", () => {
  it("names the removed fields and says why", () => {
    const note = PERSON_FIELDS_REMOVED_NOTE(["assignee", "assigneeEmail"]);
    expect(note).toContain("assignee, assigneeEmail");
    expect(note).toMatch(/protects its people/);
    expect(note).toMatch(/Do not retry/);
  });

  it("rides on an object result without losing its keys, and wraps any other result", () => {
    expect(withPersonFieldsNote({ id: 7 }, ["assignee"])).toEqual({ id: 7, [PERSON_FIELDS_NOTE_KEY]: PERSON_FIELDS_REMOVED_NOTE(["assignee"]) });
    expect(withPersonFieldsNote("ok", ["owner"])).toEqual({ result: "ok", [PERSON_FIELDS_NOTE_KEY]: PERSON_FIELDS_REMOVED_NOTE(["owner"]) });
    const r = { id: 7 };
    expect(withPersonFieldsNote(r, [])).toBe(r);
  });
});
