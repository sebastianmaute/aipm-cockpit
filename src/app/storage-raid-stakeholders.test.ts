import { describe, expect, it } from "vitest";
import {
  workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace,
  workspaceToJson, jsonToWorkspace, emptyWorkspace,
  RAID_CSV_COLUMNS, raidFieldToString, buildRaidItemFromObj,
} from "./storage";
import type { RaidItem } from "./types";

const raid: RaidItem = {
  id: 1, category: "R", title: "Vendor delay", status: "Open",
  linkedTaskIds: [4], raisedDate: "2026-06-01",
  causedByRaidIds: [], stakeholderIds: [3, 7],
};

describe("RAID stakeholderIds CSV round-trip", () => {
  it("survives CSV write/read", () => {
    const ws = { ...emptyWorkspace(), raid: [raid] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.raid[0]).toMatchObject({ id: 1, category: "R", status: "Open", stakeholderIds: [3, 7] });
  });
  it("raidFieldToString encodes stakeholderIds pipe-joined; buildRaidItemFromObj round-trips", () => {
    const obj: Record<string, string> = {};
    for (const c of RAID_CSV_COLUMNS) obj[c] = raidFieldToString(raid, c);
    expect(obj.stakeholderIds).toBe("3|7");
    const back = buildRaidItemFromObj(obj);
    expect(back).toMatchObject({ id: 1, title: "Vendor delay", stakeholderIds: [3, 7] });
  });
  it("buildRaidItemFromObj defaults missing stakeholderIds to []", () => {
    const back = buildRaidItemFromObj({ id: "2", category: "R", title: "X", status: "Open", raisedDate: "2026-06-01" });
    expect(back?.stakeholderIds).toEqual([]);
  });
});

describe("RAID stakeholderIds Markdown round-trip", () => {
  it("survives Markdown write/read", () => {
    const ws = { ...emptyWorkspace(), raid: [raid] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.raid[0]).toMatchObject({ id: 1, title: "Vendor delay", stakeholderIds: [3, 7] });
  });
});

describe("RAID stakeholderIds JSON round-trip", () => {
  it("survives workspaceToJson -> jsonToWorkspace", () => {
    const ws = { ...emptyWorkspace(), raid: [raid] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.raid[0]).toMatchObject({ id: 1, stakeholderIds: [3, 7] });
  });
});

describe("ChangeItem + RaidItem stakeholderIds round-trip together (CSV)", () => {
  it("restores stakeholderIds on both entities", () => {
    const change = {
      id: 2, title: "Scope add", description: "", type: "Scope" as const, status: "Proposed" as const,
      raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [3],
    };
    const ws = { ...emptyWorkspace(), raid: [raid], changes: [change] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.raid[0].stakeholderIds).toEqual([3, 7]);
    expect(back.changes?.[0].stakeholderIds).toEqual([3]);
  });
});
