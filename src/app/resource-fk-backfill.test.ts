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
import { backfillResourceFks } from "./resource-foundation";
import type { Absence, RaidItem, Resource, Shift } from "./types";
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
