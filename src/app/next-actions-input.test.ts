import { describe, expect, it } from "vitest";
import { buildActionInput } from "./next-actions-input";

const base = {
  tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dashboard: { budget: { effective: "G" }, evm: { cpi: 1 } } as any,
  commsReminders: [], features: ["raid"] as const, projectName: "Demo",
  today: "2026-06-15", now: new Date("2026-06-15T00:00:00Z"),
  reminderLeadDays: 7, dueSoonWorkdays: 3, raidReviewIntervalDays: 14,
};

describe("buildActionInput", () => {
  it("maps args onto the ActionInput shape", () => {
    const input = buildActionInput(base);
    expect(input.projectName).toBe("Demo");
    expect(input.features).toEqual(["raid"]);
    expect(input.dueSoonWorkdays).toBe(3);
  });
  it("defaults dismissed to an empty set when omitted", () => {
    expect(buildActionInput(base).dismissed.size).toBe(0);
  });
  it("passes a provided dismissed set through", () => {
    const d = new Set(["x"]);
    expect(buildActionInput({ ...base, dismissed: d }).dismissed).toBe(d);
  });
  it("surfaces a provided steeringCommittee on the built ActionInput", () => {
    const committee = { name: "SteerCo", memberResourceIds: [], meetings: [], infoSchedules: [] };
    expect(buildActionInput({ ...base, steeringCommittee: committee }).steeringCommittee).toBe(committee);
  });
  it("leaves steeringCommittee undefined when omitted", () => {
    expect(buildActionInput(base).steeringCommittee).toBeUndefined();
  });
});

describe("confidence field passthrough", () => {
  const base = {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: { budget: { effective: "G" }, evm: {} } as never,
    commsReminders: [], features: [], projectName: "P",
    today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
    reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
  };
  it("passes trends and weight overrides straight through", () => {
    const input = buildActionInput({
      ...base,
      trends: { budget: "worsening" },
      clarityBonus: 20, semiClarityBonus: 9, staticPenalty: 30,
    });
    expect(input.trends).toEqual({ budget: "worsening" });
    expect(input.clarityBonus).toBe(20);
    expect(input.semiClarityBonus).toBe(9);
    expect(input.staticPenalty).toBe(30);
  });
  it("leaves them undefined when omitted", () => {
    const input = buildActionInput(base);
    expect(input.trends).toBeUndefined();
    expect(input.clarityBonus).toBeUndefined();
  });
});

describe("project key-fact passthrough", () => {
  const base = {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: {} as never, commsReminders: [], features: [], projectName: "P",
    today: "2026-09-13", now: new Date("2026-09-13T00:00:00Z"),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30,
  };

  it("passes projectId and projectMeta through", () => {
    const meta = { name: "P" } as never;
    const input = buildActionInput({ ...base, projectId: "p1", projectMeta: meta });
    expect(input.projectId).toBe("p1");
    expect(input.projectMeta).toBe(meta);
  });

  // G8: the previous version of this test ("leaves both undefined when
  // omitted") passed on pre-change code too — `input.projectId` reads
  // `undefined` from a plain object whether or not `buildActionInput` ever
  // assigns the key. Assert the OWN PROPERTY exists (set to `undefined`)
  // rather than merely reading as falsy, so deleting the passthrough lines
  // — which removes the key entirely rather than setting it undefined —
  // actually turns this red.
  it("keeps projectId/projectMeta as explicit own properties (undefined) when omitted", () => {
    const input = buildActionInput(base);
    expect(Object.prototype.hasOwnProperty.call(input, "projectId")).toBe(true);
    expect(input.projectId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(input, "projectMeta")).toBe(true);
    expect(input.projectMeta).toBeUndefined();
  });
});
