import { beforeEach, describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { ENTITY_SPECS } from "./turso-schema";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { requiredIsoDateOnLoad } from "./sanitize-load-date";
import { sanitizeAbsence, sanitizeFxRates, sanitizeMilestone } from "./sanitize";

// §539 follow-up (final fix round F1). A REQUIRED date that is shape-valid but
// not a real calendar date must not drop its whole record on load: it is kept
// raw, with a diagnostic. Optional dates still blank; writes still refuse.
const BAD = "2026-02-30";

beforeEach(() => {
  clearDiagLog();
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
  it("keeps a shape-valid non-calendar date raw and logs only entity, id and field", () => {
    expect(requiredIsoDateOnLoad(BAD, "absence", 7, "endDate")).toBe(BAD);
    const events = readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept");
    expect(events).toHaveLength(1);
    expect(events[0].fields).toEqual({ entity: "absence", id: 7, field: "endDate" });
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
      { entity: "absence", id: 1, field: "endDate" },
      { entity: "milestone", id: 1, field: "date" },
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

describe("write paths still refuse a non-calendar required date (positive control)", () => {
  it("the strict sanitizers the writers call return null", () => {
    expect(sanitizeAbsence({ id: 1, assignee: "Ada", startDate: "2026-02-01", endDate: BAD })).toBeNull();
    expect(sanitizeMilestone({ id: 1, name: "Go-Live", date: BAD })).toBeNull();
    expect(sanitizeFxRates({ base: "EUR", date: BAD, fetchedAt: "2026-02-01T00:00:00.000Z", rates: {} })).toBeNull();
    expect(readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept")).toHaveLength(0);
  });
});
