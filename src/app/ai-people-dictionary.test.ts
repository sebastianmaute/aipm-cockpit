import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPeopleDictionary, NOT_PERSON_FIELDS, PERSON_FIELD_PATHS } from "./ai-people-dictionary";
import type { Insight } from "./insights/insight";
import type {
  Absence, ChangeItem, NoteLogEntry, ProjectMeta, RaidItem, Resource, Shift, Stakeholder, Task,
} from "./types";
import { emptyWorkspace, type Workspace } from "./workspace";

// Partial<T> checks every key against the real type, so a renamed field fails tsc here.
const task = (p: Partial<Task>) => p as Task;
const raid = (p: Partial<RaidItem>) => p as RaidItem;
const change = (p: Partial<ChangeItem>) => p as ChangeItem;
const note = (authorName: string) => ({ id: 1, authorName, timestamp: "", html: "", text: "" }) satisfies NoteLogEntry;

/** One distinct fictional person per person field (R2). */
const FIXTURE: Workspace = {
  ...emptyWorkspace(),
  resources: [
    { id: 1, firstName: "Rosalind", lastName: "Quenby", email: "r.quenby@example.test", emails: ["rq.alt@example.test"], businessPhone: "+49 30 5550111" } as Resource,
  ],
  stakeholders: [{ id: 1, name: "Stellan Hargreave", email: "s.hargreave@example.test" } as Stakeholder],
  absences: [{ id: 1, assignee: "Abigail Thornbury", assigneeEmail: "a.thornbury@example.test" } as Absence],
  shifts: [{ id: 1, assignee: "Shiloh Vantongeren", assigneeEmail: "s.vantongeren@example.test" } as Shift],
  tasks: [
    task({
      id: 1, assignee: "Tobias Kranewitter", assigneeEmail: "t.kranewitter@example.test",
      noteLog: [note("Nadia Oberholt")],
      blockerLog: [{ id: 1, text: "", createdAt: "", authorName: "Bertram Ellingsworth" }],
    }),
  ],
  raid: [
    raid({
      id: 1, owner: "Ottilie Marchbanks", ownerEmail: "o.marchbanks@example.test",
      noteLog: [note("Rufus Pennywhistle")],
      escalations: [{ at: "", toName: "Esmeralda Gwynfor", toEmail: "e.gwynfor@example.test" }],
    }),
  ],
  changes: [
    change({ id: 1, requestedBy: "Reginald Applethwaite", decisionBy: "Desdemona Farquhar", noteLog: [note("Cornelius Wetherby")] }),
  ],
  project: {
    name: "Project Lighthouse",
    projectManager: "Philippa Underhay",
    sponsor: "Sebastian Oakenfold",
    keyStakeholdersInternal: ["Imogen Blackwater"],
    keyStakeholdersExternal: ["Xavier Lindqvist"],
    contactPersons: [{ id: 1, name: "Cordelia Ashdown", email: "c.ashdown@example.test", synced: false }],
  } as unknown as ProjectMeta,
  insights: [
    { id: 1, key: "timelog:x:1", type: "stalledWork", severity: "medium", data: { person: "Barnaby Quillfeather", count: 1 } } as unknown as Insight,
    // A dangling Timelog link is recorded as "#<userId>" — an id, not a name.
    { id: 2, key: "timelog:x:2", type: "stalledWork", severity: "medium", data: { person: "#42", count: 1 } } as unknown as Insight,
  ],
};

describe("buildPeopleDictionary", () => {
  it("reads every person field of every slice (R2)", () => {
    const d = buildPeopleDictionary(FIXTURE);
    for (const n of [
      "Rosalind Quenby", "Stellan Hargreave", "Abigail Thornbury", "Shiloh Vantongeren", "Tobias Kranewitter",
      "Nadia Oberholt", "Bertram Ellingsworth", "Ottilie Marchbanks", "Rufus Pennywhistle", "Esmeralda Gwynfor",
      "Reginald Applethwaite", "Desdemona Farquhar", "Cornelius Wetherby", "Philippa Underhay", "Sebastian Oakenfold",
      "Imogen Blackwater", "Xavier Lindqvist", "Cordelia Ashdown", "Barnaby Quillfeather",
    ]) expect(d.names, n).toContain(n);
    for (const e of [
      "r.quenby@example.test", "rq.alt@example.test", "s.hargreave@example.test", "a.thornbury@example.test",
      "s.vantongeren@example.test", "t.kranewitter@example.test", "o.marchbanks@example.test", "e.gwynfor@example.test",
      "c.ashdown@example.test",
    ]) expect(d.emails, e).toContain(e);
    expect(d.phones).toEqual(["+49 30 5550111"]);
  });

  it("drops blanks, ids and case-duplicates, keeping the first spelling", () => {
    const d = buildPeopleDictionary({
      ...emptyWorkspace(),
      resources: [{ id: 1, firstName: "Sofia", lastName: "Ramirez", email: "Sofia.Ramirez@example.test" } as Resource],
      tasks: [
        task({ id: 1, assignee: "sofia ramirez", assigneeEmail: "sofia.ramirez@example.test" }),
        task({ id: 2, assignee: "  ", assigneeEmail: "" }),
      ],
    });
    expect(d.names).toEqual(["Sofia Ramirez"]);
    expect(d.emails).toEqual(["Sofia.Ramirez@example.test"]);
    expect(buildPeopleDictionary(FIXTURE).names).not.toContain("#42");
  });

  it("an empty workspace yields an empty dictionary", () => {
    expect(buildPeopleDictionary(emptyWorkspace())).toEqual({ names: [], emails: [], phones: [] });
  });
});

/** The brief's pattern, widened by the person fields whose names it misses
 *  (`requestedBy`, `sponsor`, `projectManager`, `keyStakeholders*`, `data.person`). */
const PERSON_LIKE = /name|email|phone|assignee|owner|author|actor|attendee|reporter|requester|booker|by$|sponsor|manager|keystakeholders|person|contact/i;

/** Every key path whose value is a string, a string list or an id list. Objects
 *  and object lists are walked into, not classified (their leaves are). */
function personLikePaths(root: unknown): Set<string> {
  const out = new Set<string>();
  const isLeaf = (v: unknown) =>
    typeof v === "string" || typeof v === "number" ||
    (Array.isArray(v) && v.every((e) => typeof e === "string" || typeof e === "number"));
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, `${path}[]`); return; }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (PERSON_LIKE.test(k) && isLeaf(x)) out.add(p);
      walk(x, p);
    }
  };
  walk(root, "");
  return out;
}

describe("person-field coverage pin (R2)", () => {
  const sample: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
  // Walk the sample AND the typed fixture: the sample lacks some fields (resources[].emails, data.person).
  const seen = new Set([...personLikePaths(sample), ...personLikePaths(FIXTURE)]);

  it("every person-like key is read by the extractor or classified as not a person", () => {
    const unclassified = [...seen].filter((p) => !PERSON_FIELD_PATHS.includes(p) && !(p in NOT_PERSON_FIELDS));
    expect(unclassified).toEqual([]);
  });

  it("finds the fields it is meant to find (the walk is not vacuous)", () => {
    expect(seen.size).toBeGreaterThan(30);
    for (const p of ["tasks[].assignee", "resources[].businessPhone", "project.keyStakeholdersExternal", "activityLog[].actor"]) {
      expect(seen, p).toContain(p);
    }
  });

  it("no path is both a person field and not one, and every exemption gives a reason", () => {
    expect(PERSON_FIELD_PATHS.filter((p) => p in NOT_PERSON_FIELDS)).toEqual([]);
    for (const [p, why] of Object.entries(NOT_PERSON_FIELDS)) expect(why.trim().length, p).toBeGreaterThan(5);
  });

  it("every listed person path exists in the sample or the fixture (no stale entries)", () => {
    expect(PERSON_FIELD_PATHS.filter((p) => !seen.has(p))).toEqual([]);
  });
});
