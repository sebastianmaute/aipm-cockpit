import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, inlineDescriptor, type InlineEntity } from "./entity-descriptor";
import { projectForInlineEdit } from "./projection";
import { describeEntityCalls } from "./plan";
import type { Workspace } from "../workspace";

const ENTITIES = Object.keys(INLINE_DESCRIPTORS) as InlineEntity[];
const ws = { tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], resources: [], absences: [], calendarEvents: [] } as unknown as Workspace;

describe("withheldFields (D7)", () => {
  it.each(ENTITIES)("%s: the inline descriptor is disjoint from every withheld field, which always includes noteLog", (entity) => {
    const d = inlineDescriptor(entity);
    expect(d.withheldFields.has("noteLog")).toBe(true);
    for (const f of d.withheldFields) {
      expect(d.diffFields, `${entity}.${f} in diffFields`).not.toContain(f);
      expect(d.emailFormatFields.has(f), `${entity}.${f} in emailFormatFields`).toBe(false);
      expect(f in d.enumFields, `${entity}.${f} in enumFields`).toBe(false);
      expect(f in d.fieldSanitizers, `${entity}.${f} in fieldSanitizers`).toBe(false);
    }
  });

  it("leaves the whole descriptor to the chat and insight cards, which still disclose these writes", () => {
    const stakeholder = INLINE_DESCRIPTORS.stakeholder;
    for (const f of ["email", "notes", "influence", "interest"]) expect(stakeholder.diffFields).toContain(f);
    expect(INLINE_DESCRIPTORS.absence.diffFields).toEqual(expect.arrayContaining(["assigneeEmail", "type", "note"]));
    expect(INLINE_DESCRIPTORS.resource.diffFields).toEqual(expect.arrayContaining(["email", "emails"]));
  });

  it("is exactly the ruled list", () => {
    const named = (e: InlineEntity) => [...INLINE_DESCRIPTORS[e].withheldFields].filter((f) => f !== "noteLog").sort();
    expect(named("task")).toEqual(["assigneeEmail"]);
    expect(named("raid")).toEqual(["ownerEmail"]);
    expect(named("stakeholder")).toEqual(["email", "influence", "interest", "notes"]);
    expect(named("resource")).toEqual(["email", "emails"]);
    expect(named("absence")).toEqual(["assigneeEmail", "note", "type"]);
    expect(named("change")).toEqual([]);
    expect(named("milestone")).toEqual([]);
    expect(named("calendarEvent")).toEqual([]);
  });
});

describe("projectForInlineEdit", () => {
  it("drops a stakeholder's email, notes, influence, interest and noteLog but keeps its name", () => {
    const row = { id: 1, name: "Ada", organization: "Acme", email: "x@example.com", notes: "private", influence: "High", interest: "Low", noteLog: [{ text: "n" }] };
    const out = projectForInlineEdit("stakeholder", row);
    expect(out).toEqual({ id: 1, name: "Ada", organization: "Acme" });
    expect(row.email).toBe("x@example.com"); // input untouched
  });

  it("drops an absence's type, note and email", () => {
    const out = projectForInlineEdit("absence", { id: 2, assignee: "Bo", type: "sick", note: "surgery", assigneeEmail: "b@example.com", startDate: "2026-01-01" });
    expect(out).toEqual({ id: 2, assignee: "Bo", startDate: "2026-01-01" });
  });

  it("drops a resource's email and emails", () => {
    expect(projectForInlineEdit("resource", { id: 3, firstName: "Cy", email: "c@example.com", emails: ["d@example.com"] })).toEqual({ id: 3, firstName: "Cy" });
  });
});

describe("a model-sent withheld field is ignored, not shown as a rejected row", () => {
  const call = (name: string, input: Record<string, unknown>) => [{ type: "tool_use" as const, id: "b", name, input }];

  it("absence: a model-sent type, note and assigneeEmail leave an empty plan", () => {
    const item = { id: 2, assignee: "Bo", type: "sick", note: "surgery", assigneeEmail: "b@example.com", startDate: "2026-01-01", endDate: "2026-01-02" };
    const plan = describeEntityCalls(
      call("update_absence", { id: 2, type: "absent", note: "x", assigneeEmail: "z@example.com" }),
      { descriptor: inlineDescriptor("absence"), item, ws },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it("absence: the dates of the same call still apply (control)", () => {
    const item = { id: 2, assignee: "Bo", type: "sick", startDate: "2026-01-01", endDate: "2026-01-02" };
    const plan = describeEntityCalls(
      call("update_absence", { id: 2, type: "absent", endDate: "2026-01-05" }),
      { descriptor: inlineDescriptor("absence"), item, ws },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates.map((u) => u.field)).toEqual(["endDate"]);
  });

  it("stakeholder: email, notes, influence and interest are not in the plan", () => {
    const item = { id: 1, name: "Ada", email: "x@example.com", influence: "High" };
    const plan = describeEntityCalls(
      call("update_stakeholder", { id: 1, name: "Ada L", email: "n@example.com", notes: "n", influence: "Low", interest: "Low" }),
      { descriptor: inlineDescriptor("stakeholder"), item, ws },
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.updates.map((u) => u.field)).toEqual(["name"]);
  });
});

describe("the label the scope block carries", () => {
  it("names an absence by its assignee, never by its note", () => {
    expect(INLINE_DESCRIPTORS.absence.titleOf({ assignee: "Bo", note: "surgery on Tuesday" })).toBe("Bo");
  });
});
