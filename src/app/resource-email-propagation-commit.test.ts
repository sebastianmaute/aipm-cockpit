import { describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import { commitEmailPropagation, commitResourceEmailCorrection, contactPersonsFragment, type PropagationSetters } from "./resource-email-propagation-commit";
import { propagateResourceEmail, type EmailPropagationInput } from "./resource-email-propagation";
import { t } from "./i18n";
import type { ContactPerson, ProjectMeta, Resource, Task } from "./types";

const change = { resourceId: 7, from: "old@x.com", to: "new@x.com" };
const linked = { id: 1, taskName: "T", assignee: "Ada", assigneeEmail: "old@x.com", resourceId: 7, dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do" } as Task;
const ada: ContactPerson = { name: "Ada", email: "old@x.com", synced: true, resourceId: 7 };

/** Applies a functional update the way React would. */
function apply<S>(value: S, action: SetStateAction<S>): S {
  return typeof action === "function" ? (action as (prev: S) => S)(value) : action;
}

function setters(): PropagationSetters {
  return { setTasks: vi.fn(), setRaid: vi.fn(), setAbsences: vi.fn(), setShifts: vi.fn(), setStakeholders: vi.fn(), setProject: vi.fn() } as unknown as PropagationSetters;
}

function empty(over: Partial<EmailPropagationInput> = {}): EmailPropagationInput {
  return { tasks: [], raid: [], absences: [], shifts: [], stakeholders: [], contactPersons: [], ...over };
}

describe("commitEmailPropagation", () => {
  it("calls only the setters of arrays that changed, and returns a fragment for each", () => {
    const input = empty({ tasks: [linked], contactPersons: [ada] });
    const s = setters();
    const parts = commitEmailPropagation({ change, input, result: propagateResourceEmail(change, input), setters: s });
    expect(s.setTasks).toHaveBeenCalledTimes(1);
    expect(s.setProject).toHaveBeenCalledTimes(1);
    for (const idle of [s.setRaid, s.setAbsences, s.setShifts, s.setStakeholders]) expect(idle).not.toHaveBeenCalled();
    expect(parts.map((p) => p !== null)).toEqual([true, false, false, false, false, true]);
  });

  it("re-runs the retarget over the setter's live prev, keeping a row added since", () => {
    const input = empty({ tasks: [linked] });
    const s = setters();
    commitEmailPropagation({ change, input, result: propagateResourceEmail(change, input), setters: s });
    const added = { ...linked, id: 2, resourceId: 8 } as Task;
    const updater = vi.mocked(s.setTasks).mock.calls[0][0] as SetStateAction<readonly Task[]>;
    expect(apply<readonly Task[]>([linked, added], updater).map((r) => [r.id, r.assigneeEmail])).toEqual([[1, "new@x.com"], [2, "old@x.com"]]);
  });

  it("leaves an absent project absent", () => {
    const input = empty({ contactPersons: [ada] });
    const s = setters();
    commitEmailPropagation({ change, input, result: propagateResourceEmail(change, input), setters: s });
    const updater = vi.mocked(s.setProject).mock.calls[0][0] as SetStateAction<ProjectMeta | undefined>;
    expect(apply<ProjectMeta | undefined>(undefined, updater)).toBeUndefined();
  });
});

describe("commitResourceEmailCorrection", () => {
  const person: Resource = { id: 7, firstName: "Ada", lastName: "L", email: "old@x.com", roleId: null, utilizationMode: "percent", utilization: {} };

  it("is null, and writes nothing, when the primary email did not change", () => {
    const s = setters();
    expect(commitResourceEmailCorrection({ previous: person, next: { ...person, title: "Lead" }, input: empty({ tasks: [linked] }), setters: s, lang: "en-US" })).toBeNull();
    expect(s.setTasks).not.toHaveBeenCalled();
  });

  it("is null, and writes nothing, when the email changed but no linked row matches", () => {
    const s = setters();
    const unlinked = { ...linked, resourceId: 8 } as Task;
    expect(commitResourceEmailCorrection({ previous: person, next: { ...person, email: "new@x.com" }, input: empty({ tasks: [unlinked] }), setters: s, lang: "en-US" })).toBeNull();
    expect(s.setTasks).not.toHaveBeenCalled();
  });

  it("commits, and returns the result, the cascade and the count-bearing toast", () => {
    const s = setters();
    const out = commitResourceEmailCorrection({ previous: person, next: { ...person, email: "new@x.com" }, input: empty({ tasks: [linked], contactPersons: [ada] }), setters: s, lang: "en-US" });
    expect(out?.result.count).toBe(2);
    expect(out?.result.tasks.next[0].assigneeEmail).toBe("new@x.com");
    expect(out?.cascade.filter((p) => p !== null)).toHaveLength(2);
    expect(out?.toastText).toBe(t("en-US", "undoToastResourceEmailPropagated", 2));
    expect(s.setTasks).toHaveBeenCalledTimes(1);
    expect(s.setProject).toHaveBeenCalledTimes(1);
  });
});

describe("contactPersonsFragment", () => {
  it("restores the before array on undo and the after array on redo, and never arms", () => {
    const s = setters();
    const after = [{ ...ada, email: "new@x.com" }];
    const arm = vi.fn();
    const fragment = contactPersonsFragment(s.setProject, [ada], after);
    expect(fragment.isPrimary).toBe(false);
    const project = { name: "P", contactPersons: after } as ProjectMeta;
    const redo = fragment.restore({ current: new Map() }, false, arm);
    const undone = apply<ProjectMeta | undefined>(project, vi.mocked(s.setProject).mock.calls[0][0] as SetStateAction<ProjectMeta | undefined>);
    expect(undone?.contactPersons).toEqual([ada]);
    expect(apply<ProjectMeta | undefined>(undefined, vi.mocked(s.setProject).mock.calls[0][0] as SetStateAction<ProjectMeta | undefined>)).toBeUndefined();
    redo();
    const redone = apply<ProjectMeta | undefined>(undone, vi.mocked(s.setProject).mock.calls[1][0] as SetStateAction<ProjectMeta | undefined>);
    expect(redone?.contactPersons).toEqual(after);
    expect(apply<ProjectMeta | undefined>(undefined, vi.mocked(s.setProject).mock.calls[1][0] as SetStateAction<ProjectMeta | undefined>)).toBeUndefined();
    expect(arm).not.toHaveBeenCalled();
  });
});
