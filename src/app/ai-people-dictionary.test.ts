import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
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

  // F2b: placeholder values are not people, and a role suffix is not part of a name.
  it("drops non-person placeholder values and strips parenthesised segments", () => {
    const placeholders = ["TBD", "tbc", "N/A", "NA", "None", "unassigned", "Unknown", "N.N.", "TBA", "-", "?", "offen", "Keine", "niemand", " 42 "];
    const d = buildPeopleDictionary({
      ...emptyWorkspace(),
      tasks: [...placeholders, "Anna Brandvik (CFO)", "[ext] Liam Price"].map((assignee, id) => task({ id, assignee, assigneeEmail: "" })),
    });
    expect(d.names).toEqual(["Anna Brandvik", "Liam Price"]);
  });

  it("an empty workspace yields an empty dictionary", () => {
    expect(buildPeopleDictionary(emptyWorkspace())).toEqual({ names: [], emails: [], phones: [] });
  });
});

/** The brief's pattern, widened by the person fields whose names it misses
 *  (`requestedBy`, `sponsor`, `projectManager`, `keyStakeholders*`, `data.person`)
 *  and by role words a future field is likely to use (reviewer, approver, ...). */
const PERSON_LIKE =
  /name|email|phone|assignee|owner|author|actor|attendee|reporter|requester|booker|by$|sponsor|manager|keystakeholders|person|contact|review|approv|leader|member|user|people|participant|organi[sz]er|creator|editor|recipient|sender|signer|staff/i;

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

/** F3: the person-like LEAF properties of every type reachable from `Workspace`,
 *  read through the TypeScript checker (declarations, not values), so a field
 *  that no sample row carries yet is still seen. `unresolved` collects paths
 *  whose type did not resolve (any) — a scan that silently stops there is vacuous. */
function personLikeTypePaths(): { paths: Set<string>; unresolved: string[] } {
  const root = join(import.meta.dirname, "workspace.ts");
  const program = ts.createProgram([root], {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(root);
  if (!source) throw new Error("workspace.ts not in the program");
  let workspace: ts.Type | undefined;
  ts.forEachChild(source, (n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === "Workspace") workspace = checker.getTypeAtLocation(n.name);
  });
  if (!workspace) throw new Error("type Workspace not found in workspace.ts");
  const NULLISH = ts.TypeFlags.Undefined | ts.TypeFlags.Null;
  const members = (t: ts.Type) => (t.isUnion() ? t.types.filter((x) => !(x.flags & NULLISH)) : [t]);
  const isPrimitive = (t: ts.Type) => (t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) !== 0;
  const isLeaf = (t: ts.Type) => members(t).every((x) =>
    isPrimitive(x) || (checker.isArrayType(x) && members(checker.getTypeArguments(x as ts.TypeReference)[0]).every(isPrimitive)));
  const paths = new Set<string>();
  const unresolved: string[] = [];
  const walk = (t: ts.Type, path: string, stack: readonly ts.Type[]): void => {
    for (const m of members(t)) {
      if (checker.isArrayType(m)) { walk(checker.getTypeArguments(m as ts.TypeReference)[0], `${path}[]`, stack); continue; }
      if (m.flags & ts.TypeFlags.Any) { unresolved.push(path); continue; }
      if (!(m.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) || stack.includes(m)) continue;
      if (m.getCallSignatures().length > 0) continue;
      for (const prop of checker.getPropertiesOfType(m)) {
        const pt = checker.getTypeOfSymbol(prop);
        const p = path ? `${path}.${prop.name}` : prop.name;
        if (PERSON_LIKE.test(prop.name) && isLeaf(pt)) paths.add(p);
        walk(pt, p, [...stack, m]);
      }
    }
  };
  walk(workspace, "", []);
  return { paths, unresolved };
}

describe("person-field coverage pin (R2)", () => {
  const sample: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
  // Walk the sample AND the typed fixture: the sample lacks some fields (resources[].emails, data.person).
  const seen = new Set([...personLikePaths(sample), ...personLikePaths(FIXTURE)]);
  const typed = personLikeTypePaths();
  const classified = (p: string) => PERSON_FIELD_PATHS.includes(p) || p in NOT_PERSON_FIELDS;

  it("every person-like key is read by the extractor or classified as not a person", () => {
    expect([...seen].filter((p) => !classified(p))).toEqual([]);
  });

  // F3: a new person field declared on any type reachable from Workspace fails
  // here even before any sample row or fixture carries it.
  it("every person-like property DECLARED on the Workspace types is classified", () => {
    expect(typed.unresolved).toEqual([]);
    expect([...typed.paths].filter((p) => !classified(p))).toEqual([]);
  });

  it("the type scan is not vacuous", () => {
    expect(typed.paths.size).toBeGreaterThan(40);
    for (const p of ["tasks[].assignee", "changes[].requestedBy", "knowledgeItems[].name", "calendarEvents[].attendeeResourceIds"]) {
      expect(typed.paths, p).toContain(p);
    }
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

  it("every listed path exists in the sample, the fixture or the types (no stale entries)", () => {
    expect(PERSON_FIELD_PATHS.filter((p) => !seen.has(p) && !typed.paths.has(p))).toEqual([]);
    expect(Object.keys(NOT_PERSON_FIELDS).filter((p) => !seen.has(p) && !typed.paths.has(p))).toEqual([]);
  });
});
