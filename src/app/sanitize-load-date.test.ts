import { beforeEach, describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { ENTITY_SPECS } from "./turso-schema";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { __resetNonCalendarDateReportsForTests, requiredIsoDateOnLoad } from "./sanitize-load-date";
import {
  sanitizeAbsence, sanitizeFxRates, sanitizeMilestone,
  sanitizeBudgetBucket, sanitizeChangeItem, sanitizeProjectMeta, sanitizeRaidItem,
  sanitizeLoadedAbsence, sanitizeLoadedFxRates, sanitizeLoadedMilestone, sanitizeLoadedSeedMilestone,
} from "./sanitize";
import { sanitizeSeed } from "./templates";

// §539 follow-up (final fix round F1). A REQUIRED date that is shape-valid but
// not a real calendar date must not drop its whole record on load: it is kept
// raw, with a diagnostic. Optional dates still blank; writes still refuse.
const BAD = "2026-02-30";

beforeEach(() => {
  clearDiagLog();
  __resetNonCalendarDateReportsForTests();
});

function seeded(): Workspace {
  return {
    ...emptyWorkspace(),
    absences: [{ id: 1, assignee: "Ada", startDate: "2026-02-01", endDate: BAD, type: "vacation" } as never],
    milestones: [{ id: 1, name: "Go-Live", date: BAD, achievedDate: BAD, linkedTaskIds: [] } as never],
  };
}

type RoundTrip = (ws: Workspace) => Workspace;
const CODECS: [string, RoundTrip][] = [
  ["JSON", (ws) => jsonToWorkspace(workspaceToJson(ws))],
  ["CSV", (ws) => csvToWorkspace(workspaceToCsv(ws))],
  ["Markdown", (ws) => markdownToWorkspace(workspaceToMarkdown(ws))],
];

describe("requiredIsoDateOnLoad", () => {
  it("keeps a shape-valid non-calendar date raw and logs only source, entity, id and field", () => {
    expect(requiredIsoDateOnLoad(BAD, "absence", 7, "endDate")).toBe(BAD);
    const events = readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept");
    expect(events).toHaveLength(1);
    expect(events[0].fields).toEqual({ source: "workspace", entity: "absence", id: 7, field: "endDate" });
    expect(JSON.stringify(events)).not.toContain(BAD);
  });

  it("returns a real date verbatim and anything else as blank, without a diagnostic", () => {
    expect(requiredIsoDateOnLoad("2024-02-29", "milestone", 1, "date")).toBe("2024-02-29");
    expect(requiredIsoDateOnLoad("1899-02-30", "milestone", 1, "date")).toBe("");
    expect(requiredIsoDateOnLoad("2026-2-30", "milestone", 1, "date")).toBe("");
    expect(requiredIsoDateOnLoad("not-a-date", "milestone", 1, "date")).toBe("");
    expect(requiredIsoDateOnLoad(20260230, "milestone", 1, "date")).toBe("");
    expect(readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept")).toHaveLength(0);
  });
});

// Final fix round 3, R2. The diagnostic fired on EVERY load of an affected
// record (Turso re-reads call the decoder repeatedly), and a template seed's
// milestone logged exactly like a workspace milestone with the same id.
describe("the non-calendar date diagnostic names its source and does not repeat", () => {
  const kept = () => readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept").map((e) => e.fields);
  const JSON_WS = () => workspaceToJson(seeded());

  it("attributes a template seed milestone and a workspace milestone of the same id separately", () => {
    sanitizeSeed({ milestones: [{ id: 1, name: "Go-Live", date: BAD }] });
    jsonToWorkspace(JSON_WS());
    expect(kept()).toEqual(expect.arrayContaining([
      { source: "templateSeed", entity: "milestone", id: 1, field: "date" },
      { source: "workspace", entity: "milestone", id: 1, field: "date" },
      { source: "workspace", entity: "absence", id: 1, field: "endDate" },
    ]));
  });

  it("logs a record's kept value once per session, however often it is loaded", () => {
    jsonToWorkspace(JSON_WS());
    const first = kept().length;
    jsonToWorkspace(JSON_WS());
    jsonToWorkspace(JSON_WS());
    sanitizeSeed({ milestones: [{ id: 3, name: "Seed", date: BAD }] });
    sanitizeSeed({ milestones: [{ id: 3, name: "Seed", date: BAD }] });
    expect(first).toBeGreaterThan(0);
    expect(kept()).toHaveLength(first + 1);
  });

  it("logs again when the same record's field holds a DIFFERENT kept value (positive control)", () => {
    requiredIsoDateOnLoad("2026-02-30", "absence", 42, "endDate");
    requiredIsoDateOnLoad("2026-02-31", "absence", 42, "endDate");
    expect(kept().filter((f) => f?.id === 42)).toHaveLength(2);
  });
});

describe("a non-calendar required date survives every load funnel", () => {
  it.each(CODECS)("%s keeps the absence and the milestone, dates raw", (_label, roundTrip) => {
    const out = roundTrip(seeded());
    expect(out.absences).toHaveLength(1);
    expect(out.absences[0]).toMatchObject({ startDate: "2026-02-01", endDate: BAD });
    expect(out.milestones).toHaveLength(1);
    expect(out.milestones?.[0].date).toBe(BAD);
  });

  it("JSON blanks the OPTIONAL achievedDate while keeping the required date", () => {
    const out = jsonToWorkspace(workspaceToJson(seeded()));
    expect(out.milestones?.[0].date).toBe(BAD);
    expect(out.milestones?.[0].achievedDate).toBeUndefined();
    const kept = readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept").map((e) => e.fields);
    expect(kept).toEqual(expect.arrayContaining([
      { source: "workspace", entity: "absence", id: 1, field: "endDate" },
      { source: "workspace", entity: "milestone", id: 1, field: "date" },
    ]));
  });

  it("JSON keeps the fx-rates snapshot and the plan range", () => {
    const ws: Workspace = {
      ...emptyWorkspace(),
      fxRates: { base: "EUR", date: BAD, fetchedAt: "2026-02-01T00:00:00.000Z", rates: { EUR: 1 } } as never,
      plan: { startDate: "2026-01-01", endDate: BAD, granularity: "month", currency: "EUR" } as never,
    };
    const out = jsonToWorkspace(workspaceToJson(ws));
    expect(out.fxRates?.date).toBe(BAD);
    expect(out.plan).toMatchObject({ startDate: "2026-01-01", endDate: BAD });
  });

  it("Turso decodes the absence through the same load reader", () => {
    const spec = ENTITY_SPECS.find((s) => s.table === "absences")!;
    const row = spec.fromObj({ id: "1", assignee: "Ada", startDate: "2026-02-01", endDate: BAD, type: "vacation" } as never);
    expect(row).toMatchObject({ endDate: BAD });
  });
});

// ★★★ M2 (pre-release review): an OPTIONAL date the load funnel blanks under
// §539 was lost with no trace, while the REQUIRED path reports what it keeps.
// The outcome stays a blank; the loss is now reported in the same family —
// attributed source/entity/id/field, once per session per record/field/value.
describe("M2: an optional non-calendar date blanked on load is reported", () => {
  const blanked = () => readDiagLog().filter((e) => e.code === "storage.nonCalendarDateBlanked").map((e) => e.fields);
  const optionalWs = (): Workspace => ({
    ...emptyWorkspace(),
    milestones: [{ id: 1, name: "Go-Live", date: "2026-03-01", achievedDate: BAD, linkedTaskIds: [] } as never],
    changes: [{
      id: 2, title: "Scope", description: "", type: "Scope", status: "Approved", raisedDate: BAD, decisionDate: BAD,
      linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
    } as never],
    budgets: [{
      id: 3, name: "Build", type: "tm", currency: "EUR", startDate: BAD, endDate: "2026-12-31", status: "closed", closedDate: BAD, allocations: [],
    } as never],
    // Full shape (the CSV/MD writers need `contactPersons`); only the dates are raw.
    project: { ...sanitizeProjectMeta({ name: "Apollo" }), startDate: BAD, endDate: "2026-12-31" } as never,
  });
  const WS_EXPECTED = [
    { source: "workspace", entity: "change", id: 2, field: "raisedDate" },
    { source: "workspace", entity: "change", id: 2, field: "decisionDate" },
    { source: "workspace", entity: "budget", id: 3, field: "startDate" },
    { source: "workspace", entity: "budget", id: 3, field: "closedDate" },
    { source: "workspace", entity: "project", id: "", field: "startDate" },
  ];

  it("JSON reports the milestone, change, budget and project dates it blanks, and still blanks them", () => {
    const out = jsonToWorkspace(workspaceToJson(optionalWs()));
    expect(out.milestones?.[0].achievedDate).toBeUndefined();
    expect(out.changes?.[0]).toMatchObject({ raisedDate: "" });
    expect(out.changes?.[0].decisionDate).toBeUndefined();
    expect(out.budgets?.[0]).toMatchObject({ startDate: "", endDate: "2026-12-31" });
    expect(out.project?.startDate).toBe("");
    expect(blanked()).toEqual(expect.arrayContaining([
      { source: "workspace", entity: "milestone", id: 1, field: "achievedDate" }, ...WS_EXPECTED,
    ]));
    expect(JSON.stringify(readDiagLog())).not.toContain(BAD);
  });

  it.each(CODECS.slice(1))("%s reports the change, budget and project dates it blanks", (_label, roundTrip) => {
    const out = roundTrip(optionalWs());
    expect(out.budgets?.[0].startDate).toBe("");
    expect(blanked()).toEqual(expect.arrayContaining(WS_EXPECTED));
  });

  it("Turso decodes the change and the budget through the same reporting reader", () => {
    ENTITY_SPECS.find((s) => s.table === "budget_buckets")!.fromObj({ id: "3", name: "Build", startDate: BAD } as never);
    ENTITY_SPECS.find((s) => s.table === "changes")!.fromObj({ id: "2", title: "Scope", decisionDate: BAD } as never);
    expect(blanked()).toEqual(expect.arrayContaining([
      { source: "workspace", entity: "budget", id: 3, field: "startDate" },
      { source: "workspace", entity: "change", id: 2, field: "decisionDate" },
    ]));
  });

  it("a stored template seed attributes every blanked optional date to templateSeed", () => {
    sanitizeSeed({
      tasks: [{ id: 1, taskName: "T", dueDate: BAD, lastUpdateDate: "2026-01-01", completedDate: BAD }],
      raid: [{ id: 2, category: "R", title: "R", status: "Open", raisedDate: BAD, targetDate: BAD }],
      changes: [{ id: 3, title: "C", decisionDate: BAD }],
      milestones: [{ id: 4, name: "M", date: "2026-03-01", achievedDate: BAD }],
      budgets: [{ id: 5, name: "B", endDate: BAD }],
    });
    expect(blanked()).toEqual(expect.arrayContaining([
      { source: "templateSeed", entity: "task", id: 1, field: "dueDate" },
      { source: "templateSeed", entity: "task", id: 1, field: "completedDate" },
      { source: "templateSeed", entity: "raid", id: 2, field: "raisedDate" },
      { source: "templateSeed", entity: "raid", id: 2, field: "targetDate" },
      { source: "templateSeed", entity: "change", id: 3, field: "decisionDate" },
      { source: "templateSeed", entity: "milestone", id: 4, field: "achievedDate" },
      { source: "templateSeed", entity: "budget", id: 5, field: "endDate" },
    ]));
    expect(blanked().every((f) => f?.source === "templateSeed")).toBe(true);
  });

  it("reports a record's blanked value once per session, and again for a different value", () => {
    jsonToWorkspace(workspaceToJson(optionalWs()));
    const first = blanked().length;
    jsonToWorkspace(workspaceToJson(optionalWs()));
    csvToWorkspace(workspaceToCsv(optionalWs()));
    expect(first).toBeGreaterThanOrEqual(6);
    expect(blanked()).toHaveLength(first);
    const again = optionalWs();
    (again.milestones![0] as { achievedDate?: string }).achievedDate = "2026-02-31";
    jsonToWorkspace(workspaceToJson(again));
    expect(blanked()).toHaveLength(first + 1);
  });

  it("reports neither a valid, blank or non-date value, nor anything on a write path", () => {
    const ws = optionalWs();
    (ws.milestones![0] as { achievedDate?: string }).achievedDate = "tbd";
    jsonToWorkspace(workspaceToJson({ ...ws, changes: [], budgets: [], project: undefined }));
    expect(blanked()).toHaveLength(0);
    sanitizeMilestone({ id: 1, name: "M", date: "2026-03-01", achievedDate: BAD });
    sanitizeChangeItem({ id: 1, title: "C", decisionDate: BAD });
    sanitizeRaidItem({ id: 1, title: "R", targetDate: BAD });
    sanitizeBudgetBucket({ id: 1, name: "B", startDate: BAD });
    sanitizeProjectMeta({ name: "P", startDate: BAD });
    expect(blanked()).toHaveLength(0);
  });
});

describe("write paths still refuse a non-calendar required date (positive control)", () => {
  it("the strict sanitizers the writers call return null", () => {
    expect(sanitizeAbsence({ id: 1, assignee: "Ada", startDate: "2026-02-01", endDate: BAD })).toBeNull();
    expect(sanitizeMilestone({ id: 1, name: "Go-Live", date: BAD })).toBeNull();
    expect(sanitizeFxRates({ base: "EUR", date: BAD, fetchedAt: "2026-02-01T00:00:00.000Z", rates: {} })).toBeNull();
    expect(readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept")).toHaveLength(0);
  });
});

// C1 of the email-and-guard batch: while the date reader was an OPTIONAL second
// parameter, `arr.map(sanitizeMilestone)` handed it the index and threw. tsc
// cannot see that, so each public form is pinned by being passed point-free —
// two elements, because map hands index 0 AND 1.
describe("every date-reading sanitizer survives being passed point-free", () => {
  const MILE = { id: 1, name: "Go-Live", date: "2026-03-01" };
  const ABS = { id: 1, assignee: "Ada", startDate: "2026-02-01", endDate: "2026-02-02" };
  const FX = { base: "EUR", date: "2026-02-01", fetchedAt: "2026-02-01T00:00:00.000Z", rates: {} };
  const CASES: ReadonlyArray<readonly [string, (x: unknown) => unknown, unknown]> = [
    ["sanitizeMilestone", sanitizeMilestone, MILE],
    ["sanitizeLoadedMilestone", sanitizeLoadedMilestone, MILE],
    ["sanitizeLoadedSeedMilestone", sanitizeLoadedSeedMilestone, MILE],
    ["sanitizeAbsence", sanitizeAbsence, ABS],
    ["sanitizeLoadedAbsence", sanitizeLoadedAbsence, ABS],
    ["sanitizeFxRates", sanitizeFxRates, FX],
    ["sanitizeLoadedFxRates", sanitizeLoadedFxRates, FX],
  ];
  for (const [name, fn, raw] of CASES) {
    it(name, () => {
      const out = [raw, raw].map(fn);
      expect(out.every((x) => x !== null)).toBe(true);
    });
  }

  it("a template seed keeps both milestones, reading dates like the other load funnels", () => {
    const seed = sanitizeSeed({ milestones: [MILE, { ...MILE, id: 2, date: BAD }] });
    expect(seed?.milestones?.map((m) => m.date)).toEqual(["2026-03-01", BAD]);
  });
});
