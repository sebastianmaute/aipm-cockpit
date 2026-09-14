import { describe, expect, it } from "vitest";
import {
  propagateResourceEmail,
  resourceEmailChange,
  retargetContactPersonEmails,
  retargetStakeholderEmails,
  retargetTaskEmails,
  type EmailPropagationInput,
} from "./resource-email-propagation";
import { BUDGET_NAME_MAX } from "./sanitize-entities";
import type { RaidItem, Resource, Stakeholder, Task } from "./types";

const ada: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };
const task = (over: Partial<Task>): Task => ({ id: 1, taskName: "T", assignee: "Ada", assigneeEmail: "old@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", resourceId: 7, ...over }) as Task;
const stakeholder = (over: Partial<Stakeholder>): Stakeholder => ({ id: 1, name: "Ada", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "old@x.com", resourceId: 7, ...over }) as unknown as Stakeholder;

function input(over: Partial<EmailPropagationInput> = {}): EmailPropagationInput {
  return { tasks: [], raid: [], absences: [], shifts: [], stakeholders: [], contactPersons: [], ...over };
}

describe("resourceEmailChange", () => {
  it("is null when the primary email is unchanged (trimmed) or the old one is blank", () => {
    expect(resourceEmailChange(ada, { ...ada, email: " old@x.com " })).toBeNull();
    expect(resourceEmailChange({ ...ada, email: "" }, { ...ada, email: "new@x.com" })).toBeNull();
  });
  it("describes any other change, a case-only change included", () => {
    expect(resourceEmailChange(ada, { ...ada, email: "new@x.com" })).toEqual({ resourceId: 7, from: "old@x.com", to: "new@x.com" });
    expect(resourceEmailChange(ada, { ...ada, email: "Old@x.com" })).toEqual({ resourceId: 7, from: "old@x.com", to: "Old@x.com" });
  });
});

describe("propagateResourceEmail", () => {
  const change = { resourceId: 7, from: "old@x.com", to: "new@x.com" };

  it("updates an FK-linked row whose cache equals the old email, trimmed and case-insensitively", () => {
    const out = propagateResourceEmail(change, input({ tasks: [task({ assigneeEmail: "  OLD@x.com " })] }));
    expect(out.tasks.next[0].assigneeEmail).toBe("new@x.com");
    expect(out.tasks.edited).toHaveLength(1);
    expect(out.count).toBe(1);
  });

  it("leaves a different cache, a blank cache and an unlinked row untouched", () => {
    const rows = [task({ id: 1, assigneeEmail: "other@x.com" }), task({ id: 2, assigneeEmail: "" }), task({ id: 3, resourceId: undefined })];
    const out = propagateResourceEmail(change, input({ tasks: rows }));
    expect(out.tasks.next).toBe(rows);
    expect(out.count).toBe(0);
  });

  it("does not reach a row linked to ANOTHER resource even when its cache equals the old email", () => {
    // Positive control in the same array: the linked row IS retargeted.
    const rows = [task({ id: 1, resourceId: 8 }), task({ id: 2 })];
    const out = retargetTaskEmails(rows, change);
    expect(out.next.map((r) => r.assigneeEmail)).toEqual(["old@x.com", "new@x.com"]);
    expect(out.edited.map((r) => r.id)).toEqual([2]);
  });

  it("skips a Jira-synced task", () => {
    const rows = [task({ jiraKey: "LOP-1" })];
    expect(propagateResourceEmail(change, input({ tasks: rows })).tasks.next).toBe(rows);
    // Positive control: the same row without a jiraKey is reached.
    expect(propagateResourceEmail(change, input({ tasks: [task({})] })).count).toBe(1);
  });

  it("reaches RAID owners, absences, shifts, stakeholders and contact persons, never escalations", () => {
    const raid = [{ id: 1, title: "R", category: "R", ownerResourceId: 7, ownerEmail: "old@x.com", escalations: [{ at: "2026-05-20T09:30:00.000Z", toEmail: "old@x.com", toResourceId: 7 }] } as unknown as RaidItem];
    const out = propagateResourceEmail(change, input({
      raid,
      absences: [{ id: 1, assignee: "Ada", assigneeEmail: "old@x.com", resourceId: 7, startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" }] as never,
      shifts: [{ id: 1, assignee: "Ada", assigneeEmail: "old@x.com", resourceId: 7, hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] }] as never,
      stakeholders: [stakeholder({})],
      contactPersons: [{ name: "Ada", email: "old@x.com", synced: true, resourceId: 7 }, { name: "Bob", email: "old@x.com", synced: false }],
    }));
    expect(out.raid.next[0].ownerEmail).toBe("new@x.com");
    expect(out.raid.next[0].escalations?.[0].toEmail).toBe("old@x.com");
    expect(out.absences.next[0].assigneeEmail).toBe("new@x.com");
    expect(out.shifts.next[0].assigneeEmail).toBe("new@x.com");
    expect(out.stakeholders.next[0].email).toBe("new@x.com");
    expect(out.contactPersons.next.map((c) => c.email)).toEqual(["new@x.com", "old@x.com"]);
    expect(out.count).toBe(5);
  });

  it("returns the same references when nothing matches", () => {
    const tasks = [task({ assigneeEmail: "x@x.com" })];
    const people = [{ name: "Bob", email: "old@x.com", synced: false }];
    expect(retargetTaskEmails(tasks, change).next).toBe(tasks);
    expect(retargetContactPersonEmails(people, change).next).toBe(people);
  });

  it("skips a stakeholder when the new email exceeds the stakeholder cap, rather than storing a torn copy", () => {
    // `sanitizeStakeholder` caps `email` at BUDGET_NAME_MAX (200), below the
    // resource's EMAIL_MAX (320): a longer value would be cut on the next load.
    const local = `${"a".repeat(BUDGET_NAME_MAX - "@x.com".length)}@x.com`;
    expect(local).toHaveLength(BUDGET_NAME_MAX);
    const rows = [stakeholder({})];
    const atCap = retargetStakeholderEmails(rows, { ...change, to: local });
    expect(atCap.next[0].email).toBe(local);
    const over = retargetStakeholderEmails(rows, { ...change, to: `a${local}` });
    expect(over.next).toBe(rows);
    expect(over.edited).toHaveLength(0);
    const out = propagateResourceEmail({ ...change, to: `a${local}` }, input({ stakeholders: rows, tasks: [task({})] }));
    expect(out.count).toBe(1);
    expect(out.tasks.next[0].assigneeEmail).toBe(`a${local}`);
  });
});
