import { describe, expect, it } from "vitest";
import {
  jsonToWorkspace,
  workspaceToJson,
  emptyWorkspace,
  STAKEHOLDERS_CSV_COLUMNS,
  stakeholderFieldToString,
  buildStakeholderFromObj,
  stakeholdersToCsv,
  csvToStakeholders,
} from "./storage";
import type { Stakeholder } from "./types";

const sample: Stakeholder = {
  id: 1, name: "Sponsor Sam", organization: "Acme", title: "VP",
  email: "sam@acme.test", category: "Sponsor", influence: "High",
  interest: "Medium", notes: "key approver", resourceId: 4,
  raci: { "10": "A", "12": "C" }, localModifiedAt: "2026-06-04T00:00:00.000Z",
};

describe("stakeholder storage round-trip", () => {
  it("survives JSON encode -> decode", () => {
    const ws = { ...emptyWorkspace(), stakeholders: [sample] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.stakeholders).toEqual([sample]);
  });

  it("drops malformed stakeholder rows on load", () => {
    const json = JSON.stringify({ ...emptyWorkspace(), stakeholders: [{ name: "no id" }, sample] });
    expect(jsonToWorkspace(json).stakeholders).toHaveLength(1);
  });

  it("survives CSV encode -> decode (incl. raci map + resourceId)", () => {
    const csv = stakeholdersToCsv([sample]);
    const back = csvToStakeholders(csv);
    expect(back).toEqual([sample]);
  });

  it("STAKEHOLDERS_CSV_COLUMNS lists the canonical order", () => {
    expect(STAKEHOLDERS_CSV_COLUMNS).toEqual([
      "id", "name", "organization", "title", "email", "category",
      "influence", "interest", "notes", "resourceId", "raci", "localModifiedAt", "knowledgeLinks",
    ]);
  });

  it("stakeholderFieldToString encodes the raci map pipe-joined; buildStakeholderFromObj round-trips", () => {
    const obj: Record<string, string> = {};
    for (const col of STAKEHOLDERS_CSV_COLUMNS) obj[col] = stakeholderFieldToString(sample, col);
    expect(obj.raci).toBe("10=A|12=C");
    expect(obj.resourceId).toBe("4");
    const back = buildStakeholderFromObj(obj);
    expect(back).toEqual(sample);
  });
});
