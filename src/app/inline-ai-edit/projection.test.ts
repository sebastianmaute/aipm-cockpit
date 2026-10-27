import { describe, it, expect, vi, afterEach } from "vitest";
import * as chatApi from "../chat-api";
import { callInlineEdit } from "../inline-ai-edit-call";
import { asTimeZoneForTests } from "../timezone";
import { INLINE_DESCRIPTORS, inlineDescriptor, type InlineEntity } from "./entity-descriptor";
import { projectForInlineEdit } from "./projection";
import { describeEntityCalls } from "./plan";
import type { Workspace } from "../workspace";

afterEach(() => vi.restoreAllMocks());

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
    expect(named("resource")).toEqual(["absenceOverride", "birthday", "businessPhone", "email", "emails", "location", "notes"]);
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

  it("drops a resource's phone, location, birthday, notes and absence hours but keeps name, title, department and company (R10)", () => {
    const row = { id: 4, firstName: "Cy", lastName: "Doe", title: "Lead", department: "Ops", company: "Example Co", isExternal: false, businessPhone: "+1 555 0100", location: "Springfield", birthday: "01-02", notes: "private", absenceOverride: { "2026-01": 8 }, utilization: { "2026-01": 50 } };
    expect(projectForInlineEdit("resource", row)).toEqual({ id: 4, firstName: "Cy", lastName: "Doe", title: "Lead", department: "Ops", company: "Example Co", isExternal: false, utilization: { "2026-01": 50 } });
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

describe("nested emails (D7 fix round 1)", () => {
  const raid = { id: 4, title: "Vendor slip", escalations: [{ at: "2026-10-01T09:00:00Z", toName: "Pat", toEmail: "pat@example.com", toSeverity: "High" }] };

  it("keeps the other escalation fields but drops toEmail", () => {
    const out = projectForInlineEdit("raid", raid) as { escalations: Record<string, unknown>[] };
    expect(out.escalations).toEqual([{ at: "2026-10-01T09:00:00Z", toName: "Pat", toSeverity: "High" }]);
    expect(raid.escalations[0].toEmail).toBe("pat@example.com"); // input untouched
  });

  it("escalations is not a writable inline field", () => {
    expect(inlineDescriptor("raid").diffFields).not.toContain("escalations");
  });

  it("the inline call's system text carries no escalation address", async () => {
    const spy = vi.spyOn(chatApi, "callClaude").mockResolvedValue({ content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
    await callInlineEdit({
      apiKey: "k", model: "m", lang: "en-US", entity: "raid", item: raid, itemLabel: "Vendor slip", instruction: "x",
      snapshot: { today: "2026-07-03", language: "en-US", holidayCountries: [], storageKind: "browser", taskCount: 0, knownGroups: [], knownLabels: [], mode: "advanced", enabledModules: [], currentView: "raid", timezone: asTimeZoneForTests("UTC") },
      guides: [], groundInGuides: false,
    });
    const text = spy.mock.calls[0][2].map((b) => b.text).join(" ");
    expect(text).toContain("Vendor slip"); // control: the scope block is there
    expect(text).toContain("toSeverity"); // control: the escalation is still described
    expect(text).not.toContain("pat@example.com");
    expect(text).not.toContain("toEmail");
  });
});

describe("the label the scope block carries", () => {
  it("names an absence by its assignee, never by its note", () => {
    expect(INLINE_DESCRIPTORS.absence.titleOf({ assignee: "Bo", note: "surgery on Tuesday" })).toBe("Bo");
  });
});
