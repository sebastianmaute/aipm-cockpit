import { describe, expect, it } from "vitest";
import {
  getStakeholderCommsItems,
  type CommsFlags,
} from "./stakeholder-comms";
import type {
  ChangeItem, Milestone, RaidItem, Stakeholder,
} from "./types";

const TODAY = "2026-06-08";

const ALL_ON: CommsFlags = {
  stakeholdersEnabled: true,
  milestonesEnabled: true,
  raidEnabled: true,
  changesEnabled: true,
};

function stake(p: Partial<Stakeholder> & Pick<Stakeholder, "id" | "name">): Stakeholder {
  return {
    organization: undefined,
    title: undefined,
    email: undefined,
    category: "Internal",
    influence: "Low",
    interest: "Low",
    notes: undefined,
    resourceId: null,
    raci: {},
    ...p,
  };
}

function milestone(p: Partial<Milestone> & Pick<Milestone, "id" | "name" | "date">): Milestone {
  return {
    description: undefined,
    achievedDate: undefined,
    linkedTaskIds: [],
    ...p,
  };
}

function raidItem(p: Partial<RaidItem> & Pick<RaidItem, "id" | "title">): RaidItem {
  return {
    category: "R",
    description: undefined,
    owner: undefined,
    status: "Open",
    linkedTaskIds: [],
    raisedDate: "2026-01-01",
    causedByRaidIds: [],
    stakeholderIds: [],
    ...p,
  };
}

function change(p: Partial<ChangeItem> & Pick<ChangeItem, "id" | "title">): ChangeItem {
  return {
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-01-01",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...p,
  };
}

describe("getStakeholderCommsItems", () => {
  it("returns [] when stakeholders module is disabled", () => {
    const result = getStakeholderCommsItems({
      stakeholders: [stake({ id: 1, name: "A", influence: "High", interest: "High", raci: { "1": "A" } })],
      milestones: [milestone({ id: 1, name: "M1", date: "2026-06-10" })],
      raid: [],
      changes: [],
      today: TODAY,
      flags: { ...ALL_ON, stakeholdersEnabled: false },
    });
    expect(result).toEqual([]);
  });

  it("reminds a manage-closely (High/High) stakeholder about a due-soon RACI-linked milestone within the 14d lead", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High", raci: { "1": "A" } });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [milestone({ id: 1, name: "Launch", date: "2026-06-18" })], // 10 days out
      raid: [],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stakeholderId: 1,
      quadrant: "manage-closely",
      itemKind: "milestone",
      itemId: 1,
      itemTitle: "Launch",
      reasonKey: "stakeholderCommsMilestoneDue",
    });
  });

  it("does NOT remind manage-closely about a milestone beyond the 14d lead", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High", raci: { "1": "A" } });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [milestone({ id: 1, name: "Far", date: "2026-07-30" })], // ~52 days out
      raid: [],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toEqual([]);
  });

  it("reminds a monitor (Low/Low) stakeholder ONLY about overdue milestones, not upcoming ones", () => {
    const s = stake({ id: 1, name: "Mona", influence: "Low", interest: "Low", raci: { "1": "A", "2": "C" } });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [
        milestone({ id: 1, name: "Soon", date: "2026-06-09" }), // upcoming -> ignored
        milestone({ id: 2, name: "Past", date: "2026-06-01" }), // overdue -> reminded
      ],
      raid: [],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      quadrant: "monitor",
      itemId: 2,
      reasonKey: "stakeholderCommsMilestoneOverdue",
    });
  });

  it("keep-satisfied (High/Low) requires High+ RAID severity to be reminded", () => {
    const s = stake({ id: 1, name: "Sam", influence: "High", interest: "Low" });
    const lowSev = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [raidItem({ id: 10, title: "Minor risk", severity: "Medium", stakeholderIds: [1] })],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(lowSev).toEqual([]);

    const highSev = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [raidItem({ id: 11, title: "Big risk", severity: "High", stakeholderIds: [1] })],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(highSev).toHaveLength(1);
    expect(highSev[0]).toMatchObject({ quadrant: "keep-satisfied", itemKind: "raid", itemId: 11 });
  });

  it("keep-informed (Low/High) gets NO RAID reminders at all", () => {
    const s = stake({ id: 1, name: "Ivy", influence: "Low", interest: "High" });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [raidItem({ id: 12, title: "Critical risk", severity: "Critical", stakeholderIds: [1] })],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toEqual([]);
  });

  it("reminds linked stakeholders about a pending change in raid/change-source quadrants", () => {
    const manage = stake({ id: 1, name: "Alice", influence: "High", interest: "High" });
    const informed = stake({ id: 2, name: "Ivy", influence: "Low", interest: "High" });
    const result = getStakeholderCommsItems({
      stakeholders: [manage, informed],
      milestones: [],
      raid: [],
      changes: [change({ id: 5, title: "Scope cut", status: "Under Review", stakeholderIds: [1, 2] })],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.stakeholderId).sort()).toEqual([1, 2]);
    for (const r of result) {
      expect(r.itemKind).toBe("change");
      expect(r.reasonKey).toBe("stakeholderCommsChangePending");
    }
  });

  it("does NOT remind about a non-pending (approved) change", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High" });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [],
      changes: [change({ id: 5, title: "Done deal", status: "Approved", stakeholderIds: [1] })],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toEqual([]);
  });

  it("suppresses a source when its module flag is off (milestonesEnabled=false)", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High", raci: { "1": "A" } });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [milestone({ id: 1, name: "Launch", date: "2026-06-10" })],
      raid: [],
      changes: [],
      today: TODAY,
      flags: { ...ALL_ON, milestonesEnabled: false },
    });
    expect(result).toEqual([]);
  });

  it("ignores RAID items in a terminal status even when overdue", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High" });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [raidItem({
        id: 9, title: "Closed risk", status: "Closed", severity: "Critical",
        targetDate: "2026-01-01", stakeholderIds: [1],
      })],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toEqual([]);
  });

  it("reminds manage-closely about an overdue RAID item below severity threshold (overdue path)", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High" });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [raidItem({
        id: 8, title: "Late but minor", status: "Open", severity: "Low",
        targetDate: "2026-05-01", stakeholderIds: [1],
      })],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ itemKind: "raid", itemId: 8 });
  });

  it("produces nothing for orphan stakeholderIds (no matching stakeholder)", () => {
    const result = getStakeholderCommsItems({
      stakeholders: [stake({ id: 1, name: "Alice", influence: "High", interest: "High" })],
      milestones: [],
      raid: [raidItem({ id: 7, title: "Risk", severity: "Critical", stakeholderIds: [999] })],
      changes: [change({ id: 6, title: "Change", status: "Proposed", stakeholderIds: [999] })],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toEqual([]);
  });

  it("tolerates legacy RAID/Change items whose stakeholderIds field is undefined", () => {
    // Pre-0.55.0 records loaded raw from the JSON or IndexedDB backend have no
    // stakeholderIds field. The engine must treat a missing field as [] rather
    // than crash on `.includes()`.
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High" });
    const legacyRaid = raidItem({ id: 5, title: "Legacy risk", severity: "Critical" });
    const legacyChange = change({ id: 4, title: "Legacy change", status: "Proposed" });
    // Simulate the un-sanitized legacy shape (field absent at runtime).
    (legacyRaid as { stakeholderIds?: number[] }).stakeholderIds = undefined;
    (legacyChange as { stakeholderIds?: number[] }).stakeholderIds = undefined;
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [],
      raid: [legacyRaid],
      changes: [legacyChange],
      today: TODAY,
      flags: ALL_ON,
    });
    // No stakeholder is linked (field absent) -> no reminders, and no throw.
    expect(result).toEqual([]);
  });

  it("does not remind about an achieved (signed-off) milestone", () => {
    const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High", raci: { "1": "A" } });
    const result = getStakeholderCommsItems({
      stakeholders: [s],
      milestones: [milestone({ id: 1, name: "Done", date: "2026-06-01", achievedDate: "2026-05-30" })],
      raid: [],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toEqual([]);
  });

  describe("leadDaysByQuadrant override", () => {
    it("with override 30 for manage-closely, a milestone 25 days out triggers a reminder", () => {
      const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High", raci: { "1": "A" } });
      const result = getStakeholderCommsItems({
        stakeholders: [s],
        milestones: [milestone({ id: 1, name: "Future", date: "2026-07-03" })], // 25 days out
        raid: [],
        changes: [],
        today: TODAY,
        flags: ALL_ON,
        leadDaysByQuadrant: { "manage-closely": 30, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ quadrant: "manage-closely", itemId: 1, reasonKey: "stakeholderCommsMilestoneDue" });
    });

    it("without override, default 14d applies — milestone 25 days out is NOT reminded", () => {
      const s = stake({ id: 1, name: "Alice", influence: "High", interest: "High", raci: { "1": "A" } });
      const result = getStakeholderCommsItems({
        stakeholders: [s],
        milestones: [milestone({ id: 1, name: "Future", date: "2026-07-03" })], // 25 days out
        raid: [],
        changes: [],
        today: TODAY,
        flags: ALL_ON,
      });
      expect(result).toEqual([]);
    });

    it("override only affects the targeted quadrant (monitor unaffected)", () => {
      const monitor = stake({ id: 2, name: "Mona", influence: "Low", interest: "Low", raci: { "1": "C" } });
      const result = getStakeholderCommsItems({
        stakeholders: [monitor],
        milestones: [milestone({ id: 1, name: "Soon", date: "2026-06-10" })], // 2 days out, not overdue
        raid: [],
        changes: [],
        today: TODAY,
        flags: ALL_ON,
        // manage-closely boosted to 30 but monitor stays at 3 → milestone is upcoming, not overdue → no reminder
        leadDaysByQuadrant: { "manage-closely": 30, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
      });
      expect(result).toEqual([]);
    });
  });

  it("sorts by priority desc then stakeholder name", () => {
    const manage = stake({ id: 1, name: "Zoe", influence: "High", interest: "High", raci: { "1": "A" } });
    const monitor = stake({ id: 2, name: "Abe", influence: "Low", interest: "Low", raci: { "2": "C" } });
    const result = getStakeholderCommsItems({
      stakeholders: [monitor, manage],
      milestones: [
        milestone({ id: 1, name: "Soon", date: "2026-06-12" }), // manage -> upcoming
        milestone({ id: 2, name: "Past", date: "2026-06-01" }), // monitor -> overdue
      ],
      raid: [],
      changes: [],
      today: TODAY,
      flags: ALL_ON,
    });
    expect(result).toHaveLength(2);
    expect(result[0].stakeholderId).toBe(1); // manage-closely (priority 4) first
    expect(result[1].stakeholderId).toBe(2); // monitor (priority 1)
  });
});
