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

  it("is null, and writes nothing, when the primary email was CLEARED — linked copies keep the old address", () => {
    const s = setters();
    const input = empty({ tasks: [linked], contactPersons: [ada] });
    expect(commitResourceEmailCorrection({ previous: person, next: { ...person, email: "" }, input, setters: s, lang: "en-US" })).toBeNull();
    for (const setter of Object.values(s)) expect(setter).not.toHaveBeenCalled();
    expect(input.tasks[0].assigneeEmail).toBe("old@x.com");
    expect(input.contactPersons[0].email).toBe("old@x.com");
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
  it("moves the retargeted rows back on undo and forward on redo, and never arms", () => {
    const s = setters();
    const after = [{ ...ada, email: "new@x.com" }];
    const arm = vi.fn();
    const fragment = contactPersonsFragment(s.setProject, change, [ada]);
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

  it("keeps contact persons added after the correction, and leaves unlinked rows alone, on undo and redo", () => {
    const s = setters();
    const carol: ContactPerson = { name: "Carol", email: "carol@x.com", synced: false };
    const namesake: ContactPerson = { name: "Other Ada", email: "new@x.com", synced: false, resourceId: 8 };
    const fragment = contactPersonsFragment(s.setProject, change, [ada]);
    const live = { name: "P", contactPersons: [{ ...ada, email: "new@x.com" }, namesake, carol] } as ProjectMeta;
    const redo = fragment.restore({ current: new Map() }, false, vi.fn());
    const undone = apply<ProjectMeta | undefined>(live, vi.mocked(s.setProject).mock.calls[0][0] as SetStateAction<ProjectMeta | undefined>);
    expect(undone?.contactPersons).toEqual([ada, namesake, carol]);
    redo();
    const redone = apply<ProjectMeta | undefined>(undone, vi.mocked(s.setProject).mock.calls[1][0] as SetStateAction<ProjectMeta | undefined>);
    expect(redone?.contactPersons).toEqual([{ ...ada, email: "new@x.com" }, namesake, carol]);
  });

  // Final fix round 3, R1. `retarget` matches case- and space-insensitively, so
  // a row can hold the old address spelled differently from the resource's
  // trimmed primary. Undo must give each row back ITS OWN stored string, not
  // `change.from`. Driven through `commitEmailPropagation` so the wiring that
  // hands the fragment its before-images is pinned too.
  const setProjectCall = (s: PropagationSetters, n: number) =>
    vi.mocked(s.setProject).mock.calls[n][0] as SetStateAction<ProjectMeta | undefined>;

  it("undo restores each retargeted row's own stored address byte-for-byte, and redo re-applies", () => {
    const s = setters();
    const spaced: ContactPerson = { ...ada, email: " Old@X.com " };
    const shouty: ContactPerson = { name: "Ada B", email: "OLD@X.COM", synced: false, resourceId: 7 };
    const input = empty({ contactPersons: [spaced, shouty] });
    const parts = commitEmailPropagation({ change, input, result: propagateResourceEmail(change, input), setters: s });
    const committed = apply<ProjectMeta | undefined>({ name: "P", contactPersons: [spaced, shouty] } as ProjectMeta, setProjectCall(s, 0));
    expect(committed?.contactPersons.map((c) => c.email)).toEqual(["new@x.com", "new@x.com"]);
    const redo = parts[5]!.restore({ current: new Map() }, false, vi.fn());
    const undone = apply<ProjectMeta | undefined>(committed, setProjectCall(s, 1));
    expect(undone?.contactPersons).toEqual([spaced, shouty]);
    redo();
    const redone = apply<ProjectMeta | undefined>(undone, setProjectCall(s, 2));
    expect(redone?.contactPersons.map((c) => c.email)).toEqual(["new@x.com", "new@x.com"]);
  });

  // Final fix round 4, S3. Pairing is by NAME, IN ORDER, one before-image per
  // row (`consumed`). Two same-named rows retargeted together therefore get
  // their own strings back exactly while their order is unchanged. Without
  // `consumed` both would take the FIRST before-image.
  it("two same-named rows retargeted together each get their own spelling back, in order", () => {
    const s = setters();
    const spaced: ContactPerson = { ...ada, email: " Old@X.com " };
    const shouty: ContactPerson = { ...ada, email: "OLD@X.COM", synced: false };
    const input = empty({ contactPersons: [spaced, shouty] });
    const parts = commitEmailPropagation({ change, input, result: propagateResourceEmail(change, input), setters: s });
    const committed = apply<ProjectMeta | undefined>({ name: "P", contactPersons: [spaced, shouty] } as ProjectMeta, setProjectCall(s, 0));
    parts[5]!.restore({ current: new Map() }, false, vi.fn());
    const undone = apply<ProjectMeta | undefined>(committed, setProjectCall(s, 1));
    expect(undone?.contactPersons).toEqual([spaced, shouty]);
  });

  // ★ The documented residual (§537), pinned honestly rather than fixed: rows
  // have no id, so a same-named linked row inserted AHEAD after the correction
  // takes the first before-image, the originals shift down one, and the last
  // row falls back to `change.from`. Every value is still fold-equal to the old
  // primary; only the per-row spelling moves.
  it("a same-named row inserted ahead after the correction shifts the pairing by one", () => {
    const s = setters();
    const spaced: ContactPerson = { ...ada, email: " Old@X.com " };
    const shouty: ContactPerson = { ...ada, email: "OLD@X.COM", synced: false };
    const fragment = contactPersonsFragment(s.setProject, change, [spaced, shouty]);
    fragment.restore({ current: new Map() }, false, vi.fn());
    const inserted: ContactPerson = { ...ada, email: "new@x.com", synced: false, title: "added later" } as ContactPerson;
    const live = { name: "P", contactPersons: [inserted, { ...spaced, email: "new@x.com" }, { ...shouty, email: "new@x.com" }] } as ProjectMeta;
    const undone = apply<ProjectMeta | undefined>(live, setProjectCall(s, 0));
    expect(undone?.contactPersons.map((c) => c.email)).toEqual([" Old@X.com ", "OLD@X.COM", "old@x.com"]);
  });

  it("a linked row with no before-image of its name still falls back to the old primary on undo", () => {
    const s = setters();
    const addedLater: ContactPerson = { name: "Dora", email: "new@x.com", synced: false, resourceId: 7 };
    const fragment = contactPersonsFragment(s.setProject, change, [{ ...ada, email: " Old@X.com " }]);
    fragment.restore({ current: new Map() }, false, vi.fn());
    const live = { name: "P", contactPersons: [{ ...ada, email: "new@x.com" }, addedLater] } as ProjectMeta;
    const undone = apply<ProjectMeta | undefined>(live, setProjectCall(s, 0));
    expect(undone?.contactPersons.map((c) => c.email)).toEqual([" Old@X.com ", "old@x.com"]);
  });
});
