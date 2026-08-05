import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  jsonToWorkspace,
  workspaceToJson,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
  migrateWorkspaceV9,
  SHIFTS_CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  shiftFieldToString,
  raidFieldToString,
  buildRaidItemFromObj,
} from "./storage";
import { sanitizeShift } from "./sanitize";
import { backfillResourceFks, backfillTaskResourceFks } from "./resource-foundation";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";
import type { Workspace } from "./workspace";

// A small resource registry whose emails match the entities below (varying case
// to prove the match is case-folded).
const resources: Resource[] = [
  {
    id: 10, firstName: "Ada", lastName: "Lovelace", email: "Ada@Example.com",
    roleId: null, utilizationMode: "percent", utilization: {},
  },
  {
    id: 20, firstName: "Alan", lastName: "Turing", email: "alan@example.com",
    roleId: null, utilizationMode: "percent", utilization: {},
  },
  {
    // No email — must be ignored by the email matcher and never crash.
    id: 30, firstName: "Grace", lastName: "Hopper", email: undefined,
    roleId: null, utilizationMode: "percent", utilization: {},
  },
];

describe("backfillResourceFks (V9 core)", () => {
  it("fills Absence.resourceId / RaidItem.ownerResourceId / Shift.resourceId by case-folded email", () => {
    const absences: Absence[] = [
      { id: 1, assignee: "Ada Lovelace", assigneeEmail: "ada@example.com", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" },
    ];
    const raid: RaidItem[] = [
      { id: 1, category: "R", title: "Risk", status: "Open", ownerEmail: "ALAN@EXAMPLE.COM", linkedTaskIds: [], raisedDate: "2026-06-01", causedByRaidIds: [], stakeholderIds: [] },
    ];
    const shifts: Shift[] = [
      { id: 1, assignee: "Ada Lovelace", assigneeEmail: "Ada@Example.com", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] },
    ];
    const out = backfillResourceFks(resources, absences, raid, shifts);
    expect(out.absences[0].resourceId).toBe(10);
    expect(out.raid[0].ownerResourceId).toBe(20);
    expect(out.shifts[0].resourceId).toBe(10);
  });

  it("does not overwrite an already-set FK (idempotent)", () => {
    const absences: Absence[] = [
      { id: 1, assignee: "Ada", assigneeEmail: "ada@example.com", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation", resourceId: 999 },
    ];
    const raid: RaidItem[] = [
      { id: 1, category: "R", title: "R", status: "Open", ownerEmail: "alan@example.com", ownerResourceId: 888, linkedTaskIds: [], raisedDate: "2026-06-01", causedByRaidIds: [], stakeholderIds: [] },
    ];
    const shifts: Shift[] = [
      { id: 1, assignee: "Ada", assigneeEmail: "ada@example.com", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0], resourceId: 777 },
    ];
    const out = backfillResourceFks(resources, absences, raid, shifts);
    expect(out.absences[0].resourceId).toBe(999);
    expect(out.raid[0].ownerResourceId).toBe(888);
    expect(out.shifts[0].resourceId).toBe(777);
    // No element changed → original array references are preserved.
    expect(out.absences).toBe(absences);
    expect(out.raid).toBe(raid);
    expect(out.shifts).toBe(shifts);
  });

  it("leaves non-matching mentions unset and ignores email-less resources", () => {
    const absences: Absence[] = [
      { id: 1, assignee: "Nobody", assigneeEmail: "nobody@example.com", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" },
      // Matches Grace by name but Grace has no email → must stay unset.
      { id: 2, assignee: "Grace Hopper", assigneeEmail: "grace@example.com", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" },
    ];
    const out = backfillResourceFks(resources, absences, [], []);
    expect(out.absences[0].resourceId).toBeUndefined();
    expect(out.absences[1].resourceId).toBeUndefined();
  });

  it("does not crash when an entity has no email", () => {
    const absences: Absence[] = [
      { id: 1, assignee: "Ada", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" },
    ];
    expect(() => backfillResourceFks(resources, absences, [], [])).not.toThrow();
    const out = backfillResourceFks(resources, absences, [], []);
    expect(out.absences[0].resourceId).toBeUndefined();
  });
});

describe("migrateWorkspaceV9 via jsonToWorkspace (V8-era file, no FKs set)", () => {
  it("populates FKs by email after load", () => {
    // Build a V8-era workspace: resources present, but no FKs stamped on the
    // raid/shift/absence rows. Hand-write the JSON envelope (raid is passed raw
    // by jsonToWorkspace, so the FK only appears via the migration).
    const ws: Workspace = {
      ...emptyWorkspace(),
      resources,
      absences: [
        { id: 1, assignee: "Ada", assigneeEmail: "ada@example.com", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" },
      ],
      raid: [
        { id: 1, category: "R", title: "Risk", status: "Open", ownerEmail: "alan@example.com", linkedTaskIds: [], raisedDate: "2026-06-01", causedByRaidIds: [], stakeholderIds: [] },
      ],
      shifts: [
        { id: 1, assignee: "Ada", assigneeEmail: "ada@example.com", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] },
      ],
    };
    const loaded = jsonToWorkspace(workspaceToJson(ws));
    expect(loaded.absences[0].resourceId).toBe(10);
    expect(loaded.raid[0].ownerResourceId).toBe(20);
    expect(loaded.shifts[0].resourceId).toBe(10);
  });

  it("is a no-op when there are no resources to match", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      raid: [
        { id: 1, category: "R", title: "Risk", status: "Open", ownerEmail: "alan@example.com", linkedTaskIds: [], raisedDate: "2026-06-01", causedByRaidIds: [], stakeholderIds: [] },
      ],
    };
    const out = migrateWorkspaceV9(ws);
    expect(out.raid[0].ownerResourceId).toBeUndefined();
  });
});

describe("ownerResourceId / Shift.resourceId codec round-trips", () => {
  const raid: RaidItem = {
    id: 1, category: "R", title: "Vendor delay", status: "Open",
    ownerEmail: "alan@example.com", ownerResourceId: 20,
    linkedTaskIds: [], raisedDate: "2026-06-01", causedByRaidIds: [], stakeholderIds: [],
  };
  const shift: Shift = {
    id: 1, assignee: "Ada", assigneeEmail: "ada@example.com",
    resourceId: 10, hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
  };

  it("RaidItem.ownerResourceId survives CSV round-trip", () => {
    const ws = { ...emptyWorkspace(), raid: [raid] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.raid[0].ownerResourceId).toBe(20);
  });

  it("RaidItem.ownerResourceId survives Markdown round-trip", () => {
    const ws = { ...emptyWorkspace(), raid: [raid] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.raid[0].ownerResourceId).toBe(20);
  });

  it("Shift.resourceId survives CSV round-trip", () => {
    const ws = { ...emptyWorkspace(), shifts: [shift] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.shifts[0].resourceId).toBe(10);
  });

  it("Shift.resourceId survives Markdown round-trip", () => {
    const ws = { ...emptyWorkspace(), shifts: [shift] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.shifts[0].resourceId).toBe(10);
  });

  it("encodes a blank FK as empty string (never coerced to 0)", () => {
    const blankRaid: RaidItem = { ...raid, ownerResourceId: undefined };
    const blankShift: Shift = { ...shift, resourceId: undefined };
    const raidObj: Record<string, string> = {};
    for (const c of RAID_CSV_COLUMNS) raidObj[c] = raidFieldToString(blankRaid, c);
    expect(raidObj.ownerResourceId).toBe("");
    expect(buildRaidItemFromObj(raidObj)?.ownerResourceId).toBeUndefined();

    const shiftObj: Record<string, string> = {};
    for (const c of SHIFTS_CSV_COLUMNS) shiftObj[c] = shiftFieldToString(blankShift, c);
    expect(shiftObj.resourceId).toBe("");
    expect(sanitizeShift(shiftObj)?.resourceId).toBeUndefined();
  });
});

// ★★★ Tasks were NEVER part of the v9 FK backfill (it covers absence / raid /
// shift only), so a task carrying just an assignee STRING kept a null
// `resourceId` forever. That is what forked a second swimlane for a person who
// already had one and left the per-card assignee select reading "Unassigned"
// beside a card printing their name. `backfillTaskResourceFks` closes it at the
// LOAD funnel, which — unlike the v9 migration chain — every backend reaches.
describe("backfillTaskResourceFks", () => {
  const dir: Resource[] = [
    { id: 10, firstName: "Ada", lastName: "Lovelace", email: "Ada@Example.com",
      roleId: null, utilizationMode: "percent", utilization: {} },
    { id: 20, firstName: "Alan", lastName: "Turing", email: "alan@example.com",
      roleId: null, utilizationMode: "percent", utilization: {} },
  ];
  const task = (over: Partial<Task>): Task => ({
    id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-03-01",
    lastUpdateDate: "2026-02-01", priority: "Medium", status: "To Do",
    blockers: "", description: "", ...over,
  });

  it("fills the FK from a case-folded email match", () => {
    const out = backfillTaskResourceFks(dir, [task({ assigneeEmail: "ADA@example.com" })]);
    expect(out[0].resourceId).toBe(10);
  });

  it("fills the FK from a unique case-folded NAME match when no email is stored", () => {
    const out = backfillTaskResourceFks(dir, [task({ assignee: "  alan   turing " })]);
    expect(out[0].resourceId).toBe(20);
  });

  it("never overwrites an FK that is already set", () => {
    const out = backfillTaskResourceFks(dir, [task({ resourceId: 20, assigneeEmail: "ada@example.com" })]);
    expect(out[0].resourceId).toBe(20);
  });

  // ★★ The guard is `task.resourceId != null`, NOT "resolves in the directory".
  // A DANGLING id must stay dangling: re-pointing it at a same-named person is a
  // guess dressed as a repair, and it would silently move one person's work onto
  // another's. The existing "never overwrites" test uses an id the directory
  // HOLDS, so tightening the guard to `!= null && byId.has(...)` passes it —
  // this is the case that fails.
  it("leaves a DANGLING FK dangling rather than re-resolving it by name", () => {
    const input = [task({ resourceId: 999, assignee: "Ada Lovelace" })];
    const out = backfillTaskResourceFks(dir, input);
    expect(out[0].resourceId).toBe(999);
    // Untouched means the no-op fast path, so the array identity survives too.
    expect(out).toBe(input);
  });

  it("leaves an ambiguous name unlinked rather than guessing", () => {
    const twins: Resource[] = [
      { ...dir[0], id: 1, email: "" },
      { ...dir[0], id: 2, email: "" },
    ];
    const out = backfillTaskResourceFks(twins, [task({ assignee: "Ada Lovelace" })]);
    expect(out[0].resourceId ?? null).toBeNull();
  });

  it("leaves an unknown person unlinked and returns the SAME array reference", () => {
    const input = [task({ assignee: "Nobody At All" })];
    const out = backfillTaskResourceFks(dir, input);
    expect(out[0].resourceId ?? null).toBeNull();
    // Reference equality is the no-op signal the load funnel relies on.
    expect(out).toBe(input);
  });

  it("is idempotent — a second pass changes nothing and reuses the array", () => {
    const once = backfillTaskResourceFks(dir, [task({ assignee: "Ada Lovelace" })]);
    const twice = backfillTaskResourceFks(dir, once);
    expect(twice).toBe(once);
  });
});

// The email index is LOCAL to backfillTaskResourceFks precisely so it can
// poison duplicates; the shared `emailToResourceId` (v9's) is first-wins and is
// deliberately left alone. Without these, swapping the local index back for the
// shared helper is a silent behaviour change.
describe("backfillTaskResourceFks — ambiguity and precedence", () => {
  const task = (over: Partial<Task>): Task => ({
    id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-03-01",
    lastUpdateDate: "2026-02-01", priority: "Medium", status: "To Do",
    blockers: "", description: "", ...over,
  });

  it("leaves a DUPLICATED email unlinked rather than taking the first match", () => {
    const dupes: Resource[] = [
      { id: 10, firstName: "Ada", lastName: "L", email: "shared@example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 20, firstName: "Alan", lastName: "T", email: "Shared@Example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    const out = backfillTaskResourceFks(dupes, [task({ assigneeEmail: "shared@example.com" })]);
    // First-wins would yield 10 — a different value, so this cannot pass by accident.
    expect(out[0].resourceId ?? null).toBeNull();
  });

  // ★ An AMBIGUOUS email must not veto the task — it only fails to answer, so
  // resolution falls through to the name (`viaEmail ?? viaName ?? null`). The
  // duplicated-email test above carries no `assignee`, so it never reaches this
  // branch: blocking outright (`if (viaEmail === null) return task;`) passes it
  // and fails here.
  it("falls through to an unambiguous NAME when the email is ambiguous", () => {
    const dupes: Resource[] = [
      { id: 10, firstName: "Ada", lastName: "Lovelace", email: "shared@example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 20, firstName: "Alan", lastName: "Turing", email: "Shared@Example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    const out = backfillTaskResourceFks(dupes, [
      task({ assignee: "Ada Lovelace", assigneeEmail: "shared@example.com" }),
    ]);
    expect(out[0].resourceId).toBe(10);
  });

  it("prefers the email match when email and name name DIFFERENT people", () => {
    const dir: Resource[] = [
      { id: 10, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
      { id: 20, firstName: "Alan", lastName: "Turing", email: "alan@example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    // The email is the stronger identifier: a name cache goes stale after a
    // rename, an address does not.
    const out = backfillTaskResourceFks(dir, [
      task({ assignee: "Alan Turing", assigneeEmail: "ada@example.com" }),
    ]);
    expect(out[0].resourceId).toBe(10);
  });

  it("falls back to the name when the email matches nobody", () => {
    const dir: Resource[] = [
      { id: 20, firstName: "Alan", lastName: "Turing", email: "alan@example.com",
        roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    const out = backfillTaskResourceFks(dir, [
      task({ assignee: "Alan Turing", assigneeEmail: "gone@example.com" }),
    ]);
    expect(out[0].resourceId).toBe(20);
  });
});

// ★★★ The storage-layer half of the same invariant. Writing an FK from a NAME
// onto an external makes `isExternalTask` true, and "Hide externals" then drops
// the task out of Open Points — permanently, since the FK is persisted, and
// silently, since it happens at load with no user action and no undo entry.
describe("backfillTaskResourceFks — externals", () => {
  const ext: Resource[] = [
    { id: 50, firstName: "Ext", lastName: "Contractor", email: "ext@vendor.com",
      isExternal: true, roleId: null, utilizationMode: "percent", utilization: {} },
  ];
  const task = (over: Partial<Task>): Task => ({
    id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-03-01",
    lastUpdateDate: "2026-02-01", priority: "Medium", status: "To Do",
    blockers: "", description: "", ...over,
  });

  it("never links an external by NAME", () => {
    const out = backfillTaskResourceFks(ext, [task({ assignee: "Ext Contractor" })]);
    expect(out[0].resourceId ?? null).toBeNull();
  });

  it("DOES link an external by email — an address is an identity, not a guess", () => {
    const out = backfillTaskResourceFks(ext, [task({ assigneeEmail: "ext@vendor.com" })]);
    expect(out[0].resourceId).toBe(50);
  });

  it("control: the same name links when the resource is internal", () => {
    const internal = [{ ...ext[0], isExternal: false }];
    const out = backfillTaskResourceFks(internal, [task({ assignee: "Ext Contractor" })]);
    expect(out[0].resourceId).toBe(50);
  });
});
