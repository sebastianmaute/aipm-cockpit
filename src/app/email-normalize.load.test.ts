import { describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { migrateTask } from "./task-status";
import { sanitizeRaidEscalations } from "./raid-escalation";

// Spec Part 2: a stored `Name <addr>` loads as `addr` on every text/JSON codec.
// The object is built UNSANITIZED on purpose — the loader is the subject.
// Turso (single + tenant) decodes through the same `build*FromObj` / `sanitizeX`
// functions as CSV (`ENTITY_SPECS`); that shared decode path is its only
// coverage here. IndexedDB is pinned in browser-backend.test.ts.
function seeded(): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [{ id: 1, taskName: "T", assignee: "Ada", assigneeEmail: "Ada <ada@x.com>", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" } as never],
    raid: [{ id: 1, category: "R", title: "Risk", ownerEmail: "Ann <ann@x.com>", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-06-01", status: "Open", severity: "Medium" } as never],
    absences: [{ id: 1, assignee: "Ada", assigneeEmail: "Ada <ada@x.com>", startDate: "2026-06-01", endDate: "2026-06-02", type: "vacation" } as never],
    resources: [{ id: 1, firstName: "Ada", lastName: "L", email: "Ada <ada@x.com>", emails: ["b@y.com; c@z.com", "Ann <d@w.com>"], roleId: null, utilizationMode: "percent", utilization: {} } as never],
    stakeholders: [{ id: 1, name: "Sam", category: "Other", influence: "Medium", interest: "Medium", raci: {}, email: "Sam <sam@x.com>" } as never],
    shifts: [{ id: 1, assignee: "Shay", assigneeEmail: "Shay <shay@x.com>", hoursPerWeekday: { sun: 0, mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0 } } as never],
    project: { name: "P", code: "P", contactPersons: [{ name: "Cleo", email: "Cleo <cleo@x.com>", synced: false }] } as never,
  };
}

function expectNormalised(ws: Workspace): void {
  expect(ws.tasks[0].assigneeEmail).toBe("ada@x.com");
  expect(ws.raid[0].ownerEmail).toBe("ann@x.com");
  expect(ws.absences[0].assigneeEmail).toBe("ada@x.com");
  expect(ws.resources[0].email).toBe("ada@x.com");
  // ★ "b@y.com; c@z.com" alone is vacuous for CSV and Markdown: those codecs
  //  already split on ";" today (§533). "Ann <d@w.com>" becomes "d@w.com" only
  //  through normalizeEmailListShape, on every codec (pre-flight M3).
  expect(ws.resources[0].emails).toEqual(["b@y.com", "c@z.com", "d@w.com"]);
  expect(ws.stakeholders?.[0].email).toBe("sam@x.com");
  expect(ws.shifts[0]?.assigneeEmail).toBe("shay@x.com");
  expect(ws.project?.contactPersons?.[0]?.email).toBe("cleo@x.com");
}

type RoundTrip = (ws: Workspace) => Workspace;
const CODECS: [string, RoundTrip][] = [
  ["JSON", (ws) => jsonToWorkspace(workspaceToJson(ws))],
  ["CSV", (ws) => csvToWorkspace(workspaceToCsv(ws))],
  ["Markdown", (ws) => markdownToWorkspace(workspaceToMarkdown(ws))],
];

// Fix round 1: the normaliser runs BEFORE the cap. Capping first cut the `>`
// off a `Name <addr>` longer than the cap, storing it torn instead of unwrapped.
describe("a Name <addr> longer than its field's cap still unwraps", () => {
  const longStakeholder = `Ann ${"x".repeat(196)} <a@x.com>`; // BUDGET_NAME_MAX (200) site
  const longAbsence = `Ada ${"x".repeat(310)} <ada@x.com>`; // EMAIL_MAX (320) site
  const overCap = (): Workspace => {
    const base = seeded();
    return {
      ...base,
      stakeholders: [{ ...base.stakeholders![0], email: longStakeholder }],
      absences: [{ ...base.absences[0], assigneeEmail: longAbsence }],
    };
  };
  it.each(CODECS)("%s", (_label, roundTrip) => {
    expect(longStakeholder.length).toBeGreaterThan(200); // control: really over the cap
    expect(longAbsence.length).toBeGreaterThan(320);
    const out = roundTrip(overCap());
    expect(out.stakeholders?.[0].email).toBe("a@x.com");
    expect(out.absences[0].assigneeEmail).toBe("ada@x.com");
  });
});

describe("the Name <addr> normaliser on every load funnel", () => {
  it("JSON", () => expectNormalised(jsonToWorkspace(workspaceToJson(seeded()))));
  it("CSV", () => expectNormalised(csvToWorkspace(workspaceToCsv(seeded()))));
  it("Markdown", () => expectNormalised(markdownToWorkspace(workspaceToMarkdown(seeded()))));
  it("migrateTask keeps the reference when nothing changes", () => {
    const task = seeded().tasks[0];
    const clean = { ...task, assigneeEmail: "ada@x.com" };
    expect(migrateTask(clean)).toBe(clean);
  });
  it("an escalation Name <addr> loads as addr; a Name <a,b@x.com> is still dropped", () => {
    const at = "2026-05-20T09:30:00.000Z";
    expect(sanitizeRaidEscalations([{ at, toEmail: "Ops <ops@x.com>" }])).toEqual([{ at, toEmail: "ops@x.com" }]);
    expect(sanitizeRaidEscalations([{ at, toEmail: "Ops <a,b@x.com>" }])).toEqual([]);
  });
});
